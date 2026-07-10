// transform/journals.mjs — JournalEntry Foundry (monde + pack règles) →
// forme { categories, journals } consommée par le front (ex journals.json).
// Les catégories viennent de la config (dossiers Foundry déclarés) ; les
// journaux du pack règles sont fusionnés comme une catégorie « rules ».

const RULES_CAT_ID = '__rules__';

function pageView(p) {
  return {
    id: p._id,
    name: p.name,
    level: 1,
    img: p.src || null,
    icon: null,
    html: (p.text && p.text.content) || '',
  };
}

// journalsIndex + journaux complets (store) + pack règles → vue front.
// `visibleFilter(doc)` applique l'ownership de la session (auth.canSee).
export function buildJournalsView({ config, folders, journalsIndex, getJournal, rulesPack, visibleFilter }) {
  const cats = [];
  const journals = [];
  const folderByName = new Map((folders || []).filter((f) => f.type === 'JournalEntry').map((f) => [f.name, f]));

  const declared = (config?.categories || []);
  for (const c of declared) {
    const f = folderByName.get(c.folder);
    if (!f) continue;
    const label = c.label || c.folder.replace(/^[^\p{L}\p{N}]+\s*/u, '');
    cats.push({ id: f._id, label, kind: c.kind || 'misc', editable: Boolean(c.editable) });
  }

  // Journaux monde des dossiers déclarés (ordre du sort Foundry).
  const catIds = new Set(cats.map((c) => c.id));
  const sorted = [...(journalsIndex || [])].sort((a, b) => (a.sort || 0) - (b.sort || 0));
  for (const entry of sorted) {
    if (!catIds.has(entry.folder)) continue;
    if (visibleFilter && !visibleFilter(entry)) continue;
    const doc = getJournal(entry._id);
    if (!doc) continue; // pas encore synchronisé — apparaîtra au prochain tick
    const fh = entry.flags?.holocron || {};
    journals.push({
      id: fh.legacyId || doc._id,
      foundryId: doc._id,
      name: doc.name,
      categoryId: entry.folder,
      ...(fh.statut ? { statut: fh.statut } : {}),
      ...(fh.mort ? { mort: true } : {}),
      pages: (doc.pages || []).filter((p) => p.type === 'text' || p.text).map(pageView),
    });
  }

  // Pack règles → catégorie dédiée (préfixe « NN · » retiré, ordre par préfixe).
  if (rulesPack && rulesPack.length) {
    const prefixRe = new RegExp(config?.packs?.rulesNamePrefix || '^\\d+\\s*·\\s*');
    cats.unshift({ id: RULES_CAT_ID, label: 'Règles du jeu', kind: 'rules', editable: false });
    const sortedRules = [...rulesPack].sort((a, b) => a.name.localeCompare(b.name, 'fr', { numeric: true }));
    for (const doc of sortedRules) {
      journals.push({
        id: doc._id,
        foundryId: doc._id,
        name: doc.name.replace(prefixRe, ''),
        categoryId: RULES_CAT_ID,
        pages: (doc.pages || []).filter((p) => p.type === 'text' || p.text).map(pageView),
      });
    }
  }

  return { categories: cats, journals };
}
