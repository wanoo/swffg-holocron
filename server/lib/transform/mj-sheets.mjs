// transform/mj-sheets.mjs — LES TROIS GABARITS DE FICHES MJ.
//
// Décision (wanoo) : Front/Menace, Secret/Vérité et Préparation de séance sont
// des FICHES CAMPAIGN CODEX PRIVÉES, pas des flags maison — pour que le MJ
// puisse les organiser, les lier et les tagger DEPUIS FOUNDRY comme n'importe
// quelle autre fiche de sa campagne.
//
// Support : le type CC `tag`, qui est la fiche GÉNÉRIQUE de Campaign Codex
// (`data.tagMode: true`, libellé relabellable par `data.sheetTypeLabelOverride`,
// relations natives `associates` / `linkedActor` / `linkedLocations` /
// `linkedStandardJournals`). On ne réinvente donc RIEN : la sheet CC affiche et
// édite la fiche dans Foundry, Asset Librarian l'indexe par ses tags.
//
// Conventions :
//   · `flags.campaign-codex.type = 'tag'` + `data.tagMode = true`
//   · `flags.core.sheetClass = 'campaign-codex.TagSheet'` (sinon sheet Foundry nue)
//   · champs structurés dans `flags.campaign-codex.data.<champ>` (chaînes)
//   · `data.description` = miroir HTML LISIBLE des champs (ce que la sheet montre)
//   · tags MIROITÉS des deux côtés : `data.tags` (CC) ET `asset-librarian.filterTag`
//   · `ownership.default = 0` — MJ only, strictement
//
// PURE et sans I/O : le service (`server/lib/gm-sheets.mjs`) s'occupe des écritures.

import { docTags, normName } from './tags.mjs';

export const CC = 'campaign-codex';
export const AL = 'asset-librarian';
/** Sheet CC de la fiche générique (miroir de CC_SHEET.tag du module Foundry). */
export const TAG_SHEET_CLASS = 'campaign-codex.TagSheet';

/**
 * Les trois gabarits. `tag` marque le gabarit ; `states` porte les tags d'état
 * (exclusifs entre eux) ; `fields` décrit les champs structurés, dans l'ordre
 * d'affichage.
 */
export const MJ_TEMPLATES = {
  front: {
    tag: 'mj:front',
    label: 'Front',                      // sheetTypeLabelOverride
    icon: '🔥',
    states: { actif: 'mj:front-actif', eteint: 'mj:front-eteint' },
    defaultState: 'actif',
    fields: [
      { key: 'intention', label: 'Intention', max: 500 },
      { key: 'horloge', label: 'Horloge / progression', max: 80 },
      { key: 'cible', label: 'Cible', max: 240 },
      { key: 'signes', label: 'Prochains signes', max: 2000 },
    ],
  },
  secret: {
    tag: 'mj:secret',
    label: 'Secret',
    icon: '🤫',
    states: { seme: 'mj:secret-seme' },   // absent = pas encore semé
    defaultState: '',
    fields: [
      { key: 'verite', label: 'La vérité', max: 2000 },
      { key: 'indices', label: 'Indices semables', max: 2000 },
      { key: 'revelableA', label: 'À qui c’est révélable', max: 500 },
    ],
  },
  prepa: {
    tag: 'mj:prepa',
    label: 'Prépa',
    icon: '🗓️',
    states: {},
    defaultState: '',
    fields: [
      { key: 'semer', label: 'À semer ce soir', max: 2000 },
      { key: 'questions', label: 'Questions ouvertes', max: 2000 },
      { key: 'checklist', label: 'Checklist', max: 2000 },
    ],
  },
};

export const MJ_KINDS = Object.keys(MJ_TEMPLATES);

/* ------------------------------------------------- éléments de jeu (bible) --
 * La bible décomposée en ÉLÉMENTS RÉUTILISABLES : lecture à voix haute,
 * ambiance sonore, visuel à projeter, vision par PJ. Même support que les
 * fiches MJ (fiche CC `tag` privée, tags des deux côtés, TagSheet) — donc
 * organisables, taggables et éditables DEPUIS FOUNDRY, exigence permanente.
 * Chaque gabarit déclare en plus son RÉPERTOIRE : le sous-dossier direct du
 * dossier bible où ses fiches sont rangées (= rubrique automatique de la
 * sidebar MJ). `folder` n'existe pas sur les gabarits MJ (dossier unique). */
