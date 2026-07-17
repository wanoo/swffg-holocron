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
import { statutPill } from './statut.js';
import { STATUS as QUEST_STATUS } from './gm-quests.js';
import { apiBase } from './collab.js';

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
// render(body) remplit l'enveloppe ; retourner false = état vide (une promesse
// résolue false compte aussi). hideEmpty : widget retiré de la home quand il
// est vide hors personnalisation (nouveaux widgets à configurer d'abord).
// options(panel, ctx) : formulaire ⚙ PROPRE au widget (mode Personnaliser MJ),
// qui écrit ses réglages dans ui.dashboard.widgets.<id> (ctx.save) — sauf
// exceptions documentées (« Où en est-on ? » garde dashboard.resumeJournalId).
// (« Ma fiche de personnage » a été retiré : les PJ vivent dans leur widget.)
const WIDGETS = [
  { id: 'status', label: 'Synthèse de campagne', render: renderStatus, options: statusOptions },
  { id: 'resume', label: 'Où en est-on ?', render: renderResume, options: resumeOptions },
  { id: 'journals', label: 'Journaux', render: renderJournals, options: journalsOptions },
  { id: 'quests', label: 'Quêtes', hideEmpty: true, render: renderQuests, options: questsOptions },
  { id: 'pcs', label: 'Personnages joueurs', render: renderPcs, options: pcsOptions },
  { id: 'keyNpcs', label: 'PNJ clés', hideEmpty: true, render: renderKeyNpcs, options: keyNpcsOptions },
  { id: 'tools', label: 'Outils', render: renderTools },
  { id: 'bestiary', label: 'Bestiaire (MJ)', gmOnly: true, render: renderBestiary },
];

