// home.js — tableau de bord d'accueil (#/) composé de widgets indépendants.
// Chaque section passe par une enveloppe commune (titre, état vide/chargement) ;
// l'utilisateur peut masquer/réordonner les widgets (persisté en localStorage).
// Reste à faire (cahier des charges) : grille multi-largeurs drag & drop,
// préférences par breakpoint, options fines par widget.
import { Data, foundryAsset } from './data.js';
import { getGMKey } from './collab.js';
import { fetchDash, planetInfo } from './navicomputer.js';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// Icône du pack (public/img/icons) en masque CSS, teintée par currentColor.
const ico = (name) => `<i class="ico" style="--ico:url('/img/icons/${name}.svg')" aria-hidden="true"></i>`;
const LAYOUT_KEY = 'holocron-home-layout';
const SHIP_DEFAULTS = { name: 'Vaisseau du groupe', vivres: 60, vivresMax: 60, fuel: 30, fuelMax: 30, usure: 0, hyper: 1, lastTo: '' };
const isGM = () => Boolean(getGMKey() || Data.gm);

// --- Fond & image d'en-tête configurables --------------------------------
// Lus depuis la config publique si les clés existent (config.dashboard.*).
// TODO Foundry : enregistrer dashboardBackground / dashboardHeaderImage via
// game.settings (module-foundry) + FilePicker, et les exposer dans publicConfig ;
// ici on ne fait que pousser les variables CSS (aucune URL en dur côté CSS).
export function applyDashboardArt() {
  const d = (Data.config && Data.config.dashboard) || {};
  const root = document.documentElement.style;
  if (d.background) {
    root.setProperty('--dashboard-background-image', `url("${foundryAsset(d.background)}")`);
    root.setProperty('--dashboard-overlay', 'color-mix(in srgb, var(--app-background) 62%, transparent)');
    // Le défaut du thème est procédural (multi-couches à tailles natives) :
    // une image fournie reprend le plein cadre classique.
    root.setProperty('--dashboard-background-size', 'cover');
    root.setProperty('--dashboard-background-position', 'center top');
    root.setProperty('--dashboard-background-repeat', 'no-repeat');
  }
  if (d.headerImage) {
    root.setProperty('--dashboard-header-image', `url("${foundryAsset(d.headerImage)}")`);
    root.setProperty('--hero-overlay-start', 'color-mix(in srgb, var(--surface-default) 88%, transparent)');
    root.setProperty('--hero-overlay-end', 'color-mix(in srgb, var(--surface-default) 30%, transparent)');
    // image de campagne : plein cadre (l'ornement de gamme par défaut, lui, est calé à droite)
    root.setProperty('--hero-image-size', 'cover');
    root.setProperty('--hero-image-position', 'center');
  }
}

// --- Registre des widgets --------------------------------------------------
// render(body) remplit l'enveloppe ; retourner false = état vide.
const WIDGETS = [
  { id: 'status', label: 'Synthèse de campagne', render: renderStatus },
  { id: 'resume', label: 'Reprise de partie', render: renderResume },
  { id: 'journals', label: 'Journaux', render: renderJournals },
  { id: 'pcs', label: 'Personnages joueurs', render: renderPcs },
  { id: 'tools', label: 'Outils', render: renderTools },
  { id: 'bestiary', label: 'Bestiaire (MJ)', gmOnly: true, render: renderBestiary },
];

function loadLayout() {
  let raw = null;
  try { raw = JSON.parse(localStorage.getItem(LAYOUT_KEY) || 'null'); } catch { /* stockage indisponible */ }
  const ids = WIDGETS.map((w) => w.id);
  const order = (raw?.order || []).filter((id) => ids.includes(id));
  for (const id of ids) if (!order.includes(id)) order.push(id);
  return { order, hidden: new Set((raw?.hidden || []).filter((id) => ids.includes(id))) };
}
function saveLayout(l) {
  try { localStorage.setItem(LAYOUT_KEY, JSON.stringify({ order: l.order, hidden: [...l.hidden] })); } catch { /* quota */ }
}

// --- Widgets ---------------------------------------------------------------

