// board.mjs — Éditeur de campagne MJ (« carte de campagne ») : la donnée MJ vit
// dans un journal TECHNIQUE Foundry « 🗺️ Carte de campagne (Holocron) »
// (config.journals.board), même modèle que la bibliothèque de rencontres :
//   · flags.holocron.board     = { nodes: { id: {x, y, pinned?, sound?} },
//                                  edges: [{from, to, label?}], hidden: [] }
//     (id = _id Foundry du journal, ou « seq:<id> » pour une séquence de handouts)
//   · flags.holocron.sequences = [{ id, name, items: [{src, title, note}] }]
//   · flags.holocron.sessions  = [{ id, no, title, date, startedAt, endedAt,
//                                   played, reveals, shown, present, recap }]
//     (LA TRACE : ce qui s'est joué séance après séance — voir sanitizeSessions)
// Le CATALOGUE des objets de campagne (actes, quêtes, PNJ, orgs, lieux, boutiques
// Campaign Codex) et leurs LIENS AUTO sont DÉRIVÉS du SyncStore — jamais stockés.
// Chaque ACTE porte en plus un STORYBOARD (flags.holocron.storyboard sur SON
// journal — voir sanitizeStoryboard) : moments de jeu typés 🎭⚔️🗒️🖼️ enchaînés,
// MJ only, servi UNIQUEMENT par la vue board (route gm-gated).
import { mcpCall } from './mcp.mjs';
import { ccView, resolveFolder, sanitizeActSummary } from './transform/journals.mjs';

export const BOARD_DEFAULTS = { nodes: {}, edges: [], hidden: [] };

// Relations custom TYPÉES (table fermée) : libellé aller (fwd) ET retour (back),
// affiché selon le sens de lecture. Un lien peut aussi porter un libellé libre
// (`label`, prioritaire à l'affichage). Miroir front : gm-campaign.js.
export const EDGE_TYPES = {
  lien: { fwd: 'lié à', back: 'lié à' },
  revele: { fwd: 'révèle', back: 'révélé par' },
  mene: { fwd: 'mène à', back: 'accessible depuis' },
  allie: { fwd: 'allié de', back: 'allié de' },
  oppose: { fwd: 's’oppose à', back: 'visé par' },
  dette: { fwd: 'doit une dette à', back: 'créancier de' },
  membre: { fwd: 'membre de', back: 'compte dans ses rangs' },
  possede: { fwd: 'possède', back: 'appartient à' },
};

// id de nœud : _id Foundry (16 alphanum) ou id technique court (« seq:x… »)
const NODE_ID = /^[A-Za-z0-9:_-]{1,40}$/;
const okId = (s) => typeof s === 'string' && NODE_ID.test(s);
const clampPos = (v) => (Number.isFinite(+v) ? Math.max(-20000, Math.min(20000, Math.round(+v))) : 0);

/* ------------------------------------------------------------- storyboard --
 * Chaque ACTE porte un STORYBOARD : `flags.holocron.storyboard` SUR le journal
 * de l'acte = { beats: [beat] } — l'ORDRE du tableau est l'ordre narratif.
 * Un beat = un MOMENT DE JEU typé :
 *   { id, kind: scene|combat|note|handout, title, note (texte MJ court),
 *     uuids: ["JournalEntry.<id>", …]  (entités CC impliquées : PNJ/lieux/orgs/quêtes),
 *     encounterId?  (entrée de flags.holocron.encounters — kind combat),
 *     sequenceId?   (entrée de flags.holocron.sequences — kind scene/handout),
 *     handout?      (kind handout : handout UNITAIRE inline — voir sanitizeHandout),
 *     sound?: { playlist }, status: todo|encours|fait, x?, y? }.
 * MJ-ONLY STRICT : le storyboard ne sort QUE par la vue board (route gm-gated) —
 * jamais dans les vues publiques (buildJournalsView ne le lit pas). */
export const BEAT_KINDS = ['scene', 'combat', 'note', 'handout'];
export const BEAT_STATUS = ['todo', 'encours', 'fait'];

/* ---------------------------------------------------------------- trigger --
 * CHAQUE BEAT DÉCLARE CE QU'IL DÉCLENCHE (décision produit) : « ▶ Jouer ce
 * beat » n'exécute QUE ce bloc, rien de plus, rien d'implicite.
 *   trigger: { scene: "<nom ou _id>", pullUsers: bool,
 *              playlist: "…", weather: ["fog"|…|"clear"],
 *              sequenceId: "…", handout: {…}, encounterId: "…",
 *              pan: { x, y, scale } }
 * Toutes les clés sont FACULTATIVES ; un trigger vide n'est pas stocké. Les
 * effets météo sont une TABLE FERMÉE (le connecteur refuserait un id inconnu).
 * Ne jette JAMAIS : borne, normalise, laisse tomber l'illisible. */
