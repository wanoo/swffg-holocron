// gm-quests.js — 🎯 graphe des quêtes du cockpit MJ. Lit /api/gm/quests (fiches
// Campaign Codex « quest » + liens unlocks/dépendances + layout éventuel du widget
// Quest Graph) et rend un graphe SVG : nœuds colorés par statut, arêtes dirigées
// « débloque », clic → fiche. Positions : celles du widget si posées, sinon
// disposition en couches par profondeur de dépendance.
import { apiBase, getGMKey } from './collab.js';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Palette alignée sur le widget Quest Graph (statuts) + or pour les quêtes épinglées.
// Exportée : le widget « Quêtes » de la home réutilise couleurs et libellés.
export const STATUS = {
  active: { color: '#57c7ff', label: 'Active' },
  completed: { color: '#3d8f5b', label: 'Terminée' },
  failed: { color: '#c0392b', label: 'Échouée' },
  inactive: { color: '#6b7686', label: 'Inactive' },
};

// Disposition en couches : profondeur = plus long chemin depuis une racine.
function layerLayout(quests) {
  const byId = new Map(quests.map((q) => [q.id, q]));
  const depth = new Map();
  const visiting = new Set();
  const depthOf = (id) => {
    if (depth.has(id)) return depth.get(id);
    if (visiting.has(id)) return 0; // cycle : coupe
    visiting.add(id);
    const q = byId.get(id);
    const deps = (q?.dependencies || []).filter((d) => byId.has(d));
    const d = deps.length ? 1 + Math.max(...deps.map(depthOf)) : 0;
    visiting.delete(id);
    depth.set(id, d);
    return d;
  };
  for (const q of quests) depthOf(q.id);
  const layers = new Map();
  for (const q of quests) {
    const d = depth.get(q.id) || 0;
    if (!layers.has(d)) layers.set(d, []);
    layers.get(d).push(q);
  }
  const pos = new Map();
  const COL_W = 240, ROW_H = 84;
  for (const [d, list] of [...layers.entries()].sort((a, b) => a[0] - b[0])) {
    list.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    list.forEach((q, i) => pos.set(q.id, { x: 40 + d * COL_W, y: 40 + i * ROW_H }));
  }
  return pos;
}

export async function mountGmQuests(main, cleanup = []) {
  main.innerHTML = `<div class="view-head"><h1>🎯 Quêtes</h1>
    <p class="muted">Graphe des quêtes Campaign Codex — flèche = « débloque ». Clic : ouvrir la fiche.</p></div>
    <p class="muted" id="gmq-status">Chargement…</p>`;
  let data = null;
  try {
    const r = await fetch(`${apiBase()}/gm/quests`, {
      credentials: 'same-origin',
      headers: getGMKey() ? { 'x-gm-key': getGMKey() } : {},
    });
    if (r.ok) data = await r.json();
  } catch { /* hors-ligne */ }
  const status = main.querySelector('#gmq-status');
  const quests = data?.quests || [];
  if (!quests.length) {
    status.innerHTML = 'Aucune quête. Créez des fiches <b>Campaign Codex « quête »</b> dans un dossier '
      + 'synchronisé (ex. 🎯 Quêtes) et liez-les entre elles (widget Quest Graph ou champs de la fiche).';
    return;
  }
  status.remove();

  // positions : widget Quest Graph si dispo, sinon couches automatiques
  const widgetPos = new Map();
  const lay = data.layout || {};
  for (const src of [lay.positions, lay.nodes]) {
    if (src && typeof src === 'object') {
      for (const [uuid, p] of Object.entries(src)) {
        const m = /JournalEntry\.([A-Za-z0-9]{16})/.exec(uuid) || [null, uuid];
        if (p && Number.isFinite(+p.x) && Number.isFinite(+p.y)) widgetPos.set(m[1], { x: +p.x, y: +p.y });
      }
    }
  }
  const auto = layerLayout(quests);
  const posOf = (id) => widgetPos.get(id) || auto.get(id) || { x: 40, y: 40 };

  const NODE_W = 190, NODE_H = 54;
  let maxX = 0, maxY = 0;
  for (const q of quests) { const p = posOf(q.id); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
  const W = maxX + NODE_W + 60, H = maxY + NODE_H + 60;

  const edges = [];
  const ids = new Set(quests.map((q) => q.id));
  for (const q of quests) {
    for (const to of q.unlocks || []) if (ids.has(to)) edges.push([q.id, to]);
    for (const from of q.dependencies || []) if (ids.has(from)) edges.push([from, q.id]);
  }
  const seen = new Set();
  const uniqEdges = edges.filter(([a, b]) => { const k = a + '>' + b; if (seen.has(k)) return false; seen.add(k); return true; });

  const edgeSvg = uniqEdges.map(([a, b]) => {
    const pa = posOf(a), pb = posOf(b);
    const x1 = pa.x + NODE_W, y1 = pa.y + NODE_H / 2, x2 = pb.x, y2 = pb.y + NODE_H / 2;
    const mx = (x1 + x2) / 2;
    return `<path d="M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}" class="gmq-edge" marker-end="url(#gmq-arrow)"/>`;
  }).join('');

  const nodeSvg = quests.map((q) => {
    const p = posOf(q.id);
    const st = STATUS[q.status] || STATUS.active;
    return `<g class="gmq-node${q.pinned ? ' pinned' : ''}" data-id="${esc(q.id)}" transform="translate(${p.x},${p.y})" tabindex="0" role="button">
      <rect width="${NODE_W}" height="${NODE_H}" rx="9" style="--st:${st.color}"/>
      <circle cx="14" cy="${NODE_H / 2}" r="5" fill="${st.color}"/>
      <text x="28" y="${NODE_H / 2 - 4}" class="gmq-name">${esc(q.name.length > 22 ? q.name.slice(0, 21) + '…' : q.name)}</text>
      <text x="28" y="${NODE_H / 2 + 14}" class="gmq-st">${st.label}${q.pinned ? ' · ★ principale' : ''}</text>
    </g>`;
  }).join('');

  const wrap = document.createElement('div');
  wrap.className = 'gmq-wrap';
  wrap.innerHTML = `
    <div class="gmq-legend">${Object.values(STATUS).map((s) => `<span><i style="background:${s.color}"></i>${s.label}</span>`).join('')}
      <span class="gmq-count">${quests.length} quêtes · ${uniqEdges.length} liens</span></div>
    <div class="gmq-scroll">
      <svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" class="gmq-svg" role="img" aria-label="Graphe des quêtes">
        <defs><marker id="gmq-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(87,199,255,0.7)"/></marker></defs>
        ${edgeSvg}${nodeSvg}
      </svg>
    </div>`;
  wrap.addEventListener('click', (e) => {
    const node = e.target.closest('.gmq-node');
    if (node) location.hash = `#/journal/${node.dataset.id}`;
  });
  main.appendChild(wrap);
  window.scrollTo(0, 0);
}