function meter(label, val, max, kind, iconName) {
  const pct = Math.max(0, Math.min(100, (val / (max || 1)) * 100));
  return `<div class="meter">
    <div class="meter-h"><span>${iconName ? ico(iconName) + ' ' : ''}${label}</span><b>${val}${max === 100 && label.includes('Usure') ? ' %' : ` / ${max}`}</b></div>
    <div class="meter-track" role="img" aria-label="${esc(label)} : ${val} sur ${max}"><div class="meter-fill ${kind}" style="width:${pct}%"></div></div>
  </div>`;
}

// Synthèse : allégeance, position, ressources du vaisseau (flags.holocron.ship).
async function renderStatus(body) {
  body.innerHTML = '<p class="w-loading">Connexion au pont du vaisseau…</p>';
  const dash = await fetchDash();
  const ship = { ...SHIP_DEFAULTS, ...(dash.ship || {}) };
  const alleg = (dash.codex && dash.codex.allegiance) || localStorage.getItem('holocron-allegiance') || '';
  const pl = await planetInfo(ship.lastTo);
  const ratio = (v, m) => (m ? v / m : 0);
  const kindOf = (r) => (r <= 0.12 ? 'crit' : r <= 0.3 ? 'warn' : 'ok');
  const wearKind = ship.usure > 80 ? 'crit' : ship.usure > 50 ? 'warn' : 'ok';
  body.innerHTML = `
    <div class="stat-tiles">
      <div class="tile">
        <p class="tile-k">Allégeance</p>
        <div class="tile-alleg">
          <span class="tile-emblem" aria-hidden="true">${ico('allegiance')}</span>
          <b>${esc(alleg || 'Non définie')}</b>
        </div>
      </div>
      <div class="tile">
        <p class="tile-k">${ico('position')} Position actuelle</p>
        <b class="tile-v">${esc(ship.lastTo || 'Inconnue')}</b>
        <small class="tile-sub">${pl
          ? esc([pl.region, pl.sector].filter(Boolean).join(' · '))
          : 'Applique un voyage (Astronav) pour la définir'}</small>
        <a class="tile-link" href="#/navicomputer">Navi-Computer →</a>
      </div>
      <div class="tile tile-res">
        <p class="tile-k">Ressources — ${esc(ship.name)}</p>
        ${meter('Vivres', ship.vivres, ship.vivresMax, kindOf(ratio(ship.vivres, ship.vivresMax)), 'food')}
        ${meter('Carburant', ship.fuel, ship.fuelMax, kindOf(ratio(ship.fuel, ship.fuelMax)), 'fuel')}
        ${meter('Usure', ship.usure, 100, wearKind, 'wear')}
        <a class="tile-link" href="#/vaisseau">Fiche du vaisseau →</a>
      </div>
    </div>`;
}

// Bannière de reprise : dernier acte joué + accès direct aux fiches PJ.
function renderResume(body) {
  const recaps = Data.journals
    .filter((j) => /^recap-acte-\d+$/.test(j.id))
    .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
  const last = recaps[recaps.length - 1];
  if (!last && !Data.pcs.length) return false;
  let html = '<div class="resume-grid">';
  if (last) {
    html += `<div class="tile resume-where">
      <p class="tile-k">Où en est-on ?</p>
      <b class="tile-v">${esc(last.name)}</b>
      <a class="tile-link" href="#/journal/${last.id}">Lire le dernier résumé →</a>
    </div>`;
  }
  if (Data.pcs.length) {
    html += `<div class="tile">
      <p class="tile-k">Ma fiche de personnage</p>
      <div class="resume-pcs">${Data.pcs.map((p) => `<a class="resume-pc" href="#/pc/${p.id}">${esc(p.name)}</a>`).join('')}</div>
    </div>`;
  }
  body.innerHTML = html + '</div>';
}

// Cartes catégories de journaux (navigation rapide dans le contenu).
function renderJournals(body) {
  const cards = [];
  for (const cat of Data.categories) {
    const list = Data.journals.filter((j) => j.categoryId === cat.id);
    if (!list.length) continue;
    cards.push(`<a class="dash-card" href="#/journal/${list[0].id}">
      <span class="dc-count">${list.length}</span>
      <span class="dc-title">${esc(cat.label)}</span>
    </a>`);
  }
  if (!cards.length) return false;
  body.innerHTML = `<div class="dash-cards">${cards.join('')}</div>`;
}

