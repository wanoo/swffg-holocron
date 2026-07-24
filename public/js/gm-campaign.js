// gm-campaign.js — 🗺️ Éditeur de campagne (cockpit MJ, #/mj/campagne).
// Carte pan-zoom SVG des objets de la campagne (actes, quêtes, PNJ, orgs,
// lieux, boutiques Campaign Codex, séquences de handouts) : arêtes AUTO tirées
// des liens CC (associates, linkedNPCs, linkedLocations, parentRegion,
// unlocks/dépendances de quêtes) + LIENS CUSTOM tracés à la souris.
// Persistance : flags.holocron.board du journal technique (GET/PUT /api/gm/board).
import { apiBase, getGMKey } from './collab.js';
import { toFoundrySrc } from './show-image.js';
import {
  sessionCfg, loadSessionCfg, patchSessionCfg, pinBeat, invalidateBoard, renderPlayReport,
} from './gm-session.js';
import { normalizePinned, describeTrigger, WEATHER_UI } from './session-model.js';

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
  // Éléments de jeu (bible décomposée) : fiches CC `tag` taguées elem:* —
  // attachables aux beats, leurs données pré-remplissent les déclencheurs.
  'elem-lecture': { icon: '📣', label: 'Lecture', plural: 'Lectures', color: '#e6b422' },
  'elem-ambiance': { icon: '🔊', label: 'Ambiance', plural: 'Ambiances', color: '#5fb3b3' },
  'elem-visuel': { icon: '🖼️', label: 'Visuel', plural: 'Visuels', color: '#b48ead' },
  'elem-vision': { icon: '🔮', label: 'Vision', plural: 'Visions', color: '#9d7bd8' },
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

// --- Storyboard d'acte : MOMENTS DE JEU typés (flags.holocron.storyboard) -----
// Couleurs = tokens de statut des thèmes (--accent-primary / --status-*) —
// posées en CSS via data-kind ; formes distinctes dessinées dans paintStoryboard.
export const BEAT_KINDS = {
  scene: { icon: '🎭', label: 'Scène', hint: 'theater of the mind' },
  combat: { icon: '⚔️', label: 'Combat', hint: 'rencontre liée' },
  note: { icon: '🗒️', label: 'Note MJ', hint: 'jamais montrée aux joueurs' },
  handout: { icon: '🖼️', label: 'Handout', hint: 'image, vidéo, audio ou chat à envoyer' },
};
const BEAT_STATUS = ['todo', 'encours', 'fait'];
const STATUS_META = { todo: { icon: '○', label: 'À jouer' }, encours: { icon: '▶', label: 'En cours' }, fait: { icon: '✓', label: 'Fait' } };
const BEAT_W = 200, BEAT_H = 84, BEAT_GX = 82, SAT_W = 150, SAT_H = 34;

// --- Handouts multi-média : types d'items de séquence & handouts unitaires ----
// Miroir serveur (HANDOUT_TYPES de board.mjs) : envoyés via POST
// /api/gm/foundry/handout aux joueurs SÉLECTIONNÉS (targets) ou à toute la table.
export const ITEM_TYPES = {
  image: { icon: '🖼️', label: 'Image' },
  video: { icon: '🎬', label: 'Vidéo' },
  audio: { icon: '🎵', label: 'Audio' },
  chat: { icon: '💬', label: 'Événement chat' },
};
const detectType = (src) => (/\.(mp3|ogg|wav|m4a|flac)(\?.*)?$/i.test(src) ? 'audio'
  : /\.(mp4|webm|m4v|ogv)(\?.*)?$/i.test(src) ? 'video' : 'image');
