// gm-campaign.js — 🗺️ Éditeur de campagne (cockpit MJ, #/mj/campagne).
// Carte pan-zoom SVG des objets de la campagne (actes, quêtes, PNJ, orgs,
// lieux, boutiques Campaign Codex, séquences de handouts) : arêtes AUTO tirées
// des liens CC (associates, linkedNPCs, linkedLocations, parentRegion,
// unlocks/dépendances de quêtes) + LIENS CUSTOM tracés à la souris.
// Persistance : flags.holocron.board du journal technique (GET/PUT /api/gm/board).
import { apiBase, getGMKey } from './collab.js';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };

export const NODE_TYPES = {
  acte: { icon: '🎬', label: 'Acte', plural: 'Actes', color: '#d9a54f' },
  quest: { icon: '🎯', label: 'Quête', plural: 'Quêtes', color: '#57c7ff' },
  npc: { icon: '👤', label: 'PNJ', plural: 'PNJ', color: '#7bd88f' },
  group: { icon: '🏛️', label: 'Organisation', plural: 'Organisations', color: '#c792ea' },
  location: { icon: '🌍', label: 'Lieu', plural: 'Lieux', color: '#f78c6c' },
  shop: { icon: '🏪', label: 'Boutique', plural: 'Boutiques', color: '#ffd166' },
  seq: { icon: '🎞️', label: 'Séquence', plural: 'Séquences', color: '#e06c9f' },
};
const NODE_W = 180, NODE_H = 46;

// Relations custom TYPÉES — miroir de la table fermée serveur (board.mjs) :
// libellé aller (fwd) affiché sur la carte, retour (back) selon le sens de
// lecture dans la fiche d'identité. Un libellé libre reste prioritaire.
export const EDGE_TYPES = {
  lien: { fwd: 'lié à', back: 'lié à' },
  revele: { fwd: 'révèle', back: 'révélé par' },
  mene: { fwd: 'mène à', back: 'accessible depuis' },
  allie: { fwd: 'allié de', back: 'allié de' },
  oppose: { fwd: 's’oppose à', back: 'visé par' },
  dette: { fwd: 'doit une dette à', back: 'créancier de' },
  membre: { fwd: 'membre de', back: 'compte dans ses rangs' },
  possede: { fwd: 'possède', back: 'appartient à' },
};
const edgeLabel = (e) => e.label || (EDGE_TYPES[e.type]?.fwd ?? '');

