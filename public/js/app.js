// app.js — bootstrap, routeur (hash), rendu des vues, modales, responsive.
import { loadData, Data, compendiumEntry, ensureNpcs, ensureAdversaries, ensureCompendium, foundryAsset } from './data.js';
import { mountLoginButton } from './login.js';
import { mountThemeSwitcher, applyWorldTheme } from './theme.js';
import { mountEmblemPicker, syncEmblem } from './emblem.js';
import { uiConfig, isGMActive, worldTitle } from './ui-config.js';
import { homeView, applyDashboardArt } from './home.js';
import { mountSidebar, setActiveTreeLink } from './tree.js';
import { initSearch, openPalette } from './search.js';
import { buildTOC, setupScrollSpy } from './toc.js';
import { renderJournalHTML, renderRichHTML } from './render-journal.js';
import { renderSheet, openImageFull } from './sheet.js';
import { renderBestiary, renderNpcList } from './bestiary.js';
import { initGenerator, openGenerator } from './dice-roller.js';
import { mountAstronav } from './astronav.js';
import { mountSpendHelp } from './spendhelp.js';
import { mountNaviComputer } from './navicomputer.js';
import { mountShipView } from './ship-view.js';
import { mountTimeline } from './timeline.js';
import { mountSabacc, mountAteliers } from './games.js';
import { mountEncounters } from './gm-encounters.js';
import { openCard } from './modal.js';
import { mountEditablePage } from './editor.js';
import { mountGM } from './gm.js';
import { statutPill } from './statut.js';
import { getGMKey, gmGetDossiers } from './collab.js';
import { actSummaryCard } from './act-summary.js';

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

// Accueil : tableau de bord en widgets (voir home.js).
function viewHome() {
  mount(homeView());
  document.title = worldTitle() + ' — Holocron';
}

// Applique la personnalisation de monde (config ui) : thème (défaut/verrou),
// titre affiché (sidebar + barre mobile) — rappelée quand le MJ enregistre.
function applyUiConfig() {
  applyWorldTheme(uiConfig(), isGMActive());
  syncEmblem();
  const t = worldTitle();
  const sw = document.querySelector('.sb-word'); if (sw) sw.textContent = t;
  const bt = document.querySelector('.brand-text'); if (bt) bt.textContent = t;
  applyDashboardArt();
}

function pageHead(page, journalName) {
  const head = document.createElement('div');
  head.className = 'page-head';
  if (page.img) {
    const img = document.createElement('img');
    img.className = 'portrait';
    const src = foundryAsset(page.img);
    img.src = src;
    img.alt = page.name;
    img.loading = 'lazy';
    img.title = 'Agrandir';
    img.addEventListener('error', () => img.remove(), { once: true });
    img.addEventListener('click', () => openImageFull(src, page.name));
    head.appendChild(img);
  }
  const h = document.createElement('h2');
  h.className = 'page-title';
  h.textContent = page.name;
  head.appendChild(h);
  return head;
}

