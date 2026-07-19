// gm-sheets.mjs — SERVICE des fiches MJ (Front / Secret / Prépa).
//
// Les trois gabarits sont des fiches Campaign Codex `tag` privées : voir
// `transform/mj-sheets.mjs` pour la forme exacte et le POURQUOI. Ce fichier ne
// fait que les écrire dans Foundry (SSOT) et relire le SyncStore.
//
// Deux précautions héritées du convertisseur du module :
//   · Campaign Codex DÉPORTE toute fiche qu'il voit naître dans ses propres
//     dossiers (« Campaign Codex - Tags ») via son hook de création : on repose
//     le dossier voulu juste après (patron `repairCCFolders`).
//   · write-through des caches du store : le client Foundry ne voit pas ses
//     propres écritures, on ne relit jamais pour vérifier.
import { mcpCall } from './mcp.mjs';
import {
  CC, AL, MJ_TEMPLATES, MJ_KINDS, mjSheetDoc, mjSheetUpdates, mjSheetView,
  mjKindOf, frontsMigration,
} from './transform/mj-sheets.mjs';

export { MJ_TEMPLATES, MJ_KINDS };

/** Nom par défaut du dossier d'accueil (le MJ peut le déplacer : on le suit). */
export const MJ_FOLDER_NAME = '🔥 Fronts & secrets (MJ)';

export function createGmSheetService({ store, config, logger = console }) {
  const idx = () => store.get('journalsIndex') || [];
  const docOf = (id) => store.get(`journal:${id}`) || idx().find((j) => j._id === id) || null;

  /** Dossier d'accueil : celui de la config, sinon le dossier système, sinon créé. */
  async function mjFolder() {
    const folders = store.get('folders') || [];
    const wanted = config().journals.mjSheets || MJ_FOLDER_NAME;
    const byName = folders.find((f) => f.type === 'JournalEntry' && f.name === wanted);
    if (byName) return byName._id;
    // une fiche MJ déjà rangée fait autorité (le MJ a pu la déplacer dans Foundry)
    const placed = idx().find((j) => j.flags?.holocron?.mjSheet && j.folder);
    if (placed) return placed.folder;
    try {
      await mcpCall('create_document', { type: 'Folder', data: [{ name: wanted, type: 'JournalEntry' }] });
      await store.sync.folders?.();
      return (store.get('folders') || []).find((f) => f.type === 'JournalEntry' && f.name === wanted)?._id || null;
    } catch (e) {
      logger.warn?.('[gm-sheets] dossier d’accueil non créé :', String(e.message || e));
      return (folders.find((f) => f.type === 'JournalEntry' && f.name === '🛠️ Holocron — Système') || {})._id || null;
    }
  }

  /** Toutes les fiches MJ du monde (le tag fait foi, d'où qu'il vienne). */
  function list(kind) {
    const out = [];
    for (const entry of idx()) {
      if (entry.flags?.['swffg-astronavigation']) continue;
      const doc = docOf(entry._id) || entry;
      const view = mjSheetView({ ...doc, _id: entry._id, name: doc.name || entry.name });
      if (!view) continue;
      if (kind && view.kind !== kind) continue;
      out.push(view);
    }
    out.sort((a, b) => a.kind.localeCompare(b.kind) || a.title.localeCompare(b.title, 'fr'));
    return out;
  }

  function get(id) {
    const doc = docOf(id);
    return doc ? mjSheetView({ ...doc, _id: id }) : null;
  }

  /** Crée une fiche MJ. Retourne sa vue (id compris). */
  async function create(spec) {
    const kind = String(spec?.kind || '');
    if (!MJ_KINDS.includes(kind)) throw Object.assign(new Error('gabarit inconnu'), { code: 400 });
    const body = mjSheetDoc({ ...spec, kind });
    const folder = await mjFolder();
    const before = new Set(idx().map((j) => j._id));
    await mcpCall('create_document', { type: 'JournalEntry', data: [{ ...body, ...(folder ? { folder } : {}) }] });
    await store.sync.journalsIndex();
    const fresh = idx().find((j) => !before.has(j._id) && j.name === body.name)
      || idx().find((j) => !before.has(j._id) && j.flags?.holocron?.mjSheet === kind);
    if (!fresh) throw new Error('fiche MJ créée mais introuvable dans l’index');
    // Campaign Codex l'a peut-être déportée dans SES dossiers : on la remet.
    if (folder && fresh.folder !== folder) {
      await mcpCall('modify_document', { type: 'JournalEntry', _id: fresh._id, updates: [{ folder }] });
      store.patch('journalsIndex', (items) => {
        const j = items.find((x) => x._id === fresh._id);
        if (j) j.folder = folder;
      });
    }
    return mjSheetView({ ...fresh, _id: fresh._id }) || { id: fresh._id, kind, title: body.name };
  }

  /** Patch PARTIEL d'une fiche existante (rien de ce que le MJ a écrit n'est perdu). */
  async function update(id, patch) {
    const doc = docOf(id);
    if (!doc) throw Object.assign(new Error('fiche inexistante'), { code: 404 });
    const kind = patch?.kind || mjKindOf(doc);
    if (!MJ_KINDS.includes(kind)) throw Object.assign(new Error('ce n’est pas une fiche MJ'), { code: 400 });
    const updates = mjSheetUpdates(doc, { ...patch, kind });
    const entries = Object.entries(updates);
    if (!entries.length) return get(id);
    await mcpCall('modify_document', {
      type: 'JournalEntry', _id: id, updates: entries.map(([k, v]) => ({ [k]: v })),
    });
    // write-through : index ET document complet, comme partout ailleurs
    const applyLocal = (target) => {
      if (!target) return;
      target.flags = target.flags || {};
      for (const [path, value] of entries) {
        if (path === 'name') { target.name = value; continue; }
        const keys = path.split('.');
        let cur = target;
        for (let i = 0; i < keys.length - 1; i++) {
          const k = keys[i];
          if (!cur[k] || typeof cur[k] !== 'object') cur[k] = {};
          cur = cur[k];
        }
        cur[keys[keys.length - 1]] = value;
      }
    };
    store.patch('journalsIndex', (items) => applyLocal(items.find((x) => x._id === id)));
    store.patch(`journal:${id}`, (d) => applyLocal(d));
    return get(id);
  }

  /**
   * Migration `gm:cfg:fronts` → fiches CC. NON DESTRUCTIVE : la config n'est pas
   * vidée (l'ancien widget continue de fonctionner le temps de la transition) et
   * un front déjà représenté par une fiche n'est jamais recréé. Idempotente :
   * relancer la migration ne fait rien de plus.
   */
  async function migrateFronts() {
    const cfg = config().cfg?.fronts;
    const fronts = Array.isArray(cfg) ? cfg : (cfg?.fronts || []);
    const { create: todo, skip } = frontsMigration(fronts, list('front'));
    const created = [];
    for (const spec of todo) {
      try { created.push(await create(spec)); }
      catch (e) { logger.warn?.('[gm-sheets] migration front', spec.title, String(e.message || e)); }
    }
    return { created, skipped: skip, source: fronts.length };
  }

  return { list, get, create, update, migrateFronts, MJ_TEMPLATES };
}

export { CC, AL };
