// bestiary.js — navigateurs de listes : Adversaires (module) et PNJ du monde.
import { Data } from './data.js';

const TYPE_FR = { minion: 'Sbire', rival: 'Comparse', nemesis: 'Nemesis' };
const BATCH = 60;

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}
function escape(s = '') {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function norm(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

// Ligne récapitulative d'une fiche.
function statLine(e) {
  const c = e.characteristics || {};
  return `V${c.Brawn ?? 0} A${c.Agility ?? 0} In${c.Intellect ?? 0} R${c.Cunning ?? 0} Vo${c.Willpower ?? 0} P${c.Presence ?? 0}`;
}

function card(entity, routePrefix, showType) {
  const a = el('a', 'bestiary-card');
  a.href = `#/${routePrefix}/${entity.id}`;
  const type = showType ? `<span class="bc-type t-${entity.type}">${TYPE_FR[entity.type] || entity.type}</span>` : '';
  const sub = entity.source || entity.career || entity.species || '';
  a.innerHTML =
    `<div class="bc-top"><span class="bc-name">${escape(entity.name)}</span>${type}</div>` +
    (sub ? `<div class="bc-sub">${escape(sub)}</div>` : '') +
    `<div class="bc-stats">${statLine(entity)}</div>`;
  return a;
}

function buildBrowser(container, opts) {
  const { title, eyebrow, items, routePrefix, showType, sources } = opts;
  container.innerHTML = '';

  const head = el('div', 'view-head');
  head.innerHTML = `<p class="eyebrow">${escape(eyebrow)}</p><h1>${escape(title)}</h1>`;
  container.appendChild(head);

  // Barre de filtres.
  const bar = el('div', 'browser-bar');
  const searchWrap = el('div', 'browser-search');
  const search = el('input');
  search.type = 'search';
  search.placeholder = 'Filtrer par nom…';
  search.setAttribute('aria-label', 'Filtrer par nom');
  searchWrap.appendChild(search);
  bar.appendChild(searchWrap);

  const state = { q: '', type: 'all', source: 'all' };

  if (showType) {
    const chips = el('div', 'type-chips');
    for (const [val, label] of [['all', 'Tous'], ['minion', 'Sbires'], ['rival', 'Comparses'], ['nemesis', 'Nemesis']]) {
      const chip = el('button', 'type-chip' + (val === 'all' ? ' on' : ''));
      chip.type = 'button';
      chip.textContent = label;
      chip.dataset.val = val;
      chip.addEventListener('click', () => {
        state.type = val;
        chips.querySelectorAll('.type-chip').forEach((c) => c.classList.toggle('on', c === chip));
        refresh();
      });
      chips.appendChild(chip);
    }
    bar.appendChild(chips);
  }

  if (sources && sources.length) {
    const sel = el('select', 'source-select');
    sel.setAttribute('aria-label', 'Filtrer par ouvrage');
    sel.appendChild(new Option('Tous les ouvrages', 'all'));
    for (const s of sources) sel.appendChild(new Option(s, s));
    sel.addEventListener('change', () => {
      state.source = sel.value;
      refresh();
    });
    bar.appendChild(sel);
  }

  const countEl = el('span', 'browser-count');
  bar.appendChild(countEl);
  container.appendChild(bar);

  const grid = el('div', 'bestiary-grid');
  container.appendChild(grid);
  const sentinel = el('div', 'bestiary-sentinel');
  container.appendChild(sentinel);

  let filtered = items;
  let shown = 0;

  function computeFilter() {
    const q = norm(state.q);
    filtered = items.filter((e) => {
      if (state.type !== 'all' && e.type !== state.type) return false;
      if (state.source !== 'all' && e.source !== state.source) return false;
      if (q && !norm(e.name).includes(q)) return false;
      return true;
    });
  }
  function renderMore() {
    const next = filtered.slice(shown, shown + BATCH);
    for (const e of next) grid.appendChild(card(e, routePrefix, showType));
    shown += next.length;
    sentinel.style.display = shown < filtered.length ? '' : 'none';
  }
  function refresh() {
    computeFilter();
    grid.innerHTML = '';
    shown = 0;
    countEl.textContent = `${filtered.length} résultat${filtered.length > 1 ? 's' : ''}`;
    renderMore();
  }

  let t;
  search.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(() => {
      state.q = search.value;
      refresh();
    }, 120);
  });

  const io = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) renderMore();
    },
    { rootMargin: '400px' }
  );
  io.observe(sentinel);

  refresh();
}

export function renderBestiary(container) {
  const sources = [...new Set(Data.adversaries.map((a) => a.source).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'));
  buildBrowser(container, {
    title: 'Adversaires',
    eyebrow: `Bestiaire · ${Data.adversaries.length} fiches`,
    items: Data.adversaries,
    routePrefix: 'adv',
    showType: true,
    sources,
  });
}

export function renderNpcList(container) {
  buildBrowser(container, {
    title: 'PNJ du monde',
    eyebrow: `${Data.worldNpcs.length} personnages`,
    items: Data.worldNpcs,
    routePrefix: 'npc',
    showType: false,
    sources: null,
  });
}