// Personnages joueurs : portraits + espèce/carrière.
function renderPcs(body) {
  if (!Data.pcs.length) return false;
  body.innerHTML = `<div class="pc-cards">${Data.pcs.map((p) => {
    const sub = [p.species, p.career].filter(Boolean).join(' · ') || 'Fiche de personnage';
    const initial = esc((p.name || '?').trim().charAt(0).toUpperCase());
    const img = p.img
      ? `<img class="pc-portrait" src="${esc(foundryAsset(p.img))}" alt="" loading="lazy" data-initial="${initial}">`
      : `<span class="pc-portrait pc-fallback" aria-hidden="true">${initial}</span>`;
    return `<a class="pc-card" href="#/pc/${p.id}">${img}
      <span class="pc-info"><b>${esc(p.name)}</b><small>${esc(sub)}</small></span></a>`;
  }).join('')}</div>`;
  // portrait manquant → pastille initiale (pas d'image cassée)
  for (const img of body.querySelectorAll('img.pc-portrait')) {
    img.addEventListener('error', () => {
      const span = document.createElement('span');
      span.className = 'pc-portrait pc-fallback';
      span.setAttribute('aria-hidden', 'true');
      span.textContent = img.dataset.initial || '?';
      img.replaceWith(span);
    }, { once: true });
  }
}

const TOOLS = [
  { href: '#/vaisseau', icon: '🚀', name: 'Vaisseau', sub: 'État, position & fiche technique' },
  { href: '#/astronav', icon: '🪐', name: 'Astronav', sub: "Calculateur d'astrogation" },
  { href: '#/sabacc', icon: '🎴', name: 'Sabacc', sub: 'Règles — Spike de Corellia & Kessel' },
  { href: '#/ateliers', icon: '⚒️', name: 'Ateliers', sub: 'Fabrication — sabre, mods, potions' },
  { href: '#/timeline', icon: '📅', name: 'Chronologie', sub: 'Frise galactique (BBY/ABY)' },
];
function renderTools(body) {
  body.innerHTML = `<div class="dash-cards">${TOOLS.map((t) =>
    `<a class="dash-card tool-card" href="${t.href}">
      <span class="dc-ico" aria-hidden="true">${t.icon}</span>
      <span class="dc-title">${esc(t.name)}</span>
      <span class="dc-sub">${esc(t.sub)}</span>
    </a>`).join('')}</div>`;
}

// Bestiaire : réservé au MJ (stats & spoilers), compteurs du manifest en attendant le lazy-load.
function renderBestiary(body) {
  const cnt = Data.meta?.counts || {};
  const nNpc = Data.worldNpcs.length || cnt.npcs || 0;
  const nAdv = Data.adversaries.length || cnt.adversaries || 0;
  body.innerHTML = `<div class="dash-cards">
    <a class="dash-card" href="#/npc"><span class="dc-count">${nNpc}</span><span class="dc-title">PNJ du monde</span></a>
    <a class="dash-card" href="#/bestiaire"><span class="dc-count">${nAdv}</span><span class="dc-title">Adversaires</span></a>
  </div>`;
}

// --- Enveloppe commune + rendu du tableau de bord ---------------------------

