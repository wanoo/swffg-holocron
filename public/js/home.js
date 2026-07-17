// home.js — tableau de bord d'accueil (#/) composé de widgets indépendants.
// Chaque section passe par une enveloppe commune (titre, état vide/chargement).
// La personnalisation (ordre/masquage des widgets, titre du monde, journal de
// reprise, bannière, parties visibles) est de MONDE : éditée par le MJ seul
// (mode « ⚙ Personnaliser ») et écrite dans la config ui (PUT /api/gm/config/ui),
// donc synchronisée à tous. Rétrocompat : sans bloc ui, le layout localStorage
// historique continue de s'appliquer en lecture.
import { Data, foundryAsset } from './data.js';
import { fetchDash, planetInfo } from './navicomputer.js';
import { renderJournalHTML } from './render-journal.js';
import { uiConfig, isGMActive, saveUiConfig, worldTitle } from './ui-config.js';
import { latestByName } from './ui-shared.js';
import { THEMES } from './theme.js';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// Icône du pack (public/img/icons) en masque CSS, teintée par currentColor.
const ico = (name) => `<i class="ico" style="--ico:url('/img/icons/${name}.svg')" aria-hidden="true"></i>`;
const LAYOUT_KEY = 'holocron-home-layout'; // legacy : lecture seule (rétrocompat)
const SHIP_DEFAULTS = { name: 'Vaisseau du groupe', vivres: 60, vivresMax: 60, fuel: 30, fuelMax: 30, usure: 0, hyper: 1, lastTo: '' };
const isGM = isGMActive;

// --- Fond & bannière du héro configurables --------------------------------
// Priorité : config ui de monde (ui.dashboard.headerImage / background, posés
// par le MJ depuis « Personnaliser ») → legacy config.dashboard → décor du
// thème (variables CSS de themes.css, restaurées par removeProperty).
export function applyDashboardArt() {
  const legacy = (Data.config && Data.config.dashboard) || {};
  const ud = uiConfig().dashboard || {};
  const root = document.documentElement.style;
  const bg = ud.background || legacy.background || '';
  if (bg) {
    root.setProperty('--dashboard-background-image', `url("${foundryAsset(bg)}")`);
    root.setProperty('--dashboard-overlay', 'color-mix(in srgb, var(--app-background) 62%, transparent)');
    // Le défaut du thème est procédural (multi-couches à tailles natives) :
    // une image fournie reprend le plein cadre classique.
    root.setProperty('--dashboard-background-size', 'cover');
    root.setProperty('--dashboard-background-position', 'center top');
    root.setProperty('--dashboard-background-repeat', 'no-repeat');
  } else {
    for (const p of ['--dashboard-background-image', '--dashboard-overlay', '--dashboard-background-size',
      '--dashboard-background-position', '--dashboard-background-repeat']) root.removeProperty(p);
  }
  const hero = ud.headerImage || legacy.headerImage || '';
  if (hero) {
    root.setProperty('--dashboard-header-image', `url("${foundryAsset(hero)}")`);
    root.setProperty('--hero-overlay-start', 'color-mix(in srgb, var(--surface-default) 88%, transparent)');
    root.setProperty('--hero-overlay-end', 'color-mix(in srgb, var(--surface-default) 30%, transparent)');
    // image de campagne : plein cadre (l'ornement de gamme par défaut, lui, est calé à droite)
    root.setProperty('--hero-image-size', 'cover');
    root.setProperty('--hero-image-position', 'center');
  } else {
    for (const p of ['--dashboard-header-image', '--hero-overlay-start', '--hero-overlay-end',
      '--hero-image-size', '--hero-image-position']) root.removeProperty(p);
  }
}

// --- Registre des widgets --------------------------------------------------
// render(body) remplit l'enveloppe ; retourner false = état vide.
// (« Ma fiche de personnage » a été retiré : les PJ vivent dans leur widget.)
const WIDGETS = [
  { id: 'status', label: 'Synthèse de campagne', render: renderStatus },
  { id: 'resume', label: 'Où en est-on ?', render: renderResume },
  { id: 'journals', label: 'Journaux', render: renderJournals },
  { id: 'pcs', label: 'Personnages joueurs', render: renderPcs },
  { id: 'tools', label: 'Outils', render: renderTools },
  { id: 'bestiary', label: 'Bestiaire (MJ)', gmOnly: true, render: renderBestiary },
];

