// sync-store.mjs — cache mémoire + disque des données Foundry, resynchronisé en
// tâche de fond. AUCUN appel MCP dans le chemin d'une requête entrante : on sert
// l'état courant (éventuellement stale) instantanément.
//
// Collections :
//   config         journal « ⚙️ Holocron Config » (flags.holocron.config)
//   users          get_users (login + rôles)
//   folders        get_folders
//   journalsIndex  index léger (requested_fields, sans pages) — pattern anti-dump
//   journal:<id>   document complet, pullé seulement si l'index a bougé
//   pcs            acteurs du dossier PJ (fiches complètes)
//   pack:<id>      compendium paginé par chunks d'ids (_id__in)
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { mcpCall } from './mcp.mjs';
import { resolveCategories } from './transform/categories.mjs';
import { ccType } from './transform/tags.mjs';

const CHUNK = 40; // taille des lots _id__in pour les packs

/* --------------------------------------------- contrat de réponse du gateway --
 * Les outils `get_<collection>` répondent un TABLEAU NU de documents source
 * (`_id` et `name` toujours projetés) — cf. docs/integrators.md du gateway. Une
 * erreur remonte en exception depuis mcp.mjs, jamais en tableau : tout ce qui
 * n'est pas un tableau ici est une anomalie, on la traite comme « vide » plutôt
 * que de faire planter un tick entier.
 *
 * ⚠️ Piège vérifié contre le monde de prod : les opérateurs de `where` sont des
 * SUFFIXES de clé (`{ _id__in: [...] }`), PAS des objets imbriqués
 * (`{ _id: { __in: [...] } }`) — cette seconde forme ne lève aucune erreur et
 * renvoie silencieusement 0 document. Toujours passer par `whereIdIn`/`whereOp`.
 */
export const asDocs = (res) => (Array.isArray(res) ? res : []).filter((d) => d && d._id);

/** Clause `where` d'appartenance à une liste d'ids (forme suffixe du gateway). */
export const whereIdIn = (ids) => ({ _id__in: [...ids] });

/** Clause `where` générique : whereOp('flags.campaign-codex.type', 'in', [...]). */
export const whereOp = (path, op, value) => ({ [op ? `${path}__${op}` : path]: value });

/** Le document en cache est-il à jour vis-à-vis de son entrée d'index ? */
export const isFresh = (cached, entry) =>
  Boolean(cached) && (cached._stats?.modifiedTime || 0) >= (entry?._stats?.modifiedTime || 1);

/** Signature d'une collection pour l'invalidation d'ETag (ids + modifiedTime). */
export const indexSignature = (entries) =>
  (entries || []).map((e) => `${e._id}:${e._stats?.modifiedTime || 0}`).join('|');

// Dossiers de journaux que l'Holocron affiche/utilise réellement : catégories
// déclarées PAR DOSSIER + Bible MJ + dossiers MJ/outils connus. Les catégories
// définies par TAG ou par TYPE CC ne passent pas par là : elles sont résolues sur
// l'index (cf. journalRelevance), donc valables où que vive la fiche.
const GM_FOLDER_NAMES = ['🎭 PNJ & fronts', '🖥️ Poste de commande', '🧰 Ressources MJ', '🎬 Actes & scénarios', '🛠️ Ateliers', '🎴 Sabacc', 'Boutiques', '🎯 Quêtes'];

export function relevantJournalFolderIds({ config, folders } = {}) {
  const cfg = config || {};
  const refs = new Set(GM_FOLDER_NAMES);
  for (const c of (cfg.categories || [])) if (c && c.folder) refs.add(c.folder);
  if (cfg.gmBibleFolder) refs.add(cfg.gmBibleFolder);
  const list = (folders || []).filter((f) => f && f.type === 'JournalEntry');
  // une référence de config = nom Foundry, _id ou uuid « Folder.<id> »
  return new Set(list.filter((f) => refs.has(f.name) || refs.has(f._id) || refs.has(`Folder.${f._id}`)).map((f) => f._id));
}

// Journaux techniques suivis PAR NOM, où qu'ils soient rangés.
const utilityNames = (cfg) => new Set([
  '🚀 Vaisseau du groupe', '🖥️ Codex du groupe', '📡 HoloNet — Actualités',
  '🗒️ Notes MJ (Holocron)', '⚔️ Bibliothèque de rencontres', '🗂️ Dossiers MJ (Holocron)',
  '🗺️ Carte de campagne (Holocron)',
  process.env.CONFIG_JOURNAL_NAME || '⚙️ Holocron Config',
  ...Object.values(cfg?.journals || {}).filter((v) => typeof v === 'string' && v && !v.includes(':')),
]);

