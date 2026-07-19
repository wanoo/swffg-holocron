// transform/registry.mjs — GÉNÉRATION DU REGISTRE DES PERSONNAGES.
//
// `config.registry` = [{ kind: 'pc'|'npc'|'adv', id, forms: [nom, variantes] }].
// Il sert à DEUX choses, toutes deux MJ : les mentions cliquables dans les
// chapitres de bible (`public/js/pnj-registry.js`) et les backrefs « Mentionné
// dans » (`writer.backrefs()` fait correspondre les formes au texte des
// chapitres). Registre vide = les deux fonctionnalités n'affichent RIEN.
//
// Ce module le construit automatiquement à partir de ce que Foundry sait déjà :
// les acteurs du dossier PJ et les fiches Campaign Codex `npc`. NON DESTRUCTIF —
// les entrées écrites à la main par le MJ sont conservées telles quelles, leurs
// formes seulement complétées.
//
// PURE et sans I/O. La MÊME heuristique de formes vit dans le module Foundry
// (`module-foundry/scripts/registry-build.mjs`, pour l'installation hors ligne) :
// un test compare les deux implémentations pour qu'elles ne divergent jamais.

export const REGISTRY_KINDS = ['pc', 'npc', 'adv'];
const MAX_ENTRIES = 400;
const MAX_FORMS = 8;

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

// Particules et titres qui ne font JAMAIS une forme à eux seuls (« le », « dr »…) :
// les laisser passer ferait matcher la moitié de la bible.
const STOPWORDS = new Set([
  'le', 'la', 'les', 'de', 'du', 'des', 'un', 'une', 'l', 'd', 'et',
  'dr', 'pr', 'mr', 'mme', 'sir', 'lord', 'lady', 'dame', 'maitre', 'maître',
  'capitaine', 'commandant', 'amiral', 'general', 'général', 'colonel', 'sergent',
  'moff', 'agent', 'inquisiteur', 'senateur', 'sénateur', 'prince', 'princesse',
]);

/**
 * Formes de recherche d'un nom : le nom complet, sa version sans parenthèses ni
 * qualificatif, et les mots « portants » (prénom, patronyme) assez longs et assez
 * distinctifs pour ne pas produire de faux positifs.
 * @returns {string[]} formes uniques, la plus longue en tête
 */
export function nameForms(name) {
  const full = String(name || '').replace(/\s+/g, ' ').trim();
  if (!full) return [];
  const forms = [full];
  // « Kael Ordo (contrebandier) » / « Kael Ordo, dit le Rat » → « Kael Ordo »
  const bare = full.replace(/\s*[(（\[].*$/, '').replace(/\s*[,–—-]\s+(?:dit|dite|alias|surnomm[ée]e?)\b.*$/i, '').trim();
  if (bare && bare !== full) forms.push(bare);
  const words = (bare || full).split(/[\s'’]+/).filter(Boolean);
  if (words.length > 1) {
    for (const w of words) {
      const clean = w.replace(/[^\p{L}\p{N}-]/gu, '');
      if (clean.length < 4) continue;             // « Ben », « Kit » : trop court, trop ambigu
      if (STOPWORDS.has(norm(clean))) continue;
      forms.push(clean);
    }
  }
  const seen = new Set();
  return forms
    .filter((f) => f && !seen.has(norm(f)) && seen.add(norm(f)))
    .slice(0, MAX_FORMS);
}

/** Une entrée de registre assainie, ou null si inexploitable. */
export function sanitizeEntry(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.id || '').trim().slice(0, 40);
  if (!id) return null;
  const forms = [...new Set((Array.isArray(raw.forms) ? raw.forms : [])
    .map((f) => String(f || '').replace(/\s+/g, ' ').trim().slice(0, 80))
    .filter(Boolean))].slice(0, MAX_FORMS);
  if (!forms.length) return null;
  return {
    kind: REGISTRY_KINDS.includes(raw.kind) ? raw.kind : 'npc',
    id,
    forms,
    ...(raw.auto ? { auto: true } : {}),
  };
}

/**
 * Registre FUSIONNÉ : les entrées existantes gardent leur place, leur `kind` et
 * leurs formes manuelles (jamais retirées) ; les formes déduites du nom Foundry
 * y sont ajoutées ; les entités absentes du registre en reçoivent une nouvelle,
 * marquée `auto: true` (le MJ voit ce qui vient de la moulinette).
 *
 * @param {object} p
 * @param {Array<{_id, name}>} p.pcs      acteurs du dossier PJ
 * @param {Array<{_id, name}>} p.npcs     fiches Campaign Codex de type npc
 * @param {Array} p.existing              `config.registry` actuel
 * @returns {{ registry: Array, added: number, enriched: number, kept: number }}
 */
export function buildRegistry({ pcs = [], npcs = [], existing = [] } = {}) {
  const registry = [];
  const byId = new Map();
  for (const raw of (Array.isArray(existing) ? existing : [])) {
    const e = sanitizeEntry(raw);
    if (!e || byId.has(e.id)) continue;
    byId.set(e.id, e);
    registry.push(e);
  }
  const kept = registry.length;
  let added = 0;
  let enriched = 0;

  const feed = (list, kind) => {
    for (const doc of (Array.isArray(list) ? list : [])) {
      const id = String(doc?._id || doc?.id || '').trim();
      const forms = nameForms(doc?.name);
      if (!id || !forms.length) continue;
      const cur = byId.get(id);
      if (!cur) {
        if (registry.length >= MAX_ENTRIES) continue;
        const e = { kind, id, forms, auto: true };
        byId.set(id, e);
        registry.push(e);
        added++;
        continue;
      }
      // entrée existante : on COMPLÈTE ses formes, on ne retire ni ne réordonne
      const seen = new Set(cur.forms.map(norm));
      const add = forms.filter((f) => !seen.has(norm(f)) && seen.add(norm(f)));
      if (add.length && cur.forms.length < MAX_FORMS) {
        cur.forms = [...cur.forms, ...add].slice(0, MAX_FORMS);
        enriched++;
      }
    }
  };
  feed(pcs, 'pc');
  feed(npcs, 'npc');

  return { registry, added, enriched, kept };
}