async function api(path, opts = {}) {
  const res = await fetch(`${apiBase()}${path}`, {
    credentials: 'same-origin',
    ...opts,
    headers: { ...(getGMKey() ? { 'x-gm-key': getGMKey() } : {}), 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

// Image d'une fiche : les visuels de campagne peuvent être des spoilers → proxy
// MJ gated (même logique que les illustrations de la bible, cookie/clé).
function gmAssetUrl(path) {
  if (!path) return '';
  if (/^(https?:|data:)/.test(path)) return path;
  const key = getGMKey();
  return 'api/gm/asset/' + String(path).replace(/^\//, '').split('/').map(encodeURIComponent).join('/')
    + (key ? '?k=' + encodeURIComponent(key) : '');
}

export async function mountGmCampaign(main, cleanup = []) {
  main.innerHTML = `<div class="view-head"><h1>🗺️ Campagne</h1>
    <p class="muted">Carte de campagne — relie actes, quêtes, PNJ, organisations et lieux.
    Glisse un nœud pour le placer, tire depuis sa poignée ◈ pour créer un lien. Clic : fiche d'identité · double-clic : ouvrir.</p></div>
    <p class="muted" id="gmc-status">Chargement…</p>`;

  let data;
  try { data = await api('/gm/board'); }
  catch (e) { main.querySelector('#gmc-status').textContent = `⚠️ ${e.message}`; return; }
  main.querySelector('#gmc-status').remove();

  /* ------------------------------------------------------------------ état -- */
  const state = {
    board: data.board || { nodes: {}, edges: [], hidden: [] },
    catalog: data.catalog || { nodes: [], edges: [] },
    sequences: data.sequences || [],
    selected: null,        // { kind: 'node'|'edge', id | index }
    linkFrom: null,        // id du nœud d'origine pendant un tracé de lien
    view: { x: 20, y: 20, k: 1 },
    // lentilles d'affichage (non persistées) : types de nœuds, familles d'arêtes,
    // « MJ-only » (fiches invisibles des joueurs), « orphelins » (aucune arête).
    filters: { types: new Set(Object.keys(NODE_TYPES)), auto: true, custom: true, mjOnly: false, orphans: false },
  };
  const catById = new Map(state.catalog.nodes.map((n) => [n.id, n]));
  const seqById = () => new Map(state.sequences.map((s) => ['seq:' + s.id, s]));

  // Méta d'un nœud posé sur la carte (catalogue, séquence, ou fantôme d'un objet disparu).
  function nodeMeta(id) {
    if (id.startsWith('seq:')) {
      const s = seqById().get(id);
      return s ? { id, name: s.name, type: 'seq', img: s.items[0]?.src || null }
        : { id, name: '(séquence supprimée)', type: 'seq', ghost: true };
    }
    return catById.get(id) || { id, name: '(objet disparu)', type: 'quest', ghost: true };
  }
  const placed = () => Object.keys(state.board.nodes);

  /* ----------------------------------------------------- sauvegarde (debounce) */
  let saveTimer = null;
  let saveState = 'idle';
  function scheduleSave(now = false) {
    paintSaveDot('dirty');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(doSave, now ? 0 : 900);
  }
  async function doSave() {
    paintSaveDot('saving');
    try {
      // NE PAS remplacer state.board par la réponse : les panneaux ouverts tiennent
      // des références vives sur ses objets (éditeur de lien…) — l'assainissement
      // serveur s'applique de toute façon au prochain chargement.
      await api('/gm/board', { method: 'PUT', body: JSON.stringify(state.board) });
      paintSaveDot('saved');
    } catch (e) { paintSaveDot('error', e.message); }
  }
  cleanup.push(() => { clearTimeout(saveTimer); if (saveState === 'dirty') doSave(); });

  /* ---------------------------------------------------------------- layout -- */
  const wrap = el('div', 'gmc-wrap');
  const canvasBox = el('div', 'gmc-canvas');
  const side = el('aside', 'gmc-side');
  wrap.append(canvasBox, side);
  main.appendChild(wrap);

  // Légende = barre de LENTILLES : chaque pastille de type se (dés)active au clic ;
  // toggles arêtes CC / liens custom / 🙈 MJ-only / ⭘ orphelins.
  const legend = el('div', 'gmc-legend');
  canvasBox.appendChild(legend);
  function paintLegend() {
    const f = state.filters;
    legend.innerHTML = Object.entries(NODE_TYPES)
      .map(([k, t]) => `<button type="button" class="gmc-lens${f.types.has(k) ? '' : ' off'}" data-lens-type="${k}"
        title="Afficher/masquer les ${t.plural}"><i style="background:${t.color}"></i>${t.icon} ${t.label}</button>`).join('')
      + `<button type="button" class="gmc-lens${f.auto ? '' : ' off'}" data-lens="auto" title="Arêtes dérivées des liens Campaign Codex">— liens CC</button>`
      + `<button type="button" class="gmc-lens${f.custom ? '' : ' off'}" data-lens="custom" title="Liens tracés à la main">┄ custom</button>`
      + `<button type="button" class="gmc-lens strict${f.mjOnly ? ' on' : ''}" data-lens="mjOnly" title="Ne montrer que les fiches INVISIBLES des joueurs">🙈 MJ-only</button>`
      + `<button type="button" class="gmc-lens strict${f.orphans ? ' on' : ''}" data-lens="orphans" title="Ne montrer que les nœuds sans aucune arête">⭘ orphelins</button>`
      + '<span class="gmc-save" id="gmc-save" title="État de sauvegarde">●</span>';
    paintSaveDot(saveState); // le point de sauvegarde vient d'être recréé
  }
  paintLegend();
  legend.addEventListener('click', (ev) => {
    const b = ev.target.closest('.gmc-lens');
    if (!b) return;
    const f = state.filters;
    if (b.dataset.lensType) {
      const k = b.dataset.lensType;
      f.types.has(k) ? f.types.delete(k) : f.types.add(k);
    } else if (b.dataset.lens) f[b.dataset.lens] = !f[b.dataset.lens];
    paintLegend();
    paint();
  });
  function paintSaveDot(st, msg) {
    saveState = st;
    const dot = canvasBox.querySelector('#gmc-save');
    if (!dot) return;
    dot.dataset.state = st;
    dot.title = { idle: 'À jour', dirty: 'Modifications en attente…', saving: 'Enregistrement…', saved: 'Enregistré ✓', error: `⚠️ ${msg || 'échec'}` }[st] || '';
  }

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'gmc-svg');
  svg.innerHTML = `<defs>
      <marker id="gmc-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(150,170,190,0.75)"/></marker>
      <marker id="gmc-arrow-custom" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(217,165,79,0.9)"/></marker>
    </defs><g class="gmc-root"><g class="gmc-edges"></g><g class="gmc-temp"></g><g class="gmc-nodes"></g></g>`;
  canvasBox.appendChild(svg);
  const root = svg.querySelector('.gmc-root');
  const edgesG = svg.querySelector('.gmc-edges');
  const nodesG = svg.querySelector('.gmc-nodes');
  const tempG = svg.querySelector('.gmc-temp');

  const applyView = () => root.setAttribute('transform', `translate(${state.view.x},${state.view.y}) scale(${state.view.k})`);
  applyView();

  // point écran → coordonnées monde de la carte
  function toWorld(ev) {
    const r = svg.getBoundingClientRect();
    return { x: (ev.clientX - r.left - state.view.x) / state.view.k, y: (ev.clientY - r.top - state.view.y) / state.view.k };
  }

  /* ----------------------------------------------------------------- rendu -- */
  const anchor = (id) => {
    const n = state.board.nodes[id];
    return n ? { x: n.x + NODE_W / 2, y: n.y + NODE_H / 2 } : null;
  };
  function edgePath(a, b) {
    const mx = (a.x + b.x) / 2;
    return `M ${a.x} ${a.y} C ${mx} ${a.y}, ${mx} ${b.y}, ${b.x} ${b.y}`;
  }

  // Ids visibles selon les lentilles actives (types, MJ-only, orphelins).
  function visibleIds() {
    const f = state.filters;
    const all = placed();
    const ids = new Set(all.filter((id) => {
      const m = nodeMeta(id);
      if (!f.types.has(m.type) && !m.ghost) return false;
      if (f.mjOnly && m.playerVisible !== false) return false;
      return true;
    }));
    if (f.orphans) {
      const linked = new Set();
      for (const e of state.catalog.edges) if (ids.has(e.from) && ids.has(e.to)) { linked.add(e.from); linked.add(e.to); }
      for (const e of state.board.edges) if (ids.has(e.from) && ids.has(e.to)) { linked.add(e.from); linked.add(e.to); }
      for (const id of [...ids]) if (linked.has(id)) ids.delete(id);
    }
    return ids;
  }

  function paint() {
    const ids = visibleIds();
    // arêtes AUTO (liens CC) entre nœuds posés
    let eh = '';
    if (state.filters.auto) {
      for (const e of state.catalog.edges) {
        if (!ids.has(e.from) || !ids.has(e.to)) continue;
        const a = anchor(e.from), b = anchor(e.to);
        eh += `<g class="gmc-edge auto"><path d="${edgePath(a, b)}" marker-end="url(#gmc-arrow)"><title>${esc(e.rel)}</title></path></g>`;
      }
    }
    // liens CUSTOM du MJ
    if (state.filters.custom) {
      state.board.edges.forEach((e, i) => {
        if (!ids.has(e.from) || !ids.has(e.to)) return;
        const a = anchor(e.from), b = anchor(e.to);
        const sel = state.selected?.kind === 'edge' && state.selected.index === i;
        const lbl = edgeLabel(e);
        eh += `<g class="gmc-edge custom${sel ? ' selected' : ''}" data-edge="${i}">
          <path class="hit" d="${edgePath(a, b)}"></path>
          <path d="${edgePath(a, b)}" marker-end="url(#gmc-arrow-custom)"></path>
          ${lbl ? `<text x="${(a.x + b.x) / 2}" y="${(a.y + b.y) / 2 - 6}" class="gmc-edge-lbl">${esc(lbl)}</text>` : ''}
        </g>`;
      });
    }
    edgesG.innerHTML = eh;

    // nœuds (data-type = accroche des lentilles/CSS)
    let nh = '';
    for (const id of ids) {
      const p = state.board.nodes[id];
      const m = nodeMeta(id);
      const t = NODE_TYPES[m.type] || NODE_TYPES.quest;
      const sel = state.selected?.kind === 'node' && state.selected.id === id;
      const name = m.name.length > 20 ? m.name.slice(0, 19) + '…' : m.name;
      const gmOnly = m.playerVisible === false;
      nh += `<g class="gmc-node${sel ? ' selected' : ''}${m.ghost ? ' ghost' : ''}${p.pinned ? ' pinned' : ''}${gmOnly ? ' gm-only' : ''}"
          data-id="${esc(id)}" data-type="${esc(m.type)}" transform="translate(${p.x},${p.y})" tabindex="0" role="button" aria-label="${esc(m.name)}">
        <rect width="${NODE_W}" height="${NODE_H}" rx="9" style="--tc:${t.color}"/>
        <text x="12" y="${NODE_H / 2 - 3}" class="gmc-ico">${t.icon}</text>
        <text x="36" y="${NODE_H / 2 - 3}" class="gmc-name">${esc(name)}</text>
        <text x="36" y="${NODE_H / 2 + 13}" class="gmc-type">${t.label}${m.statut ? ' · ' + esc(m.statut) : ''}${m.mort ? ' · ✝' : ''}${p.sound ? ' · 🎵' : ''}</text>
        ${gmOnly ? `<text x="${NODE_W - 14}" y="15" class="gmc-eye" aria-label="Invisible des joueurs">🙈</text>` : ''}
        <circle class="gmc-port" cx="${NODE_W}" cy="${NODE_H / 2}" r="7"><title>Tirer pour créer un lien</title></circle>
      </g>`;
    }
    nodesG.innerHTML = nh;
  }

  /* ------------------------------------------------- interactions du canvas -- */
  let drag = null; // { mode: 'pan'|'node'|'link', … }
  svg.addEventListener('pointerdown', (ev) => {
    const port = ev.target.closest('.gmc-port');
    const nodeEl = ev.target.closest('.gmc-node');
    if (port && nodeEl) {
      drag = { mode: 'link', from: nodeEl.dataset.id };
      state.linkFrom = drag.from;
    } else if (nodeEl) {
      const id = nodeEl.dataset.id;
      const w = toWorld(ev);
      const p = state.board.nodes[id];
      drag = { mode: 'node', id, dx: w.x - p.x, dy: w.y - p.y, moved: false };
    } else {
      drag = { mode: 'pan', sx: ev.clientX, sy: ev.clientY, vx: state.view.x, vy: state.view.y };
    }
    svg.setPointerCapture(ev.pointerId);
  });
  svg.addEventListener('pointermove', (ev) => {
    if (!drag) return;
    if (drag.mode === 'pan') {
      state.view.x = drag.vx + (ev.clientX - drag.sx);
      state.view.y = drag.vy + (ev.clientY - drag.sy);
      applyView();
    } else if (drag.mode === 'node') {
      const w = toWorld(ev);
      const p = state.board.nodes[drag.id];
      p.x = Math.round(w.x - drag.dx);
      p.y = Math.round(w.y - drag.dy);
      drag.moved = true;
      requestAnimationFrame(paint);
    } else if (drag.mode === 'link') {
      const a = anchor(drag.from);
      const w = toWorld(ev);
      tempG.innerHTML = `<path class="gmc-temp-edge" d="${edgePath({ x: a.x + NODE_W / 2, y: a.y }, w)}"/>`;
    }
  });
  svg.addEventListener('pointerup', (ev) => {
    if (!drag) return;
    if (drag.mode === 'link') {
      tempG.innerHTML = '';
      state.linkFrom = null;
      const targetEl = document.elementFromPoint(ev.clientX, ev.clientY)?.closest?.('.gmc-node');
      const to = targetEl?.dataset.id;
      if (to && to !== drag.from && !state.board.edges.some((e) => e.from === drag.from && e.to === to)) {
        state.board.edges.push({ from: drag.from, to });
        state.selected = { kind: 'edge', index: state.board.edges.length - 1 };
        scheduleSave();
        paintSide();
      }
      paint();
    } else if (drag.mode === 'node' && drag.moved) {
      scheduleSave();
    }
    drag = null;
  });
  svg.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    const r = svg.getBoundingClientRect();
    const mx = ev.clientX - r.left, my = ev.clientY - r.top;
    const k0 = state.view.k;
    const k = Math.max(0.25, Math.min(2.5, k0 * (ev.deltaY < 0 ? 1.12 : 0.89)));
    // zoom centré sur le curseur
    state.view.x = mx - ((mx - state.view.x) / k0) * k;
    state.view.y = my - ((my - state.view.y) / k0) * k;
    state.view.k = k;
    applyView();
  }, { passive: false });

  svg.addEventListener('click', (ev) => {
    const nodeEl = ev.target.closest('.gmc-node');
    const edgeEl = ev.target.closest('.gmc-edge.custom');
    if (nodeEl) state.selected = { kind: 'node', id: nodeEl.dataset.id };
    else if (edgeEl) state.selected = { kind: 'edge', index: +edgeEl.dataset.edge };
    else state.selected = null;
    paint();
    paintSide();
  });
  svg.addEventListener('dblclick', (ev) => {
    const nodeEl = ev.target.closest('.gmc-node');
    if (!nodeEl) return;
    const id = nodeEl.dataset.id;
    if (!id.startsWith('seq:')) location.hash = `#/journal/${id}`;
  });

  /* ------------------------------------------------------- panneau latéral -- */
  const tabs = el('div', 'gmc-tabs');
  const panel = el('div', 'gmc-panel');
  side.append(tabs, panel);
  let activeTab = 'objets';
  const TABS = [['objets', '📚 Objets'], ['selection', '🔍 Sélection']];
  function paintTabs() {
    tabs.innerHTML = '';
    for (const [id, label] of TABS) {
      const b = el('button', 'gmc-tab' + (activeTab === id ? ' active' : ''), label);
      b.type = 'button';
      b.addEventListener('click', () => { activeTab = id; paintTabs(); paintSide(); });
      tabs.appendChild(b);
    }
  }
  paintTabs();

  function paintSide() {
    if (state.selected && activeTab !== 'selection') { activeTab = 'selection'; paintTabs(); }
    panel.innerHTML = '';
    if (activeTab === 'objets') return paintObjects();
    return paintSelection();
  }

  // « À trier » : place les nouveaux nœuds en cascade en haut-gauche de la vue.
  let dropCount = 0;
  function addNode(id) {
    if (state.board.nodes[id]) { state.selected = { kind: 'node', id }; paint(); paintSide(); return; }
    const wx = Math.round((30 - state.view.x) / state.view.k);
    const wy = Math.round((30 - state.view.y) / state.view.k);
    state.board.nodes[id] = { x: wx + (dropCount % 3) * 60, y: wy + dropCount * 26 };
    dropCount = (dropCount + 1) % 9;
    state.selected = { kind: 'node', id };
    scheduleSave();
    paint();
    paintSide();
  }
  function removeNode(id) {
    delete state.board.nodes[id];
    state.board.edges = state.board.edges.filter((e) => e.from !== id && e.to !== id);
    if (state.selected?.kind === 'node' && state.selected.id === id) state.selected = null;
    scheduleSave();
    paint();
    paintSide();
  }

  function paintObjects() {
    const search = el('input', 'gmc-search');
    search.type = 'search';
    search.placeholder = 'Rechercher un objet…';
    panel.appendChild(search);
    const list = el('div', 'gmc-obj-list');
    panel.appendChild(list);

    const candidates = [
      ...state.catalog.nodes,
      ...state.sequences.map((s) => ({ id: 'seq:' + s.id, name: s.name, type: 'seq' })),
    ];
    const norm = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const paintList = () => {
      const q = norm(search.value.trim());
      list.innerHTML = '';
      const byType = new Map();
      for (const c of candidates) {
        if (q && !norm(c.name).includes(q)) continue;
        if (!byType.has(c.type)) byType.set(c.type, []);
        byType.get(c.type).push(c);
      }
      for (const [type, t] of Object.entries(NODE_TYPES)) {
        const items = byType.get(type);
        if (!items?.length) continue;
        const box = el('details', 'gmc-obj-group');
        box.open = Boolean(q) || type === 'acte';
        const onMap = items.filter((c) => state.board.nodes[c.id]).length;
        box.innerHTML = `<summary>${t.icon} ${t.plural} <span class="gmc-count">${onMap}/${items.length}</span></summary>`;
        for (const c of items) {
          const on = Boolean(state.board.nodes[c.id]);
          const row = el('div', 'gmc-obj' + (on ? ' on-map' : ''));
          row.innerHTML = `<span class="gmc-obj-name">${esc(c.name)}</span>`;
          const btn = el('button', 'gmc-mini', on ? '✕' : '＋');
          btn.type = 'button';
          btn.title = on ? 'Retirer de la carte' : 'Ajouter à la carte (zone à trier)';
          btn.addEventListener('click', () => { on ? removeNode(c.id) : addNode(c.id); paintList(); });
          row.appendChild(btn);
          box.appendChild(row);
        }
        list.appendChild(box);
      }
      if (!list.children.length) list.appendChild(el('p', 'muted', 'Aucun objet. Crée des fiches Campaign Codex dans Foundry ou des séquences de handouts.'));
    };
    search.addEventListener('input', paintList);
    paintList();
  }

  function paintSelection() {
    if (!state.selected) { panel.appendChild(el('p', 'muted', 'Clique un nœud ou un lien custom sur la carte.')); return; }
    if (state.selected.kind === 'edge') return paintEdgeEditor(state.selected.index);
    return paintIdentity(state.selected.id);
  }

  function paintEdgeEditor(i) {
    const e = state.board.edges[i];
    if (!e) { state.selected = null; return paintSelection(); }
    const a = nodeMeta(e.from), b = nodeMeta(e.to);
    panel.appendChild(el('p', 'eyebrow', '🔗 Lien custom'));
    panel.appendChild(el('p', 'gmc-id-name', `${esc(a.name)} → ${esc(b.name)}`));
    // relation typée (table fermée, libellés aller/retour) — le libellé libre prime
    const sel = el('select', 'gmc-input');
    sel.innerHTML = '<option value="">— relation non typée —</option>'
      + Object.entries(EDGE_TYPES).map(([k, t]) =>
        `<option value="${k}"${e.type === k ? ' selected' : ''}>${esc(t.fwd)} → / ← ${esc(t.back)}</option>`).join('');
    sel.addEventListener('change', () => {
      if (sel.value) e.type = sel.value; else delete e.type;
      scheduleSave();
      paint();
    });
    panel.appendChild(sel);
    const lbl = el('input', 'gmc-input');
    lbl.placeholder = 'Libellé libre (prime sur le type)';
    lbl.value = e.label || '';
    lbl.addEventListener('change', () => {
      if (lbl.value.trim()) e.label = lbl.value.trim().slice(0, 80); else delete e.label;
      scheduleSave();
      paint();
    });
    panel.appendChild(lbl);
    const del = el('button', 'gmc-btn danger', '🗑️ Supprimer le lien');
    del.type = 'button';
    del.addEventListener('click', () => {
      state.board.edges.splice(i, 1);
      state.selected = null;
      scheduleSave();
      paint();
      paintSide();
    });
    panel.appendChild(del);
  }

  // Mini-carte d'identité du nœud sélectionné.
  function paintIdentity(id) {
    const p = state.board.nodes[id];
    const m = nodeMeta(id);
    const t = NODE_TYPES[m.type] || NODE_TYPES.quest;
    const card = el('div', 'gmc-id');
    if (m.img) {
      const img = el('img', 'gmc-id-img');
      img.alt = m.name;
      img.src = gmAssetUrl(m.img);
      img.addEventListener('error', () => img.remove(), { once: true });
      card.appendChild(img);
    }
    card.appendChild(el('p', 'eyebrow', `${t.icon} ${t.label}`));
    card.appendChild(el('p', 'gmc-id-name', esc(m.name)));
    if (m.statut || m.mort) card.appendChild(el('p', 'gmc-id-sub', `${esc(m.statut || '')}${m.mort ? ' · ✝ mort' : ''}`));
    if (m.playerVisible !== undefined) {
      card.appendChild(el('p', 'gmc-id-sub', m.playerVisible
        ? '👁 Fiche visible des joueurs'
        : '🙈 Fiche invisible des joueurs (ownership Foundry)'));
    }
    panel.appendChild(card);

    // Relations custom du nœud, libellées selon le SENS de lecture (aller/retour).
    const rels = [];
    state.board.edges.forEach((e) => {
      if (e.from === id) rels.push(`→ ${esc(e.label || EDGE_TYPES[e.type]?.fwd || 'lié à')} <b>${esc(nodeMeta(e.to).name)}</b>`);
      else if (e.to === id) rels.push(`← ${esc(e.label || EDGE_TYPES[e.type]?.back || 'lié à')} <b>${esc(nodeMeta(e.from).name)}</b>`);
    });
    if (rels.length) {
      const box = el('div', 'gmc-rels');
      box.innerHTML = '<p class="gmc-field-lbl">Relations custom</p>' + rels.map((r) => `<p class="gmc-rel">${r}</p>`).join('');
      panel.appendChild(box);
    }

    const actions = el('div', 'gmc-id-actions');
    if (!id.startsWith('seq:') && !m.ghost) {
      const open = el('a', 'gmc-btn', '↗ Ouvrir la fiche');
      open.href = `#/journal/${id}`;
      actions.appendChild(open);
    }
    if (m.type === 'acte') {
      const sum = el('button', 'gmc-btn gold', '📜 Sommaire d’acte');
      sum.type = 'button';
      sum.title = 'Récap de début d’acte (crawl, situation, objectifs…) — rendu en tête de l’acte, visible joueurs';
      sum.addEventListener('click', () => paintActEditor(id));
      actions.appendChild(sum);
    }
    const pin = el('button', 'gmc-btn', p?.pinned ? '📌 Désépingler' : '📌 Épingler');
    pin.type = 'button';
    pin.title = 'Un nœud épinglé est mis en avant (bordure or)';
    pin.addEventListener('click', () => {
      if (p.pinned) delete p.pinned; else p.pinned = true;
      scheduleSave();
      paint();
      paintSide();
    });
    actions.appendChild(pin);
    const rm = el('button', 'gmc-btn danger', '✕ Retirer de la carte');
    rm.type = 'button';
    rm.addEventListener('click', () => removeNode(id));
    actions.appendChild(rm);
    panel.appendChild(actions);
  }

  /* --------------------------------------------- 📜 Sommaire d'acte (lot 2) -- */
  // Éditeur du bloc flags.holocron.actSummary : crawl, situation, objectifs,
  // protagonistes/lieux (fiches de la carte), fronts — chaque champ masquable
  // aux joueurs (🙈). Rendu joueur : encart en tête de la page de l'acte.
  function paintActEditor(id) {
    const m = nodeMeta(id);
    const s = m.actSummary || {};
    const hidden = new Set(s.hidden || []);
    panel.innerHTML = '';
    panel.appendChild(el('p', 'eyebrow', `📜 Sommaire — ${esc(m.name)}`));
    panel.appendChild(el('p', 'gmc-hint', 'Affiché en tête de l’acte (joueurs compris). 🙈 = champ masqué aux joueurs.'));

    const fields = {};
    const hideBox = (f) => {
      const lab = el('label', 'gmc-hide');
      const cb = el('input');
      cb.type = 'checkbox';
      cb.checked = hidden.has(f);
      cb.addEventListener('change', () => { cb.checked ? hidden.add(f) : hidden.delete(f); });
      lab.append(cb, document.createTextNode(' 🙈'));
      lab.title = 'Masquer ce champ aux joueurs';
      return lab;
    };
    const textArea = (f, label, value, ph, rows = 3) => {
      const head = el('div', 'gmc-field-head');
      head.append(el('span', 'gmc-field-lbl', label), hideBox(f));
      const ta = el('textarea', 'gmc-input');
      ta.rows = rows;
      ta.placeholder = ph;
      ta.value = value || '';
      fields[f] = ta;
      panel.append(head, ta);
    };
    textArea('crawl', 'Texte d’ouverture (façon générique déroulant)', s.crawl, 'Il est une période de guerre civile…', 4);
    textArea('situation', 'Situation', s.situation, 'Où en est-on au début de cet acte ?');
    textArea('objectifs', 'Objectifs (un par ligne)', (s.objectifs || []).join('\n'), 'Livrer la cargaison\nRetrouver Maz…');
    textArea('fronts', 'Fronts en mouvement (un par ligne)', (s.fronts || []).join('\n'), 'L’Empire resserre l’étau…');

    // protagonistes / lieux : cases à cocher sur les fiches du catalogue
    const pickList = (f, label, types, selected) => {
      const head = el('div', 'gmc-field-head');
      head.append(el('span', 'gmc-field-lbl', label), hideBox(f));
      panel.appendChild(head);
      const box = el('div', 'gmc-picks');
      const sel = new Set(selected || []);
      for (const c of state.catalog.nodes.filter((n) => types.includes(n.type))) {
        const lab = el('label', 'gmc-pick');
        const cb = el('input');
        cb.type = 'checkbox';
        cb.checked = sel.has(c.id);
        cb.addEventListener('change', () => { cb.checked ? sel.add(c.id) : sel.delete(c.id); });
        lab.append(cb, document.createTextNode(` ${NODE_TYPES[c.type].icon} ${c.name}`));
        box.appendChild(lab);
      }
      if (!box.children.length) box.appendChild(el('p', 'muted', 'Aucune fiche de ce type.'));
      panel.appendChild(box);
      fields[f] = { get: () => [...sel] };
    };
    pickList('protagonistes', 'Protagonistes', ['npc', 'group'], s.protagonistes);
    pickList('lieux', 'Lieux', ['location', 'shop'], s.lieux);

    const actions = el('div', 'gmc-id-actions');
    const save = el('button', 'gmc-btn gold', '💾 Enregistrer le sommaire');
    save.type = 'button';
    save.addEventListener('click', async () => {
      save.disabled = true;
      const lines = (v) => v.split('\n').map((x) => x.trim()).filter(Boolean);
      const body = {
        crawl: fields.crawl.value.trim(),
        situation: fields.situation.value.trim(),
        objectifs: lines(fields.objectifs.value),
        fronts: lines(fields.fronts.value),
        protagonistes: fields.protagonistes.get(),
        lieux: fields.lieux.get(),
        hidden: [...hidden],
      };
      try {
        const out = await api(`/gm/act-summary/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(body) });
        const cat = catById.get(id);
        if (cat) cat.actSummary = out.actSummary;
        save.textContent = '✓ Enregistré';
      } catch (e) { save.textContent = `✗ ${e.message}`.slice(0, 40); }
      setTimeout(() => { save.textContent = '💾 Enregistrer le sommaire'; save.disabled = false; }, 1500);
    });
    const back = el('button', 'gmc-btn', '← Retour à la fiche');
    back.type = 'button';
    back.addEventListener('click', () => paintSide());
    actions.append(save, back);
    panel.appendChild(actions);
  }

  paint();
  paintSide();
  window.scrollTo(0, 0);
}
