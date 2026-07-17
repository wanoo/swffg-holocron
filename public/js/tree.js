// tree.js — barre latérale en deux zones :
//  · haut (1/3)  : sélecteur de « parties » — les grandes sections de l'app ;
//  · bas  (2/3)  : chapitrage de la partie active (scroll indépendant).
// La sélection suit la route hash (deep-link compris) et survit aux re-montages.
import { Data } from './data.js';
import { statutPill } from './statut.js';
import { getGMKey } from './collab.js';

// Couleur par type de catégorie (pastilles + surlignage) — identique dans les
// 4 thèmes : la sidebar garde un fond sombre partout (tokens --sidebar-*).
const KIND_COLOR = {
  rules: '#57c7ff',
  story: '#d9b45b',
  pc: '#8ad17a',
  org: '#c99bff',
  notes: '#ff9e6b',
  timeline: '#e8c26a',
  misc: '#8b9bc0',
  players: '#d9b45b',
  bestiary: '#e5544b',
};

// Routes rattachées à la partie « Outils » (miroir de toolItems()).
const TOOL_ROUTES = new Set(['navicomputer', 'vaisseau', 'astronav', 'aidejeu', 'timeline', 'sabacc', 'ateliers', 'rencontres']);

let parts = [];           // parties construites au dernier montage
let currentPartId = null; // partie active — survit aux re-montages (session, MJ)

const isGM = () => Boolean(getGMKey() || Data.gm);

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function toolItems() {
  const tools = [
    { href: '#/navicomputer', label: '🖥️ Navi-Computer' },
    { href: '#/vaisseau', label: '🚀 Vaisseau' },
    { href: '#/astronav', label: '🪐 Astronav' },
    { href: '#/aidejeu', label: '🎲 Symboles & dépenses' },
    { href: '#/timeline', label: '📅 Chronologie' },
    { href: '#/sabacc', label: '🎴 Sabacc' },
    { href: '#/ateliers', label: '⚒️ Ateliers' },
  ];
  if (isGM()) tools.push({ href: '#/rencontres', label: '⚔️ Rencontres (MJ)' });
  return tools;
}

// Construit la liste des parties : Tableau de bord, une partie par catégorie
// non vide (ordre des kinds — aucun id de campagne en dur), PJ, MJ, Outils.
function buildParts() {
  const list = [];
  list.push({
    id: 'home', label: 'Tableau de bord', kind: 'misc', route: '#/', chapters: [],
    empty: 'Le tableau de bord s’affiche dans la page principale.',
  });

  const KIND_ORDER = ['rules', 'notes', 'story', 'timeline', 'pc', 'org', 'misc'];
  const cats = [...Data.categories].sort((a, b) => {
    const ka = KIND_ORDER.indexOf(a.kind), kb = KIND_ORDER.indexOf(b.kind);
    return (ka < 0 ? 99 : ka) - (kb < 0 ? 99 : kb);
  });
  for (const cat of cats) {
    const journals = Data.journals.filter((j) => j.categoryId === cat.id);
    const isTimeline = cat.kind === 'timeline';
    if (!journals.length && !isTimeline) continue; // catégorie vide : pas de partie
    const chapters = journals.map((j) => ({ href: `#/journal/${j.id}`, label: j.name, statut: j.statut, mort: j.mort }));
    // Événements : la donnée vit dans la frise → renvoi épinglé en tête
    // (non compté comme chapitre).
    const count = journals.length;
    if (isTimeline) chapters.unshift({ href: '#/timeline', label: '📅 Ouvrir la chronologie' });
    list.push({ id: 'cat:' + cat.id, catId: cat.id, label: cat.label, kind: cat.kind, chapters, count });
  }

  if (Data.pcs.length) {
    list.push({
      id: 'pj', label: 'Personnages joueurs', kind: 'players',
      chapters: Data.pcs.map((p) => ({ href: `#/pc/${p.id}`, label: p.name })),
    });
  }

  // PNJ du monde + Adversaires — RÉSERVÉ AU MJ (stats = spoilers ; la sidebar
  // est re-montée au déverrouillage). Comptes du manifest tant que le lazy-load
  // n'a pas eu lieu — évite l'affichage « (0) ».
  if (isGM()) {
    const cnt = Data.meta?.counts || {};
    const nNpc = Data.worldNpcs.length || cnt.npcs || 0;
    const nAdv = Data.adversaries.length || cnt.adversaries || 0;
    list.push({
      id: 'mj', label: 'PNJ & Bestiaire (MJ)', kind: 'bestiary', count: nNpc + nAdv,
      chapters: [
        { href: '#/npc', label: `PNJ du monde (${nNpc})` },
        { href: '#/bestiaire', label: `Adversaires (${nAdv})` },
      ],
    });
  }

  list.push({ id: 'tools', label: 'Outils', kind: 'misc', chapters: toolItems() });
  return list;
}

