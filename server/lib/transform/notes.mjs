// transform/notes.mjs — association des journaux de NOTES (catégories kind
// « notes » de la config) aux fiches PJ et au vaisseau du groupe.
//
// Règles (décision utilisateur) :
//  1. PRIORITÉ au tag : un journal portant un tag égal au NOM d'un PJ (insensible
//     casse/accents) est rattaché à ce PJ ; un tag « équipage » / « groupe » /
//     « vaisseau » le rattache au vaisseau. Tags lus là où l'écosystème les met :
//     flags.campaign-codex.data.tags OU flags.asset-librarian.filterTag (convention
//     Asset Librarian, cf. favoris astronav), flags.holocron.tags en secours.
//  2. REPLI ownership : un journal dont AUCUN tag ne le rattache (ni PJ, ni groupe)
//     est rattaché aux PJ du/des joueurs qui en sont propriétaires (niveau OWNER,
//     hors MJ et hors default) — joueur ↔ PJ via actor.ownership OU user.character.
// La VISIBILITÉ n'est pas décidée ici : l'appelant filtre par canSee(session).

/** Normalisation de nom/tag : minuscules, sans accents, espaces réduits. */
export const normName = (s) => String(s || '')
  .toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/\s+/g, ' ').trim();

// tolérant aux deux formes : tableau de tags OU chaîne « a, b » (filterTag)
const asList = (raw) => (Array.isArray(raw) ? raw : String(raw || '').split(','))
  .map((s) => String(s).trim()).filter(Boolean);

/** Tags d'un journal de notes (toutes conventions confondues). */
export function noteTags(entry) {
  const f = entry?.flags || {};
  return [
    ...asList(f['campaign-codex']?.data?.tags),
    ...asList(f['asset-librarian']?.filterTag),
    ...asList(f.holocron?.tags),
  ];
}

/** Tags qui rattachent un journal de notes au vaisseau du groupe. */
export const GROUP_TAGS = new Set(['equipage', 'groupe', 'vaisseau']);

/** Ids des joueurs (hors MJ, hors default) propriétaires OWNER d'un document. */
export function playerOwnerIds(doc, gmIds = new Set()) {
  return Object.entries(doc?.ownership || {})
    .filter(([uid, lvl]) => uid !== 'default' && (lvl ?? 0) >= 3 && !gmIds.has(uid))
    .map(([uid]) => uid);
}

/**
 * Associe les journaux de notes aux PJ et au groupe.
 * @param {object[]} pcs      acteurs PJ bruts ({ _id, name, ownership })
 * @param {object[]} entries  entrées d'index des journaux de notes ({ _id, name, flags, ownership })
 * @param {object[]} users    collection users du SyncStore ({ _id, role, character })
 * @returns {{ byPc: Map<string, object[]>, group: object[] }}
 */
export function matchNotes({ pcs = [], entries = [], users = [] } = {}) {
  const gmIds = new Set(users.filter((u) => (u?.role ?? 0) >= 3).map((u) => u._id));
  const nameToPc = new Map(pcs.map((p) => [normName(p.name), p]));
  const byPc = new Map(pcs.map((p) => [p._id, []]));
  const group = [];

  // joueur → PJ qu'il incarne (OWNER sur l'actor, ou assignation user.character)
  const pcsByUser = new Map();
  const link = (uid, pc) => {
    if (!uid || !pc) return;
    const list = pcsByUser.get(uid) || [];
    if (!list.includes(pc)) { list.push(pc); pcsByUser.set(uid, list); }
  };
  for (const pc of pcs) for (const uid of playerOwnerIds(pc, gmIds)) link(uid, pc);
  for (const u of users) if (u?.character && byPc.has(u.character)) link(u._id, pcs.find((p) => p._id === u.character));

  for (const e of entries) {
    const tags = [...new Set(noteTags(e).map(normName))];
    let claimed = false;
    for (const t of tags) {
      if (GROUP_TAGS.has(t)) { group.push(e); claimed = true; }
      const pc = nameToPc.get(t);
      if (pc) { byPc.get(pc._id).push(e); claimed = true; }
    }
    if (claimed) continue; // le tag fait foi — pas de repli ownership en plus
    // repli : journal possédé (OWNER) par un joueur → rattaché à son/ses PJ
    for (const uid of playerOwnerIds(e, gmIds)) {
      for (const pc of (pcsByUser.get(uid) || [])) {
        const list = byPc.get(pc._id);
        if (!list.includes(e)) list.push(e);
      }
    }
  }
  return { byPc, group };
}
