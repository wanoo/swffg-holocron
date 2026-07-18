// board.mjs — Éditeur de campagne MJ (« carte de campagne ») : la donnée MJ vit
// dans un journal TECHNIQUE Foundry « 🗺️ Carte de campagne (Holocron) »
// (config.journals.board), même modèle que la bibliothèque de rencontres :
//   · flags.holocron.board     = { nodes: { id: {x, y, pinned?, sound?} },
//                                  edges: [{from, to, label?}], hidden: [] }
//     (id = _id Foundry du journal, ou « seq:<id> » pour une séquence de handouts)
//   · flags.holocron.sequences = [{ id, name, items: [{src, title, note}] }]
// Le CATALOGUE des objets de campagne (actes, quêtes, PNJ, orgs, lieux, boutiques
// Campaign Codex) et leurs LIENS AUTO sont DÉRIVÉS du SyncStore — jamais stockés.
import { mcpCall } from './mcp.mjs';
import { ccView, resolveFolder, sanitizeActSummary } from './transform/journals.mjs';

export const BOARD_DEFAULTS = { nodes: {}, edges: [], hidden: [] };

// id de nœud : _id Foundry (16 alphanum) ou id technique court (« seq:x… »)
const NODE_ID = /^[A-Za-z0-9:_-]{1,40}$/;
const okId = (s) => typeof s === 'string' && NODE_ID.test(s);
const clampPos = (v) => (Number.isFinite(+v) ? Math.max(-20000, Math.min(20000, Math.round(+v))) : 0);

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
      return { from: e.from, to: e.to, ...(label ? { label } : {}) };
    })
    .filter(Boolean);
  const hidden = (Array.isArray(b.hidden) ? b.hidden : []).filter(okId).slice(0, 400);
  return { nodes, edges, hidden };
}

/** Assainit une séquence de handouts (préparation de séance). */
export function sanitizeSequence(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const cleanSrc = (v) => {
    const src = String(v || '').trim().slice(0, 500);
    return src.includes('..') ? '' : src; // URL http(s) ou chemin Foundry, jamais de traversée
  };
  return {
    id: okId(s.id) ? s.id : `seq-${Math.random().toString(36).slice(2, 10)}`,
    name: String(s.name || 'Séquence').slice(0, 80),
    items: (Array.isArray(s.items) ? s.items : []).slice(0, 40)
      .map((it) => ({
        src: cleanSrc(it?.src),
        title: String(it?.title || '').slice(0, 120),
        note: String(it?.note || '').slice(0, 500),
      }))
      .filter((it) => it.src),
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
    nodes.push({
      id: entry._id,
      name: entry.name,
      type,
      ...(fh.statut ? { statut: fh.statut } : {}),
      ...(fh.mort ? { mort: true } : {}),
      ...(img ? { img } : {}),
      ...(type === 'acte' ? { sort: entry.sort || 0, actSummary: sanitizeActSummary(fh.actSummary) } : {}),
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
        flags: { holocron: { board: BOARD_DEFAULTS, sequences: [] } },
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

  /** Vue complète pour l'éditeur : board persisté + catalogue dérivé + séquences. */
  function view() {
    const entry = findEntry();
    const cc = config();
    return {
      board: sanitizeBoard(entry?.flags?.holocron?.board),
      sequences: (entry?.flags?.holocron?.sequences || []).map(sanitizeSequence),
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

  return { view, saveBoard, saveSequence, removeSequence, saveActSummary };
}