// Options courantes d'un widget (bloc ui.dashboard.widgets — objet plat borné
// côté serveur, rétrocompat : absent = défauts historiques du widget).
const widgetOpts = (id) => (uiConfig().dashboard?.widgets || {})[id] || {};
// Écrit les options d'UN widget : son objet est REMPLACÉ en entier (le panneau
// ⚙ envoie tout son formulaire) — les autres widgets ne bougent pas.
const saveWidgetOpts = (id, opts) => saveUiConfig({ dashboard: { widgets: { [id]: opts } } });

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
// Option ⚙ meters : jauges visibles (['vivres','carburant','usure'] — vide/absent = toutes).
const STATUS_METERS = [
  { id: 'vivres', label: 'Vivres' }, { id: 'carburant', label: 'Carburant' }, { id: 'usure', label: 'Usure' },
];
async function renderStatus(body) {
  body.innerHTML = '<p class="w-loading">Connexion au pont du vaisseau…</p>';
  const opts = widgetOpts('status');
  const shown = new Set(Array.isArray(opts.meters) && opts.meters.length
    ? opts.meters : STATUS_METERS.map((m) => m.id));
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
      ${shown.size ? `<div class="tile tile-res">
        <p class="tile-k">Ressources — ${esc(ship.name)}</p>
        ${shown.has('vivres') ? meter('Vivres', ship.vivres, ship.vivresMax, kindOf(ratio(ship.vivres, ship.vivresMax)), 'food') : ''}
        ${shown.has('carburant') ? meter('Carburant', ship.fuel, ship.fuelMax, kindOf(ratio(ship.fuel, ship.fuelMax)), 'fuel') : ''}
        ${shown.has('usure') ? meter('Usure', ship.usure, 100, wearKind, 'wear') : ''}
        <a class="tile-link" href="#/vaisseau">Fiche du vaisseau →</a>
      </div>` : ''}
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
// Options ⚙ : cats = ids des catégories affichées (vide/absent = TOUTES),
// max = nombre max de cartes (0 = toutes).
function renderJournals(body) {
  const opts = widgetOpts('journals');
  const wanted = Array.isArray(opts.cats) && opts.cats.length ? new Set(opts.cats) : null;
  const max = Number(opts.max) > 0 ? Number(opts.max) : Infinity;
  const hidden = new Set(isGM() ? [] : (uiConfig().partsHidden || []));
  const cards = [];
  for (const cat of Data.categories) {
    if (cards.length >= max) break;
    if (wanted && !wanted.has(cat.id)) continue; // catégorie décochée par le MJ (⚙)
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

// Portrait de carte : image proxifiée ou pastille initiale.
function portraitHTML(img, name) {
  const initial = esc((name || '?').trim().charAt(0).toUpperCase());
  return img
    ? `<img class="pc-portrait" src="${esc(foundryAsset(img))}" alt="" loading="lazy" data-initial="${initial}">`
    : `<span class="pc-portrait pc-fallback" aria-hidden="true">${initial}</span>`;
}
// portrait manquant → pastille initiale (pas d'image cassée)
function bindPortraitFallbacks(body) {
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

// Personnages joueurs : portraits + espèce/carrière.
// Option ⚙ compact : cartes resserrées, sans la ligne espèce/carrière.
function renderPcs(body) {
  if (!Data.pcs.length) return false;
  const compact = Boolean(widgetOpts('pcs').compact);
  body.innerHTML = `<div class="pc-cards${compact ? ' compact' : ''}">${Data.pcs.map((p) => {
    const sub = [p.species, p.career].filter(Boolean).join(' · ') || 'Fiche de personnage';
    return `<a class="pc-card" href="#/pc/${p.id}">${portraitHTML(p.img, p.name)}
      <span class="pc-info"><b>${esc(p.name)}</b><small>${esc(sub)}</small></span></a>`;
  }).join('')}</div>`;
  bindPortraitFallbacks(body);
}

// --- PNJ clés : fiches (journaux CC npc/group) mises en avant par le MJ -------
// ui.dashboard.widgets.keyNpcs.ids = ids de VUE des fiches choisies. Sécurité :
// on ne rend que ce que Data.journalById contient — la vue journaux est déjà
// filtrée par la session côté serveur (canSee), un id invisible est simplement
// ignoré (la liste du MJ n'accorde aucun droit).
function keyNpcJournals() {
  const ids = widgetOpts('keyNpcs').ids;
  const seen = new Set();
  const list = [];
  for (const id of (Array.isArray(ids) ? ids : [])) {
    const j = Data.journalById.get(id);
    if (!j || seen.has(j.id)) continue;
    seen.add(j.id);
    list.push(j);
  }
  return list;
}
function renderKeyNpcs(body) {
  const list = keyNpcJournals();
  if (!list.length) return false;
  body.innerHTML = `<div class="pc-cards knpc-cards">${list.map((j) => {
    const img = (j.pages || []).find((p) => p.img)?.img || null;
    return `<a class="pc-card knpc-card" href="#/journal/${esc(j.id)}" data-id="${esc(j.id)}">${portraitHTML(img, j.name)}
      <span class="pc-info"><b>${esc(j.name)}</b></span></a>`;
  }).join('')}</div>`;
  bindPortraitFallbacks(body);
  for (const a of body.querySelectorAll('.knpc-card')) {
    const pill = statutPill(Data.journalById.get(a.dataset.id), { compact: true });
    if (pill) a.querySelector('.pc-info').appendChild(pill);
  }
}

// --- Quêtes : fiches Campaign Codex « quest » visibles de la session ----------
// Vue joueur-safe /api/content/quests ({ id, name, status } — jamais le graphe).
// Options ⚙ : statuses = statuts affichés (défaut : ACTIVES seulement — les
// quêtes finies/échouées/inactives restent du récap MJ), max = nombre max.
async function renderQuests(body) {
  body.innerHTML = '<p class="w-loading">Consultation du registre des quêtes…</p>';
  const opts = widgetOpts('quests');
  let data = null;
  try {
    const r = await fetch(`${apiBase()}/content/quests`, { credentials: 'same-origin' });
    if (r.ok) data = await r.json();
  } catch { /* hors-ligne : état vide */ }
  const statuses = new Set(Array.isArray(opts.statuses) && opts.statuses.length ? opts.statuses : ['active']);
  const max = Number(opts.max) > 0 ? Number(opts.max) : Infinity;
  const list = (data?.quests || []).filter((q) => statuses.has(q.status)).slice(0, max);
  if (!list.length) { body.innerHTML = ''; return false; }
  body.innerHTML = `<ul class="qw-list">${list.map((q) => {
    const st = QUEST_STATUS[q.status] || QUEST_STATUS.active;
    const inner = `<i class="qw-dot" style="--qc:${st.color}" aria-hidden="true"></i>
      <span class="qw-name">${esc(q.name)}</span><span class="qw-st">${st.label}</span>`;
    // lien seulement si la fiche est dans la vue journaux (catégorie déclarée)
    return Data.journalById.has(q.id)
      ? `<li><a class="qw-item" href="#/journal/${esc(q.id)}">${inner}</a></li>`
      : `<li><span class="qw-item">${inner}</span></li>`;
  }).join('')}</ul>${isGM() ? '<a class="tile-link" href="#/mj/quetes">Graphe complet →</a>' : ''}`;
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

// --- Formulaires ⚙ PAR widget (mode Personnaliser, MJ) -----------------------
// Chaque builder remplit `panel` et enregistre via ctx.save(opts) — options du
// widget remplacées en entier — ou ctx.saveUi(patch) pour une clé hors bloc
// widgets. Convention listes : liste vide enregistrée = défaut du widget
// (documenté dans chaque panneau) — masquer tout un widget passe par « Masquer ».

function optCheck(label, checked, onChange) {
  const lab = document.createElement('label');
  lab.className = 'cfg-check';
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = checked;
  cb.addEventListener('change', () => onChange(cb.checked));
  lab.append(cb, Object.assign(document.createElement('span'), { textContent: label }));
  return lab;
}
const optNumField = (label, value) => `<label class="cfg-field w-opts-num"><span>${esc(label)}</span>
  <input type="number" min="0" max="99" step="1" value="${value}"></label>`;
const readNum = (input) => Math.max(0, Math.min(99, Number(input.value) || 0));

// Synthèse : jauges de ressources visibles.
function statusOptions(panel, ctx) {
  const opts = widgetOpts('status');
  const shown = new Set(Array.isArray(opts.meters) && opts.meters.length
    ? opts.meters : STATUS_METERS.map((m) => m.id));
  panel.innerHTML = `<p class="w-opts-title">Jauges de ressources visibles</p><div class="cfg-parts-grid"></div>
    <p class="cfg-hint">Toutes cochées (ou aucune) = toutes les jauges.</p>`;
  const grid = panel.querySelector('.cfg-parts-grid');
  for (const m of STATUS_METERS) {
    grid.appendChild(optCheck(m.label, shown.has(m.id), (on) => {
      if (on) shown.add(m.id); else shown.delete(m.id);
      ctx.save({ meters: shown.size >= STATUS_METERS.length ? [] : [...shown] });
    }));
  }
}

// Où en est-on ? : choix du journal de reprise — clé HISTORIQUE conservée
// (dashboard.resumeJournalId, hors bloc widgets), déplacée ici depuis le
// panneau global pour la cohérence « chaque widget porte ses options ».
function resumeOptions(panel, ctx) {
  const d = uiConfig().dashboard || {};
  const story = storyJournals();
  const opts = ['<option value="">Automatique — dernier acte</option>']
    .concat(story.map((j) => `<option value="${esc(j.id)}" ${d.resumeJournalId === j.id ? 'selected' : ''}>${esc(j.name)}</option>`)).join('');
  panel.innerHTML = `<label class="cfg-field"><span>Journal affiché</span><select>${opts}</select></label>`;
  panel.querySelector('select').addEventListener('change', (e) => {
    ctx.saveUi({ dashboard: { resumeJournalId: e.target.value } });
  });
}

// Journaux : catégories affichées + nombre max de cartes.
function journalsOptions(panel, ctx) {
  const opts = widgetOpts('journals');
  const chosen = new Set(Array.isArray(opts.cats) && opts.cats.length
    ? opts.cats : Data.categories.map((c) => c.id));
  let max = Number(opts.max) > 0 ? Number(opts.max) : 0;
  const push = () => ctx.save({
    // toutes cochées → [] enregistré (= « toutes », suit les catégories futures)
    cats: chosen.size >= Data.categories.length ? [] : [...chosen],
    max,
  });
  panel.innerHTML = `<p class="w-opts-title">Catégories affichées</p><div class="cfg-parts-grid"></div>
    ${optNumField('Nombre max de cartes (0 = toutes)', max)}
    <p class="cfg-hint">Toutes cochées (ou aucune) = toutes les catégories, y compris les futures.</p>`;
  const grid = panel.querySelector('.cfg-parts-grid');
  for (const cat of Data.categories) {
    grid.appendChild(optCheck(cat.label, chosen.has(cat.id), (on) => {
      if (on) chosen.add(cat.id); else chosen.delete(cat.id);
      push();
    }));
  }
  panel.querySelector('input[type=number]').addEventListener('change', (e) => { max = readNum(e.target); push(); });
}

// Quêtes : statuts affichés + nombre max.
function questsOptions(panel, ctx) {
  const opts = widgetOpts('quests');
  const chosen = new Set(Array.isArray(opts.statuses) && opts.statuses.length ? opts.statuses : ['active']);
  let max = Number(opts.max) > 0 ? Number(opts.max) : 0;
  const push = () => ctx.save({ statuses: [...chosen], max });
  panel.innerHTML = `<p class="w-opts-title">Statuts affichés</p><div class="cfg-parts-grid"></div>
    ${optNumField('Nombre max (0 = toutes)', max)}
    <p class="cfg-hint">Aucun coché = défaut : quêtes actives seulement.</p>`;
  const grid = panel.querySelector('.cfg-parts-grid');
  for (const [id, st] of Object.entries(QUEST_STATUS)) {
    grid.appendChild(optCheck(st.label, chosen.has(id), (on) => {
      if (on) chosen.add(id); else chosen.delete(id);
      push();
    }));
  }
  panel.querySelector('input[type=number]').addEventListener('change', (e) => { max = readNum(e.target); push(); });
}

// Personnages joueurs : mode compact.
function pcsOptions(panel, ctx) {
  panel.appendChild(optCheck('Cartes compactes (sans espèce/carrière)',
    Boolean(widgetOpts('pcs').compact), (on) => ctx.save({ compact: on })));
}

// PNJ clés : sélection des fiches (journaux CC npc/group des catégories kind
// pc/org visibles de la session MJ) — filtre texte + cases à cocher.
function keyNpcsOptions(panel, ctx) {
  const cats = new Set(Data.categories.filter((c) => c.kind === 'pc' || c.kind === 'org').map((c) => c.id));
  const all = Data.journals.filter((j) => cats.has(j.categoryId));
  if (!all.length) {
    panel.innerHTML = '<p class="cfg-hint">Aucune fiche personnage/organisation (catégories kind pc/org) dans le monde.</p>';
    return;
  }
  const chosen = new Set((widgetOpts('keyNpcs').ids || []).filter((id) => typeof id === 'string'));
  panel.innerHTML = `<p class="w-opts-title">Fiches mises en avant</p>
    <input type="search" class="w-opts-search" placeholder="Filtrer les fiches…" aria-label="Filtrer les fiches">
    <div class="cfg-parts-grid w-opts-scroll"></div>
    <p class="cfg-hint">Les joueurs ne verront que les fiches visibles pour eux (filtrage serveur).</p>`;
  const grid = panel.querySelector('.w-opts-scroll');
  const push = () => ctx.save({ ids: [...chosen] });
  const fill = (filter = '') => {
    grid.innerHTML = '';
    const f = filter.trim().toLowerCase();
    for (const j of all) {
      if (f && !j.name.toLowerCase().includes(f)) continue;
      grid.appendChild(optCheck(j.name, chosen.has(j.id), (on) => {
        if (on) chosen.add(j.id); else chosen.delete(j.id);
        push();
      }));
    }
    if (!grid.children.length) grid.innerHTML = '<p class="cfg-hint">Aucune fiche ne correspond.</p>';
  };
  fill();
  panel.querySelector('.w-opts-search').addEventListener('input', (e) => fill(e.target.value));
}

// --- Enveloppe commune + rendu du tableau de bord ---------------------------

// ctx : { layout, editing, rerender, saveLayout, setStatus }. Renvoie null si
// le widget vide doit disparaître (hideEmpty, hors personnalisation).
function widgetEl(def, ctx) {
  const { layout, editing } = ctx;
  const off = layout.hidden.has(def.id);
  const sec = document.createElement('section');
  sec.className = 'widget' + (off ? ' is-off' : '');
  sec.dataset.w = def.id;
  sec.setAttribute('aria-labelledby', `w-${def.id}-t`);

  const head = document.createElement('header');
  head.className = 'w-head';
  head.innerHTML = `<h2 class="w-title" id="w-${def.id}-t">${esc(def.label)}</h2>`;

  const body = document.createElement('div');
  body.className = 'w-body';

  // Rendu (ou re-rendu après un save d'options) du corps du widget.
  let emptyRemoved = false;
  function renderBody() {
    if (off && editing) {
      body.innerHTML = '<p class="w-empty">Widget masqué — il n\'apparaît pas hors personnalisation.</p>';
      return;
    }
    let res;
    try { res = def.render(body); } catch { res = false; }
    const onEmpty = () => {
      if (def.hideEmpty && !editing) { emptyRemoved = true; sec.remove(); return; }
      body.innerHTML = '<p class="w-empty">Rien à afficher pour l\'instant.</p>';
    };
    if (res === false) onEmpty();
    else if (res && typeof res.then === 'function') {
      res.then(
        (r) => { if (r === false) onEmpty(); },
        () => { body.innerHTML = '<p class="w-empty">Données indisponibles (pont Foundry hors-ligne).</p>'; },
      );
    }
  }

  // Panneau ⚙ inline : les options DU widget, au-dessus de son contenu.
  function toggleOpts(btn) {
    const open = sec.querySelector('.w-opts');
    if (open) { open.remove(); btn.setAttribute('aria-pressed', 'false'); return; }
    const panel = document.createElement('div');
    panel.className = 'w-opts';
    const wrap = (p) => p
      .then(() => { ctx.setStatus('Enregistré ✓'); renderBody(); })
      .catch((e) => ctx.setStatus(`Échec de l'enregistrement — ${e.message}`));
    def.options(panel, {
      save: (opts) => { ctx.setStatus('Enregistrement…'); return wrap(saveWidgetOpts(def.id, opts)); },
      saveUi: (patch) => { ctx.setStatus('Enregistrement…'); return wrap(saveUiConfig(patch)); },
    });
    head.after(panel);
    btn.setAttribute('aria-pressed', 'true');
  }

  if (editing) {
    const idx = layout.order.indexOf(def.id);
    const ctrl = document.createElement('div');
    ctrl.className = 'w-ctrl';
    ctrl.innerHTML =
      (def.options ? `<button type="button" class="w-btn w-gear" data-opts aria-pressed="false" aria-label="Options de « ${esc(def.label)} »">${ico('settings')} Options</button>` : '') +
      `<button type="button" class="w-btn" data-move="-1" aria-label="Monter « ${esc(def.label)} »" ${idx === 0 ? 'disabled' : ''}>↑</button>` +
      `<button type="button" class="w-btn" data-move="1" aria-label="Descendre « ${esc(def.label)} »" ${idx === layout.order.length - 1 ? 'disabled' : ''}>↓</button>` +
      `<button type="button" class="w-btn w-vis" data-vis aria-pressed="${String(off)}">${ico(off ? 'eye' : 'eye-off')} ${off ? 'Afficher' : 'Masquer'}</button>`;
    ctrl.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      if ('opts' in btn.dataset) { toggleOpts(btn); return; }
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
      ctx.saveLayout(layout);
      ctx.rerender(def.id);
    });
    head.appendChild(ctrl);
  }
  sec.appendChild(head);
  sec.appendChild(body);
  renderBody();
  return emptyRemoved ? null : sec;
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

function gmConfigPanel(setStatus) {
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

  // Titre + thème + images (le journal « Où en est-on ? » se choisit désormais
  // dans les options ⚙ du widget lui-même — clé dashboard.resumeJournalId inchangée)
  const themeOpts = ['<option value="">— aucun (choix libre) —</option>']
    .concat(THEMES.map((t) => `<option value="${t.id}" ${ui.theme === t.id ? 'selected' : ''}>${esc(t.label)}</option>`)).join('');
  panel.innerHTML = `
    <div class="cfg-grid">
      <label class="cfg-field"><span>Titre du monde</span>
        <input type="text" id="cfg-title" maxlength="80" value="${esc(ui.title || '')}"
               placeholder="${esc(Data.meta?.title || 'Archive Holocron')}"></label>
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
        <span>Personnalisation du <b>monde</b> : ces réglages s'appliquent à tous les joueurs (réordonne ↑ ↓, masque, ou règle chaque widget via son bouton ⚙ Options).</span>
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

  // Parties masquées aux joueurs (F) : leurs widgets miroirs de la home suivent
  // (tools → widget Outils, pj → widget Personnages joueurs). Le MJ voit tout.
  const PART_WIDGET = { tools: 'tools', pj: 'pcs' };
  function hiddenPartWidgets() {
    if (isGM()) return new Set();
    return new Set((uiConfig().partsHidden || []).map((p) => PART_WIDGET[p]).filter(Boolean));
  }

  // focusId : widget à re-focus après re-rendu (les déplacements re-rendent tout).
  function renderAll(focusId) {
    wrap.classList.toggle('editing', editing);
    editbar.hidden = !editing;
    customize?.setAttribute('aria-pressed', String(editing));
    const partHidden = hiddenPartWidgets();
    grid.innerHTML = '';
    for (const id of layout.order) {
      const def = WIDGETS.find((w) => w.id === id);
      if (!def || (def.gmOnly && !isGM()) || partHidden.has(id)) continue;
      if (layout.hidden.has(id) && !editing) continue;
      const el = widgetEl(def, { layout, editing, rerender: renderAll, saveLayout, setStatus });
      if (el) grid.appendChild(el); // null = widget vide auto-retiré (hideEmpty)
    }
    if (focusId) grid.querySelector(`[data-w="${focusId}"] .w-ctrl button:not([disabled])`)?.focus();
  }

  if (customize) {
    const slot = wrap.querySelector('#dash-config-slot');
    customize.addEventListener('click', () => {
      editing = !editing;
      if (editing) { slot.innerHTML = ''; slot.appendChild(gmConfigPanel(setStatus)); }
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
