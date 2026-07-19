// transform/journals.mjs — JournalEntry Foundry (monde + pack règles) →
// forme { categories, journals } consommée par le front (ex journals.json).
// Les catégories viennent de la config (dossiers Foundry déclarés) ; les
// journaux du pack règles sont fusionnés comme une catégorie « rules ».

import { resolveCategories, resolveFolder, categoryOf } from './categories.mjs';

const RULES_CAT_ID = '__rules__';

// Pages techniques à NE JAMAIS afficher brut : le barème « dice_helper » (JSON
// machine SWFFG.SkillsName…, parfois glissé comme page dans « Mécanique de base »).
// Il est servi joliment ailleurs (weblet #/aidejeu) ; ici on le masque.
const isRawHelperPage = (p) =>
  /^dice_helper$/i.test(String(p?.name || '').trim()) ||
  /^\s*<p>\s*\{\s*&quot;SWFFG\.SkillsName|^\s*<p>\s*\{\s*"SWFFG\.SkillsName/i.test(String(p?.text?.content || ''));

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

// --- Monk's Enhanced Journal : métadonnées structurées portées par la page ----
// (type person/place/organization…, role, location, attributes, relationships).
// Le contenu texte reste dans page.text.content — on n'extrait ici que le méta.
// role MEJ (page person, FR ou EN) → clé de statut du front (statut.js : allie /
// ennemi / neutre / mentor / contact). MEJ est la source par défaut de l'Holocron.
const MEJ_ROLE_STATUT = {
  ally: 'allie', allie: 'allie', allié: 'allie', ami: 'allie', friend: 'allie', amie: 'allie',
  enemy: 'ennemi', ennemi: 'ennemi', ennemie: 'ennemi', rival: 'ennemi', hostile: 'ennemi',
  mentor: 'mentor', maitre: 'mentor', maître: 'mentor',
  neutral: 'neutre', neutre: 'neutre',
  contact: 'contact', informateur: 'contact',
};
const ID16 = /^[a-zA-Z0-9]{16}$/; // clés par-utilisateur (notes privées) à ignorer
export function mejView(doc, gm) {
  const page = (doc.pages || []).find((p) => p.flags?.['monks-enhanced-journal']);
  const jf = doc.flags?.['monks-enhanced-journal'];
  if (!page && !jf) return null;
  const mf = page?.flags?.['monks-enhanced-journal'] || {};
  const attributes = {};
  for (const [k, v] of Object.entries(mf.attributes || {})) {
    // tolérant aux deux formes MEJ : "valeur" directe OU { value: "valeur" }
    const val = (v && typeof v === 'object') ? v.value : v;
    if (typeof val === 'string' && val.trim() && !ID16.test(k)) attributes[k] = val.trim();
  }
  const relationships = Object.values(mf.relationships || {})
    .filter((r) => r && r.id && (gm || !r.hidden))
    .map((r) => ({ ref: r.id, rel: String(r.relationship || ''), ...(r.hidden ? { hidden: true } : {}) }));
  const out = {
    type: String(mf.type || jf?.pagetype || ''),
    ...(mf.role ? { role: String(mf.role) } : {}),
    ...(mf.location ? { location: String(mf.location) } : {}),
    ...(mf.date ? { date: String(mf.date) } : {}), // champ NATIF de la fiche event MEJ
    ...(mf.placetype ? { placetype: String(mf.placetype) } : {}),
    ...(Object.keys(attributes).length ? { attributes } : {}),
    ...(relationships.length ? { relationships } : {}),
  };
  return out.type || Object.keys(out).length > 1 ? out : null;
}

// --- Timeline : dates galactiques BBY/ABY -------------------------------------
// « 19 BBY » → -19, « 4 ABY » → 4, « 0 » / « 0 BBY/ABY » → 0 ; décimales acceptées.
// null si illisible : l'événement part en fin de frise (section « non datés »).
export function parseDateBBY(s) {
  const t = String(s == null ? '' : s).trim().toUpperCase().replace(',', '.');
  if (!t) return null;
  const m = /^(-?\d+(?:\.\d+)?)\s*(BBY|ABY)?/.exec(t);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  const era = m[2] || (t.includes('BBY') ? 'BBY' : t.includes('ABY') ? 'ABY' : '');
  return era === 'BBY' ? -n : n;
}

// Résolution de dossier/catégories : implémentation partagée (transform/categories.mjs),
// ré-exportée ici pour ne pas casser les imports existants.
export { resolveFolder };

// Icône Mini Calendar qui marque un événement CANON (le reste = campagne).
export const CANON_ICON = 'fas fa-jedi';

// Timeline de campagne — deux sources fusionnées :
//  1. Mini Calendar (`calendarEvents` : notes du journal « Calendar Events - Mini
//     Calendar », année calendrier → BBY/ABY via calendar.epochBBY, icône jedi = canon) ;
//  2. LEGACY : fiches MEJ « event » des catégories kind === 'timeline' (transition).
// Tri chronologique croissant, non-datés en fin de frise.
export function buildTimelineView({ config, folders, journalsIndex, getJournal, calendarEvents, visibleFilter, gm = false }) {
  const events = [];
  const epochRaw = Number(config?.calendar?.epochBBY);
  const epoch = Number.isFinite(epochRaw) ? epochRaw : 35;
  const bbyLabel = (v) => (v < 0 ? `${-v} BBY` : `${v} ABY`);
  for (const n of (calendarEvents || [])) {
    if (!gm && !n.playerVisible) continue; // notes MJ masquées aux joueurs
    const value = n.year - epoch; // année calendrier → BBY (négatif) / ABY (positif)
    // tri AU JOUR PRÈS : calendrier Grande ReSynchronisation = 10 mois × 35 jours
    const frac = (((n.month || 1) - 1) * 35 + ((n.day || 1) - 1)) / 350;
    const excerpt = String(n.content || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    events.push({
      name: n.title || excerpt.slice(0, 60) || 'Événement',
      source: n.icon === CANON_ICON ? 'canon' : 'campagne',
      date: bbyLabel(value), dateValue: value + Math.min(frac, 0.999),
      excerpt: excerpt.length > 240 ? excerpt.slice(0, 240) + '…' : excerpt,
    });
  }
  // catégories kind « timeline » — dossier, tag ou type CC (cf. categories.mjs)
  const tlCats = resolveCategories({ config, folders }).filter((c) => c.kind === 'timeline');

  const excerptOf = (doc) => {
    const html = String(((doc.pages || []).find((p) => p.text?.content) || {}).text?.content || '');
    const txt = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    return txt.length > 240 ? txt.slice(0, 240) + '…' : txt;
  };

  for (const entry of (journalsIndex || [])) {
    if (!tlCats.some((c) => c.match(entry))) continue;
    if (visibleFilter && !visibleFilter(entry)) continue;
    const doc = getJournal(entry._id);
    if (!doc) continue;
    const mej = mejView(doc, gm);
    if (String(mej?.type || '') !== 'event') continue;
    // Convention de la fiche event MEJ : champ natif « Date » = BBY/ABY ; champ natif
    // « Position » (location) = Canon / Campagne. Replis tolérants : attributs
    // date/position (anciennes fiches) ; le lieu réel vit dans l'attribut `lieu`.
    const date = String(mej.date || mej.attributes?.date || '');
    const dateEnd = String(mej.attributes?.datefin || '');
    const pos = String(mej.location || mej.attributes?.position || '');
    const lieu = String(mej.attributes?.lieu || (pos && !/^(canon|campagne)/i.test(pos) ? pos : ''));
    events.push({
      id: entry.flags?.holocron?.legacyId || doc._id,
      foundryId: doc._id,
      name: doc.name,
      source: /^canon/i.test(pos) ? 'canon' : 'campagne',
      date, dateValue: parseDateBBY(date),
      ...(dateEnd ? { dateEnd, dateEndValue: parseDateBBY(dateEnd) } : {}),
      ...(lieu ? { location: lieu } : {}),
      excerpt: excerptOf(doc),
    });
  }

  events.sort((a, b) => ((a.dateValue ?? Infinity) - (b.dateValue ?? Infinity)) || a.name.localeCompare(b.name, 'fr'));
  return { events };
}

// --- Campaign Codex : lecture des fiches typées CC (flags.campaign-codex) -------
// Même modèle de vue que mejView — le front ne voit pas la différence de source.
// Types CC : region/location/shop/npc/group/quest/tag ; liens par uuid dans data.
const CC_TYPE_MAP = { npc: 'person', location: 'place', region: 'place', shop: 'shop', group: 'organization', quest: 'quest', tag: 'misc' };
const CC_LINK_FIELDS = {
  linkedNPCs: 'PNJ', associates: 'Associé', members: 'Membre',
  linkedLocations: 'Lieu', linkedLocation: 'Lieu', parentRegion: 'Région',
  linkedShops: 'Boutique', linkedQuests: 'Quête', linkedStandardJournals: 'Journal',
};
// Champs INTERNES de `data` : jamais affichés en « carte d'identité ». `linkedActor`
// est un uuid d'Actor (pas un lien de fiche à fiche : ccRef ne saurait pas le
// résoudre) et `tagMode`/`isLoot` sont des drapeaux de rendu de la sheet CC —
// les laisser passer afficherait « linkedActor: Actor.xxx » sur les fiches PJ et
// sur les notes promues.
const CC_SKIP_ATTRS = new Set(['description', 'notes', 'markup', 'enrichedDescription', 'inventory', 'inventoryCash', 'widgets', 'sheetTypeLabelOverride', 'linkedActor', 'tagMode', 'isLoot']);
// lien CC → id de JournalEntry (uuid "JournalEntry.<id>", id nu, ou objet {uuid})
const ccRef = (v) => {
  const s = typeof v === 'string' ? v : String(v?.uuid || v?.id || '');
  const m = /JournalEntry\.([A-Za-z0-9]{16})/.exec(s);
  return m ? m[1] : (/^[A-Za-z0-9]{16}$/.test(s) ? s : null);
};

export function ccView(doc) {
  const cf = doc.flags?.['campaign-codex'];
  if (!cf?.type) return null;
  const data = cf.data || {};
  const relationships = [];
  for (const [field, rel] of Object.entries(CC_LINK_FIELDS)) {
    const raw = data[field];
    for (const v of (Array.isArray(raw) ? raw : (raw ? [raw] : []))) {
      const ref = ccRef(v);
      if (ref) relationships.push({ ref, rel });
    }
  }
  // champs simples de data affichables en « carte d'identité » (chaînes courtes non-HTML)
  // + attributs holocron posés par le convertisseur MEJ→CC (flags.holocron.attrs)
  const attributes = {};
  for (const [k, v] of Object.entries({ ...(doc.flags?.holocron?.attrs || {}), ...data })) {
    if (typeof v === 'string' && v.trim() && v.length <= 120 && !/[<>]/.test(v)
      && !(k in CC_LINK_FIELDS) && !CC_SKIP_ATTRS.has(k)) attributes[k] = v.trim();
  }
  // tags CC (Terrain/Climat/Favori… — indexés par Asset Librarian) : affichés en attribut
  if (Array.isArray(data.tags) && data.tags.length) attributes.tags = data.tags.join(', ');
  return {
    source: 'cc',
    type: CC_TYPE_MAP[cf.type] || String(cf.type),
    ccType: String(cf.type),
    ...(Object.keys(attributes).length ? { attributes } : {}),
    ...(relationships.length ? { relationships } : {}),
  };
}

/** Vue de fiche UNIFIÉE : Campaign Codex d'abord, Monk's Enhanced Journal en legacy. */
export function sheetView(doc, gm) {
  return ccView(doc) || mejView(doc, gm);
}

// --- Sommaire d'acte (flags.holocron.actSummary) ------------------------------
// Bloc structuré posé par l'éditeur de campagne sur le journal d'acte :
// { crawl, situation, objectifs: [], protagonistes: [ids], lieux: [ids],
//   fronts: [], hidden: [champs masqués aux joueurs] }.
export const ACT_SUMMARY_FIELDS = ['crawl', 'situation', 'objectifs', 'protagonistes', 'lieux', 'fronts'];
const asStr = (v, max) => String(v == null ? '' : v).slice(0, max).trim();
const asStrList = (v, max, n) => (Array.isArray(v) ? v : [])
  .map((x) => (typeof x === 'string' ? asStr(x, max) : '')).filter(Boolean).slice(0, n);
const asIdList = (v, n) => (Array.isArray(v) ? v : [])
  .map((x) => {
    const s = String(x || '');
    const m = /JournalEntry\.([A-Za-z0-9]{16})/.exec(s);
    return m ? m[1] : (/^[A-Za-z0-9]{16}$/.test(s) ? s : null);
  })
  .filter(Boolean).slice(0, n);

/** Assainit un sommaire d'acte ; null si le bloc est vide/inexistant. */
export function sanitizeActSummary(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const out = {
    crawl: asStr(raw.crawl, 4000),
    situation: asStr(raw.situation, 4000),
    objectifs: asStrList(raw.objectifs, 240, 20),
    protagonistes: asIdList(raw.protagonistes, 30),
    lieux: asIdList(raw.lieux, 30),
    fronts: asStrList(raw.fronts, 240, 12),
    hidden: (Array.isArray(raw.hidden) ? raw.hidden : [])
      .filter((f) => ACT_SUMMARY_FIELDS.includes(f)).slice(0, ACT_SUMMARY_FIELDS.length),
  };
  const hasContent = out.crawl || out.situation
    || out.objectifs.length || out.protagonistes.length || out.lieux.length || out.fronts.length;
  return hasContent ? out : null;
}

/** Vue du sommaire pour une session : MJ = tout (hidden compris, pour l'éditeur) ;
 * joueur = champs masqués retirés — null si plus rien à montrer. */
export function actSummaryView(raw, gm) {
  const clean = sanitizeActSummary(raw);
  if (!clean) return null;
  if (gm) return clean;
  const out = {};
  for (const f of ACT_SUMMARY_FIELDS) {
    if (clean.hidden.includes(f)) continue;
    if (Array.isArray(clean[f]) ? clean[f].length : clean[f]) out[f] = clean[f];
  }
  return Object.keys(out).length ? out : null;
}

// journalsIndex + journaux complets (store) + pack règles → vue front.
// `visibleFilter(doc)` applique l'ownership de la session (auth.canSee).
export function buildJournalsView({ config, folders, journalsIndex, getJournal, rulesPack, visibleFilter, gm = false }) {
  const journals = [];

  // Catégories : par DOSSIER (historique), par TAG ou par TYPE Campaign Codex.
  // Une entrée est classée dans la PREMIÈRE catégorie qui la reconnaît, donc une
  // fiche taguée déjà rangée dans un dossier déclaré n'apparaît pas deux fois.
  const resolved = resolveCategories({ config, folders });
  const cats = resolved.map((c) => ({ id: c.id, label: c.label, kind: c.kind, editable: c.editable }));

  // Journaux des catégories déclarées (ordre du sort Foundry ; les catégories
  // kind « rules » — dossier de règles importées — reçoivent le même traitement
  // que le pack : préfixe de tri « NN · » retiré, ordre alphanumérique).
  const rulesCatIds = new Set(cats.filter((c) => c.kind === 'rules').map((c) => c.id));
  const prefixRe = new RegExp(config?.packs?.rulesNamePrefix || '^\\d+\\s*·?\\s*');
  const sorted = [...(journalsIndex || [])].sort((a, b) => (a.sort || 0) - (b.sort || 0));
  for (const entry of sorted) {
    const cat = categoryOf(resolved, entry);
    if (!cat) continue;
    if (visibleFilter && !visibleFilter(entry)) continue;
    const doc = getJournal(entry._id);
    if (!doc) continue; // pas encore synchronisé — apparaîtra au prochain tick
    const fh = entry.flags?.holocron || {};
    const mej = sheetView(doc, gm); // Campaign Codex d'abord, MEJ en legacy
    // statut/mort : rôle MEJ → statut en legacy ; pour les fiches CC (pas de rôle),
    // flags.holocron.statut/mort est la source (posé par le convertisseur).
    const statut = MEJ_ROLE_STATUT[String(mej?.role || '').toLowerCase()] || fh.statut || '';
    const mort = /mort|décéd|décès|deceased|dead/i.test(String(mej?.attributes?.life || mej?.attributes?.vie || '')) || Boolean(fh.mort);
    const isRules = rulesCatIds.has(cat.id);
    // Sommaire d'acte (récap de début d'acte, visible joueurs — champs masquables)
    const actSummary = actSummaryView(fh.actSummary, gm);
    journals.push({
      id: fh.legacyId || doc._id,
      foundryId: doc._id,
      name: isRules ? doc.name.replace(prefixRe, '') : doc.name,
      categoryId: cat.id,
      ...(isRules ? { _sortName: doc.name } : {}),
      ...(statut ? { statut } : {}),
      ...(mort ? { mort: true } : {}),
      ...(mej ? { mej } : {}),
      ...(actSummary ? { actSummary } : {}),
      pages: (doc.pages || []).filter((p) => (p.type === 'text' || p.text) && !isRawHelperPage(p)).map(pageView),
    });
  }
  if (rulesCatIds.size) {
    // tri « 01, 02, … » sur le nom BRUT (le sort Foundry d'un dossier importé est plat)
    journals.sort((a, b) => (a._sortName && b._sortName)
      ? a._sortName.localeCompare(b._sortName, 'fr', { numeric: true }) : 0);
    for (const j of journals) delete j._sortName;
  }

  // Résout les relations MEJ vers les ids de vue (lien si la cible est visible,
  // sinon nom seul depuis l'index ; les relations cachées ne sortent que MJ).
  const byFoundryId = new Map(journals.map((j) => [j.foundryId, j]));
  const idxName = new Map((journalsIndex || []).map((e) => [e._id, e.name]));
  for (const j of journals) {
    if (!j.mej?.relationships) continue;
    j.mej.relationships = j.mej.relationships.map((r) => {
      const t = byFoundryId.get(r.ref);
      if (t) return { id: t.id, name: t.name, rel: r.rel, ...(r.hidden ? { hidden: true } : {}) };
      if (idxName.has(r.ref)) return { name: idxName.get(r.ref), rel: r.rel, ...(r.hidden ? { hidden: true } : {}) };
      return null;
    }).filter(Boolean);
    if (!j.mej.relationships.length) delete j.mej.relationships;
  }

  // Pack règles → catégorie dédiée (préfixe « NN · » retiré, ordre par préfixe).
  // Ignoré si une catégorie DOSSIER kind « rules » est déclarée (règles importées
  // dans le monde — sinon la même aide de jeu sortirait en double).
  if (rulesPack && rulesPack.length && !rulesCatIds.size) {
    cats.unshift({ id: RULES_CAT_ID, label: 'Règles du jeu', kind: 'rules', editable: false });
    const sortedRules = [...rulesPack].sort((a, b) => a.name.localeCompare(b.name, 'fr', { numeric: true }));
    for (const doc of sortedRules) {
      journals.push({
        id: doc._id,
        foundryId: doc._id,
        name: doc.name.replace(prefixRe, ''),
        categoryId: RULES_CAT_ID,
        pages: (doc.pages || []).filter((p) => (p.type === 'text' || p.text) && !isRawHelperPage(p)).map(pageView),
      });
    }
  }

  return { categories: cats, journals };
}
