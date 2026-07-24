// bible-tools.mjs — SERVICE « la bible devient une collection d'éléments ».
//
// Quatre gestes, tous MJ-only, tous adossés à des fonctions PURES testées
// (`transform/elements.mjs`, `transform/mj-sheets.mjs`) :
//
//   1. ARCHIVE de sécurité : copie intégrale des chapitres dans un dossier
//      « 🗄️ Bible — Archive (AAAA-MM) » HORS bible — idempotente (une archive
//      par mois), et JAMAIS de suppression : les originaux restent en place.
//   2. RÉPERTOIRES d'éléments : chaque élément est une fiche CC `tag` privée
//      rangée dans un sous-dossier direct de la bible (📣 Lectures, 🔊 Ambiances,
//      🖼️ Visuels, 🔮 Visions) — créé à la demande au premier import.
//   3. DÉCOMPOSITION : scan (aperçu pur, zéro écriture) → création de la seule
//      sélection cochée. Le chapitre d'origine n'est JAMAIS modifié.
//   4. DÉDOUBLONNAGE PNJ : mêmes sections, rapprochées par nom des fiches CC ;
//      report ADDITIF (description + dossier narratif), jamais d'écrasement.
//
// Écritures : mêmes précautions que gm-sheets.mjs (Campaign Codex déporte les
// fiches naissantes dans SES dossiers → on repose le dossier voulu ; write-through
// des caches — le client Foundry ne voit pas ses propres writes).
import { mcpCall } from './mcp.mjs';
import {
  ELEM_TEMPLATES, ELEM_KINDS, mjSheetDoc, elemSheetView, elemKindOf,
} from './transform/mj-sheets.mjs';
import {
  scanChapterElements, scanNpcSections, isNpcChapter, npcMergeBlock, npcMarker,
} from './transform/elements.mjs';
import { ccType } from './transform/tags.mjs';

/** Nom du dossier d'archive du mois — la clé d'idempotence (un par mois max). */
export function archiveFolderName(now = new Date()) {
  const d = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date();
  return `🗄️ Bible — Archive (${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')})`;
}

/**
 * Corps PUR d'un journal archivé : pages copiées telles quelles, `gmChapter`
 * RETIRÉ (l'archive ne doit jamais polluer gmList), marqueur de provenance.
 */
export function archiveDocBody(doc, { folder, at = Date.now() } = {}) {
  return {
    name: String(doc?.name || 'chapitre').slice(0, 200),
    ownership: { default: 0 }, // l'archive est MJ only, comme la bible
    ...(folder ? { folder } : {}),
    flags: { holocron: { archivedFrom: {
      journalId: String(doc?._id || ''),
      chapterId: String(doc?.flags?.holocron?.gmChapter || ''),
      at,
    } } },
    pages: (doc?.pages || []).map((p) => ({
      name: String(p?.name || 'page').slice(0, 200),
      type: p?.type || 'text',
      sort: p?.sort || 0,
      ...(p?.text ? { text: { content: String(p.text.content || ''), format: p.text.format ?? 1 } } : {}),
      ...(p?.src ? { src: p.src } : {}),
    })),
  };
}

