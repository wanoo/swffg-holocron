// ship-view.js — vue « 🚀 Vaisseau » (#/vaisseau) : tout le vaisseau du groupe au
// même endroit — jauges (pool party-resources, /api/foundry/ship), position
// « vous êtes ici » (astronav), fiche technique de l'actor véhicule Foundry
// (/api/content/vehicle) et notes d'équipage (page Foundry configurable,
// /api/foundry/ship-notes, éditée via l'éditeur partagé /api/docs).
import { Data, foundryAsset } from './data.js';
import { getGMKey } from './collab.js';
import { bar, planetInfo } from './navicomputer.js';
import { renderJournalHTML } from './render-journal.js';
import { mountEditablePage } from './editor.js';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function hdrs() {
  const h = {};
  if (getGMKey()) h['x-gm-key'] = getGMKey();
  const key = localStorage.getItem('holocron-table-key');
  if (key && !Data.me) h['x-player-key'] = key;
  return h;
}
async function getJSON(path) {
  try {
    const r = await fetch('/api' + path, { credentials: 'same-origin', headers: hdrs() });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

const ARC_FR = { fore: 'avant', aft: 'arrière', port: 'bâbord', starboard: 'tribord', dorsal: 'dorsal', ventral: 'ventral' };

// Jauges + hyperdrive + actions rapides (le pool live prime, comme sur le deck Foundry).
function gaugesHTML(ship) {
  return bar('Vivres', '🥫', ship.vivres, ship.vivresMax, '#6fbf8f')
    + bar('Carburant', '⛽', ship.fuel, ship.fuelMax, '#57c7ff')
    + bar('Usure', '🔧', ship.usure, 100, ship.usure > 80 ? '#e5544b' : ship.usure > 50 ? '#e0975c' : '#8ad17a', { pctOnly: true })
    + `<p class="nc-hint">Hyperdrive ×${ship.hyper}</p>`;
}

function techHTML(v) {
  const chip = (label, value) => (value === '' || value == null) ? '' : `<div class="shipv-stat"><small>${esc(label)}</small><b>${esc(value)}</b></div>`;
  const defence = `${v.defence.fore}/${v.defence.port}/${v.defence.starboard}/${v.defence.aft}`;
  const weapons = (v.weapons || []).map((w) => `
    <tr>
      <td>${esc(w.name)}</td>
      <td>${esc((w.firingArc || []).map((a) => ARC_FR[a] || a).join(', ') || '—')}</td>
      <td>${w.damage || '—'}</td>
      <td>${w.crit || '—'}</td>
      <td>${esc(w.range || '—')}</td>
      <td>${esc((w.qualities || []).map((q) => q.name + (q.rank > 1 ? ` ${q.rank}` : '')).join(', ') || '—')}</td>
    </tr>`).join('');
  const attachments = (v.attachments || []).map((a) => `<li><b>${esc(a.name)}</b>${a.hardpoints ? ` <small>(${a.hardpoints} PD)</small>` : ''}</li>`).join('');
  return `
    <div class="shipv-stats">
      ${chip('Silhouette', v.silhouette)}
      ${chip('Vitesse', v.speed.max ? `${v.speed.value}/${v.speed.max}` : v.speed.value)}
      ${chip('Maniabilité', (v.handling >= 0 ? '+' : '') + v.handling)}
      ${chip('Armure', v.armour)}
      ${chip('Coque', `${v.hullTrauma.value} / ${v.hullTrauma.max}`)}
      ${chip('Tension système', `${v.systemStrain.value} / ${v.systemStrain.max}`)}
      ${chip('Défense Av/Bâ/Tri/Ar', defence)}
      ${chip('Senseurs', v.sensorRange)}
      ${chip('Passagers', v.passengers || '')}
      ${chip('Encombrement', v.encumbrance.max ? `${v.encumbrance.value} / ${v.encumbrance.max}` : '')}
      ${chip('Consommables', v.consumables.duration || v.consumables.value || '')}
      ${chip('Points durs', v.hardPoints || '')}
      ${chip('Hyperdrive', `×${v.hyperdrive}`)}
    </div>
    ${weapons ? `<h3 class="sheet-section-title">Armement</h3>
    <div class="table-scroll"><table class="sheet-table">
      <thead><tr><th>Arme</th><th>Arc</th><th>Dég.</th><th>Crit.</th><th>Portée</th><th>Qualités</th></tr></thead>
      <tbody>${weapons}</tbody>
    </table></div>` : ''}
    ${attachments ? `<h3 class="sheet-section-title">Attachements</h3><ul class="shipv-attach">${attachments}</ul>` : ''}`;
}

export async function mountShipView(container, cleanupEditors = []) {
  container.innerHTML = '<div class="view-head"><h1>🚀 Vaisseau</h1><p class="muted">Chargement du hangar…</p></div>';
  const [shipRes, vehicle, notes] = await Promise.all([
    getJSON('/foundry/ship'),
    getJSON('/content/vehicle'),
    getJSON('/foundry/ship-notes'),
  ]);
  const ship = shipRes?.ship || null;
  const pl = ship ? await planetInfo(ship.lastTo) : null;
  const name = vehicle?.name || ship?.name || 'Vaisseau du groupe';
  const canAct = Boolean(Data.me || getGMKey());

  const wrap = document.createElement('div');
  wrap.className = 'shipv';
  wrap.innerHTML = `
    <div class="view-head shipv-head">
      ${vehicle?.img ? `<span class="shipv-img" style="background-image:url('${esc(foundryAsset(vehicle.img))}')"></span>` : ''}
      <div><h1>🚀 ${esc(name)}</h1>
      <p class="muted">Vaisseau du groupe — état, position, fiche technique et notes d'équipage.</p></div>
    </div>
    <div class="shipv-grid">
      <div class="nc-panel">
        <p class="nc-eyebrow">📊 État & ressources du groupe</p>
        <div id="shipv-gauges">${ship ? gaugesHTML(ship) : '<p class="muted">État indisponible (pont Foundry hors-ligne).</p>'}</div>
        ${ship && canAct ? `<div class="shipv-actions">
          <button class="shipv-btn" data-act="refuel" title="Vivres au maximum">🥫 Ravitailler</button>
          <button class="shipv-btn" data-act="fuel" title="Carburant au maximum">⛽ Faire le plein</button>
          <button class="shipv-btn" data-act="repair" title="Usure remise à zéro">🔧 Réparer</button>
        </div>` : ''}
      </div>
      <div class="nc-panel nc-loc">
        <p class="nc-eyebrow">📍 Vous êtes ici</p>
        <div class="nc-planet"${pl && pl.img ? ` style="background-image:url('${esc(pl.img)}')"` : ''}>${(pl && pl.img) ? '' : '<span>?</span>'}</div>
        <h3>${esc(ship?.lastTo || 'Position inconnue')}</h3>
        ${pl ? `<small>${esc(pl.region || '')}${pl.sector ? ' · ' + esc(pl.sector) : ''}</small>` : '<small>Applique un voyage (Astronav) pour la définir</small>'}
        ${ship?.lastFrom ? `<small class="shipv-from">Dernier trajet : ${esc(ship.lastFrom)} → ${esc(ship.lastTo)}</small>` : ''}
        <a class="hr-cta" href="#/navicomputer">Ouvrir le Navi-Computer →</a>
      </div>
    </div>
    ${vehicle ? `<section class="nc-panel shipv-tech"><p class="nc-eyebrow">🛠️ Fiche technique</p>${techHTML(vehicle)}</section>`
      : '<section class="nc-panel shipv-tech"><p class="muted">Aucune fiche véhicule trouvée dans le dossier des PJ.</p></section>'}
    <section class="chapter page-surface shipv-notes">
      <h3 class="sheet-section-title">📓 Notes d'équipage</h3>
      <div class="journal-content" id="shipv-notes"></div>
    </section>`;

  // Actions rapides (mêmes actions que le deck Foundry, loguées au chat).
  for (const btn of wrap.querySelectorAll('[data-act]')) {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        const r = await fetch('/api/foundry/ship', {
          method: 'POST', credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json', ...hdrs() },
          body: JSON.stringify({ action: btn.dataset.act }),
        });
        const out = await r.json();
        if (out.ship) wrap.querySelector('#shipv-gauges').innerHTML = gaugesHTML(out.ship);
      } catch { /* pont indisponible */ }
      btn.disabled = false;
    });
  }

  // Notes : page Foundry configurée (journals.shipNotes) — éditable si l'ownership le permet.
  const notesEl = wrap.querySelector('#shipv-notes');
  if (!notes) {
    notesEl.innerHTML = '<p class="muted">Aucune page de notes configurée (<code>journals.shipNotes</code> dans ⚙️ Holocron Config).</p>';
  } else if (notes.syncing) {
    notesEl.innerHTML = '<p class="muted">Synchronisation de la page de notes… recharge dans quelques secondes.</p>';
  } else if (notes.editable) {
    cleanupEditors.push(mountEditablePage(notesEl, { id: notes.id, name: notes.name, html: notes.html }, {
      available: true,
      initial: { html: notes.html, updatedAt: notes.updatedAt, updatedBy: notes.updatedBy },
    }));
  } else {
    renderJournalHTML(notesEl, notes.html);
  }

  container.innerHTML = '';
  container.appendChild(wrap);
  window.scrollTo(0, 0);
  document.title = `${name} — Archive Holocron`;
}
