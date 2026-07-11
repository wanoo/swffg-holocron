// astronav.js — calculateur d'astrogation (vue joueur #/astronav).
// 6751 systèmes (liste officielle Disney : coord/secteur/région) enrichis du lore
// et des images du wiki, reliés par les grandes hyperroutes canon. Applique les
// règles FFG (durée d'hyperespace, difficulté, temps de calcul en combat).
// Données chargées à la demande (public/data/planets.json, ~950 Ko).
import { makeGlyph } from './render-dice.js';
import { foundryAvailable, playerIdentity } from './dice-roller.js';
import { getGMKey } from './collab.js';
import { Data } from './data.js';
// Moteur d'astrogation partagé (mêmes règles que la route serveur /api/astro/route)
import {
  REGION_ORDER, regionRank, DIFF_NAMES, HOSTILE_DEFAULT, UNITS_PER_CASE,
  buildGraph as coreBuildGraph, computeRoute as coreComputeRoute,
  astroCheck, tripCost, fmtDays,
} from './astro-core.js';

let PLANETS = null, byName = null;
// planètes de campagne : fournies par la config (⚙️ Holocron Config → campaignPlanets)
const CAMPAIGN_ORDER = [];
const CAMPAIGN = new Set(CAMPAIGN_ORDER);
const REGION_COLOR = {
  'Noyau profond': '#e6c66c', 'Noyau': '#e6c66c', 'Colonies': '#d9b45b',
  'Bordure Intérieure': '#57c7ff', "Région d'expansion": '#57c7ff', 'Bordure Médiane': '#57c7ff',
  'Espace Hutt': '#c98a5a', 'Bordure Extérieure': '#c98a5a', 'Espace sauvage': '#a06adf',
  'Régions Inconnues': '#e5544b',
};
const DIFF_COLOR = { 1: '#6fbf8f', 2: '#8fd05a', 3: '#e0c04a', 4: '#e0975c', 5: '#d6595a' };
// Zones hostiles = ensemble d'allégeances choisi par le MJ (persisté, localStorage).
function loadHostile() {
  try { const a = JSON.parse(localStorage.getItem('holocron-hostile-aff') || 'null'); return new Set(Array.isArray(a) ? a : HOSTILE_DEFAULT); }
  catch { return new Set(HOSTILE_DEFAULT); }
}
function saveHostile(set) { localStorage.setItem('holocron-hostile-aff', JSON.stringify([...set])); }
// Calibration coordonnées swgalaxymap → pixels de la carte GFFA (servie en 5400px,
// Coruscant = [0,0] au pixel (2699.5, 2490), 2.155 px/unité, ~99.7 unités par case).
const CAL = { cx: 2699.5, cy: 2490, k: 2.155, size: 5400 };
const CLIM_ICON = { 'tempéré': '🌤️', aride: '🏜️', glacial: '❄️', tropical: '🌴', 'brûlant': '🌋', toxique: '☣️', 'océanique': '🌊', urbain: '🏙️', venteux: '🌪️', 'varié': '🗺️' };
// position pixel (image 5400²) d'un système : coordonnées continues swgalaxymap
// (exactes pour ~2000 systèmes, estimées depuis la grille Disney pour le reste)
function posOf(p) {
  if (!p || !p.xy) return null;
  return [CAL.cx + p.xy[0] * CAL.k, CAL.cy - p.xy[1] * CAL.k];
}
let LANES = null; // 63 routes {name, major, planets[], pts[[X,Y]...]} — chargées avec les données
// Les 63 hyperroutes (listes ordonnées + tracés) vivent dans data/lanes.json.

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

async function ensureData() {
  if (PLANETS) return;
  const res = await fetch('data/planets.json');
  if (!res.ok) throw new Error('planets.json introuvable (npm run build ?)');
  PLANETS = await res.json();
  byName = Object.fromEntries(PLANETS.map((p) => [p.name, p]));
  try { LANES = await (await fetch('data/lanes.json')).json(); } catch { LANES = null; }
}

// --- moteur ---------------------------------------------------------------
// distance en « cases » (1 case DK = 5000 AL ≈ 99.7 unités swgalaxymap)
function dist(a, b) {
  if (a.xy && b.xy) return Math.hypot(a.xy[0] - b.xy[0], a.xy[1] - b.xy[1]) / UNITS_PER_CASE;
  if (a.grid && b.grid) return Math.hypot(a.grid[0] - b.grid[0], a.grid[1] - b.grid[1]);
  return null;
}
function lanesOf(name) {
  return (LANES || []).filter((l) => l.planets.includes(name)).map((l) => l.name + (l.major ? '' : ' (mineure)'));
}
function sharedLane(a, b) {
  let best = null;
  for (const l of LANES || []) {
    if (l.planets.includes(a.name) && l.planets.includes(b.name)) { if (l.major) return l.name; best = best || l.name; }
  }
  return best;
}
// --- routeur réseau (moteur dans astro-core.js, partagé avec le serveur) -----
let GRAPH = null; // graphe des hyperroutes, construit à la demande
function ensureGraph() { if (!GRAPH) GRAPH = coreBuildGraph(byName, LANES); return GRAPH; }

// Itinéraire o→dst via le moteur partagé (A* réseau + raccords hors-route).
function computeRoute(o, dst, hyper = 1, opts = {}) { return coreComputeRoute(ensureGraph(), o, dst, hyper, opts); }
// fmtDays / astroCheck / tripCost sont fournis par astro-core.js (mêmes règles serveur).

// --- vaisseau & ressources (maison, persisté en localStorage) ---------------
const SHIP_DEFAULTS = { name: 'Vaisseau du groupe', hyper: 1, vivres: 60, vivresMax: 60, fuel: 30, fuelMax: 30, usure: 0 };
function loadShip() {
  try { return { ...SHIP_DEFAULTS, ...JSON.parse(localStorage.getItem('holocron-ship') || '{}') }; }
  catch { return { ...SHIP_DEFAULTS }; }
}
function saveShip(s) { localStorage.setItem('holocron-ship', JSON.stringify(s)); }

