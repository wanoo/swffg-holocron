// app.js — bootstrap, routeur (hash), rendu des vues, modales, responsive.
import { loadData, Data, compendiumEntry, ensureNpcs, ensureAdversaries, ensureCompendium } from './data.js';
import { mountLoginButton } from './login.js';
import { mountSidebar, setActiveTreeLink } from './tree.js';
import { initSearch, openPalette } from './search.js';
import { buildTOC, setupScrollSpy } from './toc.js';
import { renderJournalHTML, renderRichHTML } from './render-journal.js';
import { renderSheet } from './sheet.js';
import { renderBestiary, renderNpcList } from './bestiary.js';
import { legendHTML } from './render-dice.js';
import { initGenerator, openGenerator } from './dice-roller.js';
import { mountAstronav } from './astronav.js';
import { mountNaviComputer } from './navicomputer.js';
import { openCard } from './modal.js';
import { mountEditablePage } from './editor.js';
import { mountGM } from './gm.js';
import { statutPill } from './statut.js';
import { getGMKey, gmGetDossiers } from './collab.js';

// Catégories dont les pages sont éditables/collaboratives.
// Catégories éditables : déclarées dans la config de campagne (⚙️ Holocron Config)
const editableCategoryIds = () => new Set(Data.categories.filter((c) => c.editable).map((c) => c.id));
let cleanupEditors = [];

const content = document.getElementById('content');
let cleanupSpy = () => {};