export const WEATHER_EFFECTS = ['clear', 'rain', 'rainStorm', 'snow', 'blizzard',
  'fog', 'leaves', 'embers', 'birds', 'bubbles', 'stars', 'clouds'];
const WEATHER_BY_LOWER = new Map(WEATHER_EFFECTS.map((w) => [w.toLowerCase(), w]));

export function sanitizeTrigger(raw) {
  const t = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const out = {};
  // scène : NOM ou _id Foundry — le connecteur accepte les deux (activate_scene)
  const scene = String(t.scene || '').trim().slice(0, 120);
  if (scene) out.scene = scene;
  if (t.pullUsers === true) out.pullUsers = true;
  const playlist = String(t.playlist || '').trim().slice(0, 100);
  if (playlist) out.playlist = playlist;
  const weather = [...new Set((Array.isArray(t.weather) ? t.weather : [])
    .map((w) => WEATHER_BY_LOWER.get(String(w).trim().toLowerCase()))
    .filter(Boolean))].slice(0, 4);
  // « clear » est exclusif : couper la météo ou en poser, jamais les deux
  if (weather.includes('clear')) out.weather = ['clear'];
  else if (weather.length) out.weather = weather;
  if (okId(t.sequenceId)) out.sequenceId = t.sequenceId;
  if (okId(t.encounterId)) out.encounterId = t.encounterId;
  if (t.handout && typeof t.handout === 'object') {
    const h = sanitizeHandout(t.handout);
    if (h) out.handout = h;
  }
  if (t.pan && typeof t.pan === 'object' && (Number.isFinite(+t.pan.x) || Number.isFinite(+t.pan.y))) {
    const scale = Number.isFinite(+t.pan.scale) ? Math.max(0.1, Math.min(4, +t.pan.scale)) : 0;
    out.pan = { x: clampPos(t.pan.x), y: clampPos(t.pan.y), ...(scale ? { scale } : {}) };
  }
  return Object.keys(out).length ? out : null;
}

const beatUuid = (v) => {
  const s = String(v || '');
  const m = /JournalEntry\.([A-Za-z0-9]{16})/.exec(s);
  return m ? `JournalEntry.${m[1]}` : (/^[A-Za-z0-9]{16}$/.test(s) ? `JournalEntry.${s}` : null);
};

/** Assainit un storyboard complet (PUT client → flag). Ne jette jamais. */
export function sanitizeStoryboard(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const seen = new Set();
  const beats = (Array.isArray(s.beats) ? s.beats : []).slice(0, 60)
    .map((b) => {
      if (!b || typeof b !== 'object') return null;
      const id = okId(b.id) ? b.id : `beat-${Math.random().toString(36).slice(2, 10)}`;
      if (seen.has(id)) return null; // ids dupliqués : premier gagnant
      seen.add(id);
      const kind = BEAT_KINDS.includes(b.kind) ? b.kind : 'scene';
      const out = {
        id, kind,
        title: String(b.title || '').trim().slice(0, 120),
        note: String(b.note || '').slice(0, 2000),
        uuids: [...new Set((Array.isArray(b.uuids) ? b.uuids : []).slice(0, 16).map(beatUuid).filter(Boolean))],
        status: BEAT_STATUS.includes(b.status) ? b.status : 'todo',
      };
      // pièces jointes SELON le kind (le reste est ignoré à l'assainissement)
      if (kind === 'combat' && okId(b.encounterId)) out.encounterId = b.encounterId;
      if ((kind === 'scene' || kind === 'handout') && okId(b.sequenceId)) out.sequenceId = b.sequenceId;
      if (kind === 'handout' && b.handout && typeof b.handout === 'object') {
        // handout UNITAIRE inline (sans séquence) : {type, src|text, title, targets?}
        const h = sanitizeHandout(b.handout);
        if (h) out.handout = h;
      }
      const pl = b.sound && typeof b.sound === 'object' ? String(b.sound.playlist || '').slice(0, 100) : '';
      if (pl) out.sound = { playlist: pl };
      // déclencheur « ▶ Jouer ce beat » — TOUS les kinds (une note MJ peut très
      // bien ne poser qu'une ambiance) ; absent quand rien n'est déclaré.
      const trig = sanitizeTrigger(b.trigger);
      if (trig) out.trigger = trig;
      if (b.x != null && Number.isFinite(+b.x)) out.x = clampPos(b.x);
      if (b.y != null && Number.isFinite(+b.y)) out.y = clampPos(b.y);
      return out;
    })
    .filter(Boolean);
  return { beats };
}

