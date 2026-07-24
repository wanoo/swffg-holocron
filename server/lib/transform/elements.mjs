// transform/elements.mjs — MOULINETTE « la bible devient une collection d'éléments ».
//
// La bible MJ est un mur de chapitres ; la table a besoin d'ÉLÉMENTS réutilisables
// (lecture à voix haute, ambiance, visuel, vision par PJ) que le storyboard
// attache aux beats. Ce module DÉCOUPE un chapitre en sections h2/h3 et PROPOSE
// un élément typé par section — proposition seulement : l'écriture n'a lieu
// qu'après validation du MJ (bible-tools.mjs), et le chapitre d'origine n'est
// JAMAIS modifié.
//
// Même philosophie que combat-scan.mjs : PUR et sans I/O, ids STABLES dérivés du
// contenu (re-scanner deux fois propose deux fois le même id → l'import est
// idempotent, jamais de doublon).
//
// S'y ajoute le DÉDOUBLONNAGE PNJ (phase D) : les mêmes sections, rapprochées
// par NOM des fiches Campaign Codex `npc` (nameForms du registre), pour un
// report ADDITIF dans la fiche (description + dossier narratif).

import { ELEM_TEMPLATES } from './mj-sheets.mjs';
import { normName } from './tags.mjs';
import { nameForms } from './registry.mjs';
import { WEATHER_EFFECTS } from '../board.mjs';
import { DOSSIER_FIELDS } from '../write.mjs';

const MAX_SECTIONS = 300;

/* ------------------------------------------------------------------- HTML -- */
// Décodage d'entités (même table que combat-scan — &amp; en dernier).
const unescapeHtml = (s) => String(s)
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
  .replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&');

/** Texte BRUT d'un fragment HTML, paragraphes préservés (\n\n).
 * Les liens Foundry `@UUID[…]{Nom}` sont aplatis en « Nom » (lisible à voix haute). */
export function plainText(html) {
  return unescapeHtml(String(html || '')
    .replace(/@UUID\[[^\]]*\]\{([^}]*)\}/g, '$1')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|blockquote|h[1-6]|figcaption|tr)>/gi, '\n\n')
    .replace(/<[^>]+>/g, ''))
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const HEADING_RE = /<(h[23])(\s[^>]*)?>([\s\S]*?)<\/\1>/gi;

/**
 * Découpe un HTML de chapitre en SECTIONS h2/h3. Le contenu avant le premier
 * titre forme une section d'introduction (heading = '', level 0).
 * @returns {Array<{ level, heading, html }>}
 */
export function splitSections(html) {
  const src = String(html || '');
  const marks = [];
  HEADING_RE.lastIndex = 0;
  for (let m = HEADING_RE.exec(src); m; m = HEADING_RE.exec(src)) {
    marks.push({ start: m.index, end: m.index + m[0].length, level: m[1] === 'h3' ? 3 : 2, heading: plainText(m[3]) });
    if (marks.length >= MAX_SECTIONS) break;
  }
  const out = [];
  const intro = src.slice(0, marks.length ? marks[0].start : src.length);
  if (intro.trim()) out.push({ level: 0, heading: '', html: intro });
  marks.forEach((mk, i) => {
    const body = src.slice(mk.end, i + 1 < marks.length ? marks[i + 1].start : src.length);
    out.push({ level: mk.level, heading: mk.heading, html: body });
  });
  return out;
}

/* -------------------------------------------------------------- heuristiques -- */
/** Type d'élément suggéré par le NOM du chapitre ('' si aucun indice). */
export function chapterKindHint(name) {
  const n = String(name || '');
  if (/🔮|\bvisions?\b/iu.test(n)) return 'vision';
  if (/📣|lecture|dialogue/iu.test(n)) return 'lecture';
  if (/🔊|ambiance|sonore|playlist/iu.test(n)) return 'ambiance';
  if (/🖼|visuel|banque\s+visuelle|illustration/iu.test(n)) return 'visuel';
  return '';
}

// météo en français → table fermée du serveur (WEATHER_EFFECTS)
const WEATHER_FR = {
  pluie: 'rain', orage: 'rainStorm', tempete: 'rainStorm', neige: 'snow',
  blizzard: 'blizzard', brouillard: 'fog', brume: 'fog', feuilles: 'leaves',
  braises: 'embers', cendres: 'embers', oiseaux: 'birds', bulles: 'bubbles',
  etoiles: 'stars', nuages: 'clouds',
};
const WEATHER_OK = new Set(WEATHER_EFFECTS.map((w) => w.toLowerCase()));