function esc(s = '') {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// --- Vues -----------------------------------------------------------------

function viewHome() {
  const m = Data.meta;
  const wrap = document.createElement('div');
  const hero = document.createElement('section');
  hero.className = 'home-hero holo-frame';
  hero.innerHTML = `
    <p class="eyebrow">${esc(m.system)}</p>
    <h1>${esc(m.title)} — Archive Holocron</h1>
    <div class="sep-aurebesh" aria-hidden="true"></div>
    <div class="crawl">${m.description || ''}</div>`;
  wrap.appendChild(hero);

  // Bannière de reprise : « où en est-on » (dernier acte joué) + accès direct aux fiches PJ.
  const recaps = Data.journals
    .filter((j) => /^recap-acte-\d+$/.test(j.id))
    .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
  const lastRecap = recaps[recaps.length - 1];
  if (lastRecap || Data.pcs.length) {
    const resume = document.createElement('section');
    resume.className = 'home-resume';
    let html = '';
    if (lastRecap) {
      html +=
        `<div class="hr-where"><p class="eyebrow">Où en est-on ?</p>` +
        `<h2>${esc(lastRecap.name)}</h2>` +
        `<a class="hr-cta" href="#/journal/${lastRecap.id}">Lire le dernier résumé →</a></div>`;
    }
    if (Data.pcs.length) {
      const links = Data.pcs
        .map((p) => `<a class="hr-pc" href="#/pc/${p.id}">${esc(p.name)}</a>`)
        .join('');
      html += `<div class="hr-mine"><p class="eyebrow">Ma fiche de personnage</p><div class="hr-pcs">${links}</div></div>`;
    }
    resume.innerHTML = html;
    wrap.appendChild(resume);
  }

  // Cartes catégories.
  wrap.insertAdjacentHTML('beforeend', '<h2 class="section-title">Journaux</h2>');
  const grid = document.createElement('div');
  grid.className = 'home-grid';
  for (const cat of Data.categories) {
    const n = Data.journals.filter((j) => j.categoryId === cat.id).length;
    if (!n) continue;
    const first = Data.journals.find((j) => j.categoryId === cat.id);
    const a = document.createElement('a');
    a.className = 'home-card';
    a.href = `#/journal/${first.id}`;
    a.innerHTML = `<div class="hc-count">${n}</div><div class="hc-title">${esc(cat.label)}</div>`;
    grid.appendChild(a);
  }
  wrap.appendChild(grid);

  // Personnages joueurs.
  if (Data.pcs.length) {
    wrap.insertAdjacentHTML('beforeend', '<h2 class="section-title">Personnages joueurs</h2>');
    const pg = document.createElement('div');
    pg.className = 'home-players';
    for (const p of Data.pcs) {
      const a = document.createElement('a');
      a.className = 'home-card';
      a.href = `#/pc/${p.id}`;
      a.innerHTML = `<div class="hc-title">${esc(p.name)}</div><div class="hc-sub">${esc([p.species, p.career].filter(Boolean).join(' · ') || 'Fiche')}</div>`;
      pg.appendChild(a);
    }
    wrap.appendChild(pg);
  }

  // Outils joueurs.
  wrap.insertAdjacentHTML('beforeend', '<h2 class="section-title">Outils</h2>');
  const tg = document.createElement('div');
  tg.className = 'home-grid';
  tg.innerHTML = `<a class="home-card" href="#/astronav"><div class="hc-count">🪐</div><div class="hc-title">Astronav</div><div class="hc-sub">Calculateur d'astrogation · 6 750 systèmes</div></a>`;
  wrap.appendChild(tg);

  // Bestiaire / PNJ — RÉSERVÉ AU MJ (stats/spoilers). Masqué côté joueur.
  if (getGMKey() || Data.gm) {
    wrap.insertAdjacentHTML('beforeend', '<h2 class="section-title">Bestiaire (MJ)</h2>');
    const bg = document.createElement('div');
    bg.className = 'home-grid';
    bg.innerHTML =
      `<a class="home-card" href="#/npc"><div class="hc-count">${Data.worldNpcs.length}</div><div class="hc-title">PNJ du monde</div></a>` +
      `<a class="home-card" href="#/bestiaire"><div class="hc-count">${Data.adversaries.length}</div><div class="hc-title">Adversaires</div></a>`;
    wrap.appendChild(bg);
  }

  mount(wrap);
  document.title = 'Archive Holocron — Star Wars FFG';
}

function pageHead(page, journalName) {
  const head = document.createElement('div');
  head.className = 'page-head';
  if (page.img) {
    const img = document.createElement('img');
    img.className = 'portrait';
    img.src = page.img;
    img.alt = page.name;
    img.loading = 'lazy';
    img.addEventListener('error', () => img.remove(), { once: true });
    head.appendChild(img);
  }
  const h = document.createElement('h2');
  h.className = 'page-title';
  h.textContent = page.name;
  head.appendChild(h);
  return head;
}

function viewJournal(jid, pid) {
  const journal = Data.journalById.get(jid);
  if (!journal) return viewNotFound('Journal introuvable');

  const view = document.createElement('div');
  view.className = 'journal-view';
  const main = document.createElement('div');
  main.className = 'journal-main';

  const header = document.createElement('div');
  header.className = 'view-head';
  const cat = Data.categories.find((c) => c.id === journal.categoryId);
  header.innerHTML = `<p class="eyebrow">${esc(cat ? cat.label : '')}</p><h1>${esc(journal.name)}</h1>`;
  const pill = statutPill(journal);
  if (pill) header.querySelector('h1').appendChild(pill);
  main.appendChild(header);

  const editable = editableCategoryIds().has(journal.categoryId);
  const pagesWrap = document.createElement('div');
  for (const p of journal.pages) {
    const sec = document.createElement('section');
    sec.className = 'chapter page-surface reader';
    sec.id = `chap-${p.id}`;
    sec.appendChild(pageHead(p, journal.name));
    const body = document.createElement('div');
    body.className = 'journal-content';
    if (editable) cleanupEditors.push(mountEditablePage(body, p));
    else renderJournalHTML(body, p.html);
    sec.appendChild(body);
    pagesWrap.appendChild(sec);
  }
  main.appendChild(pagesWrap);
  appendPnjGmVolet(main, journal); // 🔒 Volet MJ — gated, async ; jamais rendu sans clé

  const toc = buildTOC(journal.pages);
  view.append(main, toc);
  mount(view);

  cleanupSpy = setupScrollSpy(pagesWrap, [toc]);
  document.title = `${journal.name} — Archive Holocron`;

  // Défilement vers la page ciblée.
  if (pid) {
    const target = document.getElementById(`chap-${pid}`);
    if (target) target.scrollIntoView({ behavior: 'auto', block: 'start' });
  } else {
    window.scrollTo(0, 0);
  }
}

// Volet MJ d'une fiche PNJ (catégorie Personnages) : renvoie vers le dossier MJ
// complet porté par la fiche de stats. Étanchéité : ne s'affiche QUE si une clé MJ
// est présente ET les données proviennent de l'endpoint gated (jamais dans le bundle).
async function appendPnjGmVolet(container, journal) {
  if (!(getGMKey() || Data.gm) || !journal?.statut) return; // seulement fiches PNJ typées, MJ présent
  let dossiers = {};
  try { dossiers = await gmGetDossiers(); } catch { return; }
  const d = dossiers[journal.id];
  if (!d) return;
  const sec = document.createElement('section');
  sec.className = 'chapter page-surface gm-dossier pnj-gm-volet';
  sec.appendChild(Object.assign(document.createElement('h3'), { className: 'sheet-section-title', textContent: '🔒 Volet MJ' }));
  if (d.rappel) sec.appendChild(Object.assign(document.createElement('p'), { textContent: d.rappel }));
  const links = document.createElement('div');
  links.className = 'pnj-gm-links';
  const addLink = (href, label) => {
    const a = document.createElement('a');
    a.className = 'gm-dossier-stats';
    a.href = href;
    a.textContent = label;
    links.appendChild(a);
  };
  if (d.npcId) addLink(`#/npc/${d.npcId}`, '↗ Fiche & dossier MJ');
  if (d.advId) addLink(`#/adv/${d.advId}`, '↗ Fiche de combat');
  if (links.children.length) sec.appendChild(links);
  container.appendChild(sec);
}

function viewSheet(entity, kind) {
  if (!entity) return viewNotFound('Fiche introuvable');
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  wrap.appendChild(renderSheet(entity, kind));
  mount(wrap);
  window.scrollTo(0, 0);
  document.title = `${entity.name} — Archive Holocron`;
}

function viewBrowser(kind) {
  const wrap = document.createElement('div');
  if (kind === 'adv') renderBestiary(wrap);
  else renderNpcList(wrap);
  mount(wrap);
  window.scrollTo(0, 0);
  document.title = (kind === 'adv' ? 'Adversaires' : 'PNJ du monde') + ' — Archive Holocron';
}

function viewGmOnly() {
  const d = document.createElement('div');
  d.className = 'view-head';
  d.innerHTML =
    `<p class="eyebrow">Réservé au MJ</p>` +
    `<h1>🔒 Section MJ</h1>` +
    `<p class="muted">Le bestiaire et les fiches de PNJ du monde contiennent des informations de jeu ` +
    `réservées au maître du jeu. <a href="#/mj">Déverrouiller la partie MJ</a> ou ` +
    `<a href="#/">revenir à l'accueil</a>.</p>`;
  mount(d);
  document.title = 'Section MJ — Archive Holocron';
}

function viewNotFound(msg) {
  const d = document.createElement('div');
  d.className = 'view-head';
  d.innerHTML = `<h1>${esc(msg)}</h1><p class="muted"><a href="#/">Retour à l'accueil</a></p>`;
  mount(d);
}

function mount(node) {
  cleanupSpy();
  cleanupSpy = () => {};
  content.innerHTML = '';
  content.appendChild(node);
  content.focus({ preventScroll: true });
}

// Dispose les éditeurs de la vue précédente (appelé au début du routage,
// AVANT de construire la nouvelle vue — sinon on tuerait les éditeurs neufs).
function disposeEditors() {
  for (const fn of cleanupEditors) fn();
  cleanupEditors = [];
}

// --- Routeur --------------------------------------------------------------

function route() {
  disposeEditors(); // libère les éditeurs de la vue précédente
  const hash = location.hash || '#/';
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const [a, b, c] = parts;

  if (a === 'mj') {
    cleanupSpy();
    cleanupSpy = () => {};
    content.innerHTML = '';
    mountGM(content, b, cleanupEditors);
    content.focus({ preventScroll: true });
    setActiveTreeLink('#/mj');
    closeDrawer();
    return;
  }
  // Bestiaire & PNJ du monde = stats/spoilers → réservés au MJ (blocage doux).
  const gmOnly = a === 'npc' || a === 'adv' || a === 'bestiaire';
  const isGm = Data.gm || Boolean(getGMKey());
  if (!a) viewHome();
  else if (a === 'astronav') { cleanupSpy(); cleanupSpy = () => {}; mountAstronav(content); }
  else if (a === 'navicomputer') { cleanupSpy(); cleanupSpy = () => {}; mountNaviComputer(content); }
  else if (a === 'journal' && b) viewJournal(b, c);
  else if (a === 'pc' && b) viewSheet(Data.pcById.get(b), 'pc');
  else if (gmOnly && !isGm) viewGmOnly();
  else if (a === 'npc' && b) ensureNpcs().then(() => viewSheet(Data.npcById.get(b), 'npc'));
  else if (a === 'npc') ensureNpcs().then(() => viewBrowser('npc'));
  else if (a === 'adv' && b) ensureAdversaries().then(() => viewSheet(Data.advById.get(b), 'adversary'));
  else if (a === 'bestiaire') ensureAdversaries().then(() => viewBrowser('adv'));
  else viewHome();

  setActiveTreeLink(hash.startsWith('#/journal/') ? `#/journal/${parts[1]}` : hash);
  closeDrawer();
}

// --- Modales --------------------------------------------------------------

function openModal(id) {
  document.getElementById(id).hidden = false;
}
function closeModal(id) {
  document.getElementById(id).hidden = true;
}
function openCompendiumCard(ref) {
  const entry = compendiumEntry(ref);
  if (!entry) return;
  const bits = [];
  if (entry.type) bits.push(entry.type);
  if (entry.meta?.range) bits.push(`Jet ${entry.meta.range[0]}–${entry.meta.range[1]}`);
  if (entry.meta?.severity) bits.push(`Gravité ${entry.meta.severity}`);
  if (entry.meta?.damage != null) bits.push(`Dégâts ${entry.meta.damage}`);
  openCard(entry.name || 'Référence', renderRichHTML(entry.html || '<p class="muted">Aucune description.</p>'), bits.join(' · '));
}

// --- Responsive drawer ----------------------------------------------------

function openDrawer() {
  document.body.classList.add('drawer-open');
  document.getElementById('scrim').hidden = false;
  document.getElementById('btn-menu').setAttribute('aria-expanded', 'true');
}
function closeDrawer() {
  document.body.classList.remove('drawer-open');
  document.getElementById('scrim').hidden = true;
  document.getElementById('btn-menu').setAttribute('aria-expanded', 'false');
}

// --- Init -----------------------------------------------------------------

async function init() {
  try {
    await loadData();
  ensureCompendium();
  if (Data.authEnabled) mountLoginButton(document.querySelector('.topbar'));
  document.addEventListener('holocron:session', () => { mountSidebar(); });
  if (Data.meta?.title) {
    document.title = Data.meta.title + ' — Holocron';
    const bt = document.querySelector('.brand-text'); if (bt) bt.textContent = Data.meta.title;
  }
  } catch (err) {
    content.innerHTML = `<div class="view-head"><h1>Erreur de chargement</h1><p class="muted">${esc(err.message)}<br>Servez le site via <code>npx serve public</code> (le protocole file:// bloque le chargement des données).</p></div>`;
    return;
  }

  mountSidebar();
  initSearch();
  initGenerator();
  document.getElementById('legend-body').innerHTML = legendHTML();

  // Boutons.
  document.getElementById('btn-search').addEventListener('click', openPalette);
  document.getElementById('sidebar-search-box').addEventListener('focus', openPalette);
  document.getElementById('sidebar-search-box').addEventListener('click', openPalette);
  document.getElementById('btn-legend').addEventListener('click', () => openModal('legend'));
  document.getElementById('btn-generator').addEventListener('click', () => openGenerator());
  document.getElementById('btn-gm').addEventListener('click', () => { location.hash = '#/mj'; });
  document.getElementById('btn-menu').addEventListener('click', () =>
    document.body.classList.contains('drawer-open') ? closeDrawer() : openDrawer()
  );
  document.getElementById('scrim').addEventListener('click', closeDrawer);

  // Fermeture des modales.
  for (const el of document.querySelectorAll('[data-close]')) {
    el.addEventListener('click', () => (el.closest('.modal-backdrop').hidden = true));
  }
  for (const bd of document.querySelectorAll('.modal-backdrop')) {
    bd.addEventListener('click', (e) => {
      if (e.target === bd) bd.hidden = true;
    });
  }
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      for (const bd of document.querySelectorAll('.modal-backdrop')) bd.hidden = true;
      closeDrawer();
    }
  });

  // Délégation des clics dans le contenu (pastilles compendium + ancres chapitres).
  content.addEventListener('click', (e) => {
    const cite = e.target.closest('.citem.is-known');
    if (cite) {
      e.preventDefault();
      openCompendiumCard(cite.dataset.ref);
      return;
    }
    const chap = e.target.closest('[data-chap]');
    if (chap) {
      e.preventDefault();
      document.getElementById(`chap-${chap.dataset.chap}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    // Liens internes xref déjà gérés par leur href (#/journal/...).
  });
  // Fermer le tiroir quand on suit un lien de la barre latérale.
  document.getElementById('sidebar').addEventListener('click', (e) => {
    if (e.target.closest('a')) closeDrawer();
  });

  window.addEventListener('hashchange', route);
  route();
}

init();