/* ---------------------------------------------------------------- séances --
 * LA TRACE : `flags.holocron.sessions` SUR LE MÊME journal technique que
 * board/sequences — ce qui s'est RÉELLEMENT joué, séance après séance :
 *   { sessions: [{ id, no, title, date, startedAt, endedAt,
 *       played:  [{ actId, beatId, title, kind, at }],   // beats passés à « fait »
 *       reveals: [{ uuid, label, at, note }],            // ce qui a été révélé
 *       shown:   [{ type, title, targets, at }],         // handouts projetés
 *       acted:   [{ action, label, beatId, ok, at }],    // ▶ Jouer ce beat
 *       present: [userId],                               // qui était là
 *       recap:   { gm, players } }] }                    // debrief MJ + version publiable
 * Une séance TRAVERSE les actes (played porte son actId) : la trace est indexée
 * par SÉANCE, jamais par acte. Alimentée AUTOMATIQUEMENT par le storyboard
 * (cycleStatus / projection / « marquer révélé ») — le MJ ne saisit que le récap.
 * MJ-ONLY STRICT : ne sort que par les routes gm-gated (board.view / sessions). */
const MAX_SESSIONS = 200;
const MAX_ENTRIES = 400;

// horodatage : epoch ms ou chaîne ISO → epoch ms (0 = absent).
const clampAt = (v) => {
  if (v == null || v === '') return 0;
  const n = typeof v === 'number' ? v : Date.parse(String(v));
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(n, 4102444800000); // ≤ 2100-01-01, borne anti-absurde
};
const atOrNow = (v) => clampAt(v) || Date.now();
// uuid d'entité : « Type.<id16> » (type conservé) ou id16 nu → JournalEntry.<id>
const FOUNDRY_ID = /^[A-Za-z0-9]{16}$/;
const anyUuid = (v) => {
  const s = String(v || '').split('::')[0].trim();
  const m = /^([A-Za-z]{1,32})\.([A-Za-z0-9]{16})$/.exec(s);
  if (m) return `${m[1]}.${m[2]}`;
  const tail = /([A-Za-z]{1,32})\.([A-Za-z0-9]{16})(?!.*\.)/.exec(s);
  if (tail) return `${tail[1]}.${tail[2]}`;
  return FOUNDRY_ID.test(s) ? `JournalEntry.${s}` : null;
};
const txt = (v, n) => String(v == null ? '' : v).slice(0, n);
// ligne courte (titre, date…) : on rogne les blancs AVANT de borner, comme les beats
const line = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
const list = (v) => (Array.isArray(v) ? v : []).slice(0, MAX_ENTRIES);

/** Une entrée « beat joué ». null si inexploitable (pas de beat identifiable). */
function sanitizePlayed(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (!okId(raw.beatId)) return null;
  return {
    actId: FOUNDRY_ID.test(String(raw.actId || '')) ? String(raw.actId) : '',
    beatId: raw.beatId,
    title: line(raw.title, 120),
    kind: BEAT_KINDS.includes(raw.kind) ? raw.kind : 'scene',
    at: atOrNow(raw.at),
  };
}

/** Une révélation (entité CC montrée/semée). null si l'entité n'est pas identifiable. */
function sanitizeReveal(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const uuid = anyUuid(raw.uuid);
  if (!uuid) return null;
  const note = txt(raw.note, 500);
  return { uuid, label: line(raw.label, 120), at: atOrNow(raw.at), ...(note ? { note } : {}) };
}

/** Un handout réellement projeté. null si rien d'exploitable. */
function sanitizeShown(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const targets = [...new Set(list(raw.targets).map(String).filter((t) => USER_ID.test(t)))].slice(0, 30);
  return {
    type: HANDOUT_TYPES.includes(raw.type) ? raw.type : 'image',
    title: line(raw.title, 120),
    at: atOrNow(raw.at),
    ...(targets.length ? { targets } : {}), // absent = toute la table
  };
}

/** Une action de pilotage RÉELLEMENT exécutée par « ▶ Jouer ce beat » (scène
 * activée, playlist lancée, combat monté, caméra recadrée…). Complète played /
 * shown / reveals : c'est le « qu'est-ce que la machine a fait » du journal.
 * null si l'action n'est pas d'un type connu. */
export const BEAT_ACTIONS = ['scene', 'combat-scene', 'combat', 'playlist', 'weather', 'handout', 'sequence', 'pan'];
function sanitizeActed(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (!BEAT_ACTIONS.includes(raw.action)) return null;
  return {
    action: raw.action,
    label: line(raw.label, 160),
    ...(okId(raw.beatId) ? { beatId: raw.beatId } : {}),
    ok: raw.ok !== false,
    at: atOrNow(raw.at),
  };
}