/** Effets météo cités dans un texte (fr ou id technique), dédupliqués, ≤ 4. */
export function extractWeather(text) {
  const found = [];
  const push = (w) => { if (w && !found.includes(w)) found.push(w); };
  const flat = normName(text);
  for (const [fr, id] of Object.entries(WEATHER_FR)) {
    if (new RegExp(`\\b${fr}\\b`, 'u').test(flat)) push(id);
  }
  for (const m of String(text || '').matchAll(/\b([a-zA-Z]{3,12})\b/g)) {
    const w = m[1].toLowerCase();
    if (WEATHER_OK.has(w)) push(WEATHER_EFFECTS.find((x) => x.toLowerCase() === w));
  }
  return found.slice(0, 4);
}

/** Playlist citée (« Playlist : Tension », « playlist “Cantina” »…), '' sinon. */
export function extractPlaylist(text) {
  const m = /playlist\s*(?:foundry)?\s*[:=«"“]?\s*([^\n«»"”:;.]+)/iu.exec(String(text || ''));
  return m ? m[1].replace(/[»"”].*$/, '').trim().slice(0, 100) : '';
}

// Encadrés : ceux qui SE LISENT aux joueurs vs les notes MJ. Les callouts
// gm-callout-tip / warn / note / mj / ambiance (vus dans la bible réelle) sont
// des instructions de MJ — jamais une lecture.
const MJ_CALLOUT_RE = /\bgm-callout-(?:tip|warn|warning|note|mj|ambiance)\b/i;
const ALOUD_RE = /\b(?:[àa]\s+(?:lire\s+)?(?:[àa]\s+)?voix\s+haute|lis(?:ez)?\s+(?:ceci\s+)?aux?\s+joueurs?|read\s+aloud)\b/iu;
const VISION_HEAD_RE = /^\s*(?:🔮\s*)?visions?\b\s*(?:de|pour|d['’])?\s*[—:–-]?\s*(.*)$/iu;

/** Blockquotes « à lire » d'un HTML (les notes MJ en callout sont exclues). */
function readableQuotes(html) {
  const out = [];
  const re = /<blockquote([^>]*)>([\s\S]*?)<\/blockquote>/gi;
  for (let m = re.exec(String(html || '')); m; m = re.exec(String(html || ''))) {
    const cls = /class="([^"]*)"/i.exec(m[1] || '')?.[1] || '';
    if (MJ_CALLOUT_RE.test(cls)) continue;
    const t = plainText(m[2]);
    if (t) out.push(t);
  }
  return out;
}

// borne un texte au max du champ du gabarit
const fieldMax = (kind, key) => (ELEM_TEMPLATES[kind]?.fields.find((f) => f.key === key)?.max || 2000);
const cut = (s, n) => String(s || '').trim().slice(0, n);

/**
 * Élément proposé pour UNE section (heuristiques, hint de chapitre en repli).
 * @returns {{ kind, data } | null} null = section sans élément identifiable
 */
export function guessElement(section, hint = '') {
  const { heading = '', html = '' } = section || {};
  const text = plainText(html);
  if (!text && !/<img\b/i.test(html)) return null;

  // 🔮 vision — le titre l'annonce (« Vision — Kael ») ou le chapitre est « par PJ »
  const vh = VISION_HEAD_RE.exec(heading);
  if (vh || hint === 'vision') {
    const pj = cut(vh?.[1] || (hint === 'vision' ? heading : ''), fieldMax('vision', 'pj'));
    if (text) return { kind: 'vision', data: { ...(pj ? { pj } : {}), texte: cut(text, fieldMax('vision', 'texte')) } };
  }

  // 🖼️ visuel — la section porte une image
  const vis = imageProposal(html, heading);
  if (vis) return vis;

  // 🔊 ambiance — une playlist est citée (ou chapitre d'ambiances)
  const playlist = extractPlaylist(text);
  if (playlist || hint === 'ambiance') {
    const weather = extractWeather(text).join(', ');
    if (playlist || weather) {
      return { kind: 'ambiance', data: { ...(playlist ? { playlist } : {}), ...(weather ? { weather } : {}) } };
    }
  }

  // 📣 lecture — encadré à lire, formule « à voix haute », ou chapitre de lectures
  const quotes = readableQuotes(html);
  if (ALOUD_RE.test(text) || quotes.length || hint === 'lecture') {
    const texte = cut(quotes.length ? quotes.join('\n\n') : text, fieldMax('lecture', 'texte'));
    if (texte) return { kind: 'lecture', data: { texte } };
  }
  return null;
}

/** Proposition 🖼️ visuel si le HTML porte une image exploitable, sinon null. */
function imageProposal(html, heading = '') {
  const img = /<img\b[^>]*\bsrc="([^"]+)"[^>]*>/i.exec(html);
  if (!img) return null;
  const alt = /\balt="([^"]*)"/i.exec(img[0])?.[1] || '';
  const cap = /<figcaption[^>]*>([\s\S]*?)<\/figcaption>/i.exec(html)?.[1] || '';
  // les visuels MJ passent par data-gm-asset (src retiré au rendu) : on lit les deux
  const gmSrc = /\bdata-gm-asset="([^"]+)"/i.exec(html)?.[1] || '';
  const src = cut(unescapeHtml(gmSrc || img[1]), fieldMax('visuel', 'src'));
  if (!src || /^api\//.test(src)) return null;
  return { kind: 'visuel', data: { src, legende: cut(plainText(cap) || unescapeHtml(alt) || heading, fieldMax('visuel', 'legende')) } };
}