const itemType = (it) => (ITEM_TYPES[it?.type] ? it.type : 'image'); // rétrocompat : sans type = image

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
    sessions: data.sessions || [],  // 📓 la trace (séances jouées) — MJ only
    selected: null,        // { kind: 'node'|'edge'|'beat'|'sat', id | index }
    linkFrom: null,        // id du nœud d'origine pendant un tracé de lien
    sb: null,              // mode storyboard : { actId } (null = carte globale)
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
      return s ? { id, name: s.name, type: 'seq', img: s.items.find((it) => it.src)?.src || null }
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

  /* ------------------------------------------ storyboard : état + sauvegarde -- */
  const sbAct = () => (state.sb ? catById.get(state.sb.actId) : null);
  function sbData() {
    const act = sbAct();
    if (!act) return { beats: [] };
    act.storyboard = act.storyboard || { beats: [] };
    act.storyboard.beats = act.storyboard.beats || [];
    return act.storyboard;
  }
  const sbTagKey = () => 'holocron-sb-tag:' + (state.sb?.actId || '');
  const sbTagOn = () => localStorage.getItem(sbTagKey()) === '1';
  let sbTagInfo = ''; // retour serveur du dernier taguage (« mj:acte-6 : 3 posés… »)
  let sbSaveTimer = null;
  let sbDirty = false;
  function scheduleSbSave(now = false, tagParticipants) {
    sbDirty = true;
    paintSaveDot('dirty');
    clearTimeout(sbSaveTimer);
    sbSaveTimer = setTimeout(() => doSbSave(tagParticipants), now ? 0 : 900);
  }
  async function doSbSave(tagParticipants) {
    const act = sbAct();
    if (!act) return;
    sbDirty = false;
    paintSaveDot('saving');
    const tag = tagParticipants !== undefined ? tagParticipants : (sbTagOn() ? true : undefined);
    try {
      // NE PAS remplacer act.storyboard par la réponse (références vives du panneau) —
      // l'assainissement serveur s'applique au prochain chargement.
      const out = await api(`/gm/storyboard/${encodeURIComponent(act.id)}`, {
        method: 'PUT',
        body: JSON.stringify({ ...sbData(), ...(tag !== undefined ? { tagParticipants: tag } : {}) }),
      });
      if (out.tags) {
        sbTagInfo = `${out.tags.tag} : ${out.tags.added} posé(s), ${out.tags.removed} retiré(s)`;
        if (state.sb && !state.selected) paintSide(); // rafraîchit l'info tag de l'aperçu
      }
      paintSaveDot('saved');
      invalidateBoard(); // le bandeau de séance relit le storyboard (beat épinglé)
    } catch (e) { paintSaveDot('error', e.message); }
  }
  cleanup.push(() => { clearTimeout(sbSaveTimer); if (sbDirty) doSbSave(); });

  /* ------------------------------------------------ 📓 la trace (séances) --- */
  // Une séance OUVERTE enregistre AUTOMATIQUEMENT ce qui se joue : beat passé à
  // « fait » (played), handout réellement projeté (shown), entité marquée
  // révélée (reveals). Le MJ ne saisit RIEN pendant la partie — juste le récap
  // à la clôture. Stockage : flags.holocron.sessions du journal technique.
  // L'id de la séance courante vit dans la config MJ PARTAGÉE `gm:cfg:session`
  // (champ `currentId`) : la trace suit le MJ d'un appareil à l'autre.
  // La config `gm:cfg:session` appartient à gm-session.js (source unique des
  // défauts + écriture coordonnée) : ici on ne fait que lire et patcher.
  const loadSessCfg = () => loadSessionCfg();
  const setCurrentSession = (id) => patchSessionCfg({ currentId: id || '' });
  const sessionById = (id) => state.sessions.find((s) => s.id === id) || null;
  // séance COURANTE = celle pointée par la config, tant qu'elle n'est pas close.
  const openSession = () => {
    const s = sessionById(sessionCfg().currentId);
    return s && !s.endedAt ? s : null;
  };
  // beat épinglé par le bandeau de séance (étape 2) — pastille 📌 dans la vue
  const pinnedBeat = () => {
    const p = normalizePinned(sessionCfg().pinned);
    return p && p.kind === 'beat' ? p : null;
  };

  /** Inscrit une entrée dans la séance ouverte. FIRE-AND-FORGET : jamais attendu,
   * jamais bloquant — si la trace échoue, le pilotage de la séance continue et
   * seul un log discret le signale. Ajout ATOMIQUE côté serveur (deux onglets
   * MJ ouverts ne s'écrasent pas : le client n'envoie que l'entrée). */
  function trace(kind, entry) {
    const s = openSession();
    if (!s) return; // aucune séance ouverte : on ne trace rien (et on ne gêne rien)
    // enveloppe EXPLICITE { kind, entry } : l'entrée `played` porte son propre
    // champ `kind` (celui du BEAT) et écrasait le type d'événement à plat.
    api(`/gm/sessions/${encodeURIComponent(s.id)}/event`, {
      method: 'POST',
      body: JSON.stringify({ kind, entry: { at: Date.now(), ...entry } }),
    }).then((out) => {
      if (!out?.session) return;
      const i = state.sessions.findIndex((x) => x.id === out.session.id);
      if (i >= 0) state.sessions[i] = out.session;
      if (activeTab === 'seance' && !state.sb) paintSide(); // compteurs vivants
    }).catch((e) => console.warn('[holocron] trace non enregistrée :', e.message));
  }

  // Sauvegarde de la collection (remplacement complet) — réservée aux gestes
  // LENTS du panneau (démarrer, clôturer, rédiger le récap), jamais au pilotage.
  async function saveSessions() {
    const out = await api('/gm/sessions', { method: 'PUT', body: JSON.stringify({ sessions: state.sessions }) });
    if (out?.sessions) state.sessions = out.sessions;
    return state.sessions;
  }

  function enterStoryboard(actId) {
    if (saveState === 'dirty') { clearTimeout(saveTimer); doSave(); } // flush board
    state.sb = { actId, prevView: { ...state.view } };
    state.selected = null;
    state.view = { x: 40, y: 150, k: 1 };
    applyView();
    paintLegend();
    paint();
    paintSide();
  }
  function exitStoryboard() {
    if (sbDirty) { clearTimeout(sbSaveTimer); doSbSave(); }
    const prev = state.sb?.prevView;
    state.sb = null;
    state.selected = null;
    if (prev) state.view = prev;
    applyView();
    paintLegend();
    paintTabs();
    paint();
    paintSide();
  }

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
    // Mode storyboard : la barre devient l'en-tête de l'acte (retour, progression).
    if (state.sb) {
      const act = sbAct();
      const beats = sbData().beats;
      const done = beats.filter((b) => b.status === 'fait').length;
      const pct = beats.length ? Math.round((done / beats.length) * 100) : 0;
      legend.innerHTML = `<button type="button" class="gmc-lens" data-sb-back title="Revenir à la carte de campagne">← Carte</button>
        <span class="gmc-sb-title">🎬 ${esc(act?.name || '(acte disparu)')}</span>
        <span class="gmc-sb-progress" role="progressbar" aria-valuenow="${done}" aria-valuemax="${beats.length}"
          title="Progression de l'acte : ${done}/${beats.length} beats joués"><i style="width:${pct}%"></i></span>
        <span class="gmc-count">${done}/${beats.length}</span>
        <span class="gmc-save" id="gmc-save" title="État de sauvegarde">●</span>`;
      paintSaveDot(saveState);
      return;
    }
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
    if (b.dataset.sbBack !== undefined) return exitStoryboard();
    if (state.sb) return;
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
    if (state.sb) return paintStoryboard();
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
        ${m.type === 'acte' && m.storyboard?.beats?.length ? `<g class="gmc-sb-badge"><title>Storyboard : ${m.storyboard.beats.length} beat(s)</title>
          <circle cx="${NODE_W - 12}" cy="${NODE_H - 11}" r="9"/><text x="${NODE_W - 12}" y="${NODE_H - 7}">${m.storyboard.beats.length}</text></g>` : ''}
        <circle class="gmc-port" cx="${NODE_W}" cy="${NODE_H / 2}" r="7"><title>Tirer pour créer un lien</title></circle>
      </g>`;
    }
    nodesG.innerHTML = nh;
  }

  /* ------------------------------------------------- interactions du canvas -- */
  let drag = null; // { mode: 'pan'|'node'|'link'|'beat', … }
  svg.addEventListener('pointerdown', (ev) => {
    if (state.sb) {
      // storyboard : drag d'un beat = RÉORDONNANCEMENT dans la chaîne (pas de
      // position libre) ; le clic sur la pastille de statut ne déclenche rien ici.
      const beatEl = !ev.target.closest('.gmc-beat-st') && ev.target.closest('.gmc-beat');
      if (beatEl) {
        const w = toWorld(ev);
        drag = { mode: 'beat', id: beatEl.dataset.beat, startX: w.x, dx: 0, moved: false };
      } else {
        drag = { mode: 'pan', sx: ev.clientX, sy: ev.clientY, vx: state.view.x, vy: state.view.y };
      }
      svg.setPointerCapture(ev.pointerId);
      return;
    }
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
    } else if (drag.mode === 'beat') {
      const w = toWorld(ev);
      drag.dx = w.x - drag.startX;
      if (Math.abs(drag.dx) > 5) drag.moved = true;
      const p = sbPos.get(drag.id);
      const g = nodesG.querySelector(`.gmc-beat[data-beat="${CSS.escape(drag.id)}"]`);
      if (p && g) g.setAttribute('transform', `translate(${p.x + drag.dx},${p.y - (drag.moved ? 8 : 0)})`);
    } else if (drag.mode === 'link') {
      const a = anchor(drag.from);
      const w = toWorld(ev);
      tempG.innerHTML = `<path class="gmc-temp-edge" d="${edgePath({ x: a.x + NODE_W / 2, y: a.y }, w)}"/>`;
    }
  });
  svg.addEventListener('pointerup', (ev) => {
    if (!drag) return;
    if (drag.mode === 'beat') {
      if (drag.moved) {
        // réordonne par la position du CENTRE lâché dans la chaîne
        const beats = sbData().beats;
        const i = beats.findIndex((b) => b.id === drag.id);
        const p = sbPos.get(drag.id);
        if (i >= 0 && p) {
          const center = p.x + drag.dx + BEAT_W / 2;
          const [moved] = beats.splice(i, 1);
          let to = beats.length;
          for (let j = 0; j < beats.length; j++) {
            const q = sbPos.get(beats[j].id);
            if (q && center < q.x + BEAT_W / 2) { to = j; break; }
          }
          beats.splice(to, 0, moved);
          scheduleSbSave();
        }
        paint();
        paintSide();
      }
      drag = null;
      return;
    }
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
    if (state.sb) {
      // pastille de statut : todo → encours → fait → todo, sans changer la sélection
      const stEl = ev.target.closest('.gmc-beat-st');
      if (stEl) {
        const id = stEl.closest('.gmc-beat')?.dataset.beat;
        const b = sbData().beats.find((x) => x.id === id);
        if (b) cycleStatus(b); // trace comprise (passage à « fait »)
        return;
      }
      const beatEl = ev.target.closest('.gmc-beat');
      const satEl = ev.target.closest('.gmc-sat');
      if (beatEl) state.selected = { kind: 'beat', id: beatEl.dataset.beat };
      else if (satEl) state.selected = { kind: 'sat', id: satEl.dataset.sat };
      else state.selected = null;
      paint();
      paintSide();
      return;
    }
    const nodeEl = ev.target.closest('.gmc-node');
    const edgeEl = ev.target.closest('.gmc-edge.custom');
    if (nodeEl) state.selected = { kind: 'node', id: nodeEl.dataset.id };
    else if (edgeEl) state.selected = { kind: 'edge', index: +edgeEl.dataset.edge };
    else state.selected = null;
    paint();
    paintSide();
  });
  svg.addEventListener('dblclick', (ev) => {
    if (state.sb) {
      const satEl = ev.target.closest('.gmc-sat');
      if (satEl) location.hash = `#/journal/${satEl.dataset.sat}`;
      return;
    }
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
  const TABS = [['objets', '📚 Objets'], ['selection', '🔍 Sélection'], ['projeter', '🎞️ Projeter'],
    ['ambiance', '🎵 Ambiance'], ['seance', '📓 Séance']];
  function paintTabs() {
    tabs.innerHTML = '';
    for (const [id, label] of TABS) {
      const b = el('button', 'gmc-tab' + (activeTab === id ? ' active' : ''), label);
      b.type = 'button';
      b.addEventListener('click', () => {
        activeTab = id;
        if (id !== 'selection' && state.selected) { state.selected = null; paint(); } // sinon paintSide re-bascule
        paintTabs();
        paintSide();
      });
      tabs.appendChild(b);
    }
  }
  paintTabs();

  function paintSide() {
    if (state.sb) { tabs.innerHTML = ''; return paintSbSide(); } // storyboard : panneau dédié
    if (state.selected && activeTab !== 'selection') { activeTab = 'selection'; paintTabs(); }
    panel.innerHTML = '';
    if (activeTab === 'objets') return paintObjects();
    if (activeTab === 'projeter') return paintProjeter();
    if (activeTab === 'ambiance') return paintAmbiance();
    if (activeTab === 'seance') return paintSession();
    return paintSelection();
  }

  /* -------------------------------------------------- 🎵 Ambiances (lot 4) -- */
  // Liste des playlists Foundry (connecteur MCP get_playlists) ; lecture/arrêt
  // via le PONT ChatMessage holocron.sound (module ≥ 2.2 : playAll/stopAll, le
  // vrai moteur — fiable quel que soit le mode de la playlist). Repli : champ
  // « nom de playlist » si la liste est indisponible.
  let playlists = null; // null = pas encore chargées, [] = échec/aucune
  async function loadPlaylists() {
    try { playlists = (await api('/gm/foundry/playlists')).playlists || []; }
    catch { playlists = []; }
  }
  async function playSound(playlist, action, statusEl) {
    if (statusEl) statusEl.textContent = '…';
    try {
      await api('/gm/foundry/sound', { method: 'POST', body: JSON.stringify({ playlist, action }) });
      if (statusEl) statusEl.textContent = action === 'stop' ? '⏹ Arrêt demandé' : `▶ Lecture demandée — ${playlist}`;
    } catch (e) { if (statusEl) statusEl.textContent = `⚠️ ${e.message}`.slice(0, 60); }
  }

  function paintAmbiance() {
    panel.appendChild(el('p', 'eyebrow', '🎵 Ambiances'));
    panel.appendChild(el('p', 'gmc-hint', 'Joue/arrête les playlists Foundry chez les joueurs (client MJ Foundry ouvert requis).'));
    const status = el('p', 'gmc-hint', '');
    const list = el('div', 'gmc-obj-list', '<p class="muted">chargement…</p>');
    panel.append(list, status);
    const paintList = () => {
      list.innerHTML = '';
      if (!playlists?.length) {
        // repli : nom de playlist en clair (la liste MCP est indisponible)
        list.appendChild(el('p', 'muted', playlists === null ? 'chargement…' : 'Liste indisponible — entre le nom exact de la playlist.'));
        const row = el('div', 'gmc-seq-nav');
        const inp = el('input', 'gmc-input');
        inp.placeholder = 'Nom de playlist Foundry';
        const play = el('button', 'gmc-btn gold', '▶'); play.type = 'button';
        play.addEventListener('click', () => inp.value.trim() && playSound(inp.value.trim(), 'play', status));
        const stop = el('button', 'gmc-btn', '⏹'); stop.type = 'button';
        stop.addEventListener('click', () => inp.value.trim() && playSound(inp.value.trim(), 'stop', status));
        row.append(inp, play, stop);
        list.appendChild(row);
        return;
      }
      for (const p of playlists) {
        const row = el('div', 'gmc-obj');
        row.appendChild(el('span', 'gmc-obj-name', `${p.playing ? '🔊 ' : ''}${esc(p.name)}`));
        const play = el('button', 'gmc-mini', '▶'); play.type = 'button'; play.title = 'Jouer (chez les joueurs)';
        play.addEventListener('click', () => playSound(p.name, 'play', status));
        const stop = el('button', 'gmc-mini', '⏹'); stop.type = 'button'; stop.title = 'Arrêter';
        stop.addEventListener('click', () => playSound(p.name, 'stop', status));
        row.append(play, stop);
        list.appendChild(row);
      }
    };
    if (playlists === null) loadPlaylists().then(() => { if (activeTab === 'ambiance') paintList(); });
    paintList();
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

    // 🎵 ambiance associée au nœud (board.nodes[id].sound.playlist) : ▶ en un clic.
    if (p) {
      const box = el('div', 'gmc-rels');
      box.appendChild(el('p', 'gmc-field-lbl', '🎵 Ambiance du nœud'));
      const row = el('div', 'gmc-seq-nav');
      const inp = el('input', 'gmc-input');
      inp.placeholder = 'Playlist Foundry…';
      inp.setAttribute('list', 'gmc-playlists');
      inp.value = p.sound?.playlist || '';
      inp.addEventListener('change', () => {
        const v = inp.value.trim();
        if (v) p.sound = { playlist: v }; else delete p.sound;
        scheduleSave();
        paint();
      });
      const play = el('button', 'gmc-btn gold', '▶'); play.type = 'button'; play.title = 'Jouer cette ambiance chez les joueurs';
      const stop = el('button', 'gmc-btn', '⏹'); stop.type = 'button'; stop.title = 'Arrêter cette ambiance';
      const status = el('p', 'gmc-hint', '');
      play.addEventListener('click', () => { const v = inp.value.trim(); if (v) playSound(v, 'play', status); });
      stop.addEventListener('click', () => { const v = inp.value.trim(); if (v) playSound(v, 'stop', status); });
      row.append(inp, play, stop);
      box.append(row, status);
      // datalist des playlists connues (remplie à la volée)
      let dl = document.getElementById('gmc-playlists');
      if (!dl) { dl = el('datalist'); dl.id = 'gmc-playlists'; wrap.appendChild(dl); }
      const fillDl = () => { dl.innerHTML = (playlists || []).map((x) => `<option value="${esc(x.name)}">`).join(''); };
      if (playlists === null) loadPlaylists().then(fillDl); else fillDl();
      panel.appendChild(box);
    }

    const actions = el('div', 'gmc-id-actions');
    if (!id.startsWith('seq:') && !m.ghost) {
      const open = el('a', 'gmc-btn', '↗ Ouvrir la fiche');
      open.href = `#/journal/${id}`;
      actions.appendChild(open);
    }
    if (id.startsWith('seq:') && !m.ghost) {
      const proj = el('button', 'gmc-btn gold', '🎞️ Projeter la séquence');
      proj.type = 'button';
      proj.addEventListener('click', () => {
        const s = seqById().get(id);
        if (s) { projState = { mode: 'play', seqId: s.id, idx: 0 }; state.selected = null; activeTab = 'projeter'; paintTabs(); paint(); paintSide(); }
      });
      actions.appendChild(proj);
    }
    if (m.type === 'acte') {
      const nb = m.storyboard?.beats?.length || 0;
      const sb = el('button', 'gmc-btn gold', `🎬 Storyboard${nb ? ` (${nb} beats)` : ''}`);
      sb.type = 'button';
      sb.title = 'Ouvrir le storyboard de l’acte : moments de jeu 🎭⚔️🗒️🖼️ enchaînés (MJ only)';
      sb.addEventListener('click', () => enterStoryboard(id));
      actions.appendChild(sb);
      const sum = el('button', 'gmc-btn gold', '📜 Sommaire d’acte');
      sum.type = 'button';
      sum.title = 'Récap de début d’acte (crawl, situation, objectifs…) — rendu en tête de l’acte, visible joueurs';
      sum.addEventListener('click', () => paintActEditor(id));
      actions.appendChild(sum);
    }
    if (p && !state.sb) { // nœud posé sur la carte globale (pas un satellite de storyboard)
      const pin = el('button', 'gmc-btn', p.pinned ? '📌 Désépingler' : '📌 Épingler');
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
    }
    if (state.sb) {
      const back = el('button', 'gmc-btn', '← Storyboard');
      back.type = 'button';
      back.addEventListener('click', () => { state.selected = null; paint(); paintSide(); });
      actions.appendChild(back);
    }
    panel.appendChild(actions);
  }

  /* --------------------------------------- 🎞️ Handouts & séquences (lot 3) -- */
  // Une séquence = liste ORDONNÉE de handouts multi-média {type, src|text,
  // title, note, targets?} préparée avant séance (flags.holocron.sequences).
  // En séance : Précédent/Suivant POUSSENT l'item via POST /api/gm/foundry/handout
  // aux joueurs sélectionnés (targets) — aucun sélectionné = toute la table.
  let projState = { mode: 'list', seqId: null, idx: 0 };

  // Joueurs Foundry pour le picker de destinataires (vue MJ légère /gm/players).
  let players = null; // null = pas encore chargés, [] = échec/aucun
  async function loadPlayers() {
    try { players = ((await api('/gm/players')).players || []).filter((p) => !p.gm); }
    catch { players = []; }
  }
  const targetsBadge = (item) => {
    if (!item.targets?.length) return '→ Tous';
    return '→ ' + item.targets.map((id) => (players || []).find((p) => p.id === id)?.name || '?').join(', ');
  };
  // Chips cochables des destinataires — mute `item.targets` (vide = supprimé = tous).
  function targetsPicker(item, onChange) {
    const box = el('div', 'gmc-picks gmc-targets');
    const paintChips = () => {
      box.innerHTML = '';
      for (const p of players || []) {
        const lab = el('label', 'gmc-pick');
        const cb = el('input');
        cb.type = 'checkbox';
        cb.checked = (item.targets || []).includes(p.id);
        cb.addEventListener('change', () => {
          const sel = new Set(item.targets || []);
          cb.checked ? sel.add(p.id) : sel.delete(p.id);
          if (sel.size) item.targets = [...sel]; else delete item.targets;
          onChange?.();
        });
        lab.append(cb, document.createTextNode(` ${p.name}${p.active ? ' 🟢' : ''}`));
        box.appendChild(lab);
      }
      if (!(players || []).length) box.appendChild(el('p', 'muted', 'Aucun joueur listé — tout part à toute la table.'));
    };
    if (players === null) loadPlayers().then(paintChips); else paintChips();
    return box;
  }

  async function pushHandout(item, statusEl) {
    statusEl.textContent = '📡 Envoi…';
    const type = itemType(item);
    const body = { type, title: item.title || '', ...(item.targets?.length ? { targets: item.targets } : {}) };
    if (type === 'chat') body.text = item.text || ''; else body.src = toFoundrySrc(item.src);
    try {
      await api('/gm/foundry/handout', { method: 'POST', body: JSON.stringify(body) });
      statusEl.textContent = `✅ Envoyé ${targetsBadge(item)}`;
      // 📓 trace : ce handout a RÉELLEMENT été projeté (jamais les préparés).
      trace('shown', { type, title: item.title || '', ...(item.targets?.length ? { targets: item.targets } : {}) });
    } catch (e) { statusEl.textContent = `⚠️ ${e.message}`.slice(0, 60); }
  }

  function paintProjeter() {
    const s = projState.seqId ? state.sequences.find((x) => x.id === projState.seqId) : null;
    if (projState.mode === 'edit') return paintSeqEditor(s);
    if (projState.mode === 'play' && s) return paintSeqPlayer(s);
    // --- liste des séquences -----------------------------------------------
    panel.appendChild(el('p', 'eyebrow', '🎞️ Séquences de handouts'));
    panel.appendChild(el('p', 'gmc-hint', 'Prépare des suites de handouts (🖼️ images, 🎬 vidéos, 🎵 audios, 💬 événements chat) et envoie-les dans l’ordre — à toute la table ou aux joueurs choisis.'));
    for (const seq of state.sequences) {
      const row = el('div', 'gmc-obj');
      const icons = seq.items.map((it) => ITEM_TYPES[itemType(it)].icon).join('');
      row.appendChild(el('span', 'gmc-obj-name', `${esc(seq.name)} <span class="gmc-count">${seq.items.length} élément(s) ${icons}</span>`));
      const play = el('button', 'gmc-mini', '▶');
      play.type = 'button'; play.title = 'Projeter';
      play.addEventListener('click', () => { projState = { mode: 'play', seqId: seq.id, idx: 0 }; paintSide(); });
      const edit = el('button', 'gmc-mini', '✎');
      edit.type = 'button'; edit.title = 'Éditer';
      edit.addEventListener('click', () => { projState = { mode: 'edit', seqId: seq.id, idx: 0 }; paintSide(); });
      row.append(play, edit);
      panel.appendChild(row);
    }
    if (!state.sequences.length) panel.appendChild(el('p', 'muted', 'Aucune séquence.'));
    const add = el('button', 'gmc-btn gold', '＋ Nouvelle séquence');
    add.type = 'button';
    add.addEventListener('click', () => { projState = { mode: 'edit', seqId: null, idx: 0 }; paintSide(); });
    panel.appendChild(add);
  }

  function paintSeqEditor(existing) {
    const seq = existing
      ? JSON.parse(JSON.stringify(existing))
      : { id: `seq-${Math.random().toString(36).slice(2, 10)}`, name: 'Nouvelle séquence', items: [] };
    panel.appendChild(el('p', 'eyebrow', '✎ Séquence'));
    const name = el('input', 'gmc-input');
    name.value = seq.name;
    name.placeholder = 'Nom (ex. Séance 12 — l’abordage)';
    name.addEventListener('change', () => { seq.name = name.value; });
    panel.appendChild(name);
    const list = el('div', 'gmc-seq-items');
    panel.appendChild(list);
    const paintItems = () => {
      list.innerHTML = '';
      seq.items.forEach((it, i) => {
        const box = el('div', 'gmc-seq-item');
        const head = el('div', 'gmc-seq-head');
        head.appendChild(el('span', 'gmc-count', `${i + 1}.`));
        const up = el('button', 'gmc-mini', '↑'); up.type = 'button'; up.title = 'Monter';
        up.addEventListener('click', () => { if (i > 0) { seq.items.splice(i - 1, 0, seq.items.splice(i, 1)[0]); paintItems(); } });
        const down = el('button', 'gmc-mini', '↓'); down.type = 'button'; down.title = 'Descendre';
        down.addEventListener('click', () => { if (i < seq.items.length - 1) { seq.items.splice(i + 1, 0, seq.items.splice(i, 1)[0]); paintItems(); } });
        const del = el('button', 'gmc-mini', '✕'); del.type = 'button'; del.title = 'Retirer';
        del.addEventListener('click', () => { seq.items.splice(i, 1); paintItems(); });
        head.append(up, down, del);
        box.appendChild(head);
        // type du handout : 🖼️/🎬/🎵/💬 — auto-détecté sur la src (.mp3 → audio…)
        const typeSel = el('select', 'gmc-input');
        typeSel.innerHTML = Object.entries(ITEM_TYPES)
          .map(([k, tt]) => `<option value="${k}"${itemType(it) === k ? ' selected' : ''}>${tt.icon} ${tt.label}</option>`).join('');
        typeSel.addEventListener('change', () => { it.type = typeSel.value; paintItems(); });
        box.appendChild(typeSel);
        if (itemType(it) === 'chat') {
          const text = el('textarea', 'gmc-input');
          text.rows = 3;
          text.value = it.text || '';
          text.placeholder = 'Texte envoyé dans le tchat Foundry (HTML léger autorisé)';
          text.addEventListener('change', () => { it.text = text.value; });
          box.appendChild(text);
        } else {
          const src = el('input', 'gmc-input'); src.value = it.src || ''; src.placeholder = 'worlds/… (.webp, .mp3, .mp4) ou https://…';
          src.addEventListener('change', () => {
            it.src = src.value.trim();
            const auto = detectType(it.src);
            if (auto !== itemType(it)) { it.type = auto; paintItems(); } // .mp3 → audio, .mp4 → vidéo
          });
          box.appendChild(src);
        }
        const title = el('input', 'gmc-input'); title.value = it.title || ''; title.placeholder = 'Titre (montré aux joueurs)';
        title.addEventListener('change', () => { it.title = title.value; });
        const note = el('input', 'gmc-input'); note.value = it.note || ''; note.placeholder = 'Note MJ (jamais montrée)';
        note.addEventListener('change', () => { it.note = note.value; });
        box.append(title, note);
        box.appendChild(el('p', 'gmc-field-lbl', '📫 Destinataires (aucun coché = toute la table)'));
        box.appendChild(targetsPicker(it));
        list.appendChild(box);
      });
    };
    paintItems();
    const addItem = el('button', 'gmc-btn', '＋ handout (image, vidéo, audio ou chat)');
    addItem.type = 'button';
    addItem.addEventListener('click', () => { seq.items.push({ type: 'image', src: '', title: '', note: '' }); paintItems(); });
    panel.appendChild(addItem);

    const actions = el('div', 'gmc-id-actions');
    const save = el('button', 'gmc-btn gold', '💾 Enregistrer la séquence');
    save.type = 'button';
    save.addEventListener('click', async () => {
      save.disabled = true;
      try {
        const out = await api('/gm/sequences', { method: 'PUT', body: JSON.stringify(seq) });
        const i = state.sequences.findIndex((x) => x.id === out.sequence.id);
        if (i >= 0) state.sequences[i] = out.sequence; else state.sequences.push(out.sequence);
        projState = { mode: 'list', seqId: null, idx: 0 };
        paintSide();
      } catch (e) { save.textContent = `✗ ${e.message}`.slice(0, 40); save.disabled = false; }
    });
    actions.appendChild(save);
    if (existing) {
      const del = el('button', 'gmc-btn danger', '🗑️ Supprimer la séquence');
      del.type = 'button';
      del.addEventListener('click', async () => {
        try {
          await api(`/gm/sequences/${encodeURIComponent(seq.id)}`, { method: 'DELETE' });
          state.sequences = state.sequences.filter((x) => x.id !== seq.id);
          delete state.board.nodes['seq:' + seq.id];
          scheduleSave();
          projState = { mode: 'list', seqId: null, idx: 0 };
          paint();
          paintSide();
        } catch (e) { del.textContent = `✗ ${e.message}`.slice(0, 40); }
      });
      actions.appendChild(del);
    }
    const back = el('button', 'gmc-btn', '← Séquences');
    back.type = 'button';
    back.addEventListener('click', () => { projState = { mode: 'list', seqId: null, idx: 0 }; paintSide(); });
    actions.appendChild(back);
    panel.appendChild(actions);
  }

  // Aperçu MJ d'un handout selon son type (image/vidéo/audio/texte de chat).
  function handoutPreview(it) {
    const type = itemType(it);
    if (type === 'chat') return el('div', 'gmc-handout-chat', it.text || '<p class="muted">(texte vide)</p>'); // assaini serveur au save
    if (type === 'video') {
      const v = el('video', 'gmc-id-img');
      v.controls = true;
      v.src = gmAssetUrl(it.src);
      return v;
    }
    if (type === 'audio') {
      const box = el('div');
      box.appendChild(el('p', 'gmc-hint', `🎵 ${esc(it.title || it.src || '')}`));
      const a = el('audio');
      a.controls = true;
      a.src = gmAssetUrl(it.src);
      a.style.width = '100%';
      box.appendChild(a);
      return box;
    }
    const img = el('img', 'gmc-id-img');
    img.alt = it.title || '';
    img.src = gmAssetUrl(it.src);
    img.addEventListener('error', () => { img.replaceWith(el('p', 'muted', '(aperçu indisponible)')); }, { once: true });
    return img;
  }

  function paintSeqPlayer(seq) {
    if (!seq.items.length) { projState = { mode: 'edit', seqId: seq.id, idx: 0 }; return paintSeqEditor(seq); }
    projState.idx = Math.max(0, Math.min(projState.idx, seq.items.length - 1));
    const it = seq.items[projState.idx];
    const type = itemType(it);
    panel.appendChild(el('p', 'eyebrow', `🎞️ ${esc(seq.name)}`));
    const pos = el('p', 'gmc-seq-pos', `${projState.idx + 1}/${seq.items.length} · ${ITEM_TYPES[type].icon}${it.title ? ' — ' + esc(it.title) : ''}`);
    panel.appendChild(pos);
    panel.appendChild(handoutPreview(it));
    // pastille destinataires : « → Tous » ou « → Kara, Tom » (noms via /gm/players)
    const dest = el('p', 'gmc-hint gmc-targets-badge', esc(targetsBadge(it)));
    panel.appendChild(dest);
    if (players === null) loadPlayers().then(() => { dest.textContent = targetsBadge(it); });
    if (it.note) panel.appendChild(el('p', 'gmc-hint', `📝 ${esc(it.note)}`));
    const status = el('p', 'gmc-hint', '');
    const nav = el('div', 'gmc-seq-nav');
    const mk = (label, delta) => {
      const b = el('button', 'gmc-btn', label);
      b.type = 'button';
      b.disabled = (projState.idx + delta < 0) || (projState.idx + delta >= seq.items.length);
      b.addEventListener('click', () => { projState.idx += delta; paintSide(); pushCurrent(); });
      return b;
    };
    const show = el('button', 'gmc-btn gold', `📡 Envoyer (${ITEM_TYPES[type].label})`);
    show.type = 'button';
    show.addEventListener('click', () => pushHandout(it, status));
    // Précédent/Suivant : navigue ET pousse aux joueurs (préparation → projection)
    let pushCurrent = () => {
      const cur = seq.items[projState.idx];
      const st = panel.querySelector('.gmc-seq-status');
      if (cur && st) pushHandout(cur, st);
    };
    nav.append(mk('← Précédent', -1), show, mk('Suivant →', +1));
    panel.appendChild(nav);
    status.classList.add('gmc-seq-status');
    panel.appendChild(status);
    const back = el('button', 'gmc-btn', '← Séquences');
    back.type = 'button';
    back.addEventListener('click', () => { projState = { mode: 'list', seqId: null, idx: 0 }; paintSide(); });
    panel.appendChild(back);
  }

  /* -------------------------------------------------- 📓 Séance (la trace) -- */
  // Cycle de vie de la séance : ▶ démarrer → (la trace se remplit TOUTE SEULE
  // pendant la partie) → ■ terminer, ce qui pré-remplit le récap MJ à partir de
  // ce qui a été joué/révélé/montré. Le MJ ne saisit que deux phrases.
  const two = (n) => String(n).padStart(2, '0');
  const fmtTime = (ms) => { const d = new Date(ms); return `${two(d.getHours())}:${two(d.getMinutes())}`; };
  const fmtDay = (s) => {
    const ms = s.startedAt || Date.parse(s.date || '') || 0;
    return ms ? new Date(ms).toLocaleDateString('fr-FR') : (s.date || '—');
  };
  const fmtDur = (ms) => {
    if (!(ms > 0)) return '';
    const m = Math.round(ms / 60000);
    return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${two(m % 60)}`;
  };
  const actName = (id) => catById.get(id)?.name || '';

  /** Récap MJ pré-rempli : du TEXTE lisible (jamais du JSON) que le MJ complète. */
  function recapDraft(s) {
    const lines = [`Séance ${s.no}${s.title && s.title !== `Séance ${s.no}` ? ` — ${s.title}` : ''} · ${fmtDay(s)}`];
    const dur = fmtDur((s.endedAt || Date.now()) - (s.startedAt || 0));
    if (dur) lines.push(`Durée : ${dur}`);
    lines.push('');
    lines.push(`Joué (${s.played.length}) :`);
    for (const p of s.played) {
      const k = BEAT_KINDS[p.kind] || BEAT_KINDS.scene;
      const a = actName(p.actId);
      lines.push(`- ${k.icon} ${p.title || '(sans titre)'}${a ? ` — ${a}` : ''} (${fmtTime(p.at)})`);
    }
    if (!s.played.length) lines.push('- (aucun beat marqué « fait »)');
    if (s.reveals.length) {
      lines.push('', `Révélé aux joueurs (${s.reveals.length}) :`);
      for (const r of s.reveals) lines.push(`- 👁 ${r.label || r.uuid} (${fmtTime(r.at)})${r.note ? ` — ${r.note}` : ''}`);
    }
    if (s.shown.length) {
      lines.push('', `Montré (${s.shown.length}) :`);
      for (const h of s.shown) {
        const t = ITEM_TYPES[h.type] || ITEM_TYPES.image;
        lines.push(`- ${t.icon} ${h.title || '(sans titre)'} → ${h.targets?.length ? `${h.targets.length} joueur(s)` : 'toute la table'} (${fmtTime(h.at)})`);
      }
    }
    lines.push('', 'À retenir pour la prochaine fois : ');
    return lines.join('\n');
  }

  async function startSession(statusEl) {
    const no = state.sessions.reduce((m, s) => Math.max(m, +s.no || 0), 0) + 1;
    const s = {
      id: `sess-${Math.random().toString(36).slice(2, 10)}`,
      no,
      title: `Séance ${no}`,
      date: new Date().toISOString().slice(0, 10),
      startedAt: Date.now(),
      endedAt: 0,
      played: [], reveals: [], shown: [], present: [],
      recap: { gm: '', players: '' },
    };
    state.sessions.push(s);
    if (statusEl) statusEl.textContent = '…';
    try {
      await saveSessions();
      await setCurrentSession(s.id);
    } catch (e) { if (statusEl) statusEl.textContent = `⚠️ ${e.message}`.slice(0, 80); return; }
    paintSide();
  }

  async function endSession(s, statusEl) {
    s.endedAt = Date.now();
    if (!String(s.recap?.gm || '').trim()) {
      s.recap = { ...(s.recap || {}), gm: recapDraft(s) }; // pré-rempli, le MJ complète
    }
    if (statusEl) statusEl.textContent = '…';
    try {
      await saveSessions();
      await setCurrentSession('');
    } catch (e) { if (statusEl) statusEl.textContent = `⚠️ ${e.message}`.slice(0, 80); return; }
    paintSide();
  }

  // Sauvegarde douce des champs éditables d'une séance (titre, date, récaps).
  let sessSaveTimer = null;
  function scheduleSessionsSave(statusEl) {
    clearTimeout(sessSaveTimer);
    if (statusEl) statusEl.textContent = '…';
    sessSaveTimer = setTimeout(async () => {
      try { await saveSessions(); if (statusEl) statusEl.textContent = '✅ Enregistré'; }
      catch (e) { if (statusEl) statusEl.textContent = `⚠️ ${e.message}`.slice(0, 80); }
    }, 700);
  }
  cleanup.push(() => clearTimeout(sessSaveTimer));

  function paintSession() {
    panel.appendChild(el('p', 'eyebrow', '📓 Séance'));
    const status = el('p', 'gmc-hint', '');
    const cur = openSession();

    if (!cur) {
      panel.appendChild(el('p', 'gmc-hint',
        'Aucune séance ouverte. <b>Démarre une séance</b> pour que l’Archive garde trace de ce qui se joue : '
        + 'chaque beat passé à ✓ <i>fait</i>, chaque handout projeté et chaque 👁 révélation s’inscrivent tout seuls — '
        + 'tu n’as rien à saisir pendant la partie.'));
      const go = el('button', 'gmc-btn gold', '▶ Démarrer la séance');
      go.type = 'button';
      go.addEventListener('click', () => startSession(status));
      panel.append(go, status);
    } else {
      const dur = fmtDur(Date.now() - (cur.startedAt || 0));
      panel.appendChild(el('p', 'gmc-hint',
        `🔴 <b>Séance ${cur.no}</b> en cours depuis ${fmtTime(cur.startedAt)}${dur ? ` (${dur})` : ''} — tout ce que tu joues s’inscrit ici.`));

      const title = el('input', 'gmc-input');
      title.value = cur.title || '';
      title.placeholder = 'Titre de la séance (ex. L’abordage du Vanguard)';
      title.addEventListener('change', () => { cur.title = title.value.slice(0, 120); scheduleSessionsSave(status); });
      const date = el('input', 'gmc-input');
      date.type = 'date';
      date.value = cur.date || '';
      date.addEventListener('change', () => { cur.date = date.value; scheduleSessionsSave(status); });
      panel.append(title, date);

      panel.appendChild(el('p', 'gmc-field-lbl', 'Ce qui est déjà tracé'));
      const counts = el('div', 'gmc-obj-list');
      counts.appendChild(el('p', 'gmc-hint',
        `🎬 <b>${cur.played.length}</b> beat(s) joué(s) · 👁 <b>${cur.reveals.length}</b> révélation(s) · 📡 <b>${cur.shown.length}</b> projection(s)`));
      for (const p of cur.played.slice(-6).reverse()) {
        const k = BEAT_KINDS[p.kind] || BEAT_KINDS.scene;
        const a = actName(p.actId);
        counts.appendChild(el('p', 'gmc-hint', `${k.icon} ${esc(p.title || '(sans titre)')}${a ? ` <span class="gmc-count">${esc(a)}</span>` : ''} <span class="gmc-count">${fmtTime(p.at)}</span>`));
      }
      for (const r of cur.reveals.slice(-4).reverse()) {
        counts.appendChild(el('p', 'gmc-hint', `👁 ${esc(r.label || r.uuid)} <span class="gmc-count">${fmtTime(r.at)}</span>`));
      }
      for (const h of cur.shown.slice(-4).reverse()) {
        const t = ITEM_TYPES[h.type] || ITEM_TYPES.image;
        counts.appendChild(el('p', 'gmc-hint', `${t.icon} ${esc(h.title || '(sans titre)')} <span class="gmc-count">${h.targets?.length ? `${h.targets.length} joueur(s)` : 'toute la table'}</span>`));
      }
      if (!cur.played.length && !cur.reveals.length && !cur.shown.length) {
        counts.appendChild(el('p', 'muted', 'Rien encore — ouvre le storyboard d’un acte et passe un beat à ✓ fait.'));
      }
      panel.appendChild(counts);

      const stop = el('button', 'gmc-btn gold', '■ Terminer la séance');
      stop.type = 'button';
      stop.title = 'Fige l’heure de fin et pré-remplit le récap MJ à partir de ce qui a été joué';
      stop.addEventListener('click', () => endSession(cur, status));
      panel.append(stop, status);
    }

    // --- séances closes : récap MJ + version publiable ------------------------
    const past = state.sessions.filter((s) => s.endedAt && s.id !== cur?.id).sort((a, b) => b.startedAt - a.startedAt);
    panel.appendChild(el('p', 'gmc-field-lbl', '📚 Séances passées'));
    if (!past.length) {
      panel.appendChild(el('p', 'muted', 'Aucune séance archivée pour l’instant — la première clôture en créera une.'));
      return;
    }
    for (const s of past.slice(0, 20)) {
      const box = el('details', 'gmc-obj-group');
      const sum = el('summary', '', `Séance ${s.no} · ${esc(fmtDay(s))} <span class="gmc-count">${s.played.length} beat(s)${fmtDur(s.endedAt - s.startedAt) ? ' · ' + fmtDur(s.endedAt - s.startedAt) : ''}</span>`);
      box.appendChild(sum);
      const gm = el('textarea', 'gmc-input');
      gm.rows = 6;
      gm.value = s.recap?.gm || '';
      gm.placeholder = 'Récap MJ (pré-rempli à la clôture) — ce que tu veux retenir.';
      gm.addEventListener('change', () => { s.recap = { ...(s.recap || {}), gm: gm.value.slice(0, 8000) }; scheduleSessionsSave(status); });
      const pl = el('textarea', 'gmc-input');
      pl.rows = 4;
      pl.value = s.recap?.players || '';
      pl.placeholder = 'Version publiable pour les joueurs (affichée dans « Où en est-on ? »).';
      pl.addEventListener('change', () => { s.recap = { ...(s.recap || {}), players: pl.value.slice(0, 8000) }; scheduleSessionsSave(status); });
      const copy = el('button', 'gmc-btn', '⤵ Repartir du récap MJ');
      copy.type = 'button';
      copy.title = 'Copie le récap MJ dans la version joueurs (à élaguer des secrets)';
      copy.addEventListener('click', () => {
        pl.value = gm.value;
        s.recap = { ...(s.recap || {}), players: pl.value.slice(0, 8000) };
        scheduleSessionsSave(status);
      });
      box.append(el('p', 'gmc-field-lbl', '🔒 Récap MJ'), gm, el('p', 'gmc-field-lbl', '👥 Récap joueurs'), pl, copy);
      panel.appendChild(box);
    }
    panel.appendChild(status);
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

  /* ------------------------------------------------ 🎬 Storyboard d'acte (A2) --
   * L'acte est un STORYBOARD construit sur la carte : ses beats (moments de jeu
   * typés) en chaîne horizontale « puis → », et autour, les ENTITÉS CC qu'ils
   * référencent en petits nœuds satellites — leurs liens CC se dessinent entre
   * elles (le moteur d'arêtes du catalogue, exploité à fond). */
  const trunc = (s, n) => (String(s).length > n ? String(s).slice(0, n - 1) + '…' : String(s));
  let sbPos = new Map();     // beatId -> {x, y} du layout courant (drag/réordonnancement)
  let sbSatPos = new Map();  // entityId -> {x, y}
  let sbProj = false;        // player de séquence ouvert DEPUIS un beat
  let prefillInfo = '';      // ⚡ ce que l'attache d'un élément vient de pré-remplir
  let encLib = null;         // ⚔️ bibliothèque de rencontres (lazy)
  async function loadEncLib() {
    try { encLib = (await api('/gm/encounters')).encounters || []; }
    catch { encLib = []; }
  }

  // chemin d'arête VERTICAL (beat → satellite) — pendant de edgePath (horizontal)
  function edgePathV(a, b) {
    const my = (a.y + b.y) / 2;
    return `M ${a.x} ${a.y} C ${a.x} ${my}, ${b.x} ${my}, ${b.x} ${b.y}`;
  }

  function sbLayout(beats) {
    sbPos = new Map();
    beats.forEach((b, i) => sbPos.set(b.id, { x: i * (BEAT_W + BEAT_GX), y: 0 }));
    // satellites : entités uniques, placées sous le barycentre de leurs beats,
    // en rangées successives quand ça se chevauche.
    const refs = new Map(); // entityId -> [centres x des beats référents]
    beats.forEach((b, i) => (b.uuids || []).forEach((u) => {
      const id = u.split('.').pop();
      if (!refs.has(id)) refs.set(id, []);
      refs.get(id).push(i * (BEAT_W + BEAT_GX) + BEAT_W / 2);
    }));
    const avg = (a) => a.reduce((t, v) => t + v, 0) / a.length;
    sbSatPos = new Map();
    const laneEnd = [];
    const ids = [...refs.keys()].sort((a, b) => avg(refs.get(a)) - avg(refs.get(b)));
    for (const id of ids) {
      let x = avg(refs.get(id)) - SAT_W / 2;
      let row = 0;
      while (row < 6 && laneEnd[row] !== undefined && x < laneEnd[row] + 18) row++;
      if (row >= 6) { row = 0; x = laneEnd[0] + 18; } // toutes les rangées pleines : à droite
      laneEnd[row] = x + SAT_W;
      sbSatPos.set(id, { x, y: BEAT_H + 96 + row * (SAT_H + 34) });
    }
    return refs;
  }

  function beatSvg(b, i) {
    const k = BEAT_KINDS[b.kind] || BEAT_KINDS.scene;
    const p = sbPos.get(b.id);
    const sel = state.selected?.kind === 'beat' && state.selected.id === b.id;
    const st = STATUS_META[b.status] || STATUS_META.todo;
    const meta = [];
    if (b.uuids?.length) meta.push(`👥 ${b.uuids.length}`);
    if (b.encounterId) meta.push('⚔️ rencontre');
    if (b.sequenceId) meta.push('🎞️ séquence');
    if (b.handout) meta.push(`📜 ${ITEM_TYPES[itemType(b.handout)].icon}`);
    if (b.sound) meta.push('🎵');
    if (b.trigger && Object.keys(b.trigger).length) meta.push('⚡'); // ▶ jouable
    if (b.kind === 'note') meta.push('🔒 MJ');
    const pin = pinnedBeat();
    if (pin && pin.actId === state.sb?.actId && pin.beatId === b.id) meta.push('📌');
    const W = BEAT_W, H = BEAT_H;
    // FORMES typées : 🎭 panneau arrondi · ⚔️ panneau anguleux (chanfreins) ·
    // 🗒️ post-it penché à coin corné · 🖼️ cadre photo (double bordure).
    const shape = {
      scene: `<rect class="gmc-beat-bg" width="${W}" height="${H}" rx="18"/>`,
      combat: `<polygon class="gmc-beat-bg" points="14,0 ${W - 14},0 ${W},14 ${W},${H - 14} ${W - 14},${H} 14,${H} 0,${H - 14} 0,14"/>`,
      note: `<rect class="gmc-beat-bg" width="${W}" height="${H}" rx="2"/><path class="gmc-beat-fold" d="M ${W - 16} ${H} L ${W} ${H - 16} L ${W} ${H} Z"/>`,
      handout: `<rect class="gmc-beat-bg" width="${W}" height="${H}" rx="4"/><rect class="gmc-beat-frame" x="6" y="6" width="${W - 12}" height="${H - 12}" rx="2"/>`,
    }[b.kind] || `<rect class="gmc-beat-bg" width="${W}" height="${H}" rx="18"/>`;
    const inner = `${shape}
      <text x="12" y="19" class="gmc-beat-kind">${i + 1} · ${k.icon} ${k.label}</text>
      <text x="12" y="44" class="gmc-beat-title">${esc(trunc(b.title || '(sans titre)', 26))}</text>
      <text x="12" y="${H - 12}" class="gmc-beat-meta">${meta.join('  ')}</text>
      <g class="gmc-beat-st st-${esc(b.status)}"><title>${st.label} — clic : changer le statut</title>
        <circle cx="${W - 18}" cy="18" r="11"/><text x="${W - 18}" y="22.5">${st.icon}</text></g>`;
    return `<g class="gmc-beat ${esc(b.kind)}${sel ? ' selected' : ''}${b.status === 'encours' ? ' current' : ''}${b.status === 'fait' ? ' done' : ''}"
        data-beat="${esc(b.id)}" transform="translate(${p.x},${p.y})" tabindex="0" role="button" aria-label="${esc(b.title || k.label)}">
      ${b.kind === 'note' ? `<g transform="rotate(-1.6 ${W / 2} ${H / 2})">${inner}</g>` : inner}
    </g>`;
  }

  function paintStoryboard() {
    const beats = sbData().beats;
    sbLayout(beats);
    let eh = '';
    // la chaîne narrative « puis → »
    for (let i = 0; i + 1 < beats.length; i++) {
      const a = sbPos.get(beats[i].id), b = sbPos.get(beats[i + 1].id);
      const y = BEAT_H / 2;
      eh += `<g class="gmc-edge sb-chain"><path d="M ${a.x + BEAT_W + 4} ${y} L ${b.x - 6} ${y}" marker-end="url(#gmc-arrow-custom)"/>
        <text x="${(a.x + BEAT_W + b.x) / 2}" y="${y - 8}" class="gmc-chain-lbl">puis</text></g>`;
    }
    // beat → entités référencées
    for (const b of beats) {
      const bp = sbPos.get(b.id);
      for (const u of (b.uuids || [])) {
        const sp = sbSatPos.get(u.split('.').pop());
        if (sp) eh += `<g class="gmc-edge sb-ref"><path d="${edgePathV({ x: bp.x + BEAT_W / 2, y: BEAT_H }, { x: sp.x + SAT_W / 2, y: sp.y })}"/></g>`;
      }
    }
    // liens CC ENTRE les entités présentes (moteur d'arêtes du catalogue)
    for (const e of state.catalog.edges) {
      const a = sbSatPos.get(e.from), b = sbSatPos.get(e.to);
      if (!a || !b) continue;
      eh += `<g class="gmc-edge auto"><path d="${edgePath({ x: a.x + SAT_W / 2, y: a.y + SAT_H / 2 }, { x: b.x + SAT_W / 2, y: b.y + SAT_H / 2 })}" marker-end="url(#gmc-arrow)"><title>${esc(e.rel)}</title></path></g>`;
    }
    edgesG.innerHTML = eh;
    tempG.innerHTML = '';

    let nh = '';
    beats.forEach((b, i) => { nh += beatSvg(b, i); });
    for (const [id, p] of sbSatPos) {
      const m = nodeMeta(id);
      const t = NODE_TYPES[m.type] || NODE_TYPES.quest;
      const sel = state.selected?.kind === 'sat' && state.selected.id === id;
      nh += `<g class="gmc-sat${sel ? ' selected' : ''}${m.ghost ? ' ghost' : ''}" data-sat="${esc(id)}" data-type="${esc(m.type)}"
          transform="translate(${p.x},${p.y})" tabindex="0" role="button" aria-label="${esc(m.name)}">
        <rect width="${SAT_W}" height="${SAT_H}" rx="8" style="--tc:${t.color}"/>
        <text x="9" y="${SAT_H / 2 + 4}" class="gmc-ico-s">${t.icon}</text>
        <text x="28" y="${SAT_H / 2 + 4}" class="gmc-sat-name">${esc(trunc(m.name, 16))}</text>
      </g>`;
    }
    if (!beats.length) nh += '<text x="24" y="40" class="gmc-sb-empty">Storyboard vide — ajoute un premier moment de jeu (panneau de droite).</text>';
    nodesG.innerHTML = nh;
  }

  /* ------------------------------------------- panneau latéral du storyboard -- */
  function paintSbSide() {
    panel.innerHTML = '';
    if (sbProj) {
      const s = state.sequences.find((x) => x.id === projState.seqId);
      if (projState.mode === 'play' && s) return paintSeqPlayer(s);
      sbProj = false; // le player a rendu la main (← Séquences)
    }
    if (state.selected?.kind === 'beat') return paintBeatEditor(state.selected.id);
    if (state.selected?.kind === 'sat') return paintIdentity(state.selected.id);
    return paintSbOverview();
  }

  /** Change le statut d'un beat — POINT D'ACCROCHE UNIQUE de la trace : passer à
   * « fait » inscrit le beat dans la séance ouverte (horodaté, avec son acte). */
  function setBeatStatus(b, status) {
    const before = b.status;
    b.status = status;
    if (status === 'fait' && before !== 'fait') {
      trace('played', { actId: state.sb?.actId || '', beatId: b.id, title: b.title || '', kind: b.kind });
    }
    scheduleSbSave();
    paintLegend();
    paint();
    paintSide();
  }

  function cycleStatus(b) {
    setBeatStatus(b, BEAT_STATUS[(BEAT_STATUS.indexOf(b.status) + 1) % BEAT_STATUS.length]);
  }

  function addBeat(kind) {
    const beats = sbData().beats;
    const b = { id: `beat-${Math.random().toString(36).slice(2, 10)}`, kind, title: '', note: '', uuids: [], status: 'todo' };
    beats.push(b);
    state.selected = { kind: 'beat', id: b.id };
    scheduleSbSave();
    paintLegend();
    paint();
    paintSide();
  }

  function paintSbOverview() {
    const act = sbAct();
    const beats = sbData().beats;
    panel.appendChild(el('p', 'eyebrow', `🎬 Storyboard — ${esc(act?.name || '')}`));
    panel.appendChild(el('p', 'gmc-hint', 'L’acte, en moments de jeu enchaînés : 🎭 scène · ⚔️ combat · 🗒️ note MJ · 🖼️ handout. '
      + 'Clic sur un beat : éditer · pastille ○▶✓ : statut · glisser : réordonner. MJ only — jamais montré aux joueurs.'));
    // 📓 état de la trace : le storyboard est le poste de pilotage, on démarre
    // la séance d'ici (le panneau à onglets n'existe pas en mode storyboard).
    const cur = openSession();
    if (cur) {
      const n = cur.played.length + cur.reveals.length + cur.shown.length;
      panel.appendChild(el('p', 'gmc-hint', `🔴 <b>Séance ${cur.no}</b> ouverte — <b>${n}</b> événement(s) tracé(s). `
        + 'Passer un beat à ✓ <i>fait</i> l’inscrit automatiquement.'));
    } else {
      const line = el('p', 'gmc-hint', 'Aucune séance ouverte — rien de ce que tu joues ne sera gardé en mémoire. ');
      const go = el('button', 'gmc-mini', '▶');
      go.type = 'button';
      go.title = 'Démarrer la séance : l’Archive garde trace de ce qui se joue';
      go.addEventListener('click', () => startSession().then(() => paintSide()));
      line.appendChild(go);
      panel.appendChild(line);
    }

    const list = el('div', 'gmc-obj-list');
    beats.forEach((b, i) => {
      const k = BEAT_KINDS[b.kind] || BEAT_KINDS.scene;
      const st = STATUS_META[b.status] || STATUS_META.todo;
      const row = el('div', 'gmc-obj' + (b.status === 'encours' ? ' on-map' : ''));
      const stBtn = el('button', `gmc-mini gmc-st st-${b.status}`, st.icon);
      stBtn.type = 'button';
      stBtn.title = `${st.label} — clic : changer le statut`;
      stBtn.addEventListener('click', () => cycleStatus(b));
      const name = el('button', 'gmc-obj-name gmc-obj-btn', `${i + 1} · ${k.icon} ${esc(b.title || '(sans titre)')}`);
      name.type = 'button';
      name.addEventListener('click', () => { state.selected = { kind: 'beat', id: b.id }; paint(); paintSide(); });
      row.append(stBtn, name);
      list.appendChild(row);
    });
    if (!beats.length) list.appendChild(el('p', 'muted', 'Aucun beat pour l’instant.'));
    panel.appendChild(list);

    panel.appendChild(el('p', 'gmc-field-lbl', '＋ Ajouter un moment de jeu'));
    const addRow = el('div', 'gmc-kind-row');
    for (const [kk, t] of Object.entries(BEAT_KINDS)) {
      const btn = el('button', `gmc-btn gmc-kind ${kk}`, `${t.icon} ${t.label}`);
      btn.type = 'button';
      btn.title = t.hint;
      btn.addEventListener('click', () => addBeat(kk));
      addRow.appendChild(btn);
    }
    panel.appendChild(addRow);

    // 🏷️ tags d'acte : au save, pose mj:acte-<n> sur les fiches CC référencées
    // (idempotent — retire aussi celles qui ne jouent plus) ; décocher RETIRE tout.
    const nAct = (/(\d+)/.exec(act?.name || '') || [])[1] || '…';
    const tagBox = el('label', 'gmc-hide gmc-tagbox');
    const cb = el('input');
    cb.type = 'checkbox';
    cb.checked = sbTagOn();
    cb.addEventListener('change', () => {
      localStorage.setItem(sbTagKey(), cb.checked ? '1' : '');
      scheduleSbSave(true, cb.checked); // sync immédiate : pose tout / retire tout
    });
    tagBox.append(cb, document.createTextNode(` 🏷️ Taguer les participants (mj:acte-${nAct}) — Asset Librarian retrouve « tout ce qui joue dans l'acte »`));
    panel.appendChild(tagBox);
    if (sbTagInfo) panel.appendChild(el('p', 'gmc-hint', `🏷️ ${esc(sbTagInfo)}`));

    const actions = el('div', 'gmc-id-actions');
    const sum = el('button', 'gmc-btn', '📜 Sommaire d’acte');
    sum.type = 'button';
    sum.addEventListener('click', () => paintActEditor(state.sb.actId));
    const back = el('button', 'gmc-btn', '← Retour à la carte');
    back.type = 'button';
    back.addEventListener('click', () => exitStoryboard());
    actions.append(sum, back);
    panel.appendChild(actions);
  }

  /* ------------------------------------ ▶ Jouer ce beat (déclencheurs, A3) --
   * Chaque beat DÉCLARE ce qu'il déclenche (`trigger`). Le bouton n'exécute que
   * ça, côté serveur (POST /gm/beat/play : le beat est RELU depuis Foundry).
   * DIDACTIQUE : on affiche avant ce qui partira, et après ce qui a marché. */
  const triggerOf = (b) => (b.trigger || (b.trigger = {}));

  /** Attacher un ÉLÉMENT pré-remplit le déclencheur du beat — sans jamais
   * écraser un réglage déjà posé par le MJ. Retourne la liste de ce qui a été
   * pré-rempli (affichée en clair : aucun effet surprise). */
  function applyElemPrefill(b, n) {
    if (!n?.elemKind) return [];
    const t = triggerOf(b);
    const d = n.elemData || {};
    const done = [];
    if (n.elemKind === 'ambiance') {
      if (d.playlist && !t.playlist) { t.playlist = d.playlist; done.push(`🎵 playlist « ${d.playlist} »`); }
      const w = String(d.weather || '').split(',').map((x) => x.trim()).filter(Boolean).slice(0, 4);
      if (w.length && !t.weather) { t.weather = w; done.push(`🌦️ météo ${w.join(', ')}`); }
    }
    if (n.elemKind === 'visuel' && d.src && !t.handout) {
      t.handout = { type: 'image', src: d.src, title: (d.legende || n.name || '').slice(0, 120) };
      done.push(`🖼️ handout image « ${t.handout.title} »`);
    }
    return done;
  }

  /* ------------------------------------- 📖 Lire (lectures & visions en grand) --
   * Un élément 📣 lecture (ou 🔮 vision) attaché au beat donne un bouton
   * « 📖 Lire » : le texte s'affiche en GRAND FORMAT côté MJ (théâtre de
   * l'esprit, écran partagé), avec l'option de l'envoyer en handout chat. */
  let readingBox = null;
  function openReading(m) {
    const d = m.elemData || {};
    const text = String(d.texte || '');
    if (!readingBox) {
      readingBox = el('div', 'gmc-reading');
      readingBox.addEventListener('click', (ev) => { if (ev.target === readingBox) readingBox.hidden = true; });
      document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && readingBox && !readingBox.hidden) readingBox.hidden = true; });
      document.body.appendChild(readingBox);
      cleanup.push(() => { readingBox?.remove(); readingBox = null; });
    }
    const asHtml = text.split(/\n{2,}/).map((p) => `<p>${esc(p.trim()).replace(/\n/g, '<br>')}</p>`).join('');
    readingBox.innerHTML = '';
    const inner = el('div', 'gmc-reading-inner');
    inner.appendChild(el('p', 'eyebrow', `${m.elemKind === 'vision' ? '🔮' : '📣'} ${esc(m.name)}${d.pj ? ` — pour ${esc(d.pj)}` : ''}`));
    inner.appendChild(el('div', 'gmc-reading-text', asHtml || '<p class="muted">(texte vide — remplis le champ « texte » de la fiche)</p>'));
    const bar = el('div', 'gmc-seq-nav');
    const status = el('span', 'gmc-hint', '');
    const send = el('button', 'gmc-btn gold', '💬 Envoyer au chat des joueurs');
    send.type = 'button';
    send.title = 'Poste ce texte en handout chat dans Foundry (toute la table)';
    send.addEventListener('click', () => pushHandout({ type: 'chat', text: asHtml, title: m.name }, status));
    const close = el('button', 'gmc-btn', '✕ Fermer (Échap)');
    close.type = 'button';
    close.addEventListener('click', () => { readingBox.hidden = true; });
    bar.append(send, close, status);
    inner.appendChild(bar);
    readingBox.appendChild(inner);
    readingBox.hidden = false;
  }

  /** Bloc « ▶ jouera : … » + alertes + bouton + rapport d'exécution. */
  function playBlock(b) {
    const box = el('div', 'gmc-play');
    const status = el('p', 'gmc-hint gmc-play-report', '');
    const paintDesc = () => {
      const d = describeTrigger(b, {
        encounters: encLib, sequences: state.sequences,
        playlists, playerCount: (players || []).length,
      });
      const head = el('div', 'gmc-play-desc');
      head.innerHTML = d.empty
        ? '<p class="muted">Ce beat ne déclenche rien pour l’instant. Renseigne « ⚡ Ce que ce beat déclenche » ci-dessous : ▶ n’enverra QUE ça.</p>'
        : `<p class="gmc-field-lbl">▶ jouera :</p>${d.lines.map((l) => `<p class="gmc-play-line">${esc(l)}</p>`).join('')}`;
      for (const w of d.warnings) head.insertAdjacentHTML('beforeend', `<p class="gmc-play-warn">⚠️ ${esc(w)}</p>`);
      return head;
    };
    let desc = paintDesc();
    box.appendChild(desc);
    const go = el('button', 'gmc-btn gold', '▶ Jouer ce beat');
    go.type = 'button';
    go.title = 'Exécute dans Foundry exactement ce qui est listé ci-dessus — rien d’autre';
    go.addEventListener('click', async () => {
      go.disabled = true;
      status.textContent = '▶ Envoi à Foundry…';
      try {
        const out = await api('/gm/beat/play', { method: 'POST', body: JSON.stringify({ actId: state.sb.actId, beatId: b.id }) });
        status.innerHTML = renderPlayReport(out);
        if (!out.empty && b.status === 'todo') setBeatStatus(b, 'encours');
      } catch (e) { status.innerHTML = `⚠️ ${esc(e.message)}`; }
      go.disabled = false;
    });
    box.append(go, status);
    // les listes (rencontres/playlists/joueurs) arrivent en tâche de fond :
    // on redessine la description dès qu'elles sont là, sans rien perdre.
    const refresh = () => { const next = paintDesc(); desc.replaceWith(next); desc = next; };
    if (encLib === null) loadEncLib().then(refresh);
    if (playlists === null) loadPlaylists().then(refresh);
    if (players === null) loadPlayers().then(refresh);
    box.dataset.beat = b.id;
    box._refresh = refresh;
    return box;
  }

  /** Éditeur du bloc `trigger` — un réglage = une ligne, jamais de magie. */
  function triggerEditor(b, onChange) {
    const t = triggerOf(b);
    const wrapT = el('div', 'gmc-trigger');
    wrapT.appendChild(el('p', 'gmc-field-lbl', '⚡ Ce que ce beat déclenche'));
    wrapT.appendChild(el('p', 'gmc-hint',
      'Tout est facultatif : ▶ n’exécutera QUE les cases remplies, dans cet ordre — '
      + 'scène → combat → ambiance → météo → handout/séquence → caméra.'));
    const touched = () => { scheduleSbSave(); onChange?.(); };

    // scène + amener les joueurs
    const scene = el('input', 'gmc-input');
    scene.placeholder = '🎬 Scène Foundry à activer (nom exact ou id)';
    scene.value = t.scene || '';
    scene.addEventListener('change', () => { const v = scene.value.trim(); if (v) t.scene = v.slice(0, 120); else delete t.scene; touched(); });
    wrapT.appendChild(scene);
    const pull = el('label', 'gmc-hide');
    const pullCb = el('input');
    pullCb.type = 'checkbox';
    pullCb.checked = t.pullUsers === true;
    pullCb.addEventListener('change', () => { if (pullCb.checked) t.pullUsers = true; else delete t.pullUsers; touched(); });
    pull.append(pullCb, document.createTextNode(' 👥 amener les joueurs sur cette scène (pull_users)'));
    wrapT.appendChild(pull);

    // rencontre liée (beats ⚔️ surtout, mais jamais interdit ailleurs)
    if (encLib === null) loadEncLib().then(() => { if (state.sb && state.selected?.kind === 'beat') paintSide(); });
    const encSel = el('select', 'gmc-input');
    encSel.innerHTML = '<option value="">⚔️ — aucune rencontre montée —</option>'
      + (encLib || []).map((e2) => `<option value="${esc(e2.id)}"${t.encounterId === e2.id ? ' selected' : ''}>⚔️ ${esc(e2.title)}</option>`).join('');
    encSel.title = 'Monte la scène + les tokens + le combat à partir de la bibliothèque de rencontres';
    encSel.addEventListener('change', () => { if (encSel.value) t.encounterId = encSel.value; else delete t.encounterId; touched(); });
    wrapT.appendChild(encSel);

    // playlist
    const pl = el('input', 'gmc-input');
    pl.placeholder = '🎵 Playlist à lancer';
    pl.setAttribute('list', 'gmc-playlists');
    pl.value = t.playlist || '';
    pl.addEventListener('change', () => { const v = pl.value.trim(); if (v) t.playlist = v.slice(0, 100); else delete t.playlist; touched(); });
    wrapT.appendChild(pl);

    // météo (table fermée, « couper » exclusif)
    wrapT.appendChild(el('p', 'gmc-hint', '🌦️ Météo (module compagnon + navigateur MJ requis)'));
    const wBox = el('div', 'gmc-picks');
    const paintW = () => {
      wBox.innerHTML = '';
      const cur = new Set(t.weather || []);
      for (const [key, label] of WEATHER_UI) {
        const lab = el('label', 'gmc-pick');
        const cb = el('input');
        cb.type = 'checkbox';
        cb.checked = cur.has(key);
        cb.addEventListener('change', () => {
          const set = new Set(t.weather || []);
          if (cb.checked) { if (key === 'clear') set.clear(); else set.delete('clear'); set.add(key); }
          else set.delete(key);
          if (set.size) t.weather = [...set].slice(0, 4); else delete t.weather;
          paintW();
          touched();
        });
        lab.append(cb, document.createTextNode(` ${label}`));
        wBox.appendChild(lab);
      }
    };
    paintW();
    wrapT.appendChild(wBox);

    // séquence liée (projection)
    const seqSel = el('select', 'gmc-input');
    seqSel.innerHTML = '<option value="">🎞️ — aucune séquence projetée —</option>'
      + state.sequences.map((s) => `<option value="${esc(s.id)}"${t.sequenceId === s.id ? ' selected' : ''}>🎞️ ${esc(s.name)} (${s.items.length})</option>`).join('');
    seqSel.addEventListener('change', () => { if (seqSel.value) t.sequenceId = seqSel.value; else delete t.sequenceId; touched(); });
    wrapT.appendChild(seqSel);

    // caméra
    const panRow = el('div', 'gmc-seq-nav');
    const mkNum = (key, ph) => {
      const inp = el('input', 'gmc-input');
      inp.type = 'number';
      inp.placeholder = ph;
      inp.value = t.pan?.[key] ?? '';
      inp.addEventListener('change', () => {
        const x = Number(panRow.children[0].value), y = Number(panRow.children[1].value), s = Number(panRow.children[2].value);
        if (Number.isFinite(x) && panRow.children[0].value !== '' || Number.isFinite(y) && panRow.children[1].value !== '') {
          t.pan = { x: x || 0, y: y || 0, ...(s > 0 ? { scale: s } : {}) };
        } else delete t.pan;
        touched();
      });
      return inp;
    };
    panRow.append(mkNum('x', '🎥 x'), mkNum('y', 'y'), mkNum('scale', 'zoom'));
    wrapT.appendChild(panRow);
    return wrapT;
  }

  function paintBeatEditor(id) {
    const beats = sbData().beats;
    const i = beats.findIndex((b) => b.id === id);
    if (i < 0) { state.selected = null; return paintSbOverview(); }
    const b = beats[i];
    const k = BEAT_KINDS[b.kind] || BEAT_KINDS.scene;
    panel.appendChild(el('p', 'eyebrow', `${k.icon} Beat ${i + 1}/${beats.length} — ${k.label}`));

    // ▶ JOUER CE BEAT + ce qu'il déclenchera, EN CLAIR (didactique : aucun
    // effet surprise, on annonce avant d'agir et on rend compte après).
    const playBox = playBlock(b);
    panel.appendChild(playBox);
    if (prefillInfo) { panel.appendChild(el('p', 'gmc-hint gmc-prefill', esc(prefillInfo))); prefillInfo = ''; }

    // 📌 épingler ce beat : le bandeau de séance suit alors la chaîne d'ici
    const pin = pinnedBeat();
    const isPinned = pin && pin.actId === state.sb.actId && pin.beatId === b.id;
    const pinBtn = el('button', 'gmc-btn' + (isPinned ? ' gold' : ''), isPinned ? '📌 Beat de la séance' : '📌 Épingler pour la séance');
    pinBtn.type = 'button';
    pinBtn.disabled = Boolean(isPinned);
    pinBtn.title = 'Le bandeau de séance suivra ce beat : chaîne ◀▶, statut, minuteur, « ne pas oublier »';
    pinBtn.addEventListener('click', async () => {
      await pinBeat(state.sb.actId, b.id, b.title || '');
      paintSide();
    });
    panel.appendChild(pinBtn);

    const kindSel = el('select', 'gmc-input');
    kindSel.innerHTML = Object.entries(BEAT_KINDS)
      .map(([kk, t]) => `<option value="${kk}"${b.kind === kk ? ' selected' : ''}>${t.icon} ${t.label} — ${t.hint}</option>`).join('');
    kindSel.addEventListener('change', () => { b.kind = kindSel.value; scheduleSbSave(); paint(); paintSide(); });
    panel.appendChild(kindSel);

    const title = el('input', 'gmc-input');
    title.placeholder = 'Titre du moment (ex. Embuscade au spatioport)';
    title.value = b.title || '';
    title.addEventListener('change', () => { b.title = title.value.trim().slice(0, 120); scheduleSbSave(); paint(); });
    panel.appendChild(title);

    const note = el('textarea', 'gmc-input');
    note.rows = 4;
    note.placeholder = 'Note MJ courte : intention, accroche, à ne pas oublier… (jamais montrée aux joueurs)';
    note.value = b.note || '';
    note.addEventListener('change', () => { b.note = note.value.slice(0, 2000); scheduleSbSave(); });
    panel.appendChild(note);

    // statut (runbook de séance) : todo / en cours / fait
    const stRow = el('div', 'gmc-seq-nav');
    for (const st of BEAT_STATUS) {
      const m = STATUS_META[st];
      const btn = el('button', 'gmc-btn' + (b.status === st ? ' gold' : ''), `${m.icon} ${m.label}`);
      btn.type = 'button';
      btn.addEventListener('click', () => setBeatStatus(b, st));
      stRow.appendChild(btn);
    }
    panel.appendChild(stRow);

    // entités CC impliquées (satellites sur la carte)
    panel.appendChild(el('p', 'gmc-field-lbl', '👥 Entités impliquées (fiches CC)'));
    const chips = el('div', 'gmc-rels');
    for (const u of (b.uuids || [])) {
      const eid = u.split('.').pop();
      const m = nodeMeta(eid);
      const t = NODE_TYPES[m.type] || NODE_TYPES.quest;
      const row = el('div', 'gmc-obj');
      const open = el('a', 'gmc-obj-name', `${t.icon} ${esc(m.name)}`);
      open.href = `#/journal/${eid}`;
      open.title = 'Ouvrir la fiche';
      // 👁 mémoire des révélations : « les joueurs ont appris ça, à telle heure ».
      // Une entrée `reveals` dans la séance ouverte — la matière du « ne pas oublier ».
      const sess = openSession();
      const seen = (sess?.reveals || []).some((r) => String(r.uuid).endsWith(eid));
      const rev = el('button', 'gmc-mini' + (seen ? ' on' : ''), '👁');
      rev.type = 'button';
      rev.disabled = !sess || seen;
      rev.title = !sess ? 'Démarre une séance (onglet 📓 Séance) pour garder trace des révélations'
        : seen ? 'Déjà marqué révélé dans cette séance'
          : 'Marquer révélé — les joueurs viennent de l’apprendre';
      rev.addEventListener('click', () => {
        trace('reveal', { uuid: u, label: m.name });
        rev.classList.add('on');
        rev.disabled = true;
        rev.title = 'Marqué révélé';
      });
      const rm = el('button', 'gmc-mini', '✕');
      rm.type = 'button';
      rm.title = 'Détacher du beat';
      rm.addEventListener('click', () => {
        b.uuids = b.uuids.filter((x) => x !== u);
        scheduleSbSave();
        paint();
        paintSide();
      });
      row.append(open, rev);
      // 📖 un élément lecture/vision attaché se lit en grand format d'un clic
      if ((m.elemKind === 'lecture' || m.elemKind === 'vision') && m.elemData?.texte) {
        const read = el('button', 'gmc-mini', '📖');
        read.type = 'button';
        read.title = 'Lire en grand format (et option d’envoi au chat des joueurs)';
        read.addEventListener('click', () => openReading(m));
        row.appendChild(read);
      }
      row.appendChild(rm);
      chips.appendChild(row);
    }
    if (!b.uuids?.length) chips.appendChild(el('p', 'muted', 'Aucune — attache PNJ, lieux, orgs, quêtes…'));
    panel.appendChild(chips);
    const search = el('input', 'gmc-input');
    search.type = 'search';
    search.placeholder = 'Attacher une entité (recherche dans le catalogue)…';
    const results = el('div', 'gmc-obj-list');
    const norm = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    search.addEventListener('input', () => {
      const q = norm(search.value.trim());
      results.innerHTML = '';
      if (!q) return;
      const attached = new Set((b.uuids || []).map((u) => u.split('.').pop()));
      const hits = state.catalog.nodes
        .filter((n) => n.type !== 'acte' && !attached.has(n.id) && norm(n.name).includes(q))
        .slice(0, 8);
      for (const n of hits) {
        const t = NODE_TYPES[n.type] || NODE_TYPES.quest;
        const btn = el('button', 'gmc-obj-name gmc-obj-btn', `＋ ${t.icon} ${esc(n.name)}`);
        btn.type = 'button';
        btn.addEventListener('click', () => {
          b.uuids = [...(b.uuids || []), `JournalEntry.${n.id}`];
          // un ÉLÉMENT attaché pré-remplit le déclencheur (jamais d'écrasement)
          const filled = applyElemPrefill(b, n);
          if (filled.length) prefillInfo = `⚡ pré-rempli : ${filled.join(' · ')}`;
          scheduleSbSave();
          paint();
          paintSide();
        });
        results.appendChild(btn);
      }
      if (!hits.length) results.appendChild(el('p', 'muted', 'Rien dans le catalogue.'));
    });
    panel.append(search, results);

    // pièces jointes SELON le kind
    if (b.kind === 'combat') {
      panel.appendChild(el('p', 'gmc-field-lbl', '⚔️ Rencontre liée (bibliothèque)'));
      if (encLib === null) {
        panel.appendChild(el('p', 'muted', 'chargement de la bibliothèque…'));
        loadEncLib().then(() => { if (state.sb && state.selected?.kind === 'beat') paintSide(); });
      } else {
        const encSel = el('select', 'gmc-input');
        encSel.innerHTML = '<option value="">— aucune —</option>'
          + encLib.map((e2) => `<option value="${esc(e2.id)}"${b.encounterId === e2.id ? ' selected' : ''}>${esc(e2.title)}</option>`).join('');
        encSel.addEventListener('change', () => {
          if (encSel.value) b.encounterId = encSel.value; else delete b.encounterId;
          scheduleSbSave();
          paint();
          paintSide();
        });
        panel.appendChild(encSel);
        if (b.encounterId) {
          const open = el('a', 'gmc-btn gold', '⚔️ Ouvrir la rencontre (tracker)');
          open.href = `#/rencontres/${encodeURIComponent(b.encounterId)}`;
          panel.appendChild(open);
        }
      }
    }
    if (b.kind === 'scene' || b.kind === 'handout') {
      panel.appendChild(el('p', 'gmc-field-lbl', '🎞️ Séquence d’images liée'));
      const seqSel = el('select', 'gmc-input');
      seqSel.innerHTML = '<option value="">— aucune —</option>'
        + state.sequences.map((s) => `<option value="${esc(s.id)}"${b.sequenceId === s.id ? ' selected' : ''}>${esc(s.name)} (${s.items.length})</option>`).join('');
      seqSel.addEventListener('change', () => {
        if (seqSel.value) b.sequenceId = seqSel.value; else delete b.sequenceId;
        scheduleSbSave();
        paint();
        paintSide();
      });
      panel.appendChild(seqSel);
      if (b.sequenceId) {
        const proj = el('button', 'gmc-btn gold', '📡 Projeter (séquence liée)');
        proj.type = 'button';
        proj.title = 'Ouvre le projecteur : chaque handout est poussé aux joueurs dans Foundry';
        proj.addEventListener('click', () => {
          sbProj = true;
          projState = { mode: 'play', seqId: b.sequenceId, idx: 0 };
          paintSide();
        });
        panel.appendChild(proj);
      }
    }
    // 📜 handout UNITAIRE du beat (kind handout, sans passer par une séquence) :
    // {type, src|text, title, targets} envoyé direct par le bouton 📡.
    if (b.kind === 'handout') {
      panel.appendChild(el('p', 'gmc-field-lbl', '📜 Handout unitaire (sans séquence)'));
      const h = b.handout || (b.handout = { type: 'image', src: '', text: '', title: '' });
      const box = el('div', 'gmc-seq-item');
      const paintH = () => {
        box.innerHTML = '';
        const typeSel = el('select', 'gmc-input');
        typeSel.innerHTML = Object.entries(ITEM_TYPES)
          .map(([kk, tt]) => `<option value="${kk}"${itemType(h) === kk ? ' selected' : ''}>${tt.icon} ${tt.label}</option>`).join('');
        typeSel.addEventListener('change', () => { h.type = typeSel.value; scheduleSbSave(); paint(); paintH(); });
        box.appendChild(typeSel);
        if (itemType(h) === 'chat') {
          const text = el('textarea', 'gmc-input');
          text.rows = 3;
          text.value = h.text || '';
          text.placeholder = 'Texte envoyé dans le tchat Foundry (HTML léger autorisé)';
          text.addEventListener('change', () => { h.text = text.value; scheduleSbSave(); });
          box.appendChild(text);
        } else {
          const src = el('input', 'gmc-input');
          src.value = h.src || '';
          src.placeholder = 'worlds/… (.webp, .mp3, .mp4) ou https://…';
          src.addEventListener('change', () => {
            h.src = src.value.trim();
            const auto = detectType(h.src);
            if (auto !== itemType(h)) { h.type = auto; paintH(); } // .mp3 → audio, .mp4 → vidéo
            scheduleSbSave();
            paint();
          });
          box.appendChild(src);
        }
        const ht = el('input', 'gmc-input');
        ht.value = h.title || '';
        ht.placeholder = 'Titre (montré aux joueurs)';
        ht.addEventListener('change', () => { h.title = ht.value; scheduleSbSave(); });
        box.appendChild(ht);
        box.appendChild(el('p', 'gmc-field-lbl', '📫 Destinataires (aucun coché = toute la table)'));
        box.appendChild(targetsPicker(h, () => scheduleSbSave()));
        const hStatus = el('p', 'gmc-hint', '');
        const send = el('button', 'gmc-btn gold', '📡 Envoyer ce handout');
        send.type = 'button';
        send.title = 'Envoie directement ce handout aux joueurs visés (ou à toute la table)';
        send.addEventListener('click', () => pushHandout(h, hStatus));
        box.append(send, hStatus);
      };
      paintH();
      panel.appendChild(box);
    }

    // 🎵 ambiance du beat (tous kinds) : ▶/⏹ direct chez les joueurs
    panel.appendChild(el('p', 'gmc-field-lbl', '🎵 Ambiance du beat'));
    const sndRow = el('div', 'gmc-seq-nav');
    const snd = el('input', 'gmc-input');
    snd.placeholder = 'Playlist Foundry…';
    snd.setAttribute('list', 'gmc-playlists');
    snd.value = b.sound?.playlist || '';
    snd.addEventListener('change', () => {
      const v = snd.value.trim();
      if (v) b.sound = { playlist: v.slice(0, 100) }; else delete b.sound;
      scheduleSbSave();
      paint();
    });
    const sndStatus = el('p', 'gmc-hint', '');
    const play = el('button', 'gmc-btn gold', '▶'); play.type = 'button'; play.title = 'Jouer chez les joueurs';
    play.addEventListener('click', () => { const v = snd.value.trim(); if (v) playSound(v, 'play', sndStatus); });
    const stop = el('button', 'gmc-btn', '⏹'); stop.type = 'button'; stop.title = 'Arrêter';
    stop.addEventListener('click', () => { const v = snd.value.trim(); if (v) playSound(v, 'stop', sndStatus); });
    sndRow.append(snd, play, stop);
    panel.append(sndRow, sndStatus);
    let dl = document.getElementById('gmc-playlists');
    if (!dl) { dl = el('datalist'); dl.id = 'gmc-playlists'; wrap.appendChild(dl); }
    const fillDl = () => { dl.innerHTML = (playlists || []).map((x) => `<option value="${esc(x.name)}">`).join(''); };
    if (playlists === null) loadPlaylists().then(fillDl); else fillDl();

    // ⚡ déclencheurs du beat — l'annonce en tête (playBox) se réécrit à chaque
    // réglage : le MJ voit immédiatement ce que ▶ fera.
    panel.appendChild(triggerEditor(b, () => { playBox._refresh(); paint(); }));

    // ordre & suppression
    const ordRow = el('div', 'gmc-seq-nav');
    const up = el('button', 'gmc-btn', '↑ Avancer'); up.type = 'button'; up.disabled = i === 0;
    up.addEventListener('click', () => { beats.splice(i - 1, 0, beats.splice(i, 1)[0]); scheduleSbSave(); paint(); paintSide(); });
    const down = el('button', 'gmc-btn', '↓ Reculer'); down.type = 'button'; down.disabled = i === beats.length - 1;
    down.addEventListener('click', () => { beats.splice(i + 1, 0, beats.splice(i, 1)[0]); scheduleSbSave(); paint(); paintSide(); });
    const del = el('button', 'gmc-btn danger', '🗑️'); del.type = 'button'; del.title = 'Supprimer ce beat';
    del.addEventListener('click', () => {
      beats.splice(i, 1);
      state.selected = null;
      scheduleSbSave();
      paintLegend();
      paint();
      paintSide();
    });
    ordRow.append(up, down, del);
    panel.appendChild(ordRow);

    const back = el('button', 'gmc-btn', '← Storyboard');
    back.type = 'button';
    back.addEventListener('click', () => { state.selected = null; paint(); paintSide(); });
    panel.appendChild(back);
  }

  paint();
  paintSide();
  // séance courante (gm:cfg:session.currentId) : chargée en tâche de fond —
  // la carte s'affiche tout de suite, la trace se branche dès qu'on la connaît.
  loadSessCfg().then(() => { if (openSession()) paintSide(); }).catch(() => {});
  window.scrollTo(0, 0);
}