/** Assainit UNE séance. Ne jette jamais : borne, normalise, jette l'illisible. */
export function sanitizeSession(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const no = Number.isFinite(+s.no) ? Math.max(1, Math.min(9999, Math.round(+s.no))) : 1;
  const recap = s.recap && typeof s.recap === 'object' ? s.recap : {};
  const out = {
    id: okId(s.id) ? s.id : `sess-${Math.random().toString(36).slice(2, 10)}`,
    no,
    title: txt(s.title, 120).trim(),
    date: txt(s.date, 40).trim(), // date « humaine » (ISO court le plus souvent)
    startedAt: clampAt(s.startedAt),
    endedAt: clampAt(s.endedAt),
    played: list(s.played).map(sanitizePlayed).filter(Boolean),
    reveals: list(s.reveals).map(sanitizeReveal).filter(Boolean),
    shown: list(s.shown).map(sanitizeShown).filter(Boolean),
    acted: list(s.acted).map(sanitizeActed).filter(Boolean),
    present: [...new Set(list(s.present).map(String).filter((u) => USER_ID.test(u)))].slice(0, 30),
    recap: { gm: txt(recap.gm, 8000), players: txt(recap.players, 8000) },
  };
  return out;
}

/** Assainit la collection complète (PUT client → flag). Ne jette jamais.
 * Ids dupliqués : premier gagnant (même règle que les beats). */
export function sanitizeSessions(raw) {
  const arr = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.sessions) ? raw.sessions : []);
  const seen = new Set();
  return arr.slice(0, MAX_SESSIONS)
    .map((s) => {
      const clean = sanitizeSession(s);
      if (seen.has(clean.id)) return null;
      seen.add(clean.id);
      return clean;
    })
    .filter(Boolean);
}

/** Type d'entrée → liste de la séance (patron du POST .../event). */
export const SESSION_EVENTS = { played: 'played', reveal: 'reveals', shown: 'shown', acted: 'acted' };
const EVENT_SANITIZERS = { played: sanitizePlayed, reveal: sanitizeReveal, shown: sanitizeShown, acted: sanitizeActed };

/** Ajout PUR d'une entrée à une séance (testable, sans I/O) :
 * retourne la NOUVELLE liste de séances, ou null si séance/kind inconnus ou
 * entrée inexploitable. La liste visée est bornée (les plus anciennes tombent).
 * DEUX formes acceptées :
 *   · { kind, entry: {…} }  — enveloppe EXPLICITE, à préférer : l'entrée
 *     `played` porte elle-même un champ `kind` (celui du BEAT) qui écrasait
 *     silencieusement le type d'événement dans la forme plate ;
 *   · { kind, …champs }     — forme plate historique, toujours lue. */
export function appendEvent(sessions, sessionId, patch) {
  const p = patch && typeof patch === 'object' ? patch : {};
  const { kind, entry, ...flat } = p;
  const key = SESSION_EVENTS[kind];
  const clean = EVENT_SANITIZERS[kind]?.(entry && typeof entry === 'object' ? entry : flat);
  if (!key || !clean) return null;
  const all = sanitizeSessions(sessions);
  const i = all.findIndex((s) => s.id === sessionId);
  if (i < 0) return null;
  const target = [...all[i][key], clean].slice(-MAX_ENTRIES);
  all[i] = { ...all[i], [key]: target };
  return all;
}

/* Tags d'acte « mj:acte-<n> » : le storyboard POSE (option « taguer les
 * participants ») ce tag dans `flags.campaign-codex.data.tags` des fiches CC
 * référencées par ses beats — indexé par Asset Librarian (« tout ce qui joue
 * dans l'acte 6 »). Idempotent : pose sur les référencées, retire sur celles
 * qui le portent sans plus être référencées ; uuids = [] retire partout. */
export const ACT_TAG_PREFIX = 'mj:acte-';

/** Numéro d'acte : premier nombre du NOM du journal, sinon rang (1-based) dans
 * les actes triés par sort Foundry. */
export function actNumberOf(entry, storyEntries) {
  const m = /(\d+)/.exec(String(entry?.name || ''));
  if (m) return +m[1];
  const i = (storyEntries || []).findIndex((j) => j._id === entry?._id);
  return i >= 0 ? i + 1 : 1;
}

const normTags = (raw) => (Array.isArray(raw) ? raw : String(raw || '').split(','))
  .map((t) => String(t).trim()).filter(Boolean);

/** Diff PUR des poses/retraits de tag (testable) : fiches CC uniquement.
 * Retourne { add: [{id, tags}], remove: [{id, tags}] } — tags = liste FINALE. */
