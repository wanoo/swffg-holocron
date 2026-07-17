// tree.js — barre latérale en deux zones :
//  · haut (1/3)  : sélecteur de « parties » — les grandes sections de l'app ;
//  · bas  (2/3)  : chapitrage de la partie active (scroll indépendant).
// La sélection suit la route hash (deep-link compris) et survit aux re-montages.
// Iconographie façon mockups : icônes filaires dans un cadre losange teinté
// à l'accent du thème (SVG inline, aucune dépendance).
import { Data } from './data.js';
import { statutPill } from './statut.js';
import { getGMKey } from './collab.js';

// --- Icônes : pack SVG statique (public/img/icons, currentColor) -----------
// Servies en masque CSS (.ico + --ico) pour être teintées par le thème.
const packIcon = (name) => `/img/icons/${name}.svg`;
// Dé d6 (absent du pack) : même convention, en data-URI compact.
const DIE_ICON = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23000' stroke-width='1.7'%3E%3Crect x='4.5' y='4.5' width='15' height='15' rx='2.5'/%3E%3Ccircle cx='9' cy='9' r='1.1' fill='%23000' stroke='none'/%3E%3Ccircle cx='15' cy='9' r='1.1' fill='%23000' stroke='none'/%3E%3Ccircle cx='9' cy='15' r='1.1' fill='%23000' stroke='none'/%3E%3Ccircle cx='15' cy='15' r='1.1' fill='%23000' stroke='none'/%3E%3C/svg%3E";

// Icône de partie selon le type de catégorie.
const KIND_ICON = {
  rules: packIcon('rules'),
  story: packIcon('campaign'),
  notes: packIcon('journal'),
  timeline: packIcon('events'),
  pc: packIcon('npc'),
  org: packIcon('organizations'),
  players: packIcon('player-characters'),
  bestiary: packIcon('bestiary'),
  misc: packIcon('journal'),
};

// Icône d'un chapitre-outil selon sa route.
const ROUTE_ICON = {
  '#/navicomputer': packIcon('position'),
  '#/vaisseau': packIcon('ship'),
  '#/astronav': packIcon('astronav'),
  '#/aidejeu': DIE_ICON,
  '#/timeline': packIcon('chronology'),
  '#/sabacc': packIcon('sabacc'),
  '#/ateliers': packIcon('workshop'),
  '#/rencontres': packIcon('adversaries'),
  '#/npc': packIcon('npc'),
  '#/bestiaire': packIcon('bestiary'),
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

// Cadre losange + icône du pack (masque CSS teinté à l'accent du thème).
function diamondIcon(iconUrl) {
  const s = el('span', 'd-ico');
  s.setAttribute('aria-hidden', 'true');
  const i = el('i', 'ico');
  i.style.setProperty('--ico', `url('${iconUrl || packIcon('journal')}')`);
  s.appendChild(i);
  return s;
}

function toolItems() {
  const tools = [
    { href: '#/navicomputer', label: 'Navi-Computer' },
    { href: '#/vaisseau', label: 'Vaisseau' },
    { href: '#/astronav', label: 'Astronav' },
    { href: '#/aidejeu', label: 'Symboles & dépenses' },
    { href: '#/timeline', label: 'Chronologie' },
    { href: '#/sabacc', label: 'Sabacc' },
    { href: '#/ateliers', label: 'Ateliers' },
  ];
  if (isGM()) tools.push({ href: '#/rencontres', label: 'Rencontres (MJ)' });
  return tools;
}

// Construit la liste des parties : une par catégorie non vide (ordre des kinds
// — aucun id de campagne en dur), puis PJ, MJ, Outils. Le tableau de bord vit
// dans le bouton « Holocron central » en pied de sidebar, comme sur les mockups.
function buildParts() {
  const list = [];

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
    if (isTimeline) chapters.unshift({ href: '#/timeline', label: 'Ouvrir la chronologie', icon: packIcon('chronology') });
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
      id: 'mj', label: 'Bestiaire (MJ)', kind: 'bestiary', count: nNpc + nAdv,
      chapters: [
        { href: '#/npc', label: `PNJ du monde (${nNpc})`, icon: packIcon('npc') },
        { href: '#/bestiaire', label: `Adversaires (${nAdv})`, icon: packIcon('bestiary') },
      ],
    });
  }

  list.push({
    id: 'tools', label: 'Outils', kind: 'misc', icon: packIcon('tools'),
    chapters: toolItems().map((t) => ({ ...t, icon: ROUTE_ICON[t.href] })),
  });
  return list;
}

// Route hash → id de partie. null = route non rattachée (on garde la sélection).
function partForHash(hash) {
  const seg = String(hash || '').replace(/^#\/?/, '').split('/').filter(Boolean);
  const [a, b] = seg;
  if (!a) return null; // accueil : bouton « Holocron central », sélection conservée
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

// En-tête de section à filet latéral (« Navigation », nom de la partie…).
function secHead(label, count) {
  const head = el('div', 'side-sec-head');
  head.appendChild(el('span', null, label));
  if (count) head.appendChild(el('span', 'g-count', String(count)));
  return head;
}

function renderChapters(part) {
  const zone = document.getElementById('chapters');
  zone.innerHTML = '';
  zone.setAttribute('aria-label', `Chapitres — ${part.label}`);
  zone.appendChild(secHead(part.label, part.count ?? part.chapters.length));

  if (!part.chapters.length) {
    zone.appendChild(el('p', 'chapters-empty', part.empty || 'Rien à parcourir dans cette section pour l’instant.'));
    return;
  }
  const ul = el('ul', 'tree-items');
  for (const it of part.chapters) {
    const li = el('li', 'tree-item');
    const a = el('a');
    a.href = it.href;
    a.dataset.route = it.href;
    if (it.icon) a.appendChild(diamondIcon(it.icon));
    a.appendChild(el('span', 'tree-label', it.label));
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

// Bouton « Holocron central » (pied de sidebar) actif sur l'accueil.
function highlightHome(hash) {
  const hb = document.getElementById('holocron-home');
  if (!hb) return;
  if (!hash || hash === '#' || hash === '#/') hb.setAttribute('aria-current', 'page');
  else hb.removeAttribute('aria-current');
}

export function mountSidebar() {
  parts = buildParts();
  const nav = document.getElementById('parts');
  nav.innerHTML = '';
  nav.appendChild(secHead('Navigation'));
  const ul = el('ul', 'parts-list');
  for (const part of parts) {
    const li = el('li');
    const btn = el('button', 'part-btn');
    btn.type = 'button';
    btn.dataset.part = part.id;
    btn.appendChild(diamondIcon(part.icon || KIND_ICON[part.kind]));
    btn.appendChild(el('span', 'part-label', part.label));
    const n = part.count ?? part.chapters.length;
    if (n) btn.appendChild(el('span', 'g-count', String(n)));
    const chev = el('span', 'part-chev', '›');
    chev.setAttribute('aria-hidden', 'true');
    btn.appendChild(chev);
    btn.addEventListener('click', () => selectPart(part.id));
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
  selectPart(partForHash(location.hash || '#/') || currentPartId || parts[0]?.id);
  highlightHome(location.hash || '#/');
}

// Synchronise la sidebar sur la route active : partie + chapitre surligné.
// Route non rattachée (ex. #/mj, accueil) : on ne touche pas à la sélection.
export function setActiveTreeLink(hash) {
  const pid = partForHash(hash);
  if (pid && pid !== currentPartId) selectPart(pid);
  highlightChapter(hash);
  highlightHome(hash);
}