export const ELEM_TEMPLATES = {
  lecture: {
    tag: 'elem:lecture',
    label: 'Lecture',
    icon: '📣',
    folder: '📣 Lectures',
    states: {},
    defaultState: '',
    fields: [
      { key: 'texte', label: 'Texte à lire aux joueurs', max: 8000 },
    ],
  },
  ambiance: {
    tag: 'elem:ambiance',
    label: 'Ambiance',
    icon: '🔊',
    folder: '🔊 Ambiances',
    states: {},
    defaultState: '',
    fields: [
      { key: 'playlist', label: 'Playlist Foundry', max: 100 },
      { key: 'weather', label: 'Météo (fog, embers…)', max: 200 },
    ],
  },
  visuel: {
    tag: 'elem:visuel',
    label: 'Visuel',
    icon: '🖼️',
    folder: '🖼️ Visuels',
    states: {},
    defaultState: '',
    fields: [
      { key: 'src', label: 'Image (chemin Foundry ou URL)', max: 300 },
      { key: 'legende', label: 'Légende', max: 500 },
    ],
  },
  vision: {
    tag: 'elem:vision',
    label: 'Vision',
    icon: '🔮',
    folder: '🔮 Visions',
    states: {},
    defaultState: '',
    fields: [
      { key: 'pj', label: 'PJ destinataire', max: 80 },
      { key: 'texte', label: 'Texte de la vision', max: 8000 },
    ],
  },
};

export const ELEM_KINDS = Object.keys(ELEM_TEMPLATES);
/** Gabarit (MJ ou élément) d'un kind — les fonctions ci-dessous servent les deux. */
const tplOf = (kind) => MJ_TEMPLATES[kind] || ELEM_TEMPLATES[kind];
/** Marqueur d'idempotence posé sous flags.holocron (mjSheet OU elemSheet). */
const markerKeyOf = (kind) => (ELEM_TEMPLATES[kind] ? 'elemSheet' : 'mjSheet');

/** Tous les tags d'état, tous gabarits confondus (retirés avant d'en poser un). */
const ALL_STATE_TAGS = [...MJ_KINDS.flatMap((k) => Object.values(MJ_TEMPLATES[k].states)),
  ...ELEM_KINDS.flatMap((k) => Object.values(ELEM_TEMPLATES[k].states))];

const asList = (raw) => (Array.isArray(raw) ? raw : String(raw || '').split(','))
  .map((s) => String(s).trim()).filter(Boolean);

// gabarit d'un document d'après ses tags, dans UN registre donné
function kindIn(doc, templates) {
  if (String(doc?.flags?.[CC]?.type || '') !== 'tag') return '';
  const tags = new Set(docTags(doc).map(normName));
  for (const kind of Object.keys(templates)) if (tags.has(normName(templates[kind].tag))) return kind;
  return '';
}

/**
 * Gabarit d'un document, d'après ses tags (des DEUX côtés — le MJ a pu taguer
 * depuis Asset Librarian). '' si ce n'est pas une fiche MJ.
 */
export function mjKindOf(doc) {
  return kindIn(doc, MJ_TEMPLATES);
}

/** Gabarit d'ÉLÉMENT d'un document ('' si ce n'en est pas un). */
export function elemKindOf(doc) {
  return kindIn(doc, ELEM_TEMPLATES);
}

/** État courant ('actif'/'eteint'/'seme'/''), lu dans les tags. */
export function mjStateOf(doc, kind) {
  const tpl = tplOf(kind);
  if (!tpl) return '';
  const tags = new Set(docTags(doc).map(normName));
  for (const [state, tag] of Object.entries(tpl.states)) if (tags.has(normName(tag))) return state;
  return tpl.defaultState;
}