export function createBibleService({ store, config, writer, logger = console }) {
  const idx = () => store.get('journalsIndex') || [];
  const folders = () => store.get('folders') || [];
  const docOf = (id) => store.get(`journal:${id}`) || idx().find((j) => j._id === id) || null;

  const bibleRootId = () => folders()
    .find((f) => f.type === 'JournalEntry' && f.name === config().gmBibleFolder)?._id || null;

  /** Entrées d'index de la bible (racine + sous-dossiers directs) — miroir gmList. */
  function bibleEntries() {
    const root = bibleRootId();
    const subIds = new Set([root, ...folders().filter((f) => f.folder === root).map((f) => f._id)].filter(Boolean));
    return idx().filter((j) => j.flags?.holocron?.gmChapter || subIds.has(j.folder));
  }

  /* -------------------------------------------------------------- 1. archive -- */
  /**
   * Copie intégrale des chapitres dans « 🗄️ Bible — Archive (AAAA-MM) », hors
   * bible. IDEMPOTENTE : si le dossier du mois existe déjà, re-run = no-op.
   * AUCUNE suppression, jamais — les originaux ne sont pas touchés.
   */
  async function archive({ now = new Date() } = {}) {
    const name = archiveFolderName(now);
    const existing = folders().find((f) => f.type === 'JournalEntry' && f.name === name);
    if (existing) {
      return { ok: true, existed: true, folder: name,
        message: `L’archive de ce mois existe déjà (« ${name} ») — rien n’a été réécrit. Les originaux ne bougent jamais.` };
    }
    const entries = bibleEntries();
    if (!entries.length) throw Object.assign(new Error('aucun chapitre de bible à archiver (gmBibleFolder vide ?)'), { code: 404 });

    // dossier d'archive à la RACINE (hors bible : jamais une rubrique de la sidebar)
    await mcpCall('create_document', { type: 'Folder', data: [{ name, type: 'JournalEntry', color: '#3a3a3a' }] });
    await store.sync.folders?.();
    const fid = folders().find((f) => f.type === 'JournalEntry' && f.name === name)?._id || null;
    if (!fid) throw new Error('dossier d’archive introuvable après création');

    const at = Date.now();
    const copied = [];
    const skipped = [];
    for (const entry of entries) {
      // les fiches ÉLÉMENT (produites par la décomposition) et les journaux déjà
      // archivés ne sont pas re-copiés : l'archive fige les CHAPITRES.
      if (entry.flags?.holocron?.elemSheet || entry.flags?.holocron?.archivedFrom) {
        skipped.push({ name: entry.name, reason: 'élément / déjà une archive' });
        continue;
      }
      const doc = store.get(`journal:${entry._id}`) || await store.sync.journal(entry._id, entry.name);
      if (!doc) { skipped.push({ name: entry.name, reason: 'contenu pas encore synchronisé' }); continue; }
      try {
        await mcpCall('create_document', { type: 'JournalEntry', data: [archiveDocBody(doc, { folder: fid, at })] });
        copied.push({ name: entry.name, pages: (doc.pages || []).length });
      } catch (e) {
        logger.warn?.('[bible] archive', entry.name, String(e.message || e));
        skipped.push({ name: entry.name, reason: String(e.message || e).slice(0, 120) });
      }
    }
    return { ok: true, existed: false, folder: name, copied, skipped,
      message: `${copied.length} chapitre(s) copié(s) dans « ${name} »`
        + (skipped.length ? ` · ${skipped.length} ignoré(s)` : '')
        + '. Les originaux restent en place.' };
  }

  /* ------------------------------------------------------------- 2. éléments -- */
  /** Toutes les fiches élément du monde (le tag fait foi, d'où qu'il vienne). */
  function listElements(kind) {
    const out = [];
    for (const entry of idx()) {
      if (entry.flags?.['swffg-astronavigation']) continue;
      const doc = docOf(entry._id) || entry;
      const view = elemSheetView({ ...doc, _id: entry._id, name: doc.name || entry.name });
      if (!view) continue;
      if (kind && view.kind !== kind) continue;
      out.push(view);
    }
    out.sort((a, b) => a.kind.localeCompare(b.kind) || a.title.localeCompare(b.title, 'fr'));
    return out;
  }

  /** Répertoire d'un gabarit : sous-dossier direct de la bible, créé à la demande. */
  async function elemFolderId(kind) {
    const tpl = ELEM_TEMPLATES[kind];
    if (!tpl) throw Object.assign(new Error(`gabarit d'élément inconnu : ${kind}`), { code: 400 });
    const root = bibleRootId();
    if (!root) throw Object.assign(new Error('dossier bible introuvable (gmBibleFolder) — configure ⚙️ Holocron Config'), { code: 404 });
    const find = () => folders().find((f) => f.type === 'JournalEntry' && f.folder === root && f.name === tpl.folder);
    const existing = find();
    if (existing) return existing._id;
    await mcpCall('create_document', { type: 'Folder', data: [{ name: tpl.folder, type: 'JournalEntry', folder: root }] });
    await store.sync.folders?.();
    const created = find();
    if (!created) throw new Error(`répertoire « ${tpl.folder} » introuvable après création`);
    return created._id;
  }

  /** Crée UNE fiche élément dans son répertoire. Retourne sa vue (id compris). */
  async function createElement(spec) {
    const kind = String(spec?.kind || '');
    if (!ELEM_KINDS.includes(kind)) throw Object.assign(new Error('gabarit d’élément inconnu'), { code: 400 });
    const body = mjSheetDoc({ ...spec, kind });
    const folder = await elemFolderId(kind);
    const before = new Set(idx().map((j) => j._id));
    await mcpCall('create_document', { type: 'JournalEntry', data: [{ ...body, folder }] });
    await store.sync.journalsIndex();
    const fresh = idx().find((j) => !before.has(j._id) && j.name === body.name)
      || idx().find((j) => !before.has(j._id) && j.flags?.holocron?.elemSheet === kind);
    if (!fresh) throw new Error('élément créé mais introuvable dans l’index');
    // Campaign Codex l'a peut-être déporté dans SES dossiers : on le remet.
    if (fresh.folder !== folder) {
      await mcpCall('modify_document', { type: 'JournalEntry', _id: fresh._id, updates: [{ folder }] });
      store.patch('journalsIndex', (items) => {
        const j = items.find((x) => x._id === fresh._id);
        if (j) j.folder = folder;
      });
    }
    return elemSheetView({ ...fresh, _id: fresh._id }) || { id: fresh._id, kind, title: body.name };
  }

  /* -------------------------------------------------------- 3. décomposition -- */
  /** Chapitres avec leur HTML — cible unique (chapterId) ou toute la bible. */
  function chaptersWithHtml(chapterId) {
    return writer.gmList()
      .filter((c) => !chapterId || c.id === chapterId)
      .map((c) => {
        const doc = writer.gmGet(c.id);
        return { id: c.id, name: c.name, html: doc?.html || '' };
      })
      // ne jamais re-scanner les fiches élément elles-mêmes (elles vivent dans
      // les répertoires de la bible, donc dans gmList)
      .filter((c) => {
        const entry = idx().find((j) => j.flags?.holocron?.gmChapter === c.id || j._id === c.id);
        return !entry?.flags?.holocron?.elemSheet && !elemKindOf(entry || {});
      });
  }

  /** APERÇU seul : découpe et propose, ne touche à RIEN. */
  function decomposeScan({ chapterId = '' } = {}) {
    const chapters = chaptersWithHtml(chapterId);
    if (chapterId && !chapters.length) throw Object.assign(new Error('chapitre inexistant'), { code: 404 });
    const found = scanChapterElements(chapters, listElements());
    return {
      chapters: chapters.length,
      found,
      news: found.filter((f) => !f.exists).length,
      templates: ELEM_TEMPLATES,
    };
  }

  /**
   * Création de la SÉLECTION du MJ. `ids` = ids de propositions issues d'un scan.
   * Une proposition déjà matérialisée est SAUTÉE (jamais de doublon) ; le
   * chapitre d'origine n'est jamais modifié.
   */
  async function decompose({ ids, chapterId = '' } = {}) {
    const wanted = new Set((Array.isArray(ids) ? ids : []).map(String));
    if (!wanted.size) return { created: [], skipped: [] };
    const { found } = decomposeScan({ chapterId });
    const created = [];
    const skipped = [];
    for (const f of found) {
      if (!wanted.has(f.id)) continue;
      if (f.exists) { skipped.push({ id: f.id, title: f.title, reason: f.reason || 'déjà créé' }); continue; }
      try {
        created.push(await createElement({
          kind: f.kind, title: f.title, data: f.data,
          source: { propId: f.id, chapterId: f.chapterId, chapterName: f.chapterName, at: Date.now() },
        }));
      } catch (e) {
        logger.warn?.('[bible] décomposition', f.title, String(e.message || e));
        skipped.push({ id: f.id, title: f.title, reason: String(e.message || e).slice(0, 120) });
      }
    }
    return { created, skipped };
  }

  /* --------------------------------------------------- 4. dédoublonnage PNJ -- */
  /** Fiches CC npc avec leur description ACTUELLE (détection des reports déjà faits). */
  function ccNpcs() {
    return idx()
      .filter((j) => ccType(j) === 'npc' && !j.flags?.['swffg-astronavigation'])
      .map((j) => {
        const doc = docOf(j._id) || j;
        return { id: j._id, name: j.name,
          description: String(doc.flags?.['campaign-codex']?.data?.description || '') };
      });
  }

  /** APERÇU seul du dédoublonnage : chapitres PNJ → blocs rapprochés par nom. */
  function npcScan({ chapterIds = [] } = {}) {
    const wanted = new Set((Array.isArray(chapterIds) ? chapterIds : []).map(String));
    const chapters = chaptersWithHtml('')
      .filter((c) => (wanted.size ? wanted.has(String(c.id)) : isNpcChapter(c.name)));
    const found = scanNpcSections(chapters, ccNpcs());
    return {
      chapters: chapters.map((c) => ({ id: c.id, name: c.name })),
      found: found.map(({ html, ...rest }) => ({ ...rest, excerpt: html.length > 400 ? `${html.slice(0, 400)}…` : html })),
      news: found.filter((f) => !f.exists).length,
    };
  }

  /**
   * Report ADDITIF de la sélection : le bloc rejoint data.description de la
   * fiche CC (marqueur d'idempotence — jamais deux fois), et les champs
   * narratifs détectés complètent le dossier MJ SANS écraser l'existant.
   */
  async function npcMerge({ ids } = {}) {
    const wanted = new Set((Array.isArray(ids) ? ids : []).map(String));
    if (!wanted.size) return { merged: [], skipped: [] };
    const chapters = chaptersWithHtml('').filter((c) => isNpcChapter(c.name));
    const found = scanNpcSections(chapters, ccNpcs());
    const merged = [];
    const skipped = [];
    const dossiers = writer.dossiers();
    for (const f of found) {
      if (!wanted.has(f.id)) continue;
      if (f.exists) { skipped.push({ id: f.id, npcName: f.npcName, reason: 'déjà reporté dans cette fiche' }); continue; }
      try {
        const doc = docOf(f.npcId) || {};
        const cur = String(doc.flags?.['campaign-codex']?.data?.description || '');
        if (cur.includes(npcMarker(f.id))) { skipped.push({ id: f.id, npcName: f.npcName, reason: 'déjà reporté' }); continue; }
        const next = cur + npcMergeBlock(f);
        await mcpCall('modify_document', { type: 'JournalEntry', _id: f.npcId,
          updates: [{ 'flags.campaign-codex.data.description': next }] });
        // write-through (le client Foundry ne voit pas ses propres writes)
        const setDesc = (flags) => {
          flags['campaign-codex'] = flags['campaign-codex'] || {};
          flags['campaign-codex'].data = flags['campaign-codex'].data || {};
          flags['campaign-codex'].data.description = next;
        };
        store.patch('journalsIndex', (items) => {
          const j = items.find((x) => x._id === f.npcId);
          if (j) { j.flags = j.flags || {}; setDesc(j.flags); }
        });
        store.patch(`journal:${f.npcId}`, (d) => { d.flags = d.flags || {}; setDesc(d.flags); });

        // dossier narratif : SEULS les champs encore vides sont complétés
        const entityId = idx().find((j) => j._id === f.npcId)?.flags?.holocron?.legacyId || f.npcId;
        const cur2 = dossiers[entityId] || {};
        const patch = Object.fromEntries(Object.entries(f.dossier || {}).filter(([k, v]) => v && !cur2[k]));
        let dossierFields = [];
        if (Object.keys(patch).length) {
          await writer.dossierSave(entityId, patch);
          dossierFields = Object.keys(patch);
        }
        merged.push({ id: f.id, npcId: f.npcId, npcName: f.npcName, heading: f.heading, dossierFields });
      } catch (e) {
        logger.warn?.('[bible] report PNJ', f.npcName, String(e.message || e));
        skipped.push({ id: f.id, npcName: f.npcName, reason: String(e.message || e).slice(0, 120) });
      }
    }
    return { merged, skipped };
  }

  return { archive, listElements, createElement, decomposeScan, decompose, npcScan, npcMerge, ELEM_TEMPLATES };
}
