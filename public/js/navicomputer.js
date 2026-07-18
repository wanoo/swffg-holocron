// navicomputer.js — page « Poste de commande » (#/navicomputer) : tableau de bord
// lisible (allégeance, vaisseau, équipage, alignement PNJ, HoloNet) à gauche +
// l'Astronav interactif à droite. Lit l'état du vaisseau depuis Foundry (pont).
import { Data , foundryAsset } from './data.js';
import { getGMKey } from './collab.js';
import { mountAstronav } from './astronav.js';
import { STATUT } from './statut.js';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const SHIP_DEFAULTS = { name: 'Vaisseau du groupe', vivres: 60, vivresMax: 60, fuel: 30, fuelMax: 30, usure: 0, hyper: 1, lastTo: '' };

// --- tableau de bord : les données Foundry (SSOT) réaffichées par l'Holocron -----
// codex (allégeance/PJ/PNJ), HoloNet, vaisseau — via /api/(gm/)foundry/dash.
// Repli hors-ligne : données statiques du site + localStorage.
// Exporté : le widget « Synthèse » du tableau de bord (#/) le réutilise.
export async function fetchDash() {
  const gm = getGMKey() || Data.gm; // clé de secours OU session MJ Foundry
  try {
    if (gm) {
      const r = await fetch('/api/gm/foundry/dash', { credentials: 'same-origin', headers: getGMKey() ? { 'x-gm-key': getGMKey() } : {} });
      if (r.ok) return { ...(await r.json()), _src: 'Foundry (MJ)' };
    }
    const key = localStorage.getItem('holocron-table-key');
    if (key || Data.me) {
      const r = await fetch('/api/foundry/dash', { headers: key && !Data.me ? { 'x-player-key': key } : {}, credentials: 'same-origin' });
      if (r.ok) return { ...(await r.json()), _src: 'Foundry' };
    }
  } catch { /* réseau/pont indispo */ }
  let ship = null;
  try { ship = JSON.parse(localStorage.getItem('holocron-ship') || 'null'); } catch { /* noop */ }
  return { codex: null, holonet: '', ship, _src: 'local' };
}

// Fiche planète (image + région) depuis planets.json (mis en cache, partagé avec l'Astronav).
let PLANETS = null;
export async function planetInfo(name) {
  if (!name) return null;
  if (!PLANETS) {
    try {
      const raw = await (await fetch('data/planets.json')).json();
      const list = Array.isArray(raw) ? raw : (raw.planets || raw.systems || Object.values(raw)[0]);
      PLANETS = {};
      for (const p of list) PLANETS[p.name] = p;
    } catch { PLANETS = {}; }
  }
  return PLANETS[name] || null;
}

export function bar(label, icon, val, max, color, opts = {}) {
  const pct = Math.max(0, Math.min(100, (val / (max || 1)) * 100));
  const txt = opts.pctOnly ? `${Math.round(val)}%` : `${val} / ${max}`;
  return `<div class="nc-stat">
    <div class="nc-stat-h"><span>${icon} ${esc(label)}</span><b>${txt}</b></div>
    <div class="nc-track"><div class="nc-fill" style="width:${pct}%;background:${color}"></div></div>
  </div>`;
}