const NOISE = /^(sequencerDatabase|dice_helper)$/i; // DB de module / barème (synced à part)

/**
 * Prédicat de PERTINENCE d'un journal pour la synchro — un journal est
 * synchronisé s'il est :
 *   • dans un dossier de catégorie déclarée, la Bible MJ ou un dossier MJ connu ;
 *   • une FICHE CAMPAIGN CODEX (`flags.campaign-codex.type`), OÙ QU'ELLE VIVE —
 *     c'est le virage « 100 % CC » : le MJ range ses fiches comme il veut, y
 *     compris dans les dossiers « Campaign Codex - * » créés par le module ;
 *   • ciblé par une catégorie définie par TAG ou par TYPE CC (categories.mjs) ;
 *   • un journal technique suivi par nom, ou sans dossier.
 */
export function journalRelevance({ config, folders } = {}) {
  const cfg = config || {};
  const relevantFolders = relevantJournalFolderIds({ config: cfg, folders });
  const catsNoFolder = resolveCategories({ config: cfg, folders }).filter((c) => c.source !== 'folder');
  const UTIL_NAMES = utilityNames(cfg);
  return (e) => {
    if (!e || !e._id) return false;
    if (NOISE.test(e.name || '')) return false;
    if (!e.folder) return true;                    // journaux à la racine
    if (relevantFolders.has(e.folder)) return true;
    if (ccType(e)) return true;                    // fiche CC : pertinente où qu'elle soit
    if (UTIL_NAMES.has(e.name)) return true;       // journal technique suivi par nom
    return catsNoFolder.some((c) => c.match(e));   // catégorie par tag / type CC
  };
}