export function actTagOps({ tag, uuids, journalsIndex, getJournal }) {
  const referenced = new Set((uuids || []).map((u) => String(u).split('.').pop()));
  const add = [];
  const remove = [];
  for (const e of (journalsIndex || [])) {
    if (!e?._id || !e.flags?.['campaign-codex']?.type) continue;
    if (e.flags?.['swffg-astronavigation']) continue; // atlas : jamais tagué
    const doc = getJournal?.(e._id) || e;
    const tags = normTags(doc.flags?.['campaign-codex']?.data?.tags ?? e.flags?.['campaign-codex']?.data?.tags);
    const has = tags.some((t) => t.toLowerCase() === tag.toLowerCase());
    if (referenced.has(e._id) && !has) add.push({ id: e._id, tags: [...tags, tag] });
    else if (!referenced.has(e._id) && has) remove.push({ id: e._id, tags: tags.filter((t) => t.toLowerCase() !== tag.toLowerCase()) });
  }
  return { add, remove };
}

/** Assainit un board complet (PUT client → flag). Ne jette jamais. */
export function sanitizeBoard(raw) {
  const b = raw && typeof raw === 'object' ? raw : {};
  const nodes = {};
  for (const [id, n] of Object.entries(b.nodes && typeof b.nodes === 'object' ? b.nodes : {}).slice(0, 400)) {
    if (!okId(id) || !n || typeof n !== 'object') continue;
    const node = { x: clampPos(n.x), y: clampPos(n.y) };
    if (n.pinned) node.pinned = true;
    const pl = n.sound && typeof n.sound === 'object' ? String(n.sound.playlist || '').slice(0, 100) : '';
    if (pl) node.sound = { playlist: pl };
    nodes[id] = node;
  }
  const seen = new Set();
  const edges = (Array.isArray(b.edges) ? b.edges : []).slice(0, 500)
    .map((e) => {
      if (!e || !okId(e.from) || !okId(e.to) || e.from === e.to) return null;
      const key = `${e.from}>${e.to}`;
      if (seen.has(key)) return null;
      seen.add(key);
      const label = String(e.label || '').slice(0, 80).trim();
      const type = EDGE_TYPES[e.type] ? e.type : '';
      return { from: e.from, to: e.to, ...(type ? { type } : {}), ...(label ? { label } : {}) };
    })
    .filter(Boolean);
  const hidden = (Array.isArray(b.hidden) ? b.hidden : []).filter(okId).slice(0, 400);
  return { nodes, edges, hidden };
}

/* ---------------------------------------------------------------- handouts --
 * Un HANDOUT = { type: image|audio|video|chat, src|text, title, targets? } —
 * envoyé aux joueurs SÉLECTIONNÉS (targets = ids Foundry) ou à toute la table
 * (targets absent). Cœur commun du pont POST /api/gm/foundry/handout, des items
 * de séquence et du handout unitaire d'un beat. */
export const HANDOUT_TYPES = ['image', 'audio', 'video', 'chat'];
const USER_ID = /^[A-Za-z0-9]{16}$/;

/** Assainit un handout multi-média. Retourne null si rien d'exploitable
 * (chat sans texte, média sans src). Ne jette jamais. */
export function sanitizeHandout(raw) {
  const h = raw && typeof raw === 'object' ? raw : {};
  const type = HANDOUT_TYPES.includes(h.type) ? h.type : 'image';
  const src = (() => {
    const s = String(h.src || '').trim().slice(0, 300);
    return s.includes('..') ? '' : s; // URL http(s) ou chemin Foundry, jamais de traversée
  })();
  // chat : HTML léger autorisé, mais jamais de script/iframe ni de handler inline
  const text = String(h.text || '').slice(0, 4000)
    .replace(/<\s*\/?\s*(script|iframe|object|embed|form)[^>]*>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/javascript:/gi, '');
  const targets = [...new Set((Array.isArray(h.targets) ? h.targets : [])
    .map((t) => String(t)).filter((t) => USER_ID.test(t)))].slice(0, 30);
  const out = { type, title: String(h.title || '').slice(0, 120) };
  if (type === 'chat') { if (!text.trim()) return null; out.text = text; }
  else { if (!src) return null; out.src = src; }
  if (targets.length) out.targets = targets; // absent = toute la table
  return out;
}

/** Assainit une séquence de handouts (préparation de séance). Rétrocompat :
 * item sans `type` = image, sans `targets` = toute la table. */