// Carte d'identité Monk's Enhanced Journal : type de fiche, attributs,
// rattachement et relations (liens vers les journaux visibles).
const MEJ_TYPES = { person: '👤 Personnage', place: '🌍 Lieu', organization: '🏛️ Organisation', shop: '🏪 Boutique', quest: '🎯 Quête', poi: '📍 Point d\'intérêt', event: '📅 Événement', loot: '💰 Butin' };
const MEJ_ATTR_LABELS = { race: 'Espèce', gender: 'Genre', life: 'Vie', faction: 'Faction', age: 'Âge', size: 'Taille', government: 'Gouvernement', inhabitants: 'Habitants', districts: 'Districts', alignment: 'Alignement', ancestry: 'Origine', profession: 'Profession', voice: 'Voix', date: 'Date', datefin: 'Fin', position: 'Position', lieu: 'Lieu', tags: 'Tags', region: 'Région', secteur: 'Secteur', coord: 'Coordonnées' };
const MEJ_ROLE_FR = { enemy: 'Ennemi', ennemi: 'Ennemi', ally: 'Allié', allié: 'Allié', allie: 'Allié', ami: 'Ami', amie: 'Amie', neutral: 'Neutre', neutre: 'Neutre', mentor: 'Mentor', maitre: 'Maître', 'maître': 'Maître', contact: 'Contact', friend: 'Ami', rival: 'Rival' };
function mejCard(journal) {
  const m = journal.mej;
  if (!m || (!m.role && !m.location && !m.placetype && !m.attributes && !m.relationships)) return null;
  const box = document.createElement('section');
  box.className = 'mej-card page-surface';
  let html = '';
  if (MEJ_TYPES[m.type]) html += `<span class="mej-type">${MEJ_TYPES[m.type]}</span>`;
  const rows = [];
  // Rôle traduit ; masqué s'il ne fait que répéter la pastille de statut.
  if (m.role) {
    const roleFr = MEJ_ROLE_FR[String(m.role).toLowerCase()] || m.role;
    if (!journal.statut || roleFr.toLowerCase() !== journal.statut.toLowerCase()) rows.push(['Rôle', esc(roleFr)]);
  }
  if (m.location) rows.push(['Rattachement', esc(m.location)]);
  if (m.placetype) rows.push(['Type', esc(m.placetype)]);
  for (const [k, v] of Object.entries(m.attributes || {})) rows.push([MEJ_ATTR_LABELS[k] || k[0].toUpperCase() + k.slice(1), esc(v)]);
  if (rows.length) html += `<dl class="mej-attrs">${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>`;
  if (m.relationships?.length) {
    html += `<div class="mej-rels"><span class="mej-rels-label">Relations</span>${m.relationships.map((r) => {
      const label = `${esc(r.name)}${r.rel ? ` <small>· ${esc(r.rel)}</small>` : ''}${r.hidden ? ' 🔒' : ''}`;
      return r.id ? `<a href="#/journal/${esc(r.id)}" class="mej-rel">${label}</a>` : `<span class="mej-rel">${label}</span>`;
    }).join('')}</div>`;
  }
  box.innerHTML = html;
  return box;
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
  const mejBox = mejCard(journal);
  if (mejBox) main.appendChild(mejBox);
  // Sommaire d'acte (récap de début d'acte — visible joueurs, champs masqués
  // déjà retirés côté serveur ; le MJ voit tout avec badge 🔒).
  const actsBox = actSummaryCard(journal);
  if (actsBox) main.appendChild(actsBox);

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
  const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  const d = dossiers[journal.id]
    || Object.values(dossiers).find((x) => x?.name && norm(x.name) === norm(journal.name));
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
    setActiveTreeLink(hash); // partie « Espace MJ » + chapitre deep-linké
    closeDrawer();
    return;
  }
  // Bestiaire & PNJ du monde = stats/spoilers → réservés au MJ (blocage doux).
  const gmOnly = a === 'npc' || a === 'adv' || a === 'bestiaire';
  const isGm = Data.gm || Boolean(getGMKey());
  if (!a) viewHome();
  else if (a === 'astronav') { cleanupSpy(); cleanupSpy = () => {}; mountAstronav(content); }
  else if (a === 'aidejeu') { cleanupSpy(); cleanupSpy = () => {}; mountSpendHelp(content); }
  else if (a === 'navicomputer') { cleanupSpy(); cleanupSpy = () => {}; mountNaviComputer(content); }
  else if (a === 'vaisseau') { cleanupSpy(); cleanupSpy = () => {}; mountShipView(content, cleanupEditors); }
  else if (a === 'timeline') { cleanupSpy(); cleanupSpy = () => {}; mountTimeline(content); }
  else if (a === 'sabacc') { cleanupSpy(); cleanupSpy = () => {}; mountSabacc(content); }
  else if (a === 'ateliers') { cleanupSpy(); cleanupSpy = () => {}; mountAteliers(content); }
  // #/rencontres/<id> : deep-link vers une entrée de la bibliothèque (storyboard → « Ouvrir la rencontre »)
  else if (a === 'rencontres') { cleanupSpy(); cleanupSpy = () => {}; if (isGm) mountEncounters(content, b); else viewGmOnly(); }
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
  // Sélecteurs de thème et d'emblème : indépendants des données (restent
  // utilisables en cas d'erreur de chargement).
  mountThemeSwitcher(document.getElementById('btn-theme'));
  mountEmblemPicker(document.getElementById('btn-emblem'));
  try {
    await loadData();
  ensureCompendium();
  if (Data.authEnabled) mountLoginButton(document.getElementById('sidebar-actions'));
  document.addEventListener('holocron:session', () => { mountSidebar(); applyUiConfig(); });
  // Personnalisation de monde enregistrée par le MJ : sidebar (parties, titre),
  // thème, décor — resynchronisés à chaud.
  document.addEventListener('holocron:ui', () => { mountSidebar(); applyUiConfig(); });
  document.title = worldTitle() + ' — Holocron';
  applyUiConfig();
  } catch (err) {
    content.innerHTML = `<div class="view-head"><h1>Erreur de chargement</h1><p class="muted">${esc(err.message)}<br>Servez le site via <code>npx serve public</code> (le protocole file:// bloque le chargement des données).</p></div>`;
    return;
  }

  mountSidebar();
  initSearch();
  initGenerator();

  // Boutons (rangée d'actions de la sidebar).
  document.getElementById('sidebar-search-box').addEventListener('focus', openPalette);
  document.getElementById('sidebar-search-box').addEventListener('click', openPalette);
  document.getElementById('btn-dice').addEventListener('click', () => openGenerator());
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
