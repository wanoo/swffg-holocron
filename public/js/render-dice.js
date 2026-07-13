// render-dice.js — cœur de fidélité : rend les tokens de dés/symboles FFG
// avec la vraie police du système (EotESymbol) et les couleurs Foundry.
//
// Deux syntaxes coexistent dans les données :
//   - journaux / fiches PJ : forme crochet   [bo] [su] ...
//   - bestiaire (module)   : forme deux-points :boost: :success: :forcepip: ...
//
// Piège regex confirmé : on utilise un GROUPE DE CAPTURE strict, sinon
// l'alternance matcherait des sous-chaînes libres ("ab" dans "table").

// type -> { glyph (caractère EotESymbol), color (couleur Foundry), fr (nom FR) }
export const DICE = {
  boost: { glyph: 'b', color: 'lightskyblue', fr: 'dé de Fortune', kind: 'die' },
  ability: { glyph: 'd', color: 'green', fr: "dé d'Aptitude", kind: 'die' },
  proficiency: { glyph: 'c', color: '#f2c811', fr: 'dé de Maîtrise', kind: 'die' },
  setback: { glyph: 'b', color: '#111', fr: "dé d'Infortune", kind: 'die' },
  difficulty: { glyph: 'd', color: 'purple', fr: 'dé de Difficulté', kind: 'die' },
  challenge: { glyph: 'c', color: 'red', fr: 'dé de Défi', kind: 'die' },
  // Force = d12 (même silhouette que Maîtrise/Défi) : glyphe PLEIN 'c' coloré blanc.
  // ('C' est le contour creux → coloré blanc il donne un « hexagone noir bords blanc ».)
  force: { glyph: 'c', color: '#fff', fr: 'dé de Force', kind: 'die' },
  forcepoint: { glyph: 'Y', color: '#111', fr: 'Point de Force', kind: 'symbol' },
  success: { glyph: 's', color: '#111', fr: 'Succès', kind: 'symbol' },
  advantage: { glyph: 'a', color: '#111', fr: 'Avantage', kind: 'symbol' },
  triumph: { glyph: 'x', color: '#111', fr: 'Triomphe', kind: 'symbol' },
  failure: { glyph: 'f', color: '#111', fr: 'Échec', kind: 'symbol' },
  threat: { glyph: 't', color: '#111', fr: 'Menace', kind: 'symbol' },
  despair: { glyph: 'y', color: '#111', fr: 'Désespoir', kind: 'symbol' },
  // glyphes échangés : 'z' = pip PLEIN (Côté Lumineux, blanc), 'Z' = pip CREUX
  // (Côté Obscur, cercle à bord blanc + intérieur sombre) — cf. dice.css.
  light: { glyph: 'z', color: '#111', fr: 'Côté Lumineux', kind: 'symbol' },
  dark: { glyph: 'Z', color: '#111', fr: 'Côté Obscur', kind: 'symbol' },
};

// code crochet -> type
const BRACKET = {
  bo: 'boost', ab: 'ability', pr: 'proficiency', se: 'setback',
  di: 'difficulty', ch: 'challenge', fo: 'force', fp: 'forcepoint',
  su: 'success', ad: 'advantage', tr: 'triumph', fa: 'failure',
  th: 'threat', de: 'despair', li: 'light', da: 'dark',
};

// nom deux-points -> type (les plus longs d'abord dans la regex)
const COLON = {
  forcepoint: 'forcepoint', forcepip: 'forcepoint', force: 'force',
  boost: 'boost', ability: 'ability', proficiency: 'proficiency', setback: 'setback',
  difficulty: 'difficulty', challenge: 'challenge',
  success: 'success', advantage: 'advantage', triumph: 'triumph', failure: 'failure',
  threat: 'threat', despair: 'despair', lightside: 'light', darkside: 'dark',
};

const BRACKET_RE = /\[(bo|ab|pr|se|di|ch|fo|fp|su|ad|tr|fa|th|de|li|da)\]/gi;
const COLON_RE = /:(forcepoint|forcepip|force|boost|ability|proficiency|setback|difficulty|challenge|success|advantage|triumph|failure|threat|despair|lightside|darkside):/gi;
// Détection rapide (évite de traiter les nœuds sans token)
const HAS_TOKEN = /\[(?:bo|ab|pr|se|di|ch|fo|fp|su|ad|tr|fa|th|de|li|da)\]|:(?:forcepoint|forcepip|force|boost|ability|proficiency|setback|difficulty|challenge|success|advantage|triumph|failure|threat|despair|lightside|darkside):/i;

