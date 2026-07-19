// transform/tags.mjs — lecture UNIFIÉE des tags d'un document Foundry.
//
// Règle du projet : le MJ doit pouvoir tagger depuis Foundry, des DEUX côtés —
// dans la fiche Campaign Codex (`flags.campaign-codex.data.tags`) comme dans
// Asset Librarian (`flags.asset-librarian.filterTag` / `categoryTag`). L'app
// écrit les deux (miroir) et LIT les deux : un tag posé à la main par le MJ dans
// l'un ou l'autre est pris en compte partout (notes, catégories par tag, favoris).
//
// `flags.holocron.tags` reste lu en secours (surcouche historique).

/** Normalisation de nom/tag : minuscules, sans accents, espaces réduits. */
export const normName = (s) => String(s || '')
  .toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/\s+/g, ' ').trim();

// Tolérant aux deux formes de l'écosystème : tableau de tags OU chaîne « a, b »
// (Asset Librarian stocke une chaîne ; Campaign Codex un tableau).
export const asTagList = (raw) => (Array.isArray(raw) ? raw : String(raw || '').split(','))
  .map((s) => String(s).trim()).filter(Boolean);

/**
 * Tags d'un document, toutes conventions confondues (ordre : CC, puis Asset
 * Librarian filtre/catégorie, puis surcouche holocron). Doublons conservés :
 * les appelants normalisent/dédupliquent selon leur besoin.
 */
export function docTags(doc) {
  const f = doc?.flags || {};
  return [
    ...asTagList(f['campaign-codex']?.data?.tags),
    ...asTagList(f['asset-librarian']?.filterTag),
    ...asTagList(f['asset-librarian']?.categoryTag),
    ...asTagList(f.holocron?.tags),
  ];
}

/** Tags normalisés et dédupliqués (comparaison insensible casse/accents). */
export function docTagsNorm(doc) {
  return [...new Set(docTags(doc).map(normName))].filter(Boolean);
}

/** Le document porte-t-il ce tag ? (comparaison normalisée) */
export function hasTag(doc, tag) {
  const want = normName(tag);
  return want ? docTagsNorm(doc).includes(want) : false;
}

/** Type Campaign Codex d'un document (`flags.campaign-codex.type`), '' si absent. */
export const ccType = (doc) => String(doc?.flags?.['campaign-codex']?.type || '');