// Layout effectif : celui du MONDE (config ui) s'il existe, sinon le layout
// localStorage historique (rétrocompat, lecture seule désormais).
function loadLayout() {
  const ids = WIDGETS.map((w) => w.id);
  const world = uiConfig().dashboard || {};
  let raw = (world.order?.length || world.hidden?.length) ? world : null;
  if (!raw) { try { raw = JSON.parse(localStorage.getItem(LAYOUT_KEY) || 'null'); } catch { /* stockage indisponible */ } }
  const order = (raw?.order || []).filter((id) => ids.includes(id));
  for (const id of ids) if (!order.includes(id)) order.push(id);
  return { order, hidden: new Set((raw?.hidden || []).filter((id) => ids.includes(id))) };
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

// --- « Où en est-on ? » : LE journal de reprise, affiché en lecture compacte.
// Choisi par le MJ (ui.dashboard.resumeJournalId) ; par défaut le DERNIER
// journal des catégories kind « story » (tri NATUREL par nom : les actes sont
// préfixés « Acte N », le max par nom est stable — contrairement à la date de
// modif, qu'une retouche d'un vieil acte fausserait). Repli legacy : recap-acte-N.
function storyJournals() {
  const storyCats = new Set(Data.categories.filter((c) => c.kind === 'story').map((c) => c.id));
  return Data.journals.filter((j) => storyCats.has(j.categoryId));
}
function resumeJournal() {
  const id = uiConfig().dashboard?.resumeJournalId || '';
  if (id) {
    const j = Data.journalById.get(id);
    if (j) return j;
  }
  const story = storyJournals();
  if (story.length) return latestByName(story);
  const recaps = Data.journals
    .filter((j) => /^recap-acte-\d+$/.test(j.id))
    .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
  return recaps[recaps.length - 1] || null;
}
function renderResume(body) {
  const j = resumeJournal();
  if (!j) return false;
  const cat = Data.categories.find((c) => c.id === j.categoryId);
  body.innerHTML = '';
  const box = document.createElement('article');
  box.className = 'resume-doc page-surface';
  box.innerHTML = `
    <header class="resume-doc-head">
      <p class="eyebrow">${esc(cat?.label || 'Campagne')}</p>
      <h3 class="resume-doc-title">${esc(j.name)}</h3>
    </header>
    <div class="resume-doc-body"></div>
    <footer class="resume-doc-foot"><a class="tile-link" href="#/journal/${esc(j.id)}">Lire la fiche complète →</a></footer>`;
  const target = box.querySelector('.resume-doc-body');
  for (const p of j.pages) {
    const d = document.createElement('div');
    d.className = 'journal-content';
    renderJournalHTML(d, p.html);
    target.appendChild(d);
  }
  if (!target.textContent.trim()) target.innerHTML = '<p class="w-empty">Ce journal est encore vide.</p>';
  body.appendChild(box);
}

// Cartes catégories de journaux (navigation rapide) — icône du pack teintée
// selon le kind de la catégorie (même langage visuel que la sidebar).
const KIND_ICON = {
  rules: 'rules', story: 'campaign', notes: 'journal', timeline: 'events',
  pc: 'npc', org: 'organizations', players: 'player-characters', bestiary: 'bestiary', misc: 'journal',
};
const KIND_LABEL = {
  rules: 'Règles', story: 'Campagne', notes: 'Notes', timeline: 'Événements',
  pc: 'Personnages', org: 'Organisations', misc: 'Journaux',
};
function renderJournals(body) {
  const hidden = new Set(isGM() ? [] : (uiConfig().partsHidden || []));
  const cards = [];
  for (const cat of Data.categories) {
    if (hidden.has('cat:' + cat.id)) continue; // partie masquée aux joueurs (F)
    const list = Data.journals.filter((j) => j.categoryId === cat.id);
    if (!list.length) continue;
    cards.push(`<a class="dash-card cat-card" href="#/journal/${list[0].id}">
      <span class="dc-emb" aria-hidden="true">${ico(KIND_ICON[cat.kind] || 'journal')}</span>
      <span class="dc-body">
        <span class="dc-title">${esc(cat.label)}</span>
        <span class="dc-sub">${list.length} ${list.length > 1 ? 'journaux' : 'journal'}${KIND_LABEL[cat.kind] ? ' · ' + KIND_LABEL[cat.kind] : ''}</span>
      </span>
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

function widgetEl(def, layout, editing, rerender, saveLayout) {
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

// --- Panneau « Personnaliser » (MJ) : champs de la config ui de monde --------

// Parties disponibles pour les cases « visibles des joueurs » (mêmes ids que
// la sidebar : cat:<folderId>, pj, tools — les parties MJ ne sont pas listées).
function availableParts() {
  const list = Data.categories.map((c) => ({ id: 'cat:' + c.id, label: c.label }));
  if (Data.pcs.length) list.push({ id: 'pj', label: 'Personnages joueurs' });
  list.push({ id: 'tools', label: 'Outils' });
  return list;
}

function gmConfigPanel(setStatus, rerenderWidgets) {
  const ui = uiConfig();
  const d = ui.dashboard || {};
  const panel = document.createElement('div');
  panel.className = 'dash-config';

  const save = (patch, okMsg = 'Enregistré ✓') => {
    setStatus('Enregistrement…');
    return saveUiConfig(patch)
      .then((next) => { setStatus(okMsg); return next; })
      .catch((e) => { setStatus(`Échec de l'enregistrement — ${e.message}`); throw e; });
  };

  // Titre + journal de reprise + images
  const story = storyJournals();
  const themeOpts = ['<option value="">— aucun (choix libre) —</option>']
    .concat(THEMES.map((t) => `<option value="${t.id}" ${ui.theme === t.id ? 'selected' : ''}>${esc(t.label)}</option>`)).join('');
  const storyOpts = ['<option value="">Automatique — dernier acte</option>']
    .concat(story.map((j) => `<option value="${esc(j.id)}" ${d.resumeJournalId === j.id ? 'selected' : ''}>${esc(j.name)}</option>`)).join('');
  panel.innerHTML = `
    <div class="cfg-grid">
      <label class="cfg-field"><span>Titre du monde</span>
        <input type="text" id="cfg-title" maxlength="80" value="${esc(ui.title || '')}"
               placeholder="${esc(Data.meta?.title || 'Archive Holocron')}"></label>
      <label class="cfg-field"><span>Journal « Où en est-on ? »</span>
        <select id="cfg-resume">${storyOpts}</select></label>
      <label class="cfg-field"><span>Thème du monde</span>
        <select id="cfg-theme">${themeOpts}</select></label>
      <label class="cfg-check"><input type="checkbox" id="cfg-theme-lock" ${ui.themeLocked ? 'checked' : ''}>
        <span>Imposer le thème aux joueurs (leur sélecteur est masqué)</span></label>
      <label class="cfg-field cfg-wide"><span>Bannière du héro (URL ou chemin d'asset Foundry)</span>
        <input type="text" id="cfg-header" value="${esc(d.headerImage || '')}"
               placeholder="vide = ornement du thème — ex. assets/bannieres/acte3.webp"></label>
      <label class="cfg-field cfg-wide"><span>Fond de page (URL ou chemin d'asset Foundry)</span>
        <input type="text" id="cfg-bg" value="${esc(d.background || '')}"
               placeholder="vide = décor du thème"></label>
    </div>
    <fieldset class="cfg-parts">
      <legend>Parties du menu visibles des joueurs</legend>
      <div class="cfg-parts-grid"></div>
      <p class="cfg-hint">Le MJ voit toujours tout — le masquage ne s'applique qu'aux joueurs (menu + accueil).</p>
    </fieldset>`;

  panel.querySelector('#cfg-title').addEventListener('change', (e) => { save({ title: e.target.value }); });
  panel.querySelector('#cfg-resume').addEventListener('change', (e) => {
    save({ dashboard: { resumeJournalId: e.target.value } }).then(() => rerenderWidgets());
  });
  panel.querySelector('#cfg-theme').addEventListener('change', (e) => { save({ theme: e.target.value }); });
  panel.querySelector('#cfg-theme-lock').addEventListener('change', (e) => { save({ themeLocked: e.target.checked }); });
  panel.querySelector('#cfg-header').addEventListener('change', (e) => { save({ dashboard: { headerImage: e.target.value.trim() } }); });
  panel.querySelector('#cfg-bg').addEventListener('change', (e) => { save({ dashboard: { background: e.target.value.trim() } }); });

  const grid = panel.querySelector('.cfg-parts-grid');
  const hidden = new Set(ui.partsHidden || []);
  for (const part of availableParts()) {
    const lab = document.createElement('label');
    lab.className = 'cfg-check';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !hidden.has(part.id);
    cb.addEventListener('change', () => {
      if (cb.checked) hidden.delete(part.id); else hidden.add(part.id);
      save({ partsHidden: [...hidden] });
    });
    lab.append(cb, Object.assign(document.createElement('span'), { textContent: part.label }));
    grid.appendChild(lab);
  }
  return panel;
}

// Construit la vue d'accueil complète (héro + widgets) — montée par app.js.
export function homeView() {
  applyDashboardArt();
  let layout = loadLayout();
  let editing = false;

  const m = Data.meta || {};
  const gm = isGM();
  const wrap = document.createElement('div');
  wrap.className = 'dash';
  wrap.innerHTML = `
    <section class="dash-hero holo-frame">
      <div class="dash-hero-txt">
        <p class="eyebrow">${esc(m.system || 'Star Wars FFG')}</p>
        <h1>${esc(worldTitle())}</h1>
        <div class="sep-aurebesh" aria-hidden="true"></div>
        <div class="crawl">${m.description || ''}</div>
      </div>
      <div class="dash-hero-side">
        <div class="dash-holocron" aria-hidden="true"><i></i></div>
        ${gm ? `<button type="button" class="dash-customize" id="dash-customize" aria-pressed="false">${ico('settings')} Personnaliser</button>` : ''}
      </div>
    </section>
    <div class="dash-editbar" id="dash-editbar" hidden>
      <div class="dash-edit-head">
        <span>Personnalisation du <b>monde</b> : ces réglages s'appliquent à tous les joueurs (réordonne ↑ ↓ ou masque les widgets ci-dessous).</span>
        <span class="cfg-status" id="cfg-status" role="status"></span>
        <button type="button" class="w-btn" id="dash-reset">Réinitialiser les widgets</button>
        <button type="button" class="w-btn w-done" id="dash-done">Terminé</button>
      </div>
      <div id="dash-config-slot"></div>
    </div>
    <div class="dash-widgets" id="dash-widgets"></div>`;

  const grid = wrap.querySelector('#dash-widgets');
  const editbar = wrap.querySelector('#dash-editbar');
  const customize = wrap.querySelector('#dash-customize');
  const statusEl = wrap.querySelector('#cfg-status');
  const setStatus = (msg) => { if (statusEl) statusEl.textContent = msg; };

  // Écriture du layout de MONDE (MJ seul — le mode édition n'existe pas côté
  // joueur). En cas d'échec (journal ⚙️ absent, hors-ligne), on garde le
  // travail en localStorage et on l'affiche.
  function saveLayout(l) {
    setStatus('Enregistrement…');
    saveUiConfig({ dashboard: { order: l.order, hidden: [...l.hidden] } })
      .then(() => setStatus('Enregistré ✓'))
      .catch((e) => {
        try { localStorage.setItem(LAYOUT_KEY, JSON.stringify({ order: l.order, hidden: [...l.hidden] })); } catch { /* quota */ }
        setStatus(`Échec de l'enregistrement (gardé localement) — ${e.message}`);
      });
  }

  // focusId : widget à re-focus après re-rendu (les déplacements re-rendent tout).
  function renderAll(focusId) {
    wrap.classList.toggle('editing', editing);
    editbar.hidden = !editing;
    customize?.setAttribute('aria-pressed', String(editing));
    grid.innerHTML = '';
    for (const id of layout.order) {
      const def = WIDGETS.find((w) => w.id === id);
      if (!def || (def.gmOnly && !isGM())) continue;
      if (layout.hidden.has(id) && !editing) continue;
      grid.appendChild(widgetEl(def, layout, editing, renderAll, saveLayout));
    }
    if (focusId) grid.querySelector(`[data-w="${focusId}"] .w-ctrl button:not([disabled])`)?.focus();
  }

  if (customize) {
    const slot = wrap.querySelector('#dash-config-slot');
    customize.addEventListener('click', () => {
      editing = !editing;
      if (editing) { slot.innerHTML = ''; slot.appendChild(gmConfigPanel(setStatus, () => renderAll())); }
      renderAll();
    });
    wrap.querySelector('#dash-done').addEventListener('click', () => { editing = false; renderAll(); });
    wrap.querySelector('#dash-reset').addEventListener('click', () => {
      layout.order = WIDGETS.map((w) => w.id);
      layout.hidden = new Set();
      try { localStorage.removeItem(LAYOUT_KEY); } catch { /* stockage indisponible */ }
      saveLayout(layout);
      renderAll();
    });
  }

  renderAll();
  return wrap;
}