/** Une vision PAR PJ dans une liste « <li><strong>PJ</strong> — texte…</li> »
 * (la forme réelle du chapitre 🔮 de la bible : pas de titres, une liste). */
export function visionItems(html) {
  const out = [];
  for (const m of String(html || '').matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)) {
    const lead = /^\s*<strong[^>]*>([\s\S]*?)<\/strong>/i.exec(m[1]);
    if (!lead) continue;
    const pj = cut(plainText(lead[1]).replace(/\n[\s\S]*$/, ''), fieldMax('vision', 'pj'));
    const texte = cut(plainText(m[1].slice(lead[0].length)).replace(/^[\s—:–-]+/, ''), fieldMax('vision', 'texte'));
    if (pj && texte) out.push({ pj, texte });
  }
  return out;
}

/**
 * TOUTES les propositions d'une section (une section réelle peut en porter
 * plusieurs : l'illustration d'une vision + une vision par PJ, par exemple).
 * @returns {Array<{ kind, data, title? }>}
 */
export function sectionProposals(section, hint = '') {
  const { heading = '', html = '' } = section || {};
  const visionCtx = hint === 'vision' || VISION_HEAD_RE.test(heading);
  if (!visionCtx) {
    const g = guessElement(section, hint);
    return g ? [g] : [];
  }
  const out = [];
  // l'image d'illustration d'une vision est un 🖼️ visuel à part entière
  const vis = imageProposal(html, heading);
  if (vis) out.push({ ...vis, title: vis.data.legende || heading });
  const items = visionItems(html);
  for (const it of items) out.push({ kind: 'vision', data: it, title: `Vision — ${it.pj}` });
  if (!items.length) {
    const g = guessElement(section, hint);
    if (g && !(g.kind === 'visuel' && vis)) out.push(g);
  }
  return out;
}

