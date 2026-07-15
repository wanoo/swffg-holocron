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

const CHUNK = 40; // taille des lots _id__in pour les packs

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
    const candidates = (Array.isArray(list) ? list : [])
      .filter((x) => x && x.name === configJournalName && x.flags?.holocron?.config);
    candidates.sort((a, b) => JSON.stringify(b.flags.holocron.config).length - JSON.stringify(a.flags.holocron.config).length);
    set('config', candidates[0]?.flags?.holocron?.config || {});
  }

  async function syncUsers() {
    const users = await mcpCall('get_users', {});
    set('users', (Array.isArray(users) ? users : []).filter((u) => u && u._id)
      .map((u) => ({ _id: u._id, name: u.name, role: u.role, character: u.character || null, color: u.color || null })));
  }

  async function syncFolders() {
    const folders = await mcpCall('get_folders', {});
    set('folders', (Array.isArray(folders) ? folders : []).filter((f) => f && f._id));
  }

  // Dossiers de journaux que l'Holocron affiche/utilise réellement : catégories
  // déclarées + Bible MJ + dossiers MJ/outils connus. On EXCLUT tout le reste — en
  // particulier les milliers de journaux hors-scope (planètes MEJ de la nouvelle
  // astronav, gérées par leur propre module), qui sinon submergent la synchro.
  const GM_FOLDER_NAMES = ['🎭 PNJ & fronts', '🖥️ Poste de commande', '🧰 Ressources MJ', '🎬 Actes & scénarios', '🛠️ Ateliers', '🎴 Sabacc', 'Boutiques'];
  function relevantJournalFolderIds() {
    const cfg = get('config') || {};
    const refs = new Set(GM_FOLDER_NAMES);
    for (const c of (cfg.categories || [])) if (c && c.folder) refs.add(c.folder);
    if (cfg.gmBibleFolder) refs.add(cfg.gmBibleFolder);
    const folders = (get('folders') || []).filter((f) => f && f.type === 'JournalEntry');
    // une référence de config = nom Foundry, _id ou uuid « Folder.<id> »
    return new Set(folders.filter((f) => refs.has(f.name) || refs.has(f._id) || refs.has(`Folder.${f._id}`)).map((f) => f._id));
  }

  // Entrée d'index (sans les pages) dérivée d'un doc complet.
  const lightEntry = (j) => {
    const e = {};
    for (const k of INDEX_FIELDS) if (j[k] !== undefined) e[k] = j[k];
    return e;
  };

  // Synchro des journaux en 1 SEUL APPEL PAR DOSSIER pertinent (PAGES INCLUSES) :
  // d'une même réponse on remplit le cache `journal:<id>` ET l'index léger. Fini les
  // ~70 pulls individuels (tous sériés par le connecteur socket) → de ~73 appels à
  // ~une douzaine. Le connecteur ne supportant pas le concurrentiel (cf. mcp.mjs :
  // file séquentielle), on optimise en RÉDUISANT le nombre d'appels, pas en parallèle.
  // Dossiers hors-scope (ex. milliers de planètes MEJ) jamais visités : cf. l'allowlist.
  // Gardes anti-OOM : au-delà de FOLDER_CHUNK journaux, un dossier est synchronisé
  // en INCRÉMENTAL (index léger + full uniquement sur les journaux modifiés — une
  // petite réponse par journal, jamais un dump du dossier entier, qui tue le
  // connecteur par manque de mémoire sur une petite instance). Au-delà de
  // FOLDER_MAX, le dossier est ignoré (dossier hors-scope, ex. atlas de planètes).
  const FOLDER_CHUNK = 40;
  const FOLDER_MAX = 800;

  async function syncJournalsFull() {
    const relevant = relevantJournalFolderIds();
    const index = [];
    // 0. liste légère GLOBALE (une seule fois par tick) : comptes par dossier
    // (gardes) + base des pulls hors-dossier/techniques de la phase 2.
    let light = [];
    try {
      const res = await mcpCall('get_journals', { requested_fields: ['_id', 'name', 'folder'] });
      light = (Array.isArray(res) ? res : []).filter((r) => r && r._id);
    } catch (e) { logger.error(`[store] liste légère journaux: ${e.message}`); }
    const counts = new Map();
    for (const r of light) if (r.folder) counts.set(r.folder, (counts.get(r.folder) || 0) + 1);

    for (const fid of relevant) {
      const n = counts.get(fid) || 0;
      try {
        if (n > FOLDER_MAX) { logger.error(`[store] dossier ${fid} ignoré : ${n} journaux (> ${FOLDER_MAX}, garde anti-dump)`); continue; }
        if (n > FOLDER_CHUNK) {
          // GROS dossier (ex. bible MJ) : index avec flags/_stats, puis full ciblé sur
          // les seuls journaux nouveaux/modifiés (les écritures web bumpent _stats via
          // le flag rev ; une édition de PAGE seule côté Foundry peut attendre un flag).
          const idx = await mcpCall('get_journals', { where: { folder: fid }, requested_fields: INDEX_FIELDS });
          for (const e of (Array.isArray(idx) ? idx : [])) {
            if (!e || !e._id) continue;
            index.push(e);
            const cached = get(`journal:${e._id}`);
            const fresh = cached && (cached._stats?.modifiedTime || 0) >= (e._stats?.modifiedTime || 1);
            if (fresh) continue;
            const list = await mcpCall('get_journals', { where: { _id: e._id } });
            const j = (Array.isArray(list) ? list : []).find((x) => x && x._id === e._id);
            if (j) set(`journal:${j._id}`, j);
          }
        } else {
          const list = await mcpCall('get_journals', { where: { folder: fid } }); // docs complets
          for (const j of (Array.isArray(list) ? list : [])) {
            if (!j || !j._id) continue;
            set(`journal:${j._id}`, j);
            index.push(lightEntry(j));
          }
        }
        if (index.length) set('journalsIndex', [...index]); // index PROGRESSIF : les journaux apparaissent dossier par dossier
      } catch (e) { logger.error(`[store] journaux dossier ${fid}: ${e.message}`); }
    }
    // journaux SANS dossier utiles (Dossiers/Notes MJ, Mondes…) + journaux TECHNIQUES
    // suivis PAR NOM où qu'ils soient rangés (le module ≥1.5.0 les range dans le
    // dossier système, hors allowlist) : réutilise la liste légère du début.
    try {
      const cfgJ = (get('config') || {}).journals || {};
      const UTIL_NAMES = new Set([
        '🚀 Vaisseau du groupe', '🖥️ Codex du groupe', '📡 HoloNet — Actualités',
        '🗒️ Notes MJ (Holocron)', '⚔️ Bibliothèque de rencontres', '🗂️ Dossiers MJ (Holocron)',
        process.env.CONFIG_JOURNAL_NAME || '⚙️ Holocron Config',
        ...Object.values(cfgJ).filter((v) => typeof v === 'string' && v && !v.includes(':')),
      ]);
      const NOISE = /^(sequencerDatabase|dice_helper)$/i; // DB de module / barème (déjà synced à part)
      const nulls = light.filter((r) => (!r.folder || (UTIL_NAMES.has(r.name) && !relevant.has(r.folder)))
        && !NOISE.test(r.name || ''));
      for (const r of nulls) {
        try {
          const list = await mcpCall('get_journals', { where: { _id: r._id } });
          const j = (Array.isArray(list) ? list : []).find((x) => x && x._id === r._id);
          if (j) { set(`journal:${j._id}`, j); index.push(lightEntry(j)); }
        } catch { /* journal individuel indisponible : on ignore */ }
      }
    } catch (e) { logger.error(`[store] journaux hors-dossier: ${e.message}`); }
    if (index.length) set('journalsIndex', index);
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
    set('diceHelper', out);
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

  // Page de notes du vaisseau (config.journals.shipNotes = "<jid>:<pid>") : son
  // journal peut vivre hors des dossiers synchronisés → pull ciblé à chaque tick.
  async function syncShipNotes() {
    const ref = String((get('config') || {}).journals?.shipNotes || '');
    const jid = ref.split(':')[0];
    if (jid) await syncJournal(jid);
  }

  // Tous les acteurs MONDE (PJ + PNJ custom) — les vues filtrent par dossier.
  async function syncActors() {
    const actors = await mcpCall('get_actors', {});
    set('actors', (Array.isArray(actors) ? actors : []).filter((a) => a && a._id));
  }

  // Compendium complet par chunks (index léger puis _id__in) — jamais de dump.
  async function syncPack(packId, type) {
    const idx = await mcpCall('get_pack_documents', { type, pack: packId, requested_fields: ['_id', 'name'] });
    const ids = (Array.isArray(idx) ? idx : []).map((d) => d._id).filter(Boolean);
    const docs = [];
    for (let i = 0; i < ids.length; i += CHUNK) {
      const chunk = await mcpCall('get_pack_documents', { type, pack: packId, query: { _id__in: ids.slice(i, i + CHUNK) } });
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