export function createStore({ dataDir, logger = console }) {
  const cacheDir = join(dataDir, 'cache');
  const mem = new Map();      // collection → { version, syncedAt, items }
  let versionCounter = 1;
  const status = new Map();   // collection → { syncedAt, lastError, size }
  let loop = null;

  const safe = (name) => name.replace(/[^a-zA-Z0-9_.:-]/g, '_');

  async function persist(name) {
    const entry = mem.get(name);
    if (!entry) return;
    await mkdir(cacheDir, { recursive: true });
    // Écriture DIRECTE (sans tmp+rename) : le FS Bucket Clever (FUSE réseau) ne
    // supporte pas rename() de façon fiable → le cache ne se persistait pas.
    await writeFile(join(cacheDir, safe(name) + '.json'), JSON.stringify(entry));
  }

  async function restore(name) {
    try {
      const raw = await readFile(join(cacheDir, safe(name) + '.json'), 'utf8');
      const entry = JSON.parse(raw);
      mem.set(name, entry);
      versionCounter = Math.max(versionCounter, (entry.version || 0) + 1);
      return true;
    } catch { return false; }
  }

  function set(name, items) {
    mem.set(name, { version: versionCounter++, syncedAt: Date.now(), items });
    status.set(name, { syncedAt: Date.now(), lastError: null, size: JSON.stringify(items).length });
    persist(name).catch((e) => logger.error(`[store] persist ${name}: ${e.message}`));
  }

  // set() qui NE BUMPE PAS la version quand rien n'a bougé : `sig` est une
  // signature bon marché du contenu (ids + modifiedTime). Les versions alimentent
  // les ETag des vues — les re-poser à chaque tick ferait re-télécharger toute
  // l'app toutes les 5 min alors que le monde n'a pas changé.
  const sigs = new Map();
  function setIfChanged(name, items, sig) {
    if (mem.has(name) && sigs.get(name) === sig) {
      const entry = mem.get(name);
      entry.syncedAt = Date.now();
      status.set(name, { ...(status.get(name) || {}), syncedAt: Date.now(), lastError: null });
      return false;
    }
    sigs.set(name, sig);
    set(name, items);
    return true;
  }

  const get = (name) => mem.get(name)?.items ?? null;
  const version = (name) => mem.get(name)?.version ?? 0;

  // write-through après une écriture Foundry réussie : le cache reflète NOTRE
  // écriture sans re-pull (le client stranjer ne voit pas ses propres writes).
  function patch(name, mutate) {
    const entry = mem.get(name);
    if (!entry) return;
    mutate(entry.items);
    entry.version = versionCounter++;
    entry.syncedAt = Date.now();
    persist(name).catch(() => {});
  }

  /* ------------------------------------------------------------- syncers -- */
  const INDEX_FIELDS = ['_id', 'name', 'folder', 'sort', 'ownership', 'flags', '_stats'];

  async function syncConfig(configJournalName) {
    const list = await mcpCall('get_journals', { where: { name: configJournalName } });
    // Plusieurs journaux peuvent porter ce nom (doublon d'installeur, copie…) :
    // on prend celui dont flags.holocron.config est le plus RICHE — jamais le
    // premier venu, qui peut être une coquille quasi vide.
    const candidates = asDocs(list)
      .filter((x) => x.name === configJournalName && x.flags?.holocron?.config);
    candidates.sort((a, b) => JSON.stringify(b.flags.holocron.config).length - JSON.stringify(a.flags.holocron.config).length);
    const cfg = candidates[0]?.flags?.holocron?.config || {};
    setIfChanged('config', cfg, JSON.stringify(cfg));
  }

  async function syncUsers() {
    const users = await mcpCall('get_users', {});
    const list = asDocs(users)
      .map((u) => ({ _id: u._id, name: u.name, role: u.role, character: u.character || null, color: u.color || null, active: !!u.active }));
    setIfChanged('users', list, JSON.stringify(list));
  }

  async function syncFolders() {
    const folders = await mcpCall('get_folders', {});
    const list = asDocs(folders);
    setIfChanged('folders', list, JSON.stringify(list));
  }

  // --- Synchro des journaux : index global puis pulls CIBLÉS et GROUPÉS --------
  //
  // 1 appel d'INDEX pour tout le monde (`requested_fields` : jamais les pages),
  // puis les seuls journaux PERTINENTS dont `_stats.modifiedTime` a bougé depuis
  // le cache, tirés par LOTS `_id__in`. Le connecteur sérialise tout (cf. mcp.mjs)
  // → on optimise le NOMBRE d'appels, pas le parallélisme.
  //
  //   à froid : 1 + ⌈pertinents / PULL_CHUNK⌉ appels
  //   à chaud : 1 appel (rien n'a changé → aucun pull)
  //
  // Remplace la marche dossier-par-dossier et ses gardes empiriques (FOLDER_CHUNK
  // 40 / FOLDER_MAX 800), qui re-dumpaient chaque dossier à chaque tick.
  //
  // Pertinence — un journal est synchronisé s'il est :
  //   • dans un dossier de catégorie déclarée, la Bible MJ ou un dossier MJ connu ;
  //   • une FICHE CAMPAIGN CODEX (`flags.campaign-codex.type`), OÙ QU'ELLE VIVE —
  //     c'est le virage « 100 % CC » : le MJ range ses fiches comme il veut, y
  //     compris dans les dossiers « Campaign Codex - * » créés par le module ;
  //   • ciblé par une catégorie définie par TAG ou par TYPE CC (cf. categories.mjs) ;
  //   • un journal technique suivi par NOM, ou sans dossier.
  const PULL_CHUNK = 25;   // journaux par appel `_id__in` (réponses ~200 Ko max)
  // Borne de sécurité : plafond de journaux tirés EN ENTIER dans un même tick.
  // Ce n'est plus une garde anti-OOM par dossier mais un simple garde-fou de
  // débit : au premier tick d'un très gros monde on en tire PULL_MAX, le reste
  // suit au tick suivant (l'index, lui, est toujours complet — les vues affichent
  // les fiches dès que leur contenu arrive). À 5 min/tick et 1500 docs, un monde
  // de 10 000 fiches est intégralement chaud en ~35 min, sans jamais saturer la
  // mémoire du connecteur.
  const PULL_MAX = 1500;

  const isRelevantJournal = () => journalRelevance({ config: get('config'), folders: get('folders') });

  async function syncJournalsFull() {
    // 1. index GLOBAL léger (un seul appel, pages exclues) : c'est lui qui porte
    // flags/ownership/_stats — donc la pertinence ET la détection de changement.
    let light = [];
    try {
      light = asDocs(await mcpCall('get_journals', { requested_fields: INDEX_FIELDS }));
    } catch (e) {
      logger.error(`[store] index journaux: ${e.message}`);
      return; // sans index on ne touche à rien : le cache précédent reste servi
    }

    const isRelevant = isRelevantJournal();
    const index = light.filter(isRelevant);

    // 2. delta : journaux pertinents absents du cache ou modifiés depuis.
    const stale = index.filter((e) => !isFresh(get(`journal:${e._id}`), e));
    if (stale.length > PULL_MAX) {
      logger.log(`[store] ${stale.length} journaux à rafraîchir : ${PULL_MAX} ce tick, le reste au suivant`);
    }
    const todo = stale.slice(0, PULL_MAX);

    // 3. pulls GROUPÉS par lots d'ids (docs complets, pages incluses).
    for (let i = 0; i < todo.length; i += PULL_CHUNK) {
      const ids = todo.slice(i, i + PULL_CHUNK).map((e) => e._id);
      try {
        for (const j of asDocs(await mcpCall('get_journals', { where: whereIdIn(ids) }))) {
          set(`journal:${j._id}`, j);
        }
      } catch (e) { logger.error(`[store] lot de journaux (${ids.length}): ${e.message}`); }
    }

    // 4. index publié en une fois — version bumpée SEULEMENT s'il a bougé (ETag).
    setIfChanged('journalsIndex', index, indexSignature(index));
  }

  // Barème de dépense FFG (journal « dice_helper ») — pullé par requête CIBLÉE
  // (where name), jamais via le gros index (qui peut être tronqué et faire sauter
  // ce journal). Stocké déjà parsé + re-clé SWFFG.SkillsNameX → X.
  async function syncDiceHelper() {
    const list = await mcpCall('get_journals', { where: { name: 'dice_helper' } });
    const j = (Array.isArray(list) ? list : []).find((x) => x && x.name === 'dice_helper');
    const page = (j?.pages || []).find((p) => p?.text?.content) || (j?.pages || [])[0];
    const raw = String(page?.text?.content || '').replace(/^\s*<p>/i, '').replace(/<\/p>\s*$/i, '').trim();
    const out = {};
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        for (const [k, v] of Object.entries(parsed)) out[k.replace(/^SWFFG\.SkillsName/, '')] = v;
      }
    } catch { /* journal absent ou non-JSON : barème vide, repli générique côté front */ }
    setIfChanged('diceHelper', out, JSON.stringify(out));
  }

  // Pull d'un journal complet — appelé par la boucle quand l'index a bougé,
  // ou explicitement après une écriture ciblée.
  async function syncJournal(id, name) {
    // where:{_id} vérifié au POC ; name en secours (documents renommés)
    let list = await mcpCall('get_journals', { where: { _id: id } });
    let j = (Array.isArray(list) ? list : []).find((x) => x && x._id === id);
    if (!j && name) {
      list = await mcpCall('get_journals', { where: { name } });
      j = (Array.isArray(list) ? list : []).find((x) => x && x.name === name);
    }
    if (j) set(`journal:${id}`, j);
    return j || null;
  }

  // Événements Mini Calendar : journal « Calendar Events - Mini Calendar » —
  // une page par date (nom "YYYY-MM-DD"), notes dans flags["wgtgm-mini-calendar"].notes.
  // Pullé par NOM (pattern dice_helper), aplati en événements datés pour la frise.
  const CALENDAR_JOURNAL = 'Calendar Events - Mini Calendar';
  async function syncCalendar() {
    const list = await mcpCall('get_journals', { where: { name: CALENDAR_JOURNAL } });
    const j = (Array.isArray(list) ? list : []).find((x) => x && x.name === CALENDAR_JOURNAL);
    const events = [];
    for (const page of (j?.pages || [])) {
      // nom de page Mini Calendar : "<année>-MM-DD", année NON paddée et
      // possiblement NÉGATIVE (calendrier Grande ReSynchronisation, an 0 = 35 BBY)
      const m = /^(-?\d+)-(\d+)-(\d+)$/.exec(String(page.name || ''));
      if (!m) continue; // (0000-Recurring : ignorée — pas de récurrence en frise)
      const notes = page.flags?.['wgtgm-mini-calendar']?.notes || [];
      for (const n of notes) {
        if (!n || typeof n !== 'object') continue;
        events.push({
          id: String(n.id || ''),
          year: +m[1], month: +m[2], day: +m[3],
          title: String(n.title || ''),
          content: String(n.content || ''),
          icon: String(n.icon || ''),
          playerVisible: Boolean(n.playerVisible),
        });
      }
    }
    setIfChanged('calendarEvents', events, JSON.stringify(events));
  }

  // Page de notes du vaisseau (config.journals.shipNotes = "<jid>:<pid>") : son
  // journal peut vivre hors des dossiers synchronisés → pull ciblé, mais SEULEMENT
  // s'il n'est pas déjà couvert par l'index (la fiche vaisseau est une fiche CC,
  // donc pertinente à ce titre : la synchro des journaux l'a déjà rafraîchie).
  async function syncShipNotes() {
    const ref = String((get('config') || {}).journals?.shipNotes || '');
    const jid = ref.split(':')[0];
    if (!jid) return;
    const entry = (get('journalsIndex') || []).find((e) => e._id === jid);
    const cached = get(`journal:${jid}`);
    if (entry && cached && (cached._stats?.modifiedTime || 0) >= (entry._stats?.modifiedTime || 1)) return;
    await syncJournal(jid);
  }

  // Tous les acteurs MONDE (PJ + PNJ custom) — les vues filtrent par dossier.
  // Même patron que les journaux : index léger (sans `items`/`system`, qui pèsent
  // l'essentiel d'une fiche SWFFG) puis pulls groupés des seuls acteurs modifiés.
  // La collection `actors` reste la LISTE COMPLÈTE de documents attendue par les
  // vues — elle est simplement reconstruite depuis le cache par acteur.
  const ACTOR_INDEX_FIELDS = ['_id', 'name', 'folder', 'type', 'ownership', 'img', '_stats'];

  async function syncActors() {
    const light = asDocs(await mcpCall('get_actors', { requested_fields: ACTOR_INDEX_FIELDS }));
    const stale = light.filter((a) => !isFresh(get(`actor:${a._id}`), a));
    for (let i = 0; i < stale.length; i += PULL_CHUNK) {
      const ids = stale.slice(i, i + PULL_CHUNK).map((a) => a._id);
      try {
        for (const a of asDocs(await mcpCall('get_actors', { where: whereIdIn(ids) }))) {
          set(`actor:${a._id}`, a);
        }
      } catch (e) { logger.error(`[store] lot d'acteurs (${ids.length}): ${e.message}`); }
    }
    // reconstruction dans l'ordre de l'index ; un acteur dont le pull a échoué
    // garde sa version en cache (et n'est omis que s'il n'a jamais été tiré).
    const full = light.map((a) => get(`actor:${a._id}`)).filter(Boolean);
    setIfChanged('actors', full, indexSignature(light));
  }

  // Compendium complet par chunks (index léger puis _id__in) — jamais de dump.
  async function syncPack(packId, type) {
    const idx = asDocs(await mcpCall('get_pack_documents', { type, pack: packId, requested_fields: ['_id', 'name'] }));
    const ids = idx.map((d) => d._id);
    const docs = [];
    for (let i = 0; i < ids.length; i += CHUNK) {
      const chunk = await mcpCall('get_pack_documents', { type, pack: packId, query: whereIdIn(ids.slice(i, i + CHUNK)) });
      if (Array.isArray(chunk)) docs.push(...chunk);
    }
    set(`pack:${packId}`, docs);
  }

  /* ------------------------------------------------------- boucle de fond -- */
  async function tick(opts) {
    const { configJournalName } = opts;
    // Ordre = ordre d'apparition (le connecteur sérialise). On sort d'abord le rapide
    // et à haute valeur (config, PJ/acteurs, barème), puis les journaux (le plus long).
    const jobs = [
      ['config', () => syncConfig(configJournalName)],
      ['folders', () => syncFolders()],        // avant les journaux (relevantFolderIds)
      ['users', () => syncUsers()],
      ['actors', () => syncActors()],           // PJ/PNJ tôt
      ['diceHelper', () => syncDiceHelper()],
      ['journals', () => syncJournalsFull()],   // 1 appel/dossier : cache journal + index (le plus long → en dernier)
      ['shipNotes', () => syncShipNotes()],      // pull ciblé (journal possiblement hors allowlist)
      ['calendar', () => syncCalendar()],        // événements Mini Calendar (frise chronologique)
    ];
    for (const [name, job] of jobs) {
      try { await job(); }
      catch (e) {
        status.set(name, { ...(status.get(name) || {}), lastError: String(e.message).slice(0, 200) });
        logger.error(`[store] sync ${name}: ${e.message}`);
      }
    }
    // (plus de boucle de pull individuel : syncJournalsFull a déjà tiré chaque
    // journal pertinent avec ses pages, en 1 appel par dossier.)
  }

  function startLoop(opts, intervalS = 300) {
    const run = () => tick(opts).catch((e) => logger.error(`[store] tick: ${e.message}`));
    run();
    loop = setInterval(run, intervalS * 1000);
    loop.unref?.();
  }

  async function boot() {
    // restaure TOUT le cache disque (collections cœur, journaux, packs)
    let restored = 0;
    try {
      const { readdir } = await import('node:fs/promises');
      for (const f of await readdir(cacheDir)) {
        if (!f.endsWith('.json')) continue;
        if (await restore(f.slice(0, -5))) restored++;
      }
    } catch { /* premier démarrage : pas de cache */ }
    return restored;
  }

  return {
    get, set, version, patch, boot, startLoop, status,
    sync: { config: syncConfig, users: syncUsers, folders: syncFolders, journals: syncJournalsFull, journalsIndex: syncJournalsFull, diceHelper: syncDiceHelper, journal: syncJournal, actors: syncActors, pack: syncPack, tick },
  };
}
