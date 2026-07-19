// transform/categories.mjs — résolution des CATÉGORIES de l'app à partir de la
// config (`flags.holocron.config.categories`).
//
// Trois façons de définir une catégorie, combinables dans la même liste :
//
//   { folder: "📓 Notes des joueurs", kind: "notes" }   ← DOSSIER Foundry (historique)
//   { tag: "mj:front",   kind: "org",  label: "Fronts" } ← TAG (CC data.tags OU Asset Librarian)
//   { ccType: "quest",   kind: "quest", label: "Quêtes" } ← TYPE de fiche Campaign Codex
//
// `folder` accepte un nom Foundry, un `_id` ou un uuid « Folder.<id> » (inchangé).
// `tag` compare de façon normalisée (casse/accents) et lit les DEUX conventions
// de tag (cf. transform/tags.mjs) : le MJ peut tagger dans la sheet CC comme dans
// Asset Librarian, l'app voit les deux.
//
// Rétrocompatibilité : une config qui ne contient que des catégories `folder` se
// comporte exactement comme avant (mêmes ids de catégorie = ids de dossier).

import { normName, docTagsNorm, ccType } from './tags.mjs';

/** Dossier par nom Foundry, `_id` ou uuid « Folder.<id> ». */
export function resolveFolder(folders, ref) {
  const list = (folders || []).filter((f) => f && f.type === 'JournalEntry');
  return list.find((f) => f.name === ref || f._id === ref || `Folder.${f._id}` === ref) || null;
}

// Id de catégorie SYNTHÉTIQUE pour les catégories sans dossier. Préfixé pour ne
// jamais entrer en collision avec un `_id` de dossier Foundry (16 alphanum).
export const tagCatId = (tag) => `tag:${normName(tag)}`;
export const typeCatId = (t) => `cctype:${normName(t)}`;

// Libellé par défaut : celui de la config, sinon le nom du dossier / le tag,
// débarrassé de son emoji de tête (même règle qu'avant pour les dossiers).
const stripEmoji = (s) => String(s || '').replace(/^[^\p{L}\p{N}]+\s*/u, '');

/**
 * Résout les catégories déclarées en descripteurs exploitables.
 *
 * @returns {{id, label, kind, editable, source: 'folder'|'tag'|'ccType',
 *            folderId?: string, tag?: string, ccType?: string,
 *            match: (entry) => boolean}[]}
 *
 * `match(entry)` teste une entrée d'index de journal (`{_id, name, folder, flags}`).
 * Les catégories non résolvables (dossier absent, tag vide) sont ignorées —
 * comme avant, une config qui pointe un dossier supprimé ne casse pas la vue.
 */
export function resolveCategories({ config, folders } = {}) {
  const out = [];
  for (const c of (config?.categories || [])) {
    if (!c || typeof c !== 'object') continue;
    const kind = c.kind || 'misc';
    const editable = Boolean(c.editable);

    if (c.folder) {
      const f = resolveFolder(folders, c.folder);
      if (!f) continue;
      out.push({
        id: f._id, label: c.label || stripEmoji(f.name || c.folder), kind, editable,
        source: 'folder', folderId: f._id,
        match: (e) => e?.folder === f._id,
      });
      continue;
    }

    if (c.tag) {
      const tag = normName(c.tag);
      if (!tag) continue;
      out.push({
        id: tagCatId(tag), label: c.label || stripEmoji(String(c.tag)), kind, editable,
        source: 'tag', tag,
        match: (e) => docTagsNorm(e).includes(tag),
      });
      continue;
    }

    if (c.ccType) {
      const type = normName(c.ccType);
      if (!type) continue;
      out.push({
        id: typeCatId(type), label: c.label || stripEmoji(String(c.ccType)), kind, editable,
        source: 'ccType', ccType: type,
        match: (e) => normName(ccType(e)) === type,
      });
    }
  }
  return out;
}

/**
 * Catégorie d'une entrée : la PREMIÈRE qui matche, dans l'ordre de la config.
 * Les catégories `folder` gagnent naturellement quand elles sont déclarées en
 * tête — une fiche taguée qui vit déjà dans un dossier déclaré n'apparaît donc
 * pas deux fois (une entrée = une seule catégorie, comme avant).
 */
export function categoryOf(cats, entry) {
  for (const c of cats) if (c.match(entry)) return c;
  return null;
}

/** Ids de DOSSIERS déclarés (sert aux garde-fous d'étanchéité en écriture). */
export function declaredFolderIds(cats) {
  return new Set(cats.filter((c) => c.source === 'folder').map((c) => c.folderId));
}

/** Entrées d'index appartenant aux catégories d'un `kind` donné (ex. « notes »). */
export function entriesOfKind(cats, journalsIndex, kind) {
  const of = cats.filter((c) => c.kind === kind);
  if (!of.length) return [];
  return (journalsIndex || []).filter((e) => of.some((c) => c.match(e)));
}