async function renderDash(host) {
  const dash = await fetchDash();
  const remote = dash._src !== 'local';
  const ship = { ...SHIP_DEFAULTS, ...(dash.ship || {}) };
  const codex = dash.codex;
  const alleg = (codex && codex.allegiance) || localStorage.getItem('holocron-allegiance') || 'Ordre Jedi — survivants de l’Ordre 66';

  // équipage : codex Foundry si dispo (SSOT), sinon données statiques du site
  const nameById = new Map((Data.pcs || []).map((p) => [p.name, p.id]));
  const crewSrc = (codex && codex.pcs && codex.pcs.length)
    ? codex.pcs.map((p) => ({ ...p, id: nameById.get(p.name) }))
    : (Data.pcs || []).map((p) => ({ name: p.name, species: p.species, career: p.career, img: p.img, id: p.id }));
  const pcCards = crewSrc.map((p) => `
    <a class="nc-crew" href="${p.id ? `#/pc/${p.id}` : '#/navicomputer'}" title="${esc(p.name)}">
      <span class="nc-ava"${p.img ? ` style="background-image:url('${esc(foundryAsset(p.img))}')"` : ''}></span>
      <span class="nc-crew-n">${esc(p.name)}</span>
      <small>${esc(p.species || '')}${p.career ? ' · ' + esc(p.career) : ''}</small>
    </a>`).join('');

  // alignement : codex Foundry (SSOT) si dispo, sinon journaux statiques typés
  const npcSrc = (codex && codex.npcs && codex.npcs.length)
    ? codex.npcs
    : (Data.journals || []).filter((j) => j.statut && STATUT[j.statut]).map((j) => ({ name: j.name, statut: j.statut, mort: j.mort, id: j.id }));
  const camp = { allie: [], mentor: [], neutre: [], ennemi: [] };
  for (const n of npcSrc) (camp[n.statut] || camp.neutre).push(n);
  const jByName = new Map((Data.journals || []).map((j) => [j.name, j.id]));
  const chip = (n) => {
    const c = STATUT[n.statut] || STATUT.neutre;
    const jid = n.id || jByName.get(n.name);
    const inner = `${esc(n.name)}${n.mort ? ' †' : ''}`;
    return jid
      ? `<a class="nc-npc${n.mort ? ' dead' : ''}" href="#/journal/${jid}" style="--sc:${c.color}" title="${esc(c.label)}">${inner}</a>`
      : `<span class="nc-npc${n.mort ? ' dead' : ''}" style="--sc:${c.color}" title="${esc(c.label)}">${inner}</span>`;
  };
  const colList = (arr, title) => `<div class="nc-camp"><p class="nc-camp-t">${title} <b>${arr.length}</b></p><div class="nc-npcs">${arr.map(chip).join('') || '<span class="nc-empty">—</span>'}</div></div>`;

  // HoloNet : contenu du journal Foundry (SSOT) si dispo, sinon résumés d'actes du site
  const recaps = (Data.journals || []).filter((j) => /^recap-acte-\d+$/.test(j.id))
    .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
  const last = recaps[recaps.length - 1];
  const news = dash.holonet
    ? `<li class="nc-holonet-body">${dash.holonet}</li>`
    : (recaps.slice(-3).reverse().map((j) => `<li><a href="#/journal/${j.id}">${esc(j.name)}</a></li>`).join('')
      || '<li class="nc-empty">Aucune dépêche.</li>');

  const pl = await planetInfo(ship.lastTo);

  host.innerHTML = `
    <div class="nc-panel nc-alleg">
      <div class="nc-emblem">◈</div>
      <div><p class="nc-eyebrow">Allégeance du groupe${!remote && (getGMKey() || Data.gm) ? ' <button class="nc-edit" id="nc-alleg-edit" title="Modifier">✎</button>' : ''}</p>
        <h2 id="nc-alleg-name">${esc(alleg)}</h2></div>
    </div>

    <div class="nc-row2">
      <div class="nc-panel nc-ship">
        <p class="nc-eyebrow">🚀 ${esc(ship.name)} <span class="nc-src">${remote ? '🛰️ ' : '💾 '}${esc(dash._src)}</span></p>
        ${bar('Vivres', '🥫', ship.vivres, ship.vivresMax, '#6fbf8f')}
        ${bar('Carburant', '⛽', ship.fuel, ship.fuelMax, '#57c7ff')}
        ${bar('Usure', '🔧', ship.usure, 100, ship.usure > 80 ? '#e5544b' : ship.usure > 50 ? '#e0975c' : '#8ad17a', { pctOnly: true })}
        <p class="nc-hint">Hyperdrive ×${ship.hyper}</p>
      </div>
      <div class="nc-panel nc-loc">
        <p class="nc-eyebrow">📍 Position actuelle</p>
        <div class="nc-planet"${pl && pl.img ? ` style="background-image:url('${esc(pl.img)}')"` : ''}>${(pl && pl.img) ? '' : '<span>?</span>'}</div>
        <h3>${esc(ship.lastTo || 'Inconnue')}</h3>
        ${pl ? `<small>${esc(pl.region || '')}${pl.sector ? ' · ' + esc(pl.sector) : ''}</small>` : '<small>Applique un voyage pour la définir</small>'}
      </div>
    </div>

    <div class="nc-panel nc-codex">
      <p class="nc-eyebrow">👤 Codex de l’équipage — ${Data.pcs.length} PJ</p>
      <div class="nc-crews">${pcCards || '<span class="nc-empty">Aucun PJ.</span>'}</div>
    </div>

    <div class="nc-row2">
      <div class="nc-panel nc-align">
        <p class="nc-eyebrow">🕸️ Alignement des personnages</p>
        <div class="nc-axis"><span>Alliés</span><span>Neutres</span><span>Ennemis</span></div>
        <div class="nc-aligncols">
          ${colList(camp.allie.concat(camp.mentor), '🟢 Alliés / Mentors')}
          ${colList(camp.neutre, '⚪ Neutres')}
          ${colList(camp.ennemi, '🔴 Ennemis')}
        </div>
      </div>
      <div class="nc-panel nc-holo">
        <p class="nc-eyebrow">📡 HoloNet</p>
        <ul class="nc-news">${news}</ul>
        ${last ? `<div class="nc-lastnote"><p class="nc-eyebrow">Dernière note</p><a href="#/journal/${last.id}">${esc(last.name)} →</a></div>` : ''}
      </div>
    </div>`;

  const edit = host.querySelector('#nc-alleg-edit');
  if (edit) edit.addEventListener('click', (e) => {
    e.preventDefault();
    const v = window.prompt('Allégeance du groupe :', alleg);
    if (v != null) { localStorage.setItem('holocron-allegiance', v.trim()); host.querySelector('#nc-alleg-name').textContent = v.trim(); }
  });
}

export async function mountNaviComputer(container) {
  container.innerHTML = `
    <div class="view-head nc-head"><h1>🖥️ Navi-Computer</h1><p class="muted">Poste de commande du groupe — état du vaisseau, équipage et carte galactique.</p></div>
    <div class="nc-wrap">
      <aside class="nc-dash" id="nc-dash"><p class="muted" style="padding:1rem">Chargement du poste de commande…</p></aside>
      <section class="nc-astro" id="nc-astro"></section>
    </div>`;
  // dashboard (asynchrone) + Astronav à droite (réutilise le composant existant)
  renderDash(container.querySelector('#nc-dash'));
  try { await mountAstronav(container.querySelector('#nc-astro')); } catch (e) {
    container.querySelector('#nc-astro').innerHTML = `<p class="muted" style="padding:1rem">Astronav indisponible : ${esc(e.message)}</p>`;
  }
}
