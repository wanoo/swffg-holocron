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

  // Ordre : Règles → PJ → puis les catégories de la config (notes, actes, PNJ,
  // orgs…) dans l'ordre des kinds — plus aucun id de campagne en dur.
  const KIND_ORDER = ['rules', 'notes', 'story', 'pc', 'org', 'misc'];
  const cats = [...Data.categories].sort((a, b) => {
    const ka = KIND_ORDER.indexOf(a.kind), kb = KIND_ORDER.indexOf(b.kind);
    return (ka < 0 ? 99 : ka) - (kb < 0 ? 99 : kb);
  });
  for (const cat of cats.filter((c) => c.kind === 'rules')) appendCategory(tree, cat.id);

  const pcItems = Data.pcs.map((p) => ({ href: `#/pc/${p.id}`, label: p.name }));
  tree.appendChild(makeGroup('Personnages joueurs', 'players', Data.pcs.length, pcItems));

  for (const cat of cats.filter((c) => c.kind !== 'rules')) appendCategory(tree, cat.id);

  // En bas : PNJ du monde + Adversaires (vues listes) — RÉSERVÉ AU MJ.
  // Les stats d'adversaires/boss sont des spoilers : le groupe n'apparaît que
  // clé MJ présente (la sidebar est re-montée au déverrouillage).
  if (getGMKey() || Data.gm) {
    // comptes depuis le manifest (connus au boot) ; les tableaux lazy priment une
    // fois chargés — évite l'affichage « (0) » avant le lazy-load.
    const cnt = Data.meta?.counts || {};
    const nNpc = Data.worldNpcs.length || cnt.npcs || 0;
    const nAdv = Data.adversaries.length || cnt.adversaries || 0;
    tree.appendChild(
      makeGroup('PNJ & Bestiaire (MJ)', 'bestiary', nNpc + nAdv, [
        { href: '#/npc', label: `PNJ du monde (${nNpc})` },
        { href: '#/bestiaire', label: `Adversaires (${nAdv})` },
      ])
    );
  }

  // Outils transverses (toujours visibles) — calculateur d'astrogation.
  const tools = [
    { href: '#/navicomputer', label: '🖥️ Navi-Computer' },
    { href: '#/astronav', label: '🪐 Astronav' },
  ];
  if (getGMKey() || Data.gm) tools.push({ href: '#/rencontres', label: '⚔️ Rencontres (MJ)' });
  tree.appendChild(makeGroup('Outils', 'misc', tools.length, tools));

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