export function sanitizeSequence(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  return {
    id: okId(s.id) ? s.id : `seq-${Math.random().toString(36).slice(2, 10)}`,
    name: String(s.name || 'Séquence').slice(0, 80),
    items: (Array.isArray(s.items) ? s.items : []).slice(0, 40)
      .map((it) => {
        const h = sanitizeHandout(it);
        return h ? { ...h, note: String(it?.note || '').slice(0, 500) } : null;
      })
      .filter(Boolean),
    updatedAt: Date.now(),
  };
}

/* ---------------------------------------------------------------- catalogue --
 * Objets de campagne candidats à la carte + liens auto (fiches CC + quêtes).
 * PUR (testable) : reçoit config/folders/journalsIndex/getJournal.
 * Exclut l'atlas astronav (fiches flags.swffg-astronavigation — des milliers de
 * planètes gérées par leur propre module) et les journaux techniques. */
const CC_NODE_TYPES = { npc: 'npc', group: 'group', location: 'location', region: 'location', shop: 'shop', quest: 'quest' };
const refId = (v) => {
  const s = String(v || '').split('::')[0];
  const m = /JournalEntry\.([A-Za-z0-9]{16})/.exec(s);
  return m ? m[1] : (/^[A-Za-z0-9]{16}$/.test(s) ? s : null);
};