// --- pont Foundry : vaisseau canonique côté Foundry (flag holocron.ship) -----
// mode 'gm' = clé MJ (x-gm-key) ; mode 'player' = code de table (x-player-key).
// Le serveur borne les actions joueur à apply/refuel/fuel/repair.
function shipEndpoint(mode) {
  return mode === 'gm' ? '/api/gm/foundry/ship' : '/api/foundry/ship';
}
function shipHeaders(mode, json) {
  const h = json ? { 'Content-Type': 'application/json' } : {};
  if (mode === 'gm') h['x-gm-key'] = getGMKey() || '';
  else { const id = playerIdentity(); if (!id) throw new Error('identité requise'); if (id.key) h['x-player-key'] = id.key; }
  return h;
}
async function bridgeShipGet(mode) {
  const r = await fetch(shipEndpoint(mode), { headers: shipHeaders(mode, false) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { if (r.status === 401) localStorage.removeItem('holocron-table-key'); throw new Error(d.error || ('HTTP ' + r.status)); }
  return d.ship;
}
async function bridgeShipPost(mode, body) {
  const payload = { ...body };
  if (mode === 'player') { const id = playerIdentity(); if (!id) throw new Error('identité requise'); payload.player = id.name; }
  const r = await fetch(shipEndpoint(mode), { method: 'POST', headers: shipHeaders(mode, true), body: JSON.stringify(payload) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { if (r.status === 401) localStorage.removeItem('holocron-table-key'); throw new Error(d.error || ('HTTP ' + r.status)); }
  return d.ship;
}
async function bridgeRoll(mode, pool, description) {
  if (mode === 'gm') {
    const r = await fetch('/api/gm/foundry/roll', { method: 'POST', headers: shipHeaders('gm', true), body: JSON.stringify({ pool, description, skillName: 'Astrogation' }) });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || ('HTTP ' + r.status));
    return;
  }
  const id = playerIdentity(); if (!id) throw new Error('identité requise');
  const r = await fetch('/api/foundry/roll', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(id.key ? { 'x-player-key': id.key } : {}) }, body: JSON.stringify({ player: id.name, description, pool }) });
  if (!r.ok) { if (r.status === 401) localStorage.removeItem('holocron-table-key'); throw new Error((await r.json().catch(() => ({}))).error || ('HTTP ' + r.status)); }
}

// --- rendu principal ------------------------------------------------------
export async function mountAstronav(container) {
  container.innerHTML = '<div class="view-head"><h1>Astronav</h1><p class="muted">Chargement de la carte galactique…</p></div>';
  try { await ensureData(); } catch (e) {
    container.innerHTML = `<div class="view-head"><h1>Astronav</h1><p class="muted">${esc(e.message)}</p></div>`;
    return;
  }
  const total = PLANETS.length;
  container.innerHTML = '';
  const wrap = el('div', 'astronav');
  wrap.innerHTML = `
    <div class="view-head">
      <h1>Astronav</h1>
      <p class="muted">${total.toLocaleString('fr')} systèmes de toute la galaxie, classés par région et reliés
      par les grandes hyperroutes. Choisis une origine et une destination : le calcul d'astrogation FFG
      (durée, difficulté, temps de calcul) suit les coordonnées de grille et les routes empruntées.</p>
    </div>
    <div class="an-computer">
      <div class="an-route">
        <div class="an-field"><label class="o">Origine</label><select id="an-orig"></select></div>
        <div class="an-swap"><button id="an-swap" type="button" title="Inverser" aria-label="Inverser">⇄</button></div>
        <div class="an-field"><label class="d">Destination</label><select id="an-dest"></select></div>
      </div>
      <div class="an-routeopts">
        <label class="an-discret" title="Contourne les zones hostiles (trajet plus long, plus sûr)"><input type="checkbox" id="an-avoid"> 🕶️ Itinéraire discret</label>
        <details class="an-hostile"><summary>⚠️ Zones hostiles</summary><div class="an-hostile-list" id="an-hostile-list"></div></details>
      </div>
      <div class="an-readout" id="an-readout"></div>
      <div class="an-ship" id="an-ship"></div>
      <div class="an-notes" id="an-notes"></div>
    </div>
    <div class="an-chart-wrap">
      <div class="an-chart-head">
        <span class="an-chart-title">Carte officielle de la galaxie (DK) · 1 case = 5000 années-lumière</span>
        <span class="an-legend">
          <span><i style="background:#6fbf8f"></i>origine</span>
          <span><i style="background:var(--holo)"></i>destination</span>
          <span><i style="background:var(--gold)"></i>campagne</span>
          <span><i class="an-l-lane"></i>trajet</span>
          <button type="button" class="an-lanetog" id="an-lanetog" aria-pressed="false" title="Afficher les 5 grandes hyperroutes">🛣️ Hyperroutes</button>
          <button type="button" class="an-lanetog" id="an-minortog" aria-pressed="false" title="Afficher les 58 routes secondaires">routes mineures</button>
        </span>
      </div>
      <div id="an-chart"></div>
    </div>
    <div class="an-libhead">
      <h2>Registre des mondes</h2>
      <input class="an-search" id="an-search" type="search" placeholder="Rechercher un système… (Entrée : zoom carte)" aria-label="Rechercher">
    </div>
    <div class="an-filters" id="an-filters">
      <select id="f-region" aria-label="Zone"><option value="">🌌 Toutes les zones</option></select>
      <select id="f-clim" aria-label="Climat"><option value="">☀️ Tout climat</option></select>
      <select id="f-aff" aria-label="Allégeance"><option value="">🏳️ Toute allégeance</option></select>
      <select id="f-pop" aria-label="Population"><option value="">👥 Toute population</option></select>
      <button type="button" class="an-ftog" id="f-faune" aria-pressed="false">🐾 Faune</button>
      <button type="button" class="an-ftog" id="f-flore" aria-pressed="false">🌿 Flore</button>
      <button type="button" class="an-fclear" id="f-clear">Réinitialiser</button>
    </div>
    <p class="muted an-libsub" id="an-libsub"></p>
    <div id="an-library"></div>`;
  container.appendChild(wrap);

  const orig = wrap.querySelector('#an-orig'), dest = wrap.querySelector('#an-dest');
  const STAGE = 5400; // px logiques du plateau (= résolution image), viewer carte
  let view = null;    // état pan/zoom : { vp, stage, ov, s, tx, ty, minS, o, dst }
  let showLanes = false; // superposition des 5 grandes hyperroutes
  let showMinor = false; // + les 58 routes secondaires
  let lastRoute = null;  // dernier itinéraire calculé (segments réseau)
  // --- état vaisseau : source canonique Foundry si un pont est actif ----------
  let shipMode = 'local';        // 'local' | 'gm' | 'player'
  let bridgeReady = false;       // pont joueur disponible mais pas encore connecté
  let hasGmBridge = false;       // clé MJ + MCP configuré → canal MJ dispo
  // planètes de campagne depuis la config (épinglées + marqueurs carte)
  CAMPAIGN_ORDER.length = 0;
  CAMPAIGN_ORDER.push(...((Data.config?.campaignPlanets) || []));
  CAMPAIGN.clear();
  for (const n of CAMPAIGN_ORDER) CAMPAIGN.add(n);
  let shipState = loadShip();    // copie de travail (localStorage par défaut)
  let lastCtx = null;            // { o, dst, chk } du dernier calcul, pour le jet
  let avoidHostile = false;      // mode « itinéraire discret »
  let hostileSet = loadHostile(); // allégeances traitées comme hostiles (persisté)
  fillSelects();
  populateHostile();
  populateFilters();
  renderLibrary();
  orig.addEventListener('change', compute);
  dest.addEventListener('change', compute);
  wrap.querySelector('#an-swap').addEventListener('click', () => { const a = orig.value; orig.value = dest.value; dest.value = a; compute(); });
  wrap.querySelector('#an-avoid').addEventListener('change', (e) => { avoidHostile = e.target.checked; compute(); });
  wrap.querySelector('#an-lanetog').addEventListener('click', (e) => {
    showLanes = e.currentTarget.getAttribute('aria-pressed') !== 'true';
    e.currentTarget.setAttribute('aria-pressed', String(showLanes));
    if (view) renderOverlay();
  });
  wrap.querySelector('#an-minortog').addEventListener('click', (e) => {
    showMinor = e.currentTarget.getAttribute('aria-pressed') !== 'true';
    e.currentTarget.setAttribute('aria-pressed', String(showMinor));
    if (view) renderOverlay();
  });
  let st;
  wrap.querySelector('#an-search').addEventListener('input', () => { clearTimeout(st); st = setTimeout(renderLibrary, 150); });
  // Entrée dans la recherche → zoom carte sur le meilleur résultat localisable.
  wrap.querySelector('#an-search').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const F = getFilters(); if (!anyFilter(F)) return;
    const hits = PLANETS.filter((p) => matchP(p, F) && posOf(p));
    if (!hits.length) return;
    const t = F.text;
    const best = hits.find((p) => p.name.toLowerCase() === t)
      || hits.sort((a, b) => a.name.length - b.name.length)[0];
    focusPlanet(best);
  });
  ['f-region', 'f-clim', 'f-aff', 'f-pop'].forEach((id) => wrap.querySelector('#' + id).addEventListener('change', renderLibrary));
  ['f-faune', 'f-flore'].forEach((id) => wrap.querySelector('#' + id).addEventListener('click', (e) => {
    const on = e.currentTarget.getAttribute('aria-pressed') === 'true';
    e.currentTarget.setAttribute('aria-pressed', String(!on)); renderLibrary();
  }));
  wrap.querySelector('#f-clear').addEventListener('click', () => {
    wrap.querySelector('#an-search').value = '';
    ['f-region', 'f-clim', 'f-aff', 'f-pop'].forEach((id) => { wrap.querySelector('#' + id).value = ''; });
    ['f-faune', 'f-flore'].forEach((id) => wrap.querySelector('#' + id).setAttribute('aria-pressed', 'false'));
    renderLibrary();
  });
  compute();

  // Détection du pont Foundry (sans prompt : on ne demande l'identité qu'au clic).
  (async () => {
    if (getGMKey()) {
      try {
        const st = await (await fetch('/api/gm/foundry/status', { headers: { 'x-gm-key': getGMKey() } })).json();
        if (st && st.enabled) {
          hasGmBridge = true;
          try { shipState = { ...SHIP_DEFAULTS, ...(await bridgeShipGet('gm')) }; shipMode = 'gm'; } catch { /* garde le local */ }
        }
      } catch { /* pas de pont MJ */ }
    }
    if (shipMode === 'local') { try { bridgeReady = await foundryAvailable(); } catch { bridgeReady = false; } }
    // recalcule pour faire apparaître le bouton « 🎲 → Foundry » et rafraîchir le vaisseau
    compute();
  })();

  // Mondes d'intérêt flaggés depuis Foundry (macro ⭐) → épinglés pour les joueurs.
  // Le serveur ne renvoie les épingles « vis: gm » qu'au MJ (session ou clé).
  (async () => {
    let poi = [];
    try {
      const r = await fetch('/api/astro/poi', { credentials: 'same-origin', headers: getGMKey() ? { 'x-gm-key': getGMKey() } : {} });
      poi = (await r.json()).poi || [];
    } catch { return; }
    let changed = false;
    for (const it of poi) {
      const p = byName[it && it.name]; if (!p) continue;
      p.poi = true;
      p.poiVis = it.vis === 'gm' ? 'gm' : 'all';
      const note = ((it.act ? `Acte ${it.act} — ` : '') + (it.note || '')).trim();
      if (note) p.campaign = note;
      if (!CAMPAIGN.has(it.name)) { CAMPAIGN.add(it.name); CAMPAIGN_ORDER.push(it.name); changed = true; }
    }
    if (!changed) return;
    const ov = orig.value, dv = dest.value;   // préserve la sélection courante
    fillSelects(); orig.value = ov; dest.value = dv;
    renderLibrary();
    compute();
  })();

  function populateFilters() {
    const regs = REGION_ORDER.filter((r) => PLANETS.some((p) => p.region === r));
    wrap.querySelector('#f-region').insertAdjacentHTML('beforeend', regs.map((r) => `<option value="${esc(r)}">${esc(r)}</option>`).join(''));
    const clims = [...new Set(PLANETS.flatMap((p) => (p.f && p.f.clim) || []))].sort();
    wrap.querySelector('#f-clim').insertAdjacentHTML('beforeend', clims.map((c) => `<option value="${esc(c)}">${CLIM_ICON[c] || '·'} ${esc(c)}</option>`).join(''));
    const affs = [...new Set(PLANETS.flatMap((p) => (p.f && p.f.aff) || []))].sort();
    wrap.querySelector('#f-aff').insertAdjacentHTML('beforeend', affs.map((a) => `<option value="${esc(a)}">${esc(a)}</option>`).join(''));
    const pops = ['inhabité', 'faible', 'modérée', 'élevée'].filter((b) => PLANETS.some((p) => p.f && p.f.pop === b));
    wrap.querySelector('#f-pop').insertAdjacentHTML('beforeend', pops.map((b) => `<option value="${esc(b)}">👥 ${esc(b)}</option>`).join(''));
  }
  // Cases à cocher des allégeances hostiles (persisté) → réutilisable par campagne.
  function populateHostile() {
    const host = wrap.querySelector('#an-hostile-list');
    const affs = [...new Set(PLANETS.flatMap((p) => (p.f && p.f.aff) || []))].sort((a, b) => a.localeCompare(b, 'fr'));
    if (!affs.length) { host.innerHTML = '<p class="muted" style="margin:.2rem .4rem">Aucune allégeance renseignée.</p>'; return; }
    host.innerHTML = affs.map((a) => {
      const n = PLANETS.filter((p) => (p.f && p.f.aff || []).includes(a)).length;
      return `<label><input type="checkbox" value="${esc(a)}" ${hostileSet.has(a) ? 'checked' : ''}> ${esc(a)} <small>(${n})</small></label>`;
    }).join('');
    host.querySelectorAll('input[type=checkbox]').forEach((cb) => cb.addEventListener('change', () => {
      if (cb.checked) hostileSet.add(cb.value); else hostileSet.delete(cb.value);
      saveHostile(hostileSet);
      compute();
    }));
  }
  function getFilters() {
    return {
      text: (wrap.querySelector('#an-search').value || '').trim().toLowerCase(),
      region: wrap.querySelector('#f-region').value,
      clim: wrap.querySelector('#f-clim').value,
      aff: wrap.querySelector('#f-aff').value,
      pop: wrap.querySelector('#f-pop').value,
      faune: wrap.querySelector('#f-faune').getAttribute('aria-pressed') === 'true',
      flore: wrap.querySelector('#f-flore').getAttribute('aria-pressed') === 'true',
    };
  }
  function anyFilter(F) { return F.text || F.region || F.clim || F.aff || F.pop || F.faune || F.flore; }
  function matchP(p, F) {
    if (F.text && !p.name.toLowerCase().includes(F.text)) return false;
    if (F.region && p.region !== F.region) return false;
    const f = p.f || {};
    if (F.clim && !(f.clim || []).includes(F.clim)) return false;
    if (F.aff && !(f.aff || []).includes(F.aff)) return false;
    if (F.pop && f.pop !== F.pop) return false;
    if (F.faune && !f.faune) return false;
    if (F.flore && !f.flore) return false;
    return true;
  }

  function fillSelects() {
    const groups = {};
    for (const p of PLANETS) (groups[p.region] = groups[p.region] || []).push(p);
    let html = '<optgroup label="★ Campagne">' + CAMPAIGN_ORDER.filter((n) => byName[n]).map((n) => `<option value="${esc(n)}">★ ${esc(n)}</option>`).join('') + '</optgroup>';
    for (const r of REGION_ORDER) {
      const list = (groups[r] || []).filter((p) => !CAMPAIGN.has(p.name)).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
      if (!list.length) continue;
      html += `<optgroup label="${esc(r)}">` + list.map((p) => `<option value="${esc(p.name)}">${esc(p.name)}</option>`).join('') + '</optgroup>';
    }
    orig.innerHTML = html; dest.innerHTML = html;
    orig.value = byName['Coruscant'] ? 'Coruscant' : PLANETS[0].name;
    dest.value = CAMPAIGN_ORDER.find((n) => byName[n] && n !== orig.value) || PLANETS[1].name;
  }

  function compute() {
    const o = byName[orig.value], dst = byName[dest.value];
    const ro = wrap.querySelector('#an-readout'), notes = wrap.querySelector('#an-notes');
    if (!o || !dst) { ro.innerHTML = ''; notes.innerHTML = ''; lastCtx = null; return; }
    const ship = shipState;
    const same = o.name === dst.name;
    const route = (!same && o.xy && dst.xy) ? computeRoute(o, dst, ship.hyper, { avoid: avoidHostile, hostile: hostileSet }) : null;
    lastRoute = route;
    const chk = route ? astroCheck(o, dst, route, ship) : null;
    const diff = chk ? chk.diff : null;
    lastCtx = { o, dst, chk };
    const cell = (k, v, sub, cls = '') => `<div class="an-ro ${cls}"><div class="an-k">${k}</div><div class="an-v">${v}${sub ? `<small>${sub}</small>` : ''}</div></div>`;
    let html = '';
    if (same) {
      html += cell('Distance', '—', 'même monde');
      html += cell('Durée', 'Intra-système', '5–15 min → point de saut · 12–72 h à travers le système');
      html += cell('Calcul', 'Aucun saut', 'trajet local');
    } else if (route) {
      const t = route.cases;
      const pctOn = Math.round(((t.major + t.minor) / (t.total || 1)) * 100);
      const hostSub = route.hostile > 0 ? ` · ⚠️ ${route.hostile} monde${route.hostile > 1 ? 's' : ''} hostile${route.hostile > 1 ? 's' : ''}` : (avoidHostile ? ' · 🕶️ zéro zone hostile' : '');
      html += cell('Itinéraire', `${t.total.toFixed(1)} cases`, `${pctOn}% sur routes · ${t.off.toFixed(1)} hors réseau${hostSub}`, route.hostile > 0 ? 'warn' : '');
      html += cell('Durée', fmtDays(route.days), `hyperdrive ×${ship.hyper}`);
      const dice = `<span class="an-dice" id="an-dice"></span>`;
      const bad = (chk.boost ? `<span class="an-dice" id="an-boost"></span>` : '') + (chk.setback ? `<span class="an-dice" id="an-setback"></span>` : '');
      html += `<div class="an-ro diff"><div class="an-k">Difficulté</div><div class="an-v">${dice} <span class="an-dname" style="color:${DIFF_COLOR[diff]}">${DIFF_NAMES[diff]}</span>${bad}${chk.upgrades ? ` <span class="an-up">↑${chk.upgrades}</span>` : ''}</div></div>`;
      html += cell('Temps de calcul', chk.calc, chk.upgrades ? `au-delà de Redoutable` : 'avant le saut (× multiplicateur hyperdrive)');
    } else {
      html += cell('Itinéraire', 'indisponible', 'position inconnue pour un des deux mondes');
    }
    ro.innerHTML = html;
    if (chk) {
      const chal = Math.min(chk.upgrades, diff), nDiff = diff - chal;
      const slot = ro.querySelector('#an-dice');
      for (let i = 0; i < nDiff; i++) slot.appendChild(makeGlyph('difficulty'));
      for (let i = 0; i < chal; i++) slot.appendChild(makeGlyph('challenge'));
      const bs = ro.querySelector('#an-boost'); if (bs) for (let i = 0; i < chk.boost; i++) bs.appendChild(makeGlyph('boost'));
      const ss = ro.querySelector('#an-setback'); if (ss) for (let i = 0; i < chk.setback; i++) ss.appendChild(makeGlyph('setback'));
    }
    if (chk && (hasGmBridge || bridgeReady)) {
      const dcell = ro.querySelector('.an-ro.diff');
      const rb = document.createElement('button');
      rb.type = 'button'; rb.className = 'an-rollf';
      rb.textContent = '🎲 → Foundry';
      rb.title = "Envoyer le jet d'astrogation (difficulté + boost/malus) dans le chat Foundry";
      rb.addEventListener('click', () => sendAstroRoll(rb));
      if (dcell) dcell.appendChild(rb);
    }
    renderShip(route);
    const n = [];
    if (same) n.push("Origine et destination identiques : pas d'astrogation, seulement le trajet local.");
    else if (route) {
      n.push('<b>Difficulté FFG</b> : ' + chk.parts.map((p) => `${p.label} <span class="an-ptag">${p.tag}</span>`).join(' · '));
      if (avoidHostile) n.push(route.hostile > 0
        ? `🕶️ Itinéraire discret : ${route.hostile} zone${route.hostile > 1 ? 's' : ''} hostile${route.hostile > 1 ? 's' : ''} inévitable${route.hostile > 1 ? 's' : ''} sur le trajet.`
        : '🕶️ Itinéraire discret : contourne toutes les zones hostiles connues (trajet plus long mais sûr).');
      if (Math.min(o.charted, dst.charted) === 0) n.push('Destination en <b>Régions Inconnues</b> : cartes inexistantes, sortie hasardeuse.');
      n.push(`Carburant (fiche FFG) : 1 cellule à l'entrée + 1 par case ≈ <b>${Math.ceil(1 + route.cases.total)} cellules</b>.`);
    }
    notes.innerHTML = n.map((x) => `<div>• ${x}</div>`).join('');
    drawChart(o, dst);
  }

  // --- jet d'astrogation → chat Foundry (dés de difficulté / obstacle) -------
  async function sendAstroRoll(btn) {
    if (!lastCtx || !lastCtx.chk) return;
    const mode = hasGmBridge ? 'gm' : bridgeReady ? 'player' : null;
    if (!mode) return;
    const chk = lastCtx.chk;
    const chal = Math.min(chk.upgrades, chk.diff);
    const pool = { difficulty: chk.diff - chal };
    if (chal) pool.challenge = chal;
    if (chk.boost) pool.boost = chk.boost;
    if (chk.setback) pool.setback = chk.setback;
    const prev = btn.textContent; btn.disabled = true; btn.textContent = '…';
    try {
      await bridgeRoll(mode, pool, `Astrogation · ${lastCtx.o.name} → ${lastCtx.dst.name}`);
      btn.textContent = '✓ envoyé';
      setTimeout(() => { btn.textContent = prev; btn.disabled = false; }, 1800);
    } catch (e) {
      btn.textContent = '⚠️ ' + String(e.message).slice(0, 20);
      setTimeout(() => { btn.textContent = prev; btn.disabled = false; }, 2400);
    }
  }

  // Action vaisseau côté Foundry (apply/refuel/fuel/repair) → maj shipState.
  async function shipRemote(btn, action, extra) {
    const prev = btn.textContent; btn.disabled = true; btn.textContent = '…';
    try {
      shipState = { ...SHIP_DEFAULTS, ...(await bridgeShipPost(shipMode, { action, ...extra })) };
      renderShip(lastRoute);
    } catch (e) {
      btn.disabled = false; btn.textContent = '⚠️ ' + String(e.message).slice(0, 22);
      setTimeout(() => { btn.textContent = prev; }, 2400);
    }
  }

  // --- panneau vaisseau (ressources consommables, règle maison) -------------
  function renderShip(route) {
    const host = wrap.querySelector('#an-ship');
    const ship = shipState;
    const remote = shipMode !== 'local';
    const cost = route ? tripCost(route, ship.hyper) : null;
    const okV = !cost || ship.vivres >= cost.days, okF = !cost || ship.fuel >= cost.fuel;
    const bar = (val, max, cls) => `<div class="an-bar"><div class="an-barfill ${cls}" style="width:${Math.max(0, Math.min(100, (val / max) * 100))}%"></div></div>`;
    const wear = ship.usure;
    const wearFx = wear > 80 ? '[se][se] Pilotage/Mécanique + test Mécanique avant chaque saut' : wear > 50 ? '[se] aux tests de Pilotage/Mécanique' : 'aucun effet';
    const src = remote
      ? `<span class="an-shipsrc on">🛰️ Vaisseau synchronisé Foundry${shipMode === 'gm' ? ' (MJ)' : ''}</span>`
      : bridgeReady
        ? `<button type="button" class="an-shipsrc connect" id="sh-connect">🛰️ Connecter le vaisseau du groupe (Foundry)</button>`
        : `<span class="an-shipsrc off">💾 Vaisseau local (ce navigateur)</span>`;
    host.innerHTML = `
      <details class="an-shipbox" ${cost ? 'open' : ''}>
        <summary>🚀 ${esc(ship.name)} — vivres ${ship.vivres}j · carburant ${ship.fuel} · usure ${wear}%</summary>
        <div class="an-shipsrcrow">${src}</div>
        <div class="an-shipgrid">
          <div class="an-res"><div class="an-k">🥫 Vivres</div>${bar(ship.vivres, ship.vivresMax, 'v')}
            <div class="an-resline">${ship.vivres} / ${ship.vivresMax} jours ${cost ? `<b class="${okV ? 'ok' : 'ko'}">−${cost.days}j</b>` : ''}</div></div>
          <div class="an-res"><div class="an-k">⛽ Carburant</div>${bar(ship.fuel, ship.fuelMax, 'f')}
            <div class="an-resline">${ship.fuel} / ${ship.fuelMax} unités ${cost ? `<b class="${okF ? 'ok' : 'ko'}">−${cost.fuel}</b>` : ''}</div></div>
          <div class="an-res"><div class="an-k">🔧 Usure</div>${bar(wear, 100, wear > 80 ? 'w3' : wear > 50 ? 'w2' : 'w1')}
            <div class="an-resline">${wear}% ${cost ? `<b class="${wear + cost.usure > 100 ? 'ko' : 'ok'}">+${cost.usure}%</b>` : ''} · <span class="an-wearfx">${wearFx}</span></div></div>
        </div>
        <div class="an-shiprow">
          <label>Hyperdrive <select id="sh-hyper">${[0.5, 1, 2, 3, 4].map((h) => `<option value="${h}" ${h === ship.hyper ? 'selected' : ''}>×${h}</option>`).join('')}</select></label>
          ${cost ? `<button type="button" class="an-apply" id="sh-apply" ${okV && okF ? '' : 'disabled'}>${okV && okF ? '🧭 Appliquer le voyage' : '⛔ Ressources insuffisantes'}</button>` : ''}
          <span class="an-shipbtns">
            <button type="button" data-r="vivres" title="~10 cr/jour">🥫 Ravitailler</button>
            <button type="button" data-r="fuel" title="~50 cr/unité">⛽ Plein</button>
            <button type="button" data-r="usure" title="~25 cr/% (atelier)">🔧 Réviser</button>
          </span>
        </div>
        <p class="an-shiphint">Règle maison : vivres 1j/jour de voyage · carburant 1/case (+50% hors réseau) ·
        l'usure monte avec la durée et le hors-piste. ${remote ? 'État partagé du groupe (canonique côté Foundry).' : 'État local à ce navigateur.'}</p>
      </details>`;
    host.querySelector('#sh-hyper').addEventListener('change', (e) => { shipState.hyper = Number(e.target.value); if (!remote) saveShip(shipState); compute(); });
    const conn = host.querySelector('#sh-connect');
    if (conn) conn.addEventListener('click', async () => {
      const id = playerIdentity(); if (!id) return;
      conn.disabled = true; conn.textContent = '… connexion';
      try { shipState = { ...SHIP_DEFAULTS, ...(await bridgeShipGet('player')) }; shipMode = 'player'; compute(); }
      catch (e) { conn.disabled = false; conn.textContent = '⚠️ ' + String(e.message).slice(0, 30); }
    });
    host.querySelectorAll('.an-shipbtns button').forEach((b) => b.addEventListener('click', async () => {
      if (remote) {
        const action = b.dataset.r === 'vivres' ? 'refuel' : b.dataset.r === 'fuel' ? 'fuel' : 'repair';
        await shipRemote(b, action, {});
      } else {
        if (b.dataset.r === 'vivres') shipState.vivres = shipState.vivresMax;
        else if (b.dataset.r === 'fuel') shipState.fuel = shipState.fuelMax;
        else shipState.usure = 0;
        saveShip(shipState); renderShip(lastRoute);
      }
    }));
    const ap = host.querySelector('#sh-apply');
    if (ap) ap.addEventListener('click', async () => {
      const c = tripCost(lastRoute, shipState.hyper);
      if (remote) {
        const label = lastCtx ? `${lastCtx.o.name} → ${lastCtx.dst.name}` : 'Voyage';
        await shipRemote(ap, 'apply', { trip: c, label });
      } else {
        shipState.vivres = Math.max(0, shipState.vivres - c.days);
        shipState.fuel = Math.max(0, shipState.fuel - c.fuel);
        shipState.usure = Math.min(100, shipState.usure + c.usure);
        saveShip(shipState); renderShip(lastRoute);
      }
    });
  }

  // --- Viewer carte : renderer CANVAS (netteté à tous les zooms) -----------
  // L'image est dessinée à la résolution device-pixel exacte (drawImage HQ) :
  // pas de layer composité GPU qui minifie en bilinéaire (source du flou).
  // Marqueurs, trajet et hyperroutes sont dessinés dans la même passe, en px écran.
  function setupMapViewer() {
    const host = wrap.querySelector('#an-chart');
    host.innerHTML = `
      <div class="an-viewport" id="an-vp">
        <canvas class="an-canvas" id="an-canvas"></canvas>
        <div class="an-zoom">
          <button type="button" data-z="in" aria-label="Zoom avant">+</button>
          <button type="button" data-z="out" aria-label="Zoom arrière">−</button>
          <button type="button" data-z="route" aria-label="Cadrer le trajet" title="Cadrer le trajet">🎯</button>
          <button type="button" data-z="reset" aria-label="Vue galaxie" title="Vue galaxie">⤢</button>
        </div>
        <div class="an-hint">molette : zoom · glisser : déplacer</div>
      </div>`;
    const vp = host.querySelector('#an-vp'), canvas = host.querySelector('#an-canvas');
    view = { vp, canvas, ctx: canvas.getContext('2d'), s: 0.15, tx: 0, ty: 0, minS: 0.1, o: null, dst: null, raf: 0 };

    const img = new Image();
    img.src = 'data/galaxy-map.jpg';
    img.decode().then(() => { view.img = img; fitGalaxy(); }).catch(() => { view.img = img; fitGalaxy(); });

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(vp.clientWidth * dpr);
      canvas.height = Math.round(vp.clientHeight * dpr);
      view.dpr = dpr;
      draw();
    };
    view.resize = resize;
    new ResizeObserver(resize).observe(vp);

    const clamp = () => {
      const w = vp.clientWidth, h = vp.clientHeight, sw = STAGE * view.s;
      const minTx = Math.min(0, w - sw), minTy = Math.min(0, h - sw);
      if (sw <= w) view.tx = (w - sw) / 2; else view.tx = Math.max(minTx, Math.min(0, view.tx));
      if (sw <= h) view.ty = (h - sw) / 2; else view.ty = Math.max(minTy, Math.min(0, view.ty));
    };
    view.clamp = clamp;

    const zoomAt = (cx, cy, factor) => {
      const ns = Math.max(view.minS, Math.min(4, view.s * factor));
      const k = ns / view.s;
      view.tx = cx - (cx - view.tx) * k;
      view.ty = cy - (cy - view.ty) * k;
      view.s = ns; clamp(); schedule();
    };
    vp.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = vp.getBoundingClientRect();
      zoomAt(e.clientX - r.left, e.clientY - r.top, e.deltaY < 0 ? 1.18 : 1 / 1.18);
    }, { passive: false });

    let drag = null;
    vp.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.an-zoom')) return;
      drag = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty };
      vp.setPointerCapture(e.pointerId); vp.classList.add('grabbing');
    });
    vp.addEventListener('pointermove', (e) => {
      if (!drag) return;
      view.tx = drag.tx + (e.clientX - drag.x); view.ty = drag.ty + (e.clientY - drag.y);
      clamp(); schedule();
    });
    const endDrag = () => { drag = null; vp.classList.remove('grabbing'); };
    vp.addEventListener('pointerup', endDrag); vp.addEventListener('pointercancel', endDrag);

    host.querySelector('.an-zoom').addEventListener('click', (e) => {
      const z = e.target.dataset.z; if (!z) return;
      const r = vp.getBoundingClientRect();
      if (z === 'in') zoomAt(r.width / 2, r.height / 2, 1.4);
      else if (z === 'out') zoomAt(r.width / 2, r.height / 2, 1 / 1.4);
      else if (z === 'reset') { view.focus = null; fitGalaxy(); }
      else if (z === 'route') { view.focus = null; fitRoute(byName[orig.value], byName[dest.value]); }
    });

    // pincement (2 doigts)
    let pts = new Map(), pd = 0;
    vp.addEventListener('pointerdown', (e) => pts.set(e.pointerId, e));
    vp.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId)) return; pts.set(e.pointerId, e);
      if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
        if (pd) { const r = vp.getBoundingClientRect(); zoomAt((a.clientX + b.clientX) / 2 - r.left, (a.clientY + b.clientY) / 2 - r.top, d / pd); }
        pd = d; drag = null;
      }
    });
    const clearP = (e) => { pts.delete(e.pointerId); if (pts.size < 2) pd = 0; };
    vp.addEventListener('pointerup', clearP); vp.addEventListener('pointercancel', clearP);

    resize();
    return view;
  }

  function schedule() {
    if (!view || view.raf) return;
    view.raf = requestAnimationFrame(() => { view.raf = 0; draw(); });
  }

  // Une passe de dessin complète, en device pixels.
  function draw() {
    if (!view) return;
    const { ctx, canvas, dpr = 1, s, tx, ty } = view;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
    if (view.img) {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(view.img, 0, 0, CAL.size, CAL.size, tx, ty, STAGE * s, STAGE * s);
    }
    const K = (STAGE / CAL.size) * s; // px image → px écran
    const SP = (p) => { const im = posOf(p); return im ? [tx + im[0] * K, ty + im[1] * K] : null; };
    const o = view.o, dst = view.dst;
    const showLabel = s > (view.minS || 0.01) * 1.15;
    const label = (x, y, txt, col, size) => {
      ctx.font = `700 ${size}px Orbitron, system-ui, sans-serif`;
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(5,7,12,.9)'; ctx.lineJoin = 'round';
      ctx.strokeText(txt, x, y); ctx.fillStyle = col; ctx.fillText(txt, x, y);
    };
    if (LANES && (showLanes || showMinor)) {
      // polylignes de coordonnées à travers les systèmes de chaque route
      const LANE_COL = { 'Corellian Run': '#e6c66c', 'Voie Perlemienne': '#8fd0ff', 'Épine corellienne': '#f0a35c', 'Voie Hydienne': '#a0dc8a', 'Route de Rimma': '#d99bff' };
      const XY = ([X, Y]) => [tx + (CAL.cx + X * CAL.k) * K, ty + (CAL.cy - Y * CAL.k) * K];
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      for (const l of LANES) {
        if (l.major ? !showLanes : !showMinor) continue;
        const pts = l.pts; if (!pts || pts.length < 2) continue;
        ctx.strokeStyle = l.major ? (LANE_COL[l.name] || '#e6c66c') : '#9a86c9';
        ctx.lineWidth = l.major ? 2.6 : 1.3;
        ctx.globalAlpha = l.major ? 0.9 : 0.55;
        ctx.beginPath();
        pts.forEach((pt, i) => { const [x, y] = XY(pt); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
        ctx.stroke(); ctx.globalAlpha = 1;
        if (showLabel && l.major) { const [mx, my] = XY(pts[Math.floor(pts.length / 2)]); label(mx + 10, my - 6, l.name, LANE_COL[l.name] || '#e6c66c', 12); }
      }
    }
    // itinéraire calculé : segments colorés par classe (majeure/mineure/hors réseau)
    if (view.route && o && dst && o.name !== dst.name) {
      const XYc = ([X, Y]) => [tx + (CAL.cx + X * CAL.k) * K, ty + (CAL.cy - Y * CAL.k) * K];
      const SEG_STYLE = { major: ['#ffd76a', 3.4, []], minor: ['#c9a6ff', 3, []], off: ['#57c7ff', 2.6, [8, 6]] };
      ctx.lineCap = 'round';
      for (const seg of view.route.segs) {
        const [col, w2, dash] = SEG_STYLE[seg.cls];
        const [x1, y1] = XYc(seg.a), [x2, y2] = XYc(seg.b);
        ctx.setLineDash(dash); ctx.strokeStyle = col; ctx.lineWidth = w2; ctx.globalAlpha = 0.95;
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      }
      ctx.setLineDash([]); ctx.globalAlpha = 1;
    } else if (o && dst && o.name !== dst.name) {
      const po = SP(o), pd = SP(dst);
      if (po && pd) {
        ctx.setLineDash([8, 6]); ctx.strokeStyle = '#57c7ff'; ctx.lineWidth = 2.6;
        ctx.beginPath(); ctx.moveTo(po[0], po[1]); ctx.lineTo(pd[0], pd[1]); ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    for (const name of CAMPAIGN_ORDER) {
      const p = byName[name];
      if (!p || (o && p.name === o.name) || (dst && p.name === dst.name)) continue;
      const sp = SP(p); if (!sp) continue;
      ctx.fillStyle = '#d9b45b'; ctx.beginPath(); ctx.arc(sp[0], sp[1], 4.5, 0, 7); ctx.fill();
      if (showLabel) label(sp[0] + 9, sp[1] + 4, p.name, '#e6c66c', 13);
    }
    const marker = (p, col) => {
      const sp = SP(p); if (!sp) return;
      ctx.strokeStyle = col; ctx.lineWidth = 2.4; ctx.beginPath(); ctx.arc(sp[0], sp[1], 13, 0, 7); ctx.stroke();
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(sp[0], sp[1], 6, 0, 7); ctx.fill();
      if (showLabel) label(sp[0] + 18, sp[1] + 5, p.name, col, 15);
    };
    if (o) marker(o, '#6fbf8f');
    if (dst && dst.name !== (o && o.name)) marker(dst, '#57c7ff');
    // monde ciblé (📍 recherche/fiche) : réticule doré, indépendant du trajet
    const fp = view.focus;
    if (fp && (!o || fp.name !== o.name) && (!dst || fp.name !== dst.name)) {
      const sp = SP(fp);
      if (sp) {
        ctx.strokeStyle = '#ffd76a'; ctx.lineWidth = 2.2;
        ctx.beginPath(); ctx.arc(sp[0], sp[1], 16, 0, 7); ctx.stroke();
        ctx.beginPath(); ctx.arc(sp[0], sp[1], 5, 0, 7); ctx.fillStyle = '#ffd76a'; ctx.fill();
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          ctx.beginPath(); ctx.moveTo(sp[0] + dx * 20, sp[1] + dy * 20); ctx.lineTo(sp[0] + dx * 30, sp[1] + dy * 30); ctx.stroke();
        }
        label(sp[0] + 22, sp[1] - 14, fp.name, '#ffd76a', 15);
      }
    }
  }

  function fitBox(x0, y0, x1, y1, pad) {
    if (!view) return;
    const w = view.vp.clientWidth, h = view.vp.clientHeight;
    const f = STAGE / CAL.size;
    let bx = x0 * f - pad, by = y0 * f - pad, bw = (x1 - x0) * f + pad * 2, bh = (y1 - y0) * f + pad * 2;
    const s = Math.max(view.minS, Math.min(4, Math.min(w / bw, h / bh)));
    view.s = s;
    view.tx = (w - bw * s) / 2 - bx * s;
    view.ty = (h - bh * s) / 2 - by * s;
    view.clamp(); schedule();
  }
  function fitGalaxy() {
    if (!view) return;
    const w = view.vp.clientWidth, h = view.vp.clientHeight;
    view.minS = Math.min(w, h) / STAGE;
    view.s = view.minS; view.clamp(); schedule();
  }
  // Centre + zoome la carte sur un monde (recherche, fiche 📍) avec marqueur dédié.
  function focusPlanet(p) {
    if (!view || !p) return;
    const im = posOf(p); if (!im) return;
    view.focus = p;
    const R = 200; // demi-fenêtre en px image ≈ zoom secteur
    fitBox(im[0] - R, im[1] - R, im[0] + R, im[1] + R, 0);
    wrap.querySelector('#an-chart').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  function fitRoute(o, dst) {
    // cadre l'itinéraire complet (tous les segments), sinon la paire o/dst
    if (lastRoute && lastRoute.segs.length) {
      const px = lastRoute.segs.flatMap((s) => [s.a, s.b]).map(([X, Y]) => [CAL.cx + X * CAL.k, CAL.cy - Y * CAL.k]);
      const xs = px.map((p) => p[0]), ys = px.map((p) => p[1]);
      fitBox(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys), 300);
      return;
    }
    const a = o && posOf(o), b = dst && posOf(dst);
    if (!a || !b) return;
    fitBox(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1]), 700);
  }

  // conservé pour compat interne (toggle hyperroutes)
  function renderOverlay() { schedule(); }

  function drawChart(o, dst) {
    if (!view) setupMapViewer();
    view.o = o; view.dst = dst; view.route = lastRoute;
    if (o && dst && o.name !== dst.name) fitRoute(o, dst);
    else schedule();
  }

  function orbColor(p) { return REGION_COLOR[p.region] || '#556'; }
  function thumb(p) { return p.img ? `<img src="${esc(p.img)}" alt="${esc(p.name)}" loading="lazy" referrerpolicy="no-referrer">` : `<div class="an-orb" style="--oc:${orbColor(p)}">${esc(p.name[0])}</div>`; }
  function cardHTML(p) {
    return `<button class="an-pcard" data-name="${esc(p.name)}">
      <div class="an-thumb">${CAMPAIGN.has(p.name) ? `<span class="an-star">${p.poiVis === 'gm' ? '🔒' : '★'}</span>` : ''}${thumb(p)}</div>
      <div class="an-body"><h4>${esc(p.name)}</h4><div class="an-meta"><span class="an-coord">${esc(p.coord || '?')}</span>${p.sector ? `<span class="an-sectag">· ${esc(p.sector)}</span>` : ''}</div></div></button>`;
  }
  function renderLibrary() {
    const lib = wrap.querySelector('#an-library'), sub = wrap.querySelector('#an-libsub');
    const F = getFilters(), active = anyFilter(F);
    // sans filtre : mondes documentés ; avec filtre : tous les systèmes concernés
    const pool = active ? PLANETS.filter((p) => matchP(p, F))
      : PLANETS.filter((p) => p.desc || p.img || CAMPAIGN.has(p.name));
    sub.innerHTML = active
      ? `<strong>${pool.length.toLocaleString('fr')}</strong> système${pool.length > 1 ? 's' : ''} correspondent aux filtres.`
      : `Les mondes documentés (lore/image) sont affichés par région. Utilise les filtres ou la recherche pour explorer les ${total.toLocaleString('fr')} systèmes.`;
    const groups = {};
    for (const p of pool) (groups[p.region] = groups[p.region] || []).push(p);
    let html = '';
    const camp = pool.filter((p) => CAMPAIGN.has(p.name)).sort((a, b) => CAMPAIGN_ORDER.indexOf(a.name) - CAMPAIGN_ORDER.indexOf(b.name));
    if (camp.length) html += `<div class="an-regionblock"><h3><span class="an-dot" style="background:var(--gold)"></span>★ Campagne <span class="an-rcount">${camp.length}</span></h3><div class="an-grid">${camp.map(cardHTML).join('')}</div></div>`;
    for (const r of REGION_ORDER) {
      const list = (groups[r] || []).filter((p) => !CAMPAIGN.has(p.name)).sort((a, b) => (a.sector || '~').localeCompare(b.sector || '~', 'fr') || a.name.localeCompare(b.name, 'fr'));
      if (!list.length) continue;
      const shown = list.slice(0, 400);
      html += `<div class="an-regionblock"><h3><span class="an-dot" style="background:${REGION_COLOR[r] || '#889'}"></span>${esc(r)} <span class="an-rcount">${list.length} monde${list.length > 1 ? 's' : ''}${list.length > 400 ? ' · 400 affichés' : ''}</span></h3><div class="an-grid">${shown.map(cardHTML).join('')}</div></div>`;
    }
    lib.innerHTML = html || `<p class="muted">Aucun système ne correspond aux critères.</p>`;
    lib.querySelectorAll('.an-pcard').forEach((b) => b.addEventListener('click', () => openDetail(b.dataset.name)));
  }

  function openDetail(name) {
    const p = byName[name]; if (!p) return;
    const pts = (p.points && p.points.length) ? `<div class="an-pts"><div class="an-lab">Lieux importants</div><ul>${p.points.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : '';
    const camp = p.campaign ? `<div class="an-camp"><b>Campagne —</b> ${esc(p.campaign)}</div>` : '';
    const lanes = lanesOf(p.name);
    const laneHtml = lanes.length ? `<div class="an-lanes">↔ Sur : ${lanes.map(esc).join(' · ')}</div>` : '';
    const meta = [p.region, p.sector, p.star_system].filter(Boolean).map(esc).join(' · ');
    const FL = { climat: 'Climat', terrain: 'Terrain', population: 'Population', gravite: 'Gravité', diametre: 'Diamètre', jour: 'Rotation', annee: 'Révolution' };
    const facts = p.facts ? `<div class="an-facts">${Object.keys(FL).filter((k) => p.facts[k]).map((k) => `<div><span class="an-fk">${FL[k]}</span><span class="an-fv">${esc(p.facts[k])}</span></div>`).join('')}</div>` : '';
    const f = p.f || {};
    const badges = [];
    (f.aff || []).forEach((a) => badges.push(`🏳️ ${esc(a)}`));
    (f.clim || []).forEach((c) => badges.push(`${{ 'tempéré': '🌤️', aride: '🏜️', glacial: '❄️', tropical: '🌴', 'brûlant': '🌋', toxique: '☣️', 'océanique': '🌊', urbain: '🏙️', venteux: '🌪️', 'varié': '🗺️' }[c] || '·'} ${esc(c)}`));
    if (f.pop) badges.push(`👥 ${esc(f.pop)}`);
    if (f.faune) badges.push('🐾 faune');
    if (f.flore) badges.push('🌿 flore');
    const fbadges = badges.length ? `<div class="an-fbadges">${badges.map((b) => `<span class="an-fbadge">${b}</span>`).join('')}</div>` : '';
    const body = el('div', 'an-detail');
    body.innerHTML = `
      <div class="an-hero">${thumb(p)}<button class="an-close" aria-label="Fermer">✕</button></div>
      <div class="an-dbody"><h3>${esc(p.name)}</h3>
        <div class="an-sub"><span class="an-rchip" style="color:${REGION_COLOR[p.region] || '#889'}">${esc(p.region)}</span><span class="an-coord">grille ${esc(p.coord || '?')}</span>${p.terrain && !p.facts ? `<span>${esc(p.terrain)}</span>` : ''}</div>
        ${camp}${laneHtml}${fbadges}${facts}${p.desc ? `<p class="an-desc">${esc(p.desc)}</p>` : ''}
        ${meta && meta !== esc(p.region) ? `<p class="an-desc an-metaline">${meta}</p>` : ''}
        ${pts}
        <div class="an-acts"><button class="an-o" type="button">Définir origine</button><button class="an-d" type="button">Définir destination</button>
          <button class="an-map" type="button" title="Centrer la carte sur ce monde">📍 Carte</button>
          ${(Data.gm || getGMKey()) ? `<span class="an-poiseg" role="group" aria-label="Épingle du monde">
            <button type="button" data-v="off" title="Non épinglé">☆ Off</button>
            <button type="button" data-v="gm" title="Repérage privé — visible du MJ seulement">🔒 MJ</button>
            <button type="button" data-v="all" title="Épinglé pour les joueurs (Astronav + carte)">⭐ Tous</button>
          </span>` : ''}
        </div>
      </div>`;
    const ov = el('div', 'an-overlay');
    ov.appendChild(body);
    ov.addEventListener('click', (e) => { if (e.target === ov) ov.remove(); });
    body.querySelector('.an-close').addEventListener('click', () => ov.remove());
    body.querySelector('.an-o').addEventListener('click', () => { orig.value = p.name; compute(); ov.remove(); });
    body.querySelector('.an-d').addEventListener('click', () => { dest.value = p.name; compute(); ov.remove(); });
    body.querySelector('.an-map').addEventListener('click', () => { ov.remove(); focusPlanet(p); });
    // Épingle à 3 positions : ☆ off · 🔒 MJ seulement · ⭐ visible de tous.
    const seg = body.querySelector('.an-poiseg');
    const poiState = () => (!p.poi ? 'off' : (p.poiVis === 'gm' ? 'gm' : 'all'));
    const paintPoi = () => seg.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.v === poiState()));
    if (seg) { paintPoi(); seg.addEventListener('click', async (e) => {
      const next = e.target.closest('button')?.dataset.v;
      if (!next || next === poiState()) return;
      let note = p.campaign || '';
      if (poiState() === 'off') { note = window.prompt('Note (affichée avec l’épingle, optionnelle) :', note) ?? ''; }
      seg.classList.add('busy');
      try {
        const r = await fetch('/api/astro/poi', {
          method: 'PUT', credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json', ...(getGMKey() ? { 'x-gm-key': getGMKey() } : {}) },
          body: JSON.stringify({ name: p.name, note, vis: next === 'gm' ? 'gm' : 'all', on: next !== 'off' }),
        });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'échec');
        // état local immédiat : épingle + note + sélecteurs + carte
        p.poi = next !== 'off';
        p.poiVis = next === 'off' ? undefined : next;
        if (p.poi) { p.campaign = note || p.campaign; CAMPAIGN.add(p.name); if (!CAMPAIGN_ORDER.includes(p.name)) CAMPAIGN_ORDER.push(p.name); }
        else if (!(Data.config?.campaignPlanets || []).includes(p.name)) { CAMPAIGN.delete(p.name); const i = CAMPAIGN_ORDER.indexOf(p.name); if (i >= 0) CAMPAIGN_ORDER.splice(i, 1); delete p.campaign; }
        const ov2 = orig.value, dv2 = dest.value;
        fillSelects(); orig.value = ov2; dest.value = dv2;
        renderLibrary(); compute();
        paintPoi();
      } catch (err) {
        seg.classList.add('err'); seg.title = String(err.message).slice(0, 80);
        setTimeout(() => seg.classList.remove('err'), 2500);
      } finally { seg.classList.remove('busy'); }
    }); }
    document.body.appendChild(ov);
    const onKey = (e) => { if (e.key === 'Escape') { ov.remove(); document.removeEventListener('keydown', onKey); } };
    document.addEventListener('keydown', onKey);
  }
}
