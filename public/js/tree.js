// tree.js — barre latérale : filtres par catégorie + arborescence des journaux
// et sections fiches / bestiaire.
import { Data } from './data.js';
import { statutPill } from './statut.js';
import { getGMKey } from './collab.js';

// Couleur par type de catégorie (pastilles + surlignage).
const KIND_COLOR = {
  rules: '#57c7ff',
  story: '#d9b45b',
  pc: '#8ad17a',
  org: '#c99bff',
  notes: '#ff9e6b',
  misc: '#8b9bc0',
  players: '#d9b45b',
  bestiary: '#e5544b',
};

const hidden = new Set(); // catégories désactivées par les filtres

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}

function journalsByCategory(catId) {
  return Data.journals.filter((j) => j.categoryId === catId);
}

function buildFilters(container) {
  container.innerHTML = '';
  for (const cat of Data.categories) {
    const count = journalsByCategory(cat.id).length;
    if (!count) continue;
    const chip = el('button', 'filter-chip');
    chip.type = 'button';
    chip.setAttribute('aria-pressed', 'true');
    chip.style.setProperty('--k', KIND_COLOR[cat.kind] || '#888');
    chip.innerHTML = `<span class="dot"></span>${cat.label}`;
    chip.addEventListener('click', () => {
      const on = chip.getAttribute('aria-pressed') === 'true';
      chip.setAttribute('aria-pressed', String(!on));
      if (on) hidden.add(cat.id);
      else hidden.delete(cat.id);
      applyFilters();
    });
    chip.dataset.cat = cat.id;
    container.appendChild(chip);
  }
}

function applyFilters() {
  for (const group of document.querySelectorAll('.tree-group[data-cat]')) {
    group.style.display = hidden.has(group.dataset.cat) ? 'none' : '';
  }
}

function makeGroup(title, kind, count, items, catId) {
  const group = el('div', 'tree-group');
  if (catId) group.dataset.cat = catId;
  const head = el('button', 'tree-group-head');
  head.type = 'button';
  head.innerHTML = `<span class="caret" aria-hidden="true">▾</span><span class="g-dot" style="--k:${KIND_COLOR[kind] || '#888'}"></span>${title}<span class="g-count">${count}</span>`;
  head.setAttribute('aria-expanded', 'true');
  head.addEventListener('click', () => {
    const collapsed = group.classList.toggle('collapsed');
    head.setAttribute('aria-expanded', String(!collapsed));
  });
  const ul = el('ul', 'tree-items');
  for (const it of items) {
    const li = el('li', 'tree-item');
    const a = el('a');
    a.href = it.href;
    a.dataset.route = it.href;
    a.textContent = it.label;
    const pill = statutPill(it, { compact: true });
    if (pill) a.appendChild(pill);
    li.appendChild(a);
    ul.appendChild(li);
  }
  group.append(head, ul);
  return group;
}

// Rend le groupe d'une catégorie de journaux (si non vide).
function appendCategory(tree, catId) {
  const cat = Data.categories.find((c) => c.id === catId);
  if (!cat) return;
  const journals = journalsByCategory(catId);
  if (!journals.length) return;
  const items = journals.map((j) => ({ href: `#/journal/${j.id}`, label: j.name, statut: j.statut, mort: j.mort }));
  tree.appendChild(makeGroup(cat.label, cat.kind, journals.length, items, catId));
}

export function mountSidebar() {
  const filters = document.getElementById('filters');
  const tree = document.getElementById('tree');
  buildFilters(filters);
  tree.innerHTML = '';

  // Ordre voulu : Règles → PJ → Notes des PJ → Campagne → Personnages (PNJ)
  // → Organisations → (en bas) PNJ du monde & Bestiaire.
  appendCategory(tree, 'feigrnbb7j7nXQI8'); // Règles du jeu

  const pcItems = Data.pcs.map((p) => ({ href: `#/pc/${p.id}`, label: p.name }));
  tree.appendChild(makeGroup('Personnages joueurs', 'players', Data.pcs.length, pcItems));

  appendCategory(tree, 'K0fMMrlfBNrybpGR'); // Notes des joueurs
  appendCategory(tree, 'HbsyBZVq49TXndf5'); // Campagne — Actes
  appendCategory(tree, 'OhCEe8KwUvDI0Z8b'); // Personnages (PNJ)
  appendCategory(tree, '42NyXzT4i0RSRqkp'); // Organisations
  appendCategory(tree, '__misc__'); // Divers (vide → ignoré)

  // En bas : PNJ du monde + Adversaires (vues listes) — RÉSERVÉ AU MJ.
  // Les stats d'adversaires/boss sont des spoilers : le groupe n'apparaît que
  // clé MJ présente (la sidebar est re-montée au déverrouillage).
  if (getGMKey() || Data.gm) {
    tree.appendChild(
      makeGroup('PNJ & Bestiaire (MJ)', 'bestiary', Data.worldNpcs.length + Data.adversaries.length, [
        { href: '#/npc', label: `PNJ du monde (${Data.worldNpcs.length})` },
        { href: '#/bestiaire', label: `Adversaires (${Data.adversaries.length})` },
      ])
    );
  }

  // Outils transverses (toujours visibles) — calculateur d'astrogation.
  tree.appendChild(makeGroup('Outils', 'misc', 2, [
    { href: '#/navicomputer', label: '🖥️ Navi-Computer' },
    { href: '#/astronav', label: '🪐 Astronav' },
  ]));

  applyFilters();
}

// Surligne l'entrée d'arbo correspondant à la route active.
export function setActiveTreeLink(hash) {
  const base = '#/journal/' + (hash.split('/')[2] || '');
  for (const a of document.querySelectorAll('.tree-item a')) {
    const r = a.dataset.route;
    a.classList.toggle('active', r === hash || (hash.startsWith('#/journal/') && r === base));
  }
}