export function buildCatalog({ config, folders, journalsIndex, getJournal }) {
  const storyFolderIds = new Set((config?.categories || [])
    .filter((c) => c && c.kind === 'story' && c.folder)
    .map((c) => resolveFolder(folders, c.folder)?._id)
    .filter(Boolean));
  const nodes = [];
  const edges = [];
  const known = new Set();
  for (const entry of (journalsIndex || [])) {
    if (!entry || !entry._id) continue;
    if (entry.flags?.['swffg-astronavigation']) continue; // atlas astronav : hors carte
    const cc = entry.flags?.['campaign-codex']?.type;
    const type = CC_NODE_TYPES[cc] || (storyFolderIds.has(entry.folder) ? 'acte' : null);
    if (!type) continue;
    const doc = getJournal(entry._id) || entry;
    if (doc.flags?.['swffg-astronavigation']) continue;
    const fh = entry.flags?.holocron || {};
    const img = (doc.pages || []).find((p) => p.src)?.src || null;
    // storyboard (MJ only — cette vue n'est servie que par la route gm-gated)
    const sb = type === 'acte' ? sanitizeStoryboard(fh.storyboard) : null;
    nodes.push({
      id: entry._id,
      name: entry.name,
      type,
      // visible des joueurs ? (ownership Foundry — pastille 🙈 et lentille MJ-only)
      playerVisible: (entry.ownership?.default ?? 0) >= 2,
      ...(fh.statut ? { statut: fh.statut } : {}),
      ...(fh.mort ? { mort: true } : {}),
      ...(img ? { img } : {}),
      ...(type === 'acte' ? { sort: entry.sort || 0, actSummary: sanitizeActSummary(fh.actSummary) } : {}),
      ...(sb?.beats.length ? { storyboard: sb } : {}),
    });
    known.add(entry._id);
    if (type === 'quest') {
      const q = (doc.flags?.['campaign-codex']?.data?.quests || [])[0] || {};
      for (const u of (Array.isArray(q.unlocks) ? q.unlocks : [])) {
        const to = refId(u);
        if (to) edges.push({ from: entry._id, to, rel: 'débloque' });
      }
      for (const d of (Array.isArray(q.dependencies) ? q.dependencies : [])) {
        const from = refId(d);
        if (from) edges.push({ from, to: entry._id, rel: 'débloque' });
      }
    } else if (cc) {
      // liens CC (associates, linkedNPCs, linkedLocations, parentRegion…) via ccView
      for (const r of (ccView(doc)?.relationships || [])) {
        edges.push({ from: entry._id, to: r.ref, rel: r.rel });
      }
    }
  }
  // arêtes bornées aux nœuds du catalogue, dédupliquées
  const seen = new Set();
  const auto = edges.filter((e) => {
    if (!known.has(e.from) || !known.has(e.to) || e.from === e.to) return false;
    const k = `${e.from}>${e.to}>${e.rel}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  nodes.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  return { nodes, edges: auto };
}

/* ------------------------------------------------------------------ service -- */
export function createBoardService({ store, config }) {
  const idx = () => store.get('journalsIndex') || [];
  const findEntry = () => idx().find((j) => j.name === config().journals.board);

  /** Journal technique — créé au premier SAVE (jamais sur un GET), rangé dans le
   * dossier système Holocron s'il existe (même logique que le module). */
  async function boardJournal() {
    let entry = findEntry();
    if (!entry) {
      const name = config().journals.board;
      const sysF = (store.get('folders') || []).find((f) => f.type === 'JournalEntry' && f.name === '🛠️ Holocron — Système');
      await mcpCall('create_document', { type: 'JournalEntry', data: [{
        name, ownership: { default: 0 }, ...(sysF ? { folder: sysF._id } : {}),
        flags: { holocron: { board: BOARD_DEFAULTS, sequences: [], sessions: [] } },
        pages: [{ name: 'Carte de campagne', type: 'text', text: {
          content: '<p>Carte de campagne du Holocron (flags.holocron.board / flags.holocron.sequences).</p>', format: 1 } }],
      }] });
      await store.sync.journalsIndex();
      entry = findEntry();
      if (!entry) throw new Error('journal carte de campagne introuvable après création');
    }
    return entry;
  }

  function patchEntryFlags(id, mutate) {
    store.patch('journalsIndex', (items) => {
      const j = items.find((x) => x._id === id);
      if (j) { j.flags = j.flags || {}; j.flags.holocron = j.flags.holocron || {}; mutate(j.flags.holocron); }
    });
    store.patch(`journal:${id}`, (doc) => {
      doc.flags = doc.flags || {}; doc.flags.holocron = doc.flags.holocron || {}; mutate(doc.flags.holocron);
    });
  }

  /** Vue complète pour l'éditeur : board persisté + catalogue dérivé + séquences
   * + la TRACE des séances (MJ-only, comme tout le reste de cette vue). */
  function view() {
    const entry = findEntry();
    const cc = config();
    return {
      board: sanitizeBoard(entry?.flags?.holocron?.board),
      sequences: (entry?.flags?.holocron?.sequences || []).map(sanitizeSequence),
      sessions: sanitizeSessions(entry?.flags?.holocron?.sessions),
      catalog: buildCatalog({
        config: cc,
        folders: store.get('folders'),
        journalsIndex: idx(),
        getJournal: (id) => store.get(`journal:${id}`),
      }),
    };
  }

  /** Remplace le board entier (le client envoie tout son état). Écriture en deux
   * temps : suppression du flag (« -= ») puis pose — la fusion Foundry par chemin
   * garderait sinon les nœuds SUPPRIMÉS (clés d'objet jamais retirées au merge). */
  async function saveBoard(raw) {
    const clean = sanitizeBoard(raw);
    const entry = await boardJournal();
    await mcpCall('modify_document', { type: 'JournalEntry', _id: entry._id,
      updates: [{ 'flags.holocron.-=board': null }] });
    await mcpCall('modify_document', { type: 'JournalEntry', _id: entry._id,
      updates: [{ 'flags.holocron.board': clean }] });
    patchEntryFlags(entry._id, (h) => { h.board = clean; });
    return clean;
  }

  /** Séquences de handouts seules (sans reconstruire le catalogue complet) —
   * « ▶ Jouer ce beat » n'a besoin que de ça pour résoudre `trigger.sequenceId`. */
  function sequences() {
    return (findEntry()?.flags?.holocron?.sequences || []).map(sanitizeSequence);
  }

  /* ------------------------------------------------------------- séances --- */
  /** La trace, telle qu'elle est stockée (assainie à la lecture). */
  function sessions() {
    return sanitizeSessions(findEntry()?.flags?.holocron?.sessions);
  }

  /** Écrit la collection entière — MÊME écriture en deux temps que le board :
   * le merge Foundry par chemin ne retire jamais une clé, on supprime le flag
   * puis on le repose. Write-through des caches (le connecteur ne voit pas ses
   * propres writes). */
  async function writeSessions(clean) {
    const entry = await boardJournal();
    await mcpCall('modify_document', { type: 'JournalEntry', _id: entry._id,
      updates: [{ 'flags.holocron.-=sessions': null }] });
    await mcpCall('modify_document', { type: 'JournalEntry', _id: entry._id,
      updates: [{ 'flags.holocron.sessions': clean }] });
    patchEntryFlags(entry._id, (h) => { h.sessions = clean; });
    return clean;
  }

  /** Remplacement complet (le client envoie toute sa collection). */
  async function saveSessions(raw) {
    return writeSessions(sanitizeSessions(raw));
  }

  /** AJOUT ATOMIQUE d'une entrée à une séance : le client n'envoie QUE l'entrée,
   * jamais la collection — deux onglets MJ ouverts en séance ne s'écrasent pas.
   * `patch` = { kind: 'played'|'reveal'|'shown', … }. */
  async function appendToSession(sessionId, patch) {
    const next = appendEvent(sessions(), sessionId, patch || {});
    if (!next) throw Object.assign(new Error('séance inconnue ou entrée inexploitable'), { code: 400 });
    await writeSessions(next);
    return next.find((s) => s.id === sessionId);
  }

  async function saveSequence(raw) {
    const clean = sanitizeSequence(raw);
    const entry = await boardJournal();
    const all = [...(entry.flags?.holocron?.sequences || [])];
    const i = all.findIndex((s) => s.id === clean.id);
    if (i >= 0) all[i] = clean; else all.push(clean);
    await mcpCall('modify_document', { type: 'JournalEntry', _id: entry._id,
      updates: [{ 'flags.holocron.sequences': all }] });
    patchEntryFlags(entry._id, (h) => { h.sequences = all; });
    return clean;
  }

  async function removeSequence(id) {
    const entry = await boardJournal();
    const all = (entry.flags?.holocron?.sequences || []).filter((s) => s.id !== id);
    await mcpCall('modify_document', { type: 'JournalEntry', _id: entry._id,
      updates: [{ 'flags.holocron.sequences': all }] });
    patchEntryFlags(entry._id, (h) => { h.sequences = all; });
    return { ok: true };
  }

  /** Sommaire d'acte : bloc structuré flags.holocron.actSummary SUR le journal
   * d'acte (pas sur le journal technique) — rendu joueur via la vue journaux. */
  async function saveActSummary(journalId, raw) {
    const entry = idx().find((j) => j._id === journalId);
    if (!entry) throw Object.assign(new Error('journal inexistant'), { code: 404 });
    const clean = sanitizeActSummary(raw) || {
      crawl: '', situation: '', objectifs: [], protagonistes: [], lieux: [], fronts: [], hidden: [],
    };
    await mcpCall('modify_document', { type: 'JournalEntry', _id: journalId,
      updates: [{ 'flags.holocron.actSummary': clean }] });
    patchEntryFlags(journalId, (h) => { h.actSummary = clean; });
    return clean;
  }

  /** Storyboard d'acte : flags.holocron.storyboard SUR le journal de l'acte —
   * même écriture en deux temps que le board (le merge Foundry par chemin ne
   * retire jamais une clé ; on supprime le flag puis on le repose entier).
   * `tagParticipants` (true/false/absent) : synchronise / retire / ne touche pas
   * les tags « mj:acte-<n> » des fiches CC référencées (voir actTagOps). */
  async function saveStoryboard(journalId, raw, { tagParticipants } = {}) {
    const entry = idx().find((j) => j._id === journalId);
    if (!entry) throw Object.assign(new Error('journal inexistant'), { code: 404 });
    const clean = sanitizeStoryboard(raw);
    await mcpCall('modify_document', { type: 'JournalEntry', _id: journalId,
      updates: [{ 'flags.holocron.-=storyboard': null }] });
    await mcpCall('modify_document', { type: 'JournalEntry', _id: journalId,
      updates: [{ 'flags.holocron.storyboard': clean }] });
    patchEntryFlags(journalId, (h) => { h.storyboard = clean; });

    let tags = null;
    if (tagParticipants === true || tagParticipants === false) {
      const storyFolderIds = new Set((config().categories || [])
        .filter((c) => c && c.kind === 'story' && c.folder)
        .map((c) => resolveFolder(store.get('folders'), c.folder)?._id)
        .filter(Boolean));
      const story = idx().filter((j) => storyFolderIds.has(j.folder)).sort((a, b) => (a.sort || 0) - (b.sort || 0));
      const tag = ACT_TAG_PREFIX + actNumberOf(entry, story);
      const uuids = tagParticipants ? clean.beats.flatMap((b) => b.uuids) : [];
      const ops = actTagOps({ tag, uuids, journalsIndex: idx(), getJournal: (id) => store.get(`journal:${id}`) });
      for (const op of [...ops.add, ...ops.remove]) {
        await mcpCall('modify_document', { type: 'JournalEntry', _id: op.id,
          updates: [{ 'flags.campaign-codex.data.tags': op.tags }] });
        // write-through des caches (le client Foundry ne voit pas ses propres writes)
        const setTags = (flags) => {
          flags['campaign-codex'] = flags['campaign-codex'] || {};
          flags['campaign-codex'].data = flags['campaign-codex'].data || {};
          flags['campaign-codex'].data.tags = op.tags;
        };
        store.patch('journalsIndex', (items) => {
          const j = items.find((x) => x._id === op.id);
          if (j) { j.flags = j.flags || {}; setTags(j.flags); }
        });
        store.patch(`journal:${op.id}`, (doc) => { doc.flags = doc.flags || {}; setTags(doc.flags); });
      }
      tags = { tag, added: ops.add.length, removed: ops.remove.length };
    }
    return { storyboard: clean, ...(tags ? { tags } : {}) };
  }

  return { view, saveBoard, sequences, saveSequence, removeSequence, saveActSummary, saveStoryboard,
    sessions, saveSessions, appendToSession };
}