/* ----------------------------------------------------------- id stable ------ */
const slug = (s) => normName(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
function djb2(s) {
  let h = 5381;
  for (let i = 0; i < String(s).length; i++) h = ((h << 5) + h + String(s).charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/**
 * PROPOSITIONS d'éléments tirées des chapitres. Aucune écriture : l'appelant
 * affiche l'aperçu, le MJ coche, puis seule la sélection est créée.
 *
 * @param {Array<{id, name, html}>} chapters chapitres de bible (writer.gmList/gmGet)
 * @param {Array<{kind, title, source?}>} existing éléments déjà créés (elemSheetView)
 * @returns {Array<{ chapterId, chapterName, index, id, kind, title, data, exists, reason? }>}
 */
export function scanChapterElements(chapters, existing = []) {
  const byProp = new Set((existing || []).map((e) => String(e?.source?.propId || '')).filter(Boolean));
  const byTitle = new Set((existing || []).map((e) => `${e.kind}:${normName(e.title)}`));
  const out = [];
  const seen = new Set();
  for (const chap of (chapters || [])) {
    const hint = chapterKindHint(chap?.name);
    splitSections(chap?.html).forEach((section, index) => {
      for (const found of sectionProposals(section, hint)) {
        const title = cut(found.title || section.heading
          || `${ELEM_TEMPLATES[found.kind].label} — ${chap.name || 'chapitre'}`, 120);
        // id STABLE dérivé du CONTENU proposé (une section peut porter plusieurs
        // éléments : l'id doit distinguer la vision de Kael du visuel qui l'illustre)
        const id = `elem-${found.kind}-${slug(title) || 'sans-titre'}-${djb2(`${found.kind}|${JSON.stringify(found.data)}`)}`;
        if (seen.has(id)) continue;
        seen.add(id);
        const exists = byProp.has(id) || byTitle.has(`${found.kind}:${normName(title)}`);
        out.push({
          chapterId: chap.id,
          chapterName: chap.name || '',
          index,
          id,
          kind: found.kind,
          title,
          data: found.data,
          exists,
          ...(exists ? { reason: byProp.has(id) ? 'déjà créé depuis cette section' : 'un élément du même nom existe' } : {}),
        });
      }
    });
  }
  return out;
}

/* ============================================================ PNJ (phase D) ==
 * Les 3 chapitres PNJ redondants (Casting / Holocron des PNJ / Fiches minute)
 * répètent ce que les fiches CC devraient porter. On rapproche chaque section
 * h2/h3 d'une fiche `npc` par NOM (nameForms — mêmes formes que le registre),
 * et on propose un report ADDITIF : le bloc va dans data.description (avec
 * marqueur d'idempotence) et les champs narratifs détectés complètent le
 * dossier MJ SANS écraser ce qui y est déjà. */

/** Un chapitre est-il un chapitre PNJ ? (ciblage par défaut du scan) */
export const isNpcChapter = (name) => /\bpnj\b|casting|fiches?\s+minute/iu.test(String(name || ''));

// « Veut : … » / « Levier : … » — lignes narratives réutilisées par le dossier MJ
const DOSSIER_LINES = {
  role: /^(?:r[ôo]le)\s*:\s*(.+)$/iu,
  statut: /^statut\s*:\s*(.+)$/iu,
  veut: /^(?:veut|objectif|motivation)\s*:\s*(.+)$/iu,
  levier: /^(?:levier|pression|faiblesse)\s*:\s*(.+)$/iu,
  attitude: /^(?:attitude|comportement)\s*:\s*(.+)$/iu,
  replique: /^(?:r[ée]plique|citation)\s*:\s*(.+)$/iu,
  indices: /^(?:indices?|secrets?)\s*:\s*(.+)$/iu,
};

/** Champs de dossier MJ détectés dans le texte d'une section ({} si aucun). */
export function dossierHints(text) {
  const out = {};
  for (const line of String(text || '').split('\n')) {
    const l = line.trim();
    for (const [key, re] of Object.entries(DOSSIER_LINES)) {
      if (out[key]) continue;
      const m = re.exec(l);
      if (m) out[key] = m[1].trim().slice(0, DOSSIER_FIELDS[key] || 300);
    }
  }
  return out;
}

/** Marqueur d'idempotence d'un report : présent = déjà fusionné. */
export const npcMarker = (propId) => `data-holocron-import="${propId}"`;

/** Bloc HTML ADDITIF ajouté à data.description (jamais un remplacement). */
export function npcMergeBlock({ id, heading, chapterName, html }) {
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  return `\n<hr ${npcMarker(id)}>\n<h3>${esc(heading || 'Extrait de la bible')}`
    + `${chapterName ? ` <small>(${esc(chapterName)})</small>` : ''}</h3>\n${String(html || '').trim()}`;
}

/**
 * PROPOSITIONS de dédoublonnage PNJ. Aucune écriture.
 * @param {Array<{id, name, html}>} chapters chapitres à parcourir (déjà filtrés PNJ)
 * @param {Array<{id, name, description?}>} npcs fiches CC npc (id Foundry, description actuelle)
 * @returns {Array<{ id, chapterId, chapterName, heading, npcId, npcName, html, dossier, exists }>}
 */
export function scanNpcSections(chapters, npcs = []) {
  // formes de nom → fiche (la plus LONGUE gagne : « Kael Ordo » avant « Kael »)
  const matchers = [];
  for (const n of (npcs || [])) {
    if (!n?.id || !n?.name) continue;
    for (const form of nameForms(n.name)) matchers.push({ form: normName(form), npc: n });
  }
  matchers.sort((a, b) => b.form.length - a.form.length);

  const out = [];
  const seen = new Set();
  for (const chap of (chapters || [])) {
    splitSections(chap?.html).forEach((section) => {
      if (!section.heading) return; // l'intro d'un chapitre n'est pas une fiche PNJ
      const head = normName(section.heading);
      const hit = matchers.find((m) => head === m.form || head.includes(m.form));
      if (!hit) return;
      const html = String(section.html || '').trim();
      if (!html) return;
      const id = `npc-${slug(section.heading)}-${djb2(html)}`;
      if (seen.has(id)) return;
      seen.add(id);
      out.push({
        id,
        chapterId: chap.id,
        chapterName: chap.name || '',
        heading: section.heading,
        npcId: hit.npc.id,
        npcName: hit.npc.name,
        html,
        dossier: dossierHints(plainText(html)),
        exists: String(hit.npc.description || '').includes(npcMarker(id)),
      });
    });
  }
  return out;
}