function widgetEl(def, layout, editing, rerender) {
  const off = layout.hidden.has(def.id);
  const sec = document.createElement('section');
  sec.className = 'widget' + (off ? ' is-off' : '');
  sec.dataset.w = def.id;
  sec.setAttribute('aria-labelledby', `w-${def.id}-t`);

  const head = document.createElement('header');
  head.className = 'w-head';
  head.innerHTML = `<h2 class="w-title" id="w-${def.id}-t">${esc(def.label)}</h2>`;
  if (editing) {
    const idx = layout.order.indexOf(def.id);
    const ctrl = document.createElement('div');
    ctrl.className = 'w-ctrl';
    ctrl.innerHTML =
      `<button type="button" class="w-btn" data-move="-1" aria-label="Monter « ${esc(def.label)} »" ${idx === 0 ? 'disabled' : ''}>↑</button>` +
      `<button type="button" class="w-btn" data-move="1" aria-label="Descendre « ${esc(def.label)} »" ${idx === layout.order.length - 1 ? 'disabled' : ''}>↓</button>` +
      `<button type="button" class="w-btn w-vis" data-vis aria-pressed="${String(off)}">${ico(off ? 'eye' : 'eye-off')} ${off ? 'Afficher' : 'Masquer'}</button>`;
    ctrl.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      if (btn.dataset.move) {
        const from = layout.order.indexOf(def.id);
        const to = from + Number(btn.dataset.move);
        if (to < 0 || to >= layout.order.length) return;
        layout.order.splice(from, 1);
        layout.order.splice(to, 0, def.id);
      } else if ('vis' in btn.dataset) {
        if (off) layout.hidden.delete(def.id);
        else layout.hidden.add(def.id);
      }
      saveLayout(layout);
      rerender(def.id);
    });
    head.appendChild(ctrl);
  }
  sec.appendChild(head);

  const body = document.createElement('div');
  body.className = 'w-body';
  sec.appendChild(body);
  if (off && editing) {
    body.innerHTML = '<p class="w-empty">Widget masqué — il n\'apparaît pas hors personnalisation.</p>';
  } else {
    let res;
    try { res = def.render(body); } catch { res = false; }
    if (res === false) body.innerHTML = '<p class="w-empty">Rien à afficher pour l\'instant.</p>';
    if (res && typeof res.catch === 'function') {
      res.catch(() => { body.innerHTML = '<p class="w-empty">Données indisponibles (pont Foundry hors-ligne).</p>'; });
    }
  }
  return sec;
}

// Construit la vue d'accueil complète (héro + widgets) — montée par app.js.
export function homeView() {
  applyDashboardArt();
  const layout = loadLayout();
  let editing = false;

  const m = Data.meta || {};
  const wrap = document.createElement('div');
  wrap.className = 'dash';
  wrap.innerHTML = `
    <section class="dash-hero holo-frame">
      <div class="dash-hero-txt">
        <p class="eyebrow">${esc(m.system || 'Star Wars FFG')}</p>
        <h1>${esc(m.title || 'Archive Holocron')}</h1>
        <div class="sep-aurebesh" aria-hidden="true"></div>
        <div class="crawl">${m.description || ''}</div>
      </div>
      <div class="dash-hero-side">
        <div class="dash-holocron" aria-hidden="true"><i></i></div>
        <button type="button" class="dash-customize" id="dash-customize" aria-pressed="false">${ico('settings')} Personnaliser</button>
      </div>
    </section>
    <div class="dash-editbar" id="dash-editbar" hidden>
      <span>Personnalisation : réordonne (↑ ↓) ou masque les widgets — le choix est mémorisé sur cet appareil.</span>
      <button type="button" class="w-btn" id="dash-reset">Réinitialiser</button>
      <button type="button" class="w-btn w-done" id="dash-done">Terminé</button>
    </div>
    <div class="dash-widgets" id="dash-widgets"></div>`;

  const grid = wrap.querySelector('#dash-widgets');
  const editbar = wrap.querySelector('#dash-editbar');
  const customize = wrap.querySelector('#dash-customize');

  // focusId : widget à re-focus après re-rendu (les déplacements re-rendent tout).
  function renderAll(focusId) {
    wrap.classList.toggle('editing', editing);
    editbar.hidden = !editing;
    customize.setAttribute('aria-pressed', String(editing));
    grid.innerHTML = '';
    for (const id of layout.order) {
      const def = WIDGETS.find((w) => w.id === id);
      if (!def || (def.gmOnly && !isGM())) continue;
      if (layout.hidden.has(id) && !editing) continue;
      grid.appendChild(widgetEl(def, layout, editing, renderAll));
    }
    if (focusId) grid.querySelector(`[data-w="${focusId}"] .w-ctrl button:not([disabled])`)?.focus();
  }

  customize.addEventListener('click', () => { editing = !editing; renderAll(); });
  wrap.querySelector('#dash-done').addEventListener('click', () => { editing = false; renderAll(); });
  wrap.querySelector('#dash-reset').addEventListener('click', () => {
    layout.order = WIDGETS.map((w) => w.id);
    layout.hidden = new Set();
    saveLayout(layout);
    renderAll();
  });

  renderAll();
  return wrap;
}