// Route hash → id de partie. null = route non rattachée (on garde la sélection).
function partForHash(hash) {
  const seg = String(hash || '').replace(/^#\/?/, '').split('/').filter(Boolean);
  const [a, b] = seg;
  if (!a) return 'home';
  if (a === 'journal' && b) {
    const j = Data.journalById.get(b);
    return j ? 'cat:' + j.categoryId : null;
  }
  if (a === 'pc') return 'pj';
  if (a === 'npc' || a === 'adv' || a === 'bestiaire') return 'mj';
  if (a === 'timeline') {
    // La frise appartient à la partie « Événements » si elle existe, sinon Outils.
    const t = parts.find((p) => p.kind === 'timeline');
    if (t) return t.id;
  }
  if (TOOL_ROUTES.has(a)) return 'tools';
  return null;
}

// --- Rendu -----------------------------------------------------------------

function renderChapters(part) {
  const zone = document.getElementById('chapters');
  zone.innerHTML = '';
  zone.setAttribute('aria-label', `Chapitres — ${part.label}`);

  const head = el('div', 'chapters-head');
  const dot = el('span', 'g-dot');
  dot.style.setProperty('--k', KIND_COLOR[part.kind] || '#888');
  dot.setAttribute('aria-hidden', 'true');
  head.append(dot, el('span', 'chapters-title', part.label));
  const n = part.count ?? part.chapters.length;
  if (n) head.appendChild(el('span', 'g-count', String(n)));
  zone.appendChild(head);

  if (!part.chapters.length) {
    zone.appendChild(el('p', 'chapters-empty', part.empty || 'Rien à parcourir dans cette section pour l’instant.'));
    return;
  }
  const ul = el('ul', 'tree-items');
  for (const it of part.chapters) {
    const li = el('li', 'tree-item');
    const a = el('a', null, it.label);
    a.href = it.href;
    a.dataset.route = it.href;
    const pill = statutPill(it, { compact: true });
    if (pill) a.appendChild(pill);
    li.appendChild(a);
    ul.appendChild(li);
  }
  zone.appendChild(ul);
  highlightChapter(location.hash || '#/');
}

// Sélectionne une partie : état + aria + chapitrage.
function selectPart(id) {
  const part = parts.find((p) => p.id === id);
  if (!part) return;
  currentPartId = id;
  for (const btn of document.querySelectorAll('.part-btn')) {
    const on = btn.dataset.part === id;
    if (on) btn.setAttribute('aria-current', 'true');
    else btn.removeAttribute('aria-current');
  }
  renderChapters(part);
}

// Surligne le chapitre correspondant à la route active (aria-current="page").
function highlightChapter(hash) {
  const base = '#/journal/' + (hash.split('/')[2] || '');
  for (const a of document.querySelectorAll('.sidebar-chapters a[data-route]')) {
    const r = a.dataset.route;
    const on = r === hash || (hash.startsWith('#/journal/') && r === base);
    a.classList.toggle('active', on);
    if (on) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
}

export function mountSidebar() {
  parts = buildParts();
  const nav = document.getElementById('parts');
  nav.innerHTML = '';
  const ul = el('ul', 'parts-list');
  for (const part of parts) {
    const li = el('li');
    const btn = el('button', 'part-btn');
    btn.type = 'button';
    btn.dataset.part = part.id;
    btn.style.setProperty('--k', KIND_COLOR[part.kind] || '#888');
    const dot = el('span', 'g-dot');
    dot.setAttribute('aria-hidden', 'true');
    btn.append(dot, el('span', 'part-label', part.label));
    const n = part.count ?? part.chapters.length;
    if (n) btn.appendChild(el('span', 'g-count', String(n)));
    btn.addEventListener('click', () => {
      selectPart(part.id);
      if (part.route) location.hash = part.route; // parties-vues (Tableau de bord)
    });
    li.appendChild(btn);
    ul.appendChild(li);
  }
  // Navigation clavier ↑/↓ entre les parties (le focus suit).
  ul.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const btns = [...ul.querySelectorAll('.part-btn')];
    const i = btns.indexOf(document.activeElement);
    if (i < 0) return;
    e.preventDefault();
    btns[(i + (e.key === 'ArrowDown' ? 1 : -1) + btns.length) % btns.length].focus();
  });
  nav.appendChild(ul);

  // Sélection initiale : la route courante prime, sinon la sélection précédente.
  if (!parts.some((p) => p.id === currentPartId)) currentPartId = null;
  selectPart(partForHash(location.hash || '#/') || currentPartId || 'home');
}

// Synchronise la sidebar sur la route active : partie + chapitre surligné.
// Route non rattachée (ex. #/mj) : on ne touche pas à la sélection.
export function setActiveTreeLink(hash) {
  const pid = partForHash(hash);
  if (pid && pid !== currentPartId) selectPart(pid);
  highlightChapter(hash);
}
