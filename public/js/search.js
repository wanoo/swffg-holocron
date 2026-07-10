// search.js — palette de recherche (Ctrl/Cmd-K) sur journaux, pages et fiches.
import { Data } from './data.js';

let index = [];
let results = [];
let selected = 0;
let backdrop, input, list;

// Tokens de dés/symboles retirés des extraits de recherche (illisibles en texte).
const TOKEN_STRIP = /\[(?:bo|ab|pr|se|di|ch|fo|fp|su|ad|tr|fa|th|de|li|da)\]|:(?:forcepoint|forcepip|force|boost|ability|proficiency|setback|difficulty|challenge|success|advantage|triumph|failure|threat|despair|lightside|darkside):/gi;
// @UUID[...]{Libellé} -> on ne garde que le libellé dans le corpus de recherche.
const UUID_STRIP = /@UUID\[[^\]]+\](?:\{([^}]*)\})?/g;

function stripHTML(html) {
  const d = document.createElement('div');
  d.innerHTML = html || '';
  return (d.textContent || '')
    .replace(UUID_STRIP, '$1 ')
    .replace(TOKEN_STRIP, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildIndex() {
  index = [];
  for (const j of Data.journals) {
    for (const p of j.pages) {
      const text = stripHTML(p.html);
      index.push({
        kind: 'page',
        badge: 'Page',
        route: `#/journal/${j.id}/${p.id}`,
        title: p.name,
        context: j.name,
        text,
        hay: (p.name + ' ' + j.name + ' ' + text).toLowerCase(),
      });
    }
  }
  const addSheets = (arr, kind, badge, prefix) => {
    for (const s of arr) {
      index.push({
        kind,
        badge,
        route: `#/${prefix}/${s.id}`,
        title: s.name,
        context: [s.career, s.species, s.type, s.source].filter(Boolean).join(' · '),
        text: '',
        hay: (s.name + ' ' + (s.career || '') + ' ' + (s.source || '')).toLowerCase(),
      });
    }
  };
  addSheets(Data.pcs, 'pc', 'PJ', 'pc');
  addSheets(Data.worldNpcs, 'npc', 'PNJ', 'npc');
  addSheets(Data.adversaries, 'adv', 'Adversaire', 'adv');
}

// Ajoute (ou remplace) des entrées d'une source dynamique (ex. chapitres MJ),
// afin qu'elles apparaissent dans la palette Ctrl-K une fois déverrouillées.
export function addSearchDocs(kind, entries) {
  index = index.filter((e) => e.kind !== kind);
  for (const e of entries) {
    index.push({
      kind,
      badge: e.badge || 'MJ',
      route: e.route,
      title: e.title,
      context: e.context || '',
      text: e.text || '',
      hay: (e.title + ' ' + (e.context || '') + ' ' + (e.text || '')).toLowerCase(),
    });
  }
}

function tokens(q) {
  return q.toLowerCase().split(/\s+/).filter(Boolean);
}

function scoreEntry(entry, toks) {
  let score = 0;
  const title = entry.title.toLowerCase();
  for (const t of toks) {
    if (!entry.hay.includes(t)) return -1; // tous les mots doivent matcher
    if (title.includes(t)) score += 10;
    if (title.startsWith(t)) score += 8;
    score += 1;
  }
  // Bonus : les pages/titres courts pertinents remontent.
  if (entry.kind === 'page') score += 0.5;
  return score;
}

function snippet(entry, toks) {
  if (!entry.text) return '';
  const lower = entry.text.toLowerCase();
  let pos = -1;
  for (const t of toks) {
    const i = lower.indexOf(t);
    if (i >= 0 && (pos < 0 || i < pos)) pos = i;
  }
  if (pos < 0) return '';
  const start = Math.max(0, pos - 40);
  const raw = entry.text.slice(start, start + 160);
  return (start > 0 ? '…' : '') + highlight(raw, toks) + '…';
}

function escapeHTML(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function highlight(text, toks) {
  let out = escapeHTML(text);
  for (const t of toks) {
    if (!t) continue;
    const re = new RegExp('(' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
    out = out.replace(re, '<mark>$1</mark>');
  }
  return out;
}

function runSearch(q) {
  const toks = tokens(q);
  if (!toks.length) {
    // Suggestions par défaut : premiers journaux.
    results = index.filter((e) => e.kind === 'page').slice(0, 8);
  } else {
    results = index
      .map((e) => ({ e, s: scoreEntry(e, toks) }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 40)
      .map((x) => x.e);
  }
  selected = 0;
  render(toks);
}

function render(toks) {
  list.innerHTML = '';
  if (!results.length) {
    list.innerHTML = '<li class="palette-empty">Aucun résultat</li>';
    return;
  }
  results.forEach((e, i) => {
    const li = document.createElement('li');
    li.className = 'palette-item' + (i === selected ? ' sel' : '');
    li.setAttribute('role', 'option');
    li.dataset.route = e.route;
    const snip = snippet(e, toks);
    li.innerHTML =
      `<div class="pi-top"><span class="pi-badge">${e.badge}</span>` +
      `<span class="pi-title">${highlight(e.title, toks)}</span>` +
      (e.context ? ` <span class="muted">— ${escapeHTML(e.context)}</span>` : '') +
      `</div>` +
      (snip ? `<div class="pi-snippet">${snip}</div>` : '');
    li.addEventListener('click', () => choose(i));
    list.appendChild(li);
  });
}

function updateSel() {
  [...list.children].forEach((li, i) => li.classList.toggle('sel', i === selected));
  list.children[selected]?.scrollIntoView({ block: 'nearest' });
}

function choose(i) {
  const e = results[i];
  if (!e) return;
  closePalette();
  if (location.hash === e.route) window.dispatchEvent(new HashChangeEvent('hashchange'));
  else location.hash = e.route;
}

export function openPalette() {
  backdrop.hidden = false;
  input.value = '';
  runSearch('');
  input.focus();
}
export function closePalette() {
  backdrop.hidden = true;
}

export function initSearch() {
  backdrop = document.getElementById('palette');
  input = document.getElementById('palette-input');
  list = document.getElementById('palette-results');
  buildIndex();

  input.addEventListener('input', () => runSearch(input.value));
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      selected = Math.min(selected + 1, results.length - 1);
      updateSel();
    } else if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      selected = Math.max(selected - 1, 0);
      updateSel();
    } else if (ev.key === 'Enter') {
      ev.preventDefault();
      choose(selected);
    } else if (ev.key === 'Escape') {
      closePalette();
    }
  });
  backdrop.addEventListener('click', (ev) => {
    if (ev.target === backdrop) closePalette();
  });

  // Raccourci global Ctrl/Cmd-K.
  window.addEventListener('keydown', (ev) => {
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'k') {
      ev.preventDefault();
      backdrop.hidden ? openPalette() : closePalette();
    }
  });
}