// Fabrique l'élément glyphe pour un type donné.
export function makeGlyph(type) {
  const d = DICE[type];
  const span = document.createElement('span');
  span.className = `ffg-die ffg-${d.kind} dt-${type}`;
  span.textContent = d.glyph;
  span.setAttribute('aria-label', d.fr);
  span.setAttribute('title', d.fr);
  span.setAttribute('role', 'img');
  return span;
}

// Remplace un texte contenant des tokens par une liste de nœuds (texte + glyphes).
function tokenizeText(text) {
  // On fusionne les deux regex en une seule passe, dans l'ordre d'apparition.
  const nodes = [];
  let last = 0;
  const combined = new RegExp(`${BRACKET_RE.source}|${COLON_RE.source}`, 'gi');
  let m;
  while ((m = combined.exec(text)) !== null) {
    if (m.index > last) nodes.push(document.createTextNode(text.slice(last, m.index)));
    const bracketCode = m[1]; // groupe de la partie crochet
    const colonName = m[2]; // groupe de la partie deux-points
    const type = bracketCode ? BRACKET[bracketCode.toLowerCase()] : COLON[colonName.toLowerCase()];
    nodes.push(type ? makeGlyph(type) : document.createTextNode(m[0]));
    last = combined.lastIndex;
  }
  if (last < text.length) nodes.push(document.createTextNode(text.slice(last)));
  return nodes;
}

// Parcourt les nœuds texte d'un élément et remplace les tokens par des glyphes.
// N'altère jamais les attributs ni les balises (sécurité contre les hrefs, etc.).
export function enrichDice(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      if (!n.nodeValue || !HAS_TOKEN.test(n.nodeValue)) return NodeFilter.FILTER_REJECT;
      // Ne pas toucher au contenu des balises de code brut.
      const p = n.parentNode?.nodeName;
      if (p === 'SCRIPT' || p === 'STYLE') return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const targets = [];
  let node;
  while ((node = walker.nextNode())) targets.push(node);
  for (const t of targets) {
    const frag = document.createDocumentFragment();
    for (const n of tokenizeText(t.nodeValue)) frag.appendChild(n);
    t.parentNode.replaceChild(frag, t);
  }
  return root;
}

// Version chaîne HTML d'un glyphe (pour l'inclure dans un innerHTML de nom/titre).
function glyphHTML(type) {
  const d = DICE[type];
  if (!d) return null;
  const fr = d.fr.replace(/"/g, '&quot;');
  return `<span class="ffg-die ffg-${d.kind} dt-${type}" role="img" aria-label="${fr}" title="${fr}">${d.glyph}</span>`;
}
const escHtml = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Enrichit une CHAÎNE (nom d'arme, titre, cellule) en HTML sûr : convertit les tokens
// de dés/symboles FFG en glyphes et retire le BBCode de mise en forme OggDude
// ([B]/[P]/[H3]/[BR]…) qui n'a pas de sens dans un intitulé. Renvoie du HTML échappé.
export function enrichDiceString(str) {
  if (str == null || str === '') return '';
  let s = escHtml(str);
  s = s.replace(/\[\/?(?:B|I|U|H[1-4]|P|BR|LI|UL|OL)\]/gi, (m) => (/\[(?:P|BR)\]/i.test(m) ? ' ' : ''));
  s = s.replace(new RegExp(BRACKET_RE.source, 'gi'), (m, code) => glyphHTML(BRACKET[String(code).toLowerCase()]) || m);
  s = s.replace(new RegExp(COLON_RE.source, 'gi'), (m, name) => glyphHTML(COLON[String(name).toLowerCase()]) || m);
  return s;
}

// Légende dés & symboles (panneau d'aide).
export function legendHTML() {
  const row = (type) => {
    const d = DICE[type];
    return `<li class="legend-item"><span class="ffg-die ffg-${d.kind} dt-${type}" aria-hidden="true">${d.glyph}</span><span class="legend-label">${d.fr}</span></li>`;
  };
  const dice = Object.keys(DICE).filter((t) => DICE[t].kind === 'die');
  const symbols = Object.keys(DICE).filter((t) => DICE[t].kind === 'symbol');
  return `
    <div class="legend-group">
      <h3>Dés</h3>
      <ul class="legend-list">${dice.map(row).join('')}</ul>
    </div>
    <div class="legend-group">
      <h3>Symboles</h3>
      <ul class="legend-list">${symbols.map(row).join('')}</ul>
    </div>`;
}