/** Tags voulus pour un gabarit + un état, l'état étant EXCLUSIF. */
export function mjTags(kind, state, current = []) {
  const tpl = tplOf(kind);
  if (!tpl) return asList(current);
  const stateTag = state && tpl.states[state] ? tpl.states[state] : '';
  const drop = new Set(ALL_STATE_TAGS.map(normName));
  // on retire les tags d'ÉTAT (les nôtres) et on garde tout le reste — ce que le
  // MJ a posé à la main dans Foundry survit toujours
  const kept = asList(current).filter((t) => !drop.has(normName(t)));
  const out = [...kept];
  const has = (t) => out.some((x) => normName(x) === normName(t));
  if (!has(tpl.tag)) out.push(tpl.tag);
  if (stateTag && !has(stateTag)) out.push(stateTag);
  return out.slice(0, 32);
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/**
 * Miroir HTML des champs, recopié dans `data.description` : c'est CE QUE LA
 * SHEET CC AFFICHE dans Foundry. Sans lui, le MJ ouvrirait une fiche vide.
 */
export function mjDescription(kind, data) {
  const tpl = tplOf(kind);
  if (!tpl) return '';
  // Miroir SPÉCIFIQUE des éléments : le contenu prime sur la liste de champs
  // (une lecture s'affiche comme un texte, un visuel comme une image — pas
  // comme un formulaire). Les gabarits MJ gardent le miroir « label : valeur ».
  if (ELEM_TEMPLATES[kind]) return elemDescription(kind, data);
  const rows = tpl.fields
    .filter((f) => String(data?.[f.key] || '').trim())
    .map((f) => `<p><strong>${esc(f.label)} :</strong> ${esc(data[f.key]).replace(/\n/g, '<br>')}</p>`);
  return rows.join('\n');
}

// paragraphes HTML sûrs à partir d'un texte multi-lignes
const paras = (txt) => String(txt || '').split(/\n{2,}/)
  .map((p) => p.trim()).filter(Boolean)
  .map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('\n');

/** Miroir HTML d'un ÉLÉMENT — ce que la sheet CC ET la page du répertoire montrent. */
export function elemDescription(kind, data) {
  const d = data || {};
  if (kind === 'lecture') {
    return d.texte ? `<blockquote class="elem-lecture">\n${paras(d.texte)}\n</blockquote>` : '';
  }
  if (kind === 'ambiance') {
    const rows = [];
    if (d.playlist) rows.push(`<p><strong>🎵 Playlist :</strong> ${esc(d.playlist)}</p>`);
    if (d.weather) rows.push(`<p><strong>🌦️ Météo :</strong> ${esc(d.weather)}</p>`);
    return rows.join('\n');
  }
  if (kind === 'visuel') {
    if (!d.src) return d.legende ? `<p>${esc(d.legende)}</p>` : '';
    return `<figure><img src="${esc(d.src)}" alt="${esc(d.legende || '')}">`
      + (d.legende ? `<figcaption>${esc(d.legende)}</figcaption>` : '') + '</figure>';
  }
  if (kind === 'vision') {
    const head = d.pj ? `<p><strong>🔮 Vision — ${esc(d.pj)}</strong></p>\n` : '';
    return d.texte ? `${head}<blockquote class="elem-lecture">\n${paras(d.texte)}\n</blockquote>` : head.trim();
  }
  return '';
}

/** Champs assainis (bornés au gabarit), sans les clés inconnues. */
export function mjFields(kind, data) {
  const tpl = tplOf(kind);
  if (!tpl) return {};
  const out = {};
  for (const f of tpl.fields) {
    const v = String(data?.[f.key] ?? '').replace(/\r\n?/g, '\n').trim().slice(0, f.max);
    if (v) out[f.key] = v;
  }
  return out;
}

// uuid de fiche liée (relations NATIVES CC) : « JournalEntry.<id16> » ou id nu
const uuidOf = (v, type = 'JournalEntry') => {
  const s = String(typeof v === 'string' ? v : (v?.uuid || v?.id || ''));
  const m = new RegExp(`${type}\\.([A-Za-z0-9]{16})`).exec(s);
  if (m) return `${type}.${m[1]}`;
  return /^[A-Za-z0-9]{16}$/.test(s) ? `${type}.${s}` : null;
};
const linkList = (v, type) => [...new Set((Array.isArray(v) ? v : (v ? [v] : []))
  .map((x) => uuidOf(x, type)).filter(Boolean))].slice(0, 30);

/**
 * Corps de création d'une fiche MJ — forme EXACTE d'une fiche CC `tag`.
 * @returns {{ name, ownership, flags }} à passer tel quel à `create_document`
 */
export function mjSheetDoc({ kind, title, data = {}, tags = [], state, links = {}, source = null }) {
  const tpl = tplOf(kind);
  if (!tpl) throw Object.assign(new Error(`gabarit inconnu : ${kind}`), { code: 400 });
  const fields = mjFields(kind, data);
  const st = state && tpl.states[state] ? state : tpl.defaultState;
  const allTags = mjTags(kind, st, tags);
  const isElem = Boolean(ELEM_TEMPLATES[kind]);
  const name = (String(title || '').trim() || `${tpl.icon} ${tpl.label} sans nom`).slice(0, 120);
  const description = mjDescription(kind, fields);
  return {
    name,
    ownership: { default: 0 }, // MJ ONLY — jamais visible d'un joueur
    flags: {
      core: { sheetClass: TAG_SHEET_CLASS },
      [CC]: {
        type: 'tag',
        data: {
          tagMode: true,
          sheetTypeLabelOverride: tpl.label,
          description,
          notes: '',
          tags: allTags,
          associates: linkList(links.associates),
          linkedLocations: linkList(links.linkedLocations),
          linkedStandardJournals: linkList(links.linkedStandardJournals),
          ...(uuidOf(links.linkedActor, 'Actor') ? { linkedActor: uuidOf(links.linkedActor, 'Actor') } : {}),
          ...fields,
        },
      },
      [AL]: { filterTag: allTags.join(', ') },
      // marqueur d'idempotence (pas un lien : les tags font foi) + provenance
      // d'une décomposition (chapitre + id de proposition, pour ne jamais
      // recréer deux fois le même élément).
      holocron: { [markerKeyOf(kind)]: kind, ...(source ? { elemSource: source } : {}) },
    },
    // Un ÉLÉMENT porte UNE page : son miroir lisible. Elle le rend lisible et
    // éditable comme un chapitre dans la sidebar bible (l'éditeur web recopie
    // la page dans data.description à chaque save — write.mjs), et lisible tel
    // quel dans Foundry hors sheet CC.
    ...(isElem ? { pages: [{ name, type: 'text', text: { content: description, format: 1 } }] } : {}),
  };
}

/**
 * Chemins de mise à jour d'une fiche existante — PATCH PARTIEL : seules les clés
 * fournies sont écrites, ce que le MJ a rempli dans Foundry n'est jamais effacé.
 * @returns {object} { '<chemin>': valeur } prêt pour `modify_document`
 */
export function mjSheetUpdates(doc, { kind, title, data, tags, state, links } = {}) {
  const k = kind || mjKindOf(doc) || elemKindOf(doc);
  const tpl = tplOf(k);
  if (!tpl) throw Object.assign(new Error(`gabarit inconnu : ${k}`), { code: 400 });
  const cur = doc?.flags?.[CC]?.data || {};
  const updates = {};
  if (title != null && String(title).trim()) updates.name = String(title).trim().slice(0, 120);

  // champs : on fusionne l'existant avec le patch, puis on regénère le miroir
  const merged = { ...mjFields(k, cur), ...(data ? mjFields(k, data) : {}) };
  if (data) {
    for (const f of tpl.fields) {
      if (!(f.key in data)) continue;
      const v = merged[f.key] || '';
      updates[`flags.${CC}.data.${f.key}`] = v;
    }
    updates[`flags.${CC}.data.description`] = mjDescription(k, merged);
  }

  // tags : état exclusif, tags manuels préservés, miroir des DEUX côtés
  if (tags != null || state != null) {
    const base = tags != null ? asList(tags) : docTags(doc);
    const st = state != null ? state : mjStateOf(doc, k);
    const all = mjTags(k, st, base);
    updates[`flags.${CC}.data.tags`] = all;
    updates[`flags.${AL}.filterTag`] = all.join(', ');
  }

  // relations NATIVES : remplacement de la liste fournie (l'UI envoie tout le champ)
  if (links && typeof links === 'object') {
    for (const field of ['associates', 'linkedLocations', 'linkedStandardJournals']) {
      if (field in links) updates[`flags.${CC}.data.${field}`] = linkList(links[field]);
    }
    if ('linkedActor' in links) {
      updates[`flags.${CC}.data.linkedActor`] = uuidOf(links.linkedActor, 'Actor') || '';
    }
  }
  // le gabarit se répare tout seul (fiche taguée à la main dans Foundry)
  if (String(doc?.flags?.[CC]?.type || '') !== 'tag') updates[`flags.${CC}.type`] = 'tag';
  if (!doc?.flags?.[CC]?.data?.tagMode) updates[`flags.${CC}.data.tagMode`] = true;
  if (!doc?.flags?.core?.sheetClass) updates['flags.core.sheetClass'] = TAG_SHEET_CLASS;
  if (!doc?.flags?.[CC]?.data?.sheetTypeLabelOverride) updates[`flags.${CC}.data.sheetTypeLabelOverride`] = tpl.label;
  const markerKey = markerKeyOf(k);
  if (doc?.flags?.holocron?.[markerKey] !== k) updates[`flags.holocron.${markerKey}`] = k;
  return updates;
}

/**
 * Vue d'une fiche MJ pour l'app (aucune écriture). null si le document n'en est
 * pas une.
 */
export function mjSheetView(doc) {
  return sheetViewIn(doc, mjKindOf(doc));
}

/** Vue d'un ÉLÉMENT pour l'app (même forme que mjSheetView, + `source`). */
export function elemSheetView(doc) {
  const v = sheetViewIn(doc, elemKindOf(doc));
  if (!v) return null;
  const src = doc.flags?.holocron?.elemSource;
  return src && typeof src === 'object' ? { ...v, source: src } : v;
}

function sheetViewIn(doc, kind) {
  if (!kind) return null;
  const tpl = tplOf(kind);
  const cur = doc.flags?.[CC]?.data || {};
  return {
    id: doc._id,
    kind,
    label: tpl.label,
    icon: tpl.icon,
    title: doc.name || '',
    state: mjStateOf(doc, kind),
    data: mjFields(kind, cur),
    tags: asList(cur.tags),
    links: {
      associates: linkList(cur.associates),
      linkedLocations: linkList(cur.linkedLocations),
      linkedStandardJournals: linkList(cur.linkedStandardJournals),
      ...(cur.linkedActor ? { linkedActor: String(cur.linkedActor) } : {}),
    },
  };
}

/* ------------------------------------------------------- migration fronts --
 * Les fronts vivaient dans `gm:cfg:fronts` — une liste PLATE [{label, statut,
 * note}] connue de la seule app web. Ils deviennent des fiches CC : organisables,
 * taggables et liables depuis Foundry, et nœuds de la carte de campagne.
 * NON DESTRUCTIF : la config n'est pas vidée (repli le temps de la transition),
 * et un front déjà migré n'est jamais recréé — le rapprochement se fait sur le
 * NOM normalisé, pas sur un id (le MJ peut avoir créé la fiche à la main). */

/** Statut du widget fronts (`ok|tendu|chaud`…) → état de fiche. */
const FRONT_STATE = { eteint: 'eteint', fini: 'eteint', clos: 'eteint', resolu: 'eteint' };

/**
 * Diff PUR de la migration : ce qu'il faut créer, et ce qui existe déjà.
 * @param {Array<{label, statut, note}>} cfgFronts contenu de `gm:cfg:fronts`
 * @param {Array} existing fiches MJ déjà présentes (mjSheetView)
 * @returns {{ create: Array, skip: Array }}
 */
export function frontsMigration(cfgFronts, existing = []) {
  const known = new Set((existing || [])
    .filter((s) => s?.kind === 'front')
    .map((s) => normName(s.title)));
  const create = [];
  const skip = [];
  const seen = new Set();
  for (const f of (Array.isArray(cfgFronts) ? cfgFronts : [])) {
    const title = String(f?.label || '').trim();
    if (!title) continue;
    const key = normName(title);
    if (seen.has(key)) continue;
    seen.add(key);
    if (known.has(key)) { skip.push({ title, reason: 'fiche déjà créée' }); continue; }
    create.push({
      kind: 'front',
      title,
      state: FRONT_STATE[normName(f?.statut)] || 'actif',
      data: { intention: String(f?.note || '').trim().slice(0, 500) },
      tags: [],
    });
  }
  return { create, skip };
}
