// write.mjs — l'éditeur web écrit DANS Foundry (SSOT). Remplace le store
// docs.json : chapitres bible, docs publics (notes joueurs, actes), notes MJ,
// configs. Concurrence : contrat 409 conservé via flags.holocron.rev.updatedAt
// (comparé au CACHE, patché à chaque écriture — le client Foundry ne voit pas
// ses propres writes, on ne re-lit jamais pour vérifier).
import { mcpCall } from './mcp.mjs';

export function createWriteService({ store, config, logger = console }) {
  const idx = () => store.get('journalsIndex') || [];
  const findByChapter = (chapId) => idx().find((j) => j.flags?.holocron?.gmChapter === chapId);
  const findById = (fid) => idx().find((j) => j._id === fid);

  async function writePage(jid, pageId, html, rev) {
    await mcpCall('modify_document', {
      type: 'JournalEntryPage', _id: pageId, parent_uuid: `JournalEntry.${jid}`,
      updates: [{ 'text.content': html }],
    });
    await mcpCall('modify_document', { type: 'JournalEntry', _id: jid, updates: [{ 'flags.holocron.rev': rev }] });
  }

  function patchCaches(jid, pageId, html, rev) {
    store.patch('journalsIndex', (items) => {
      const j = items.find((x) => x._id === jid);
      if (j) { j.flags = j.flags || {}; j.flags.holocron = { ...(j.flags.holocron || {}), rev }; }
    });
    store.patch(`journal:${jid}`, (doc) => {
      doc.flags = doc.flags || {}; doc.flags.holocron = { ...(doc.flags.holocron || {}), rev };
      const p = (doc.pages || []).find((x) => x._id === pageId);
      if (p) { p.text = p.text || {}; p.text.content = html; }
    });
  }

  // --- chapitres bible MJ (gm:<chapId>) -------------------------------------
  function gmList() {
    const cc = config();
    const folders = store.get('folders') || [];
    const bibleRoot = folders.find((f) => f.type === 'JournalEntry' && f.name === cc.gmBibleFolder)?._id;
    const subIds = new Set([bibleRoot, ...folders.filter((f) => f.folder === bibleRoot).map((f) => f._id)].filter(Boolean));
    const folderName = new Map(folders.map((f) => [f._id, f.name]));
    return idx()
      .filter((j) => j.flags?.holocron?.gmChapter || subIds.has(j.folder))
      .map((j) => ({
        id: j.flags?.holocron?.gmChapter || j._id,
        name: j.name,
        folder: j.folder,
        rubrique: j.folder === bibleRoot ? '' : (folderName.get(j.folder) || ''),
        updatedAt: j.flags?.holocron?.rev?.updatedAt || 0,
        order: j.sort || 0,
      }))
      .sort((a, b) => a.order - b.order);
  }

  function gmGet(chapId) {
    const entry = findByChapter(chapId) || findById(chapId);
    if (!entry) return null;
    const doc = store.get(`journal:${entry._id}`);
    if (!doc) return null;
    const page = (doc.pages || [])[0];
    return {
      id: chapId, name: doc.name,
      html: page?.text?.content || '',
      updatedAt: doc.flags?.holocron?.rev?.updatedAt || 0,
      updatedBy: doc.flags?.holocron?.rev?.updatedBy || '',
    };
  }

  async function gmSave(chapId, html, baseUpdatedAt, updatedBy) {
    const entry = findByChapter(chapId) || findById(chapId);
    if (!entry) throw Object.assign(new Error('chapitre inexistant'), { code: 404 });
    const current = gmGet(chapId);
    if (baseUpdatedAt != null && current && current.updatedAt && current.updatedAt !== baseUpdatedAt) {
      throw Object.assign(new Error('conflit'), { code: 409, current });
    }
    const doc = store.get(`journal:${entry._id}`) || await store.sync.journal(entry._id, entry.name);
    const pageId = doc?.pages?.[0]?._id;
    if (!pageId) throw Object.assign(new Error('page introuvable'), { code: 500 });
    const rev = { updatedAt: Date.now(), updatedBy: String(updatedBy || 'MJ').slice(0, 80) };
    await writePage(entry._id, pageId, html, rev);
    patchCaches(entry._id, pageId, html, rev);
    return { ok: true, id: chapId, updatedAt: rev.updatedAt };
  }

  // --- docs publics : <journalId>:<pageId> (notes joueurs, actes) ------------
  // L'id logique préserve les ancres legacy (flags.holocron.legacyId).
  function resolvePublicDoc(docId) {
    const [jid, pid] = String(docId).split(':');
    const entry = idx().find((j) => j._id === jid || j.flags?.holocron?.legacyId === jid);
    if (!entry) return null;
    const cc = config();
    const editableFolders = new Set(
      (store.get('folders') || [])
        .filter((f) => (cc.categories || []).some((c) => c.editable && c.folder === f.name))
        .map((f) => f._id),
    );
    if (!editableFolders.has(entry.folder)) return null; // étanchéité : jamais la bible
    const doc = store.get(`journal:${entry._id}`);
    const page = pid ? (doc?.pages || []).find((p) => p._id === pid) : (doc?.pages || [])[0];
    return { entry, doc, page };
  }

  function publicGet(docId) {
    const r = resolvePublicDoc(docId);
    if (!r || !r.doc) return null;
    return {
      id: docId,
      html: r.page?.text?.content || '',
      name: r.page?.name || r.doc.name,
      updatedAt: r.doc.flags?.holocron?.rev?.updatedAt || 0,
      updatedBy: r.doc.flags?.holocron?.rev?.updatedBy || '',
      ownership: r.entry.ownership || {},
    };
  }

  async function publicSave(docId, html, baseUpdatedAt, updatedBy) {
    const r = resolvePublicDoc(docId);
    if (!r || !r.doc || !r.page) throw Object.assign(new Error('document non éditable'), { code: 404 });
    const cur = publicGet(docId);
    if (baseUpdatedAt != null && cur.updatedAt && cur.updatedAt !== baseUpdatedAt) {
      throw Object.assign(new Error('conflit'), { code: 409, current: cur });
    }
    const rev = { updatedAt: Date.now(), updatedBy: String(updatedBy || 'joueur').slice(0, 80) };
    await writePage(r.entry._id, r.page._id, html, rev);
    patchCaches(r.entry._id, r.page._id, html, rev);
    return { ok: true, id: docId, updatedAt: rev.updatedAt };
  }

  // --- notes MJ : journal dédié, une page par note ---------------------------
  async function notesJournal() {
    const cc = config();
    const name = cc.journals.gmNotes;
    let entry = idx().find((j) => j.name === name);
    if (!entry) {
      await mcpCall('create_document', { type: 'JournalEntry', data: [{
        name, ownership: { default: 0 }, flags: { holocron: { gmNotesStore: true } }, pages: [],
      }] });
      await store.sync.journalsIndex();
      entry = idx().find((j) => j.name === name);
      if (!entry) throw new Error('journal notes MJ introuvable');
    }
    const doc = store.get(`journal:${entry._id}`) || await store.sync.journal(entry._id, entry.name);
    return { entry, doc };
  }

  async function notesList() {
    const { doc } = await notesJournal();
    return (doc?.pages || []).map((p) => ({
      id: p._id,
      html: p.text?.content || '',
      ...(p.flags?.holocron?.note || {}),
    }));
  }

  async function noteSave(id, { html, targetType, targetRef, targetLabel, updatedBy }) {
    const { entry, doc } = await notesJournal();
    const meta = { id, targetType: targetType || 'global', targetRef: targetRef || '', targetLabel: targetLabel || '', updatedAt: Date.now(), updatedBy: String(updatedBy || 'MJ').slice(0, 80) };
    const existing = (doc?.pages || []).find((p) => p._id === id || p.flags?.holocron?.note?.id === id);
    if (existing) {
      await mcpCall('modify_document', {
        type: 'JournalEntryPage', _id: existing._id, parent_uuid: `JournalEntry.${entry._id}`,
        updates: [{ 'text.content': html, 'flags.holocron.note': meta }],
      });
    } else {
      await mcpCall('create_document', {
        type: 'JournalEntryPage', parent_uuid: `JournalEntry.${entry._id}`,
        data: [{ name: (targetLabel || 'note').slice(0, 60) || 'note', type: 'text',
                 text: { content: html, format: 1 }, flags: { holocron: { note: meta } } }],
      });
    }
    await store.sync.journal(entry._id, entry.name);
    return { ok: true, id, updatedAt: meta.updatedAt };
  }

  async function noteDelete(id) {
    const { entry, doc } = await notesJournal();
    const page = (doc?.pages || []).find((p) => p._id === id || p.flags?.holocron?.note?.id === id);
    if (page) {
      await mcpCall('delete_document', { type: 'JournalEntryPage', parent_uuid: `JournalEntry.${entry._id}`, ids: [page._id] });
      await store.sync.journal(entry._id, entry.name);
    }
    return { ok: true };
  }

  // --- configs MJ (gm:cfg:<name>) → flags.holocron.config.cfg.<name> ----------
  async function cfgSave(name, value) {
    const cc = config();
    const entry = idx().find((j) => j.name === (process.env.CONFIG_JOURNAL_NAME || '⚙️ Holocron Config'));
    if (!entry) throw Object.assign(new Error('journal ⚙️ Holocron Config absent — POST /api/gm/bootstrap'), { code: 404 });
    await mcpCall('modify_document', {
      type: 'JournalEntry', _id: entry._id,
      updates: [{ [`flags.holocron.config.cfg.${name}`]: value }],
    });
    store.patch('config', (cfg) => { cfg.cfg = cfg.cfg || {}; cfg.cfg[name] = value; });
    return { ok: true };
  }

  return { gmList, gmGet, gmSave, publicGet, publicSave, notesList, noteSave, noteDelete, cfgSave };
}
