// gm-session.js — mode séance « jour J ». Le bandeau sticky est branché sur le
// STORYBOARD (le poste de pilotage) : beat en cours, ◀ Précédent / Suivant ▶
// dans la chaîne, statut cliquable, progression de l'acte, minuteurs de rythme,
// panneau « ne pas oublier » et ▶ Jouer ce beat.
//
// Ce module est aussi le PROPRIÉTAIRE UNIQUE de la config MJ partagée
// `gm:cfg:session` (défauts dans session-model.js, écriture coordonnée par
// patchSessionCfg) : gm-home.js et gm-campaign.js passent tous par ici — fini
// les deux UI qui écrivaient la même clé chacune dans son coin.
import { loadCfg, saveCfg } from './gm-config.js';
import { apiBase, getGMKey } from './collab.js';
import { openNotes } from './notes.js';
import {
  SESSION_DEFAULTS, normalizePinned, chainInfo, paceState, fmtDur, buildForget, describeTrigger,
} from './session-model.js';

export { SESSION_DEFAULTS };
const ON_KEY = 'holocron-gm-session';

const BEAT_ICON = { scene: '🎭', combat: '⚔️', note: '🗒️', handout: '🖼️' };
const STATUS_META = { todo: { icon: '○', label: 'À jouer' }, encours: { icon: '▶', label: 'En cours' }, fait: { icon: '✓', label: 'Fait' } };
const STATUS_CHAIN = ['todo', 'encours', 'fait'];
const TYPE_ICON = { acte: '🎬', quest: '🎯', npc: '👤', group: '🏛️', location: '🌍', shop: '🏪', seq: '🎞️' };

let state = { cfg: { ...SESSION_DEFAULTS }, updatedAt: null, loaded: false };
let bar = null;
let ctxRef = null;      // { selectChap(id, heading?), getCurrentChap() }
let board = null;       // { catalog, sessions, sequences } — chargé à la demande
let boardPending = null;
let dossiers = null;    // flags.holocron.dossiers (intentions des PNJ)
let openPanel = null;   // 'forget' | 'checklist' | null
let lastPlay = null;    // { beatId, html } — le rapport de ▶ SURVIT au re-rendu
let tick = null;        // minuteur du bandeau (rythme)
const subscribers = new Set();

const el = (t, c, h) => { const e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const slug = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'seance';

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

export function isSessionOn() { return localStorage.getItem(ON_KEY) === '1'; }

/* ============================================================ config partagée
 * UNE seule lecture, UNE seule écriture. `patchSessionCfg` fusionne un patch
 * dans l'état courant puis persiste ; en cas de conflit (autre appareil, autre
 * onglet) on refusionne la version serveur SANS perdre le patch qu'on vient de
 * poser. Tous les abonnés (poste de pilotage, storyboard) sont prévenus. */
export function sessionCfg() { return state.cfg; }

export async function loadSessionCfg(force = false) {
  if (state.loaded && !force) return state.cfg;
  const { cfg, updatedAt } = await loadCfg('session', SESSION_DEFAULTS);
  state = { cfg, updatedAt, loaded: true };
  return state.cfg;
}

export async function patchSessionCfg(patch) {
  if (!state.loaded) await loadSessionCfg();
  Object.assign(state.cfg, patch);
  const res = await saveCfg('session', state.cfg, state.updatedAt);
  if (res.conflict) state.cfg = { ...SESSION_DEFAULTS, ...(res.current || {}), ...patch };
  state.updatedAt = res.updatedAt;
  renderBar();
  for (const fn of subscribers) { try { fn(state.cfg); } catch { /* abonné cassé */ } }
  return state.cfg;
}

/** S'abonner aux changements de la séance (retourne la fonction de désabonnement). */
export function onSessionCfg(fn) { subscribers.add(fn); return () => subscribers.delete(fn); }

// Initialise le module (contexte + config serveur). Ré-appelable sans effet de bord.
export async function initSession(ctx) {
  ctxRef = ctx;
  await loadSessionCfg();
  if (isSessionOn()) enable();
}

export function toggleSession() {
  const on = !isSessionOn();
  localStorage.setItem(ON_KEY, on ? '1' : '');
  if (on) enable(); else disable();
  return on;
}
function enable() {
  document.body.classList.add('gm-session');
  if (!bar) {
    bar = el('div', 'gm-session-bar');
    document.querySelector('.topbar')?.after(bar);
  }
  // minuteur de rythme : une minute suffit (indicatif, jamais bloquant)
  if (!tick) tick = setInterval(() => { if (bar && !openPanel) renderBar(); }, 60_000);
  renderBar();
  ensureBoard();
}
function disable() {
  document.body.classList.remove('gm-session');
  bar?.remove();
  bar = null;
  openPanel = null;
  if (tick) { clearInterval(tick); tick = null; }
}
export function teardownSession() { disable(); }

/* ================================================================ storyboard
 * Le bandeau a besoin du catalogue (actes + storyboards) et de la trace : une
 * seule route les porte déjà (/gm/board, MJ-gated). Chargé À LA DEMANDE, puis
 * invalidé quand le storyboard bouge ailleurs (gm-campaign.js). */
function ensureBoard() {
  if (board || boardPending) return boardPending;
  boardPending = api('/gm/board')
    .then((d) => { board = d; renderBar(); return d; })
    .catch(() => { board = { catalog: { nodes: [] }, sessions: [], sequences: [] }; return board; })
    .finally(() => { boardPending = null; });
  return boardPending;
}
/** À appeler après toute écriture du storyboard ailleurs dans l'app. */
export function invalidateBoard() { board = null; if (bar) ensureBoard(); }

const actOf = (actId) => (board?.catalog?.nodes || []).find((n) => n.id === actId) || null;
const beatsOf = (actId) => actOf(actId)?.storyboard?.beats || [];
const openSession = () => {
  const s = (board?.sessions || []).find((x) => x.id === state.cfg.currentId);
  return s && !s.endedAt ? s : null;
};

/* ------------------------------------------------------------- épinglage --- */
/** La séance épingle un BEAT du storyboard (étape 2). */
export async function pinBeat(actId, beatId, label = '') {
  await patchSessionCfg({
    pinned: { actId, beatId, label },
    pinnedAt: Date.now(),
    ...(state.cfg.title ? {} : { title: 'Séance en cours' }),
  });
  invalidateBoard();
}

/** COMPAT ASCENDANTE : l'ancien épinglage « chapitre de bible + heading »
 * continue de fonctionner tel quel (boutons 📌 injectés dans les chapitres). */
export async function pinScene(chapId, headingId, label) {
  await patchSessionCfg({
    pinned: { chap: chapId, heading: headingId || null, label: label || '' },
    pinnedAt: Date.now(),
    ...(state.cfg.title ? {} : { title: 'Séance en cours' }),
  });
}

export function refreshSessionBar() { if (bar) renderBar(); }

/* ------------------------------------------------------ actions sur un beat */
/** Change le statut du beat épinglé. Relit le storyboard AVANT d'écrire (la vue
 * campagne peut l'avoir modifié) et alimente la trace comme cycleStatus. */
async function setPinnedStatus(status, statusEl) {
  const p = normalizePinned(state.cfg.pinned);
  if (!p || p.kind !== 'beat') return;
  if (statusEl) statusEl.textContent = '…';
  try {
    const fresh = await api('/gm/board');
    board = fresh;
    const act = actOf(p.actId);
    const sb = act?.storyboard || { beats: [] };
    const b = (sb.beats || []).find((x) => x.id === p.beatId);
    if (!b) throw new Error('beat introuvable');
    const before = b.status;
    b.status = status;
    await api(`/gm/storyboard/${encodeURIComponent(p.actId)}`, { method: 'PUT', body: JSON.stringify(sb) });
    // 📓 la trace : passer à « fait » inscrit le beat dans la séance ouverte
    if (status === 'fait' && before !== 'fait') traceEvent('played', { actId: p.actId, beatId: b.id, title: b.title || '', kind: b.kind });
    renderBar();
  } catch (e) { if (statusEl) statusEl.textContent = `⚠️ ${e.message}`.slice(0, 60); }
}

/** Inscrit une entrée dans la séance ouverte — fire-and-forget, jamais bloquant. */
function traceEvent(kind, entry) {
  const s = openSession();
  if (!s) return;
  // enveloppe EXPLICITE { kind, entry } : l'entrée `played` porte son propre
  // champ `kind` (celui du beat) et écraserait le type d'événement à plat.
  api(`/gm/sessions/${encodeURIComponent(s.id)}/event`, {
    method: 'POST', body: JSON.stringify({ kind, entry: { at: Date.now(), ...entry } }),
  }).then((out) => { if (out?.session && board) {
    const i = board.sessions.findIndex((x) => x.id === out.session.id);
    if (i >= 0) board.sessions[i] = out.session;
  } }).catch((e) => console.warn('[holocron] trace non enregistrée :', e.message));
}

/** ▶ Jouer ce beat — le serveur relit le beat et exécute ce qu'il DÉCLARE. */
async function playPinnedBeat(statusEl) {
  const p = normalizePinned(state.cfg.pinned);
  if (!p || p.kind !== 'beat') return;
  const say = (html) => {
    // le rapport est mémorisé : passer le beat « en cours » redessine le
    // bandeau, et le MJ doit garder sous les yeux ce qui a marché ou non.
    lastPlay = { beatId: p.beatId, html };
    const cur = bar?.querySelector('.gm-session-status');
    if (cur) cur.innerHTML = html;
    else if (statusEl) statusEl.innerHTML = html;
  };
  say('▶ Envoi à Foundry…');
  try {
    const out = await api('/gm/beat/play', { method: 'POST', body: JSON.stringify({ actId: p.actId, beatId: p.beatId }) });
    // le beat qu'on joue passe « en cours » (s'il n'est pas déjà fait)
    const b = beatsOf(p.actId).find((x) => x.id === p.beatId);
    if (b && b.status === 'todo') await setPinnedStatus('encours');
    say(renderPlayReport(out));
  } catch (e) { say(`⚠️ ${esc(e.message)}`); }
}

/** Retour APRÈS exécution : ce qui a marché, ce qui a échoué — jamais un « ok » muet. */
export function renderPlayReport(out) {
  if (!out) return '';
  if (out.empty) return `<b>${esc(out.message)}</b> Déclare ses déclencheurs dans l’éditeur de beat (🗺️ Campagne).`;
  const rows = (out.steps || []).map((s) => `<span class="gm-play-step ${s.ok ? 'ok' : 'ko'}">${s.ok ? '✅' : '⚠️'} ${esc(s.label)}${s.ok ? '' : ` — ${esc(s.error || 'échec')}`}</span>`);
  return `<b>${esc(out.message)}</b><br>${rows.join('<br>')}`;
}

/* =============================================================== rendu de la barre */
function renderBar() {
  if (!bar) return;
  const keep = openPanel;
  bar.innerHTML = '';
  const cfg = state.cfg;
  const p = normalizePinned(cfg.pinned);

  bar.appendChild(el('span', 'gm-session-title',
    `🎬 ${esc(cfg.title || 'Séance')}${cfg.date ? ` <span class="gm-session-date">${esc(cfg.date)}</span>` : ''}`));

  if (p && p.kind === 'beat') renderBeatControls(p);
  else if (p) renderChapControls(p);  // ancien format : on ne casse rien
  else bar.appendChild(el('span', 'gm-session-hint', 'Rien d’épinglé — 📌 sur un beat du storyboard (🗺️ Campagne) ou sur une scène de la bible'));

  bar.appendChild(el('span', 'gm-session-spacer'));

  // rythme : séance ouverte + temps sur le beat courant (indicatif)
  const pace = paceBadge();
  if (pace) bar.appendChild(pace);

  // « ne pas oublier » : toujours accessible, sans quitter la vue en cours
  const forget = el('button', 'gm-session-tool', '🧠');
  forget.type = 'button';
  forget.title = 'Ne pas oublier : secrets non révélés, fils ouverts, intentions des PNJ';
  forget.addEventListener('click', () => togglePanel('forget'));
  bar.appendChild(forget);

  const ckBtn = el('button', 'gm-session-tool', checklistLabel());
  ckBtn.type = 'button';
  ckBtn.title = 'Checklist de séance';
  ckBtn.addEventListener('click', () => togglePanel('checklist'));
  bar.appendChild(ckBtn);

  const notesBtn = el('button', 'gm-session-tool', '📝');
  notesBtn.type = 'button';
  notesBtn.title = 'Notes de cette séance';
  notesBtn.addEventListener('click', () => {
    if (!state.cfg.noteRef) patchSessionCfg({ noteRef: slug(state.cfg.title || 'seance') });
    openNotes({ type: 'seance', ref: state.cfg.noteRef || slug(state.cfg.title || 'seance'), label: state.cfg.title || 'Séance' });
  });
  bar.appendChild(notesBtn);

  if (keep) { openPanel = null; togglePanel(keep); }
}

/** Le bandeau branché sur le storyboard : beat, chaîne, statut, progression. */
function renderBeatControls(p) {
  const beats = beatsOf(p.actId);
  if (!board) { bar.appendChild(el('span', 'gm-session-hint', '⏳ storyboard…')); return; }
  const info = chainInfo(beats, p.beatId);
  const act = actOf(p.actId);
  if (info.index < 0) {
    bar.appendChild(el('span', 'gm-session-hint', `📌 ${esc(p.label || 'beat')} — introuvable dans « ${esc(act?.name || 'l’acte')} »`));
    return;
  }
  const b = info.beat;
  const st = STATUS_META[b.status] || STATUS_META.todo;
  // le rapport du dernier ▶ reste affiché tant qu'on est sur CE beat
  const status = el('span', 'gm-session-status', lastPlay?.beatId === b.id ? lastPlay.html : '');

  // ◀ Précédent
  const prev = el('button', 'gm-session-nav', '◀');
  prev.type = 'button';
  prev.disabled = !info.prev;
  prev.title = info.prev ? `Précédent : ${info.prev.title || 'sans titre'}` : 'Premier beat de l’acte';
  prev.addEventListener('click', () => info.prev && pinBeat(p.actId, info.prev.id, info.prev.title || ''));

  // le beat lui-même : va au storyboard
  const go = el('button', 'gm-session-go', `${BEAT_ICON[b.kind] || '🎭'} ${esc(b.title || '(sans titre)')}`);
  go.type = 'button';
  go.title = `Beat ${info.index + 1}/${info.total} — ${esc(act?.name || '')} · ouvrir le storyboard`;
  go.addEventListener('click', () => { location.hash = '#/mj/campagne'; });

  const next = el('button', 'gm-session-nav', '▶');
  next.type = 'button';
  next.disabled = !info.next;
  next.title = info.next ? `Suivant : ${info.next.title || 'sans titre'}` : 'Dernier beat de l’acte';
  next.addEventListener('click', () => info.next && pinBeat(p.actId, info.next.id, info.next.title || ''));

  // statut cliquable DEPUIS le bandeau (même cycle que le storyboard, trace comprise)
  const stBtn = el('button', `gm-session-st st-${esc(b.status)}`, st.icon);
  stBtn.type = 'button';
  stBtn.title = `${st.label} — clic : statut suivant (✓ fait s’inscrit dans la séance)`;
  stBtn.addEventListener('click', () => setPinnedStatus(STATUS_CHAIN[(STATUS_CHAIN.indexOf(b.status) + 1) % STATUS_CHAIN.length], status));

  // progression de l'acte (X/Y)
  const prog = el('span', 'gm-session-prog', `${info.index + 1}/${info.total} · ✓${info.done}`);
  prog.title = `Beat ${info.index + 1} sur ${info.total} — ${info.done} joué(s) dans « ${act?.name || 'cet acte'} »`;

  // ▶ Jouer ce beat (déclencheurs déclarés)
  const play = el('button', 'gm-session-play', '▶ Jouer');
  play.type = 'button';
  const desc = describeTrigger(b, { encounters: null, sequences: board?.sequences || null, playlists: null });
  play.title = desc.empty
    ? 'Ce beat ne déclare aucun déclencheur — rien ne partira vers Foundry'
    : 'Jouera : ' + desc.lines.join(' · ');
  play.classList.toggle('empty', desc.empty);
  play.addEventListener('click', () => playPinnedBeat(status));

  bar.append(prev, go, next, stBtn, prog, play, status);
}

/** Ancien épinglage (chapitre + heading) : comportement d'origine intact. */
function renderChapControls(p) {
  const go = el('button', 'gm-session-go', `📌 ${esc(p.label || 'Scène en cours')}`);
  go.type = 'button';
  go.title = 'Aller à la scène épinglée (ancien format : chapitre de la bible)';
  go.addEventListener('click', () => ctxRef?.selectChap(p.chap, p.heading || undefined));
  bar.appendChild(go);
  const chips = sceneChips(p);
  if (chips.length) {
    const wrap = el('span', 'gm-session-chips');
    for (const c of chips) wrap.appendChild(c);
    bar.appendChild(wrap);
  }
}

/* ------------------------------------------------------------------ rythme */
function paceBadge() {
  const s = openSession();
  const sessMs = s?.startedAt ? Date.now() - s.startedAt : 0;
  const beatMs = state.cfg.pinnedAt ? Date.now() - state.cfg.pinnedAt : 0;
  if (!sessMs && !beatMs) return null;
  const tone = paceState(beatMs, state.cfg.paceMin);
  const p = normalizePinned(state.cfg.pinned);
  const beats = p?.kind === 'beat' ? beatsOf(p.actId) : [];
  const info = p?.kind === 'beat' ? chainInfo(beats, p.beatId) : null;
  const share = info && info.total ? Math.round(((info.index + 1) / info.total) * 100) : 0;
  const badge = el('span', `gm-session-pace tone-${tone}`,
    `${sessMs ? `⏱ ${esc(fmtDur(sessMs))}` : ''}${beatMs ? ` · 🎬 ${esc(fmtDur(beatMs))}` : ''}${share ? ` · ${share} %` : ''}`);
  badge.title = [
    sessMs ? `Séance ouverte depuis ${fmtDur(sessMs)}` : 'Aucune séance ouverte',
    beatMs ? `Sur ce beat depuis ${fmtDur(beatMs)} (seuil doux : ${state.cfg.paceMin || '—'} min)` : '',
    share ? `${share} % de l’acte parcouru` : '',
    'Purement indicatif — rien ne s’arrête, rien ne bloque.',
  ].filter(Boolean).join('\n');
  return badge;
}

/* -------------------------------------------------------- panneaux dépliants */
function togglePanel(which) {
  bar.querySelector('.gm-session-panel')?.remove();
  if (openPanel === which) { openPanel = null; return; }
  openPanel = which;
  bar.appendChild(which === 'forget' ? forgetPanel() : checklistPanel());
}

function checklistLabel() {
  const list = state.cfg.checklist || [];
  const done = list.filter((c) => c.done).length;
  return list.length ? `☑ ${done}/${list.length}` : '☑';
}

function checklistPanel() {
  const panel = el('div', 'gm-session-panel gm-session-ck');
  const list = el('div', 'gm-session-ck-list');
  const items = state.cfg.checklist || (state.cfg.checklist = []);
  items.forEach((item, i) => {
    const row = el('label', 'gm-session-ck-item');
    const cb = el('input');
    cb.type = 'checkbox';
    cb.checked = !!item.done;
    cb.addEventListener('change', () => { item.done = cb.checked; patchSessionCfg({ checklist: items }); });
    const txt = el('span', item.done ? 'done' : '', esc(item.text));
    const del = el('button', 'gm-session-ck-del', '✕');
    del.type = 'button';
    del.addEventListener('click', (e) => { e.preventDefault(); items.splice(i, 1); patchSessionCfg({ checklist: items }); });
    row.append(cb, txt, del);
    list.appendChild(row);
  });
  panel.appendChild(list);
  const form = el('form', 'gm-session-ck-add');
  const input = el('input', 'gm-session-ck-input');
  input.placeholder = 'Ajouter (ex. imprimer le handout)…';
  const ok = el('button', 'gm-session-ck-ok', '＋');
  ok.type = 'submit';
  form.append(input, ok);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const t = input.value.trim();
    if (!t) return;
    items.push({ text: t, done: false });
    input.value = '';
    patchSessionCfg({ checklist: items });
  });
  panel.appendChild(form);
  return panel;
}

/* --------------------------------------------------- 🧠 « ne pas oublier » --
 * Le cœur du bandeau : ce que le MJ a semé et que les joueurs n'ont PAS encore
 * appris, les fils restés ouverts, et l'intention du PNJ qu'il a devant lui.
 * Accessible depuis n'importe quelle vue, sans la quitter. */
function forgetPanel() {
  const panel = el('div', 'gm-session-panel gm-session-forget');
  if (!board) { panel.appendChild(el('p', 'muted', 'Chargement du storyboard…')); ensureBoard(); return panel; }
  const p = normalizePinned(state.cfg.pinned);
  if (!p || p.kind !== 'beat') {
    panel.appendChild(el('p', 'muted',
      'Épingle un beat du storyboard (🗺️ Campagne → un acte → 📌 sur un beat) : ce panneau listera alors '
      + 'les secrets encore non révélés de l’acte, les fils ouverts et l’intention des PNJ en scène.'));
    return panel;
  }
  if (dossiers === null) {
    api('/gm/dossiers').then((d) => { dossiers = d.dossiers || {}; if (openPanel === 'forget') { openPanel = null; togglePanel('forget'); } }).catch(() => { dossiers = {}; });
  }
  const f = buildForget({
    actId: p.actId, beatId: p.beatId,
    catalog: board.catalog, sessions: board.sessions, dossiers: dossiers || {},
  });

  // 1. les PNJ en scène, avec ce qu'ils veulent
  const npcs = f.npcs.filter((n) => n.type === 'npc' || n.hasDossier);
  panel.appendChild(el('p', 'gm-session-forget-h', `👤 En scène (${npcs.length})`));
  if (!npcs.length) panel.appendChild(el('p', 'muted', 'Aucune entité attachée à ce beat.'));
  for (const n of npcs.slice(0, 6)) {
    const box = el('div', 'gm-session-forget-row');
    box.innerHTML = `<b>${TYPE_ICON[n.type] || '👤'} ${esc(n.name)}</b>${n.revealed ? ' <span class="gm-session-seen">👁 connu</span>' : ''}`
      + (n.veut ? `<br><span class="k">veut</span> ${esc(n.veut)}` : '')
      + (n.levier ? `<br><span class="k">levier</span> ${esc(n.levier)}` : '')
      + (n.attitude ? `<br><span class="k">attitude</span> ${esc(n.attitude)}` : '')
      + (n.replique ? `<br><span class="k">réplique</span> « ${esc(n.replique)} »` : '')
      + (!n.hasDossier ? '<br><span class="muted">aucun dossier — remplis-le dans Foundry (flags.holocron.dossiers)</span>' : '');
    panel.appendChild(box);
  }

  // 2. semé mais pas encore révélé (croisement storyboard × trace)
  panel.appendChild(el('p', 'gm-session-forget-h', `🤫 Pas encore révélé (${f.secrets.length})`));
  if (!f.secrets.length) panel.appendChild(el('p', 'muted', 'Tout ce que cet acte met en jeu a déjà été montré aux joueurs.'));
  for (const s of f.secrets.slice(0, 8)) {
    const row = el('p', 'gm-session-forget-line',
      `${TYPE_ICON[s.type] || '•'} ${esc(s.name)} <span class="muted">— ${esc(s.beatTitle || 'beat sans titre')}</span>`);
    panel.appendChild(row);
  }

  // 3. fils ouverts (tous actes non terminés)
  panel.appendChild(el('p', 'gm-session-forget-h', `🧵 Fils ouverts (${f.threads.length})`));
  if (!f.threads.length) panel.appendChild(el('p', 'muted', 'Aucun beat en attente — tous les actes ouverts sont bouclés.'));
  for (const t of f.threads.slice(0, 10)) {
    const line = el('p', 'gm-session-forget-line' + (t.current ? ' current' : ''),
      `${STATUS_META[t.status]?.icon || '○'} ${BEAT_ICON[t.kind] || '🎭'} ${esc(t.title || '(sans titre)')} `
      + `<span class="muted">${esc(t.actName)}</span>`);
    panel.appendChild(line);
  }
  return panel;
}

/* -------------------------------------------------------------- chips 📌 --- */
// Ancien épinglage (chapitre) : raccourcis 1-clic vers les callouts de la scène.
function sceneChips(p) {
  if (!p || p.kind !== 'chap' || !ctxRef || ctxRef.getCurrentChap() !== p.chap) return [];
  const target = p.heading ? document.getElementById(p.heading) : null;
  if (!target) return [];
  const scope = target.closest('.gm-scene') || target.parentElement;
  if (!scope) return [];
  const found = [
    ...[...scope.querySelectorAll('.gm-callout-ambiance')].map((n) => ({ n, ico: '🔊', lbl: 'Ambiance' })),
    ...[...scope.querySelectorAll('.gm-callout-handout')].map((n) => ({ n, ico: '📄', lbl: 'Handout' })),
    ...[...scope.querySelectorAll('.gm-callout-image, .gm-figure')].map((n) => ({ n, ico: '🖼️', lbl: 'Visuel' })),
    ...[...scope.querySelectorAll('.combat-sheet')].map((n) => ({ n, ico: '⚔️', lbl: 'Combat' })),
  ];
  return found.slice(0, 6).map(({ n, ico, lbl }) => {
    const chip = el('button', 'gm-session-chip', `${ico} ${lbl}`);
    chip.type = 'button';
    chip.addEventListener('click', () => {
      const details = n.closest('details');
      if (details && !details.open) details.open = true;
      n.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    return chip;
  });
}

/* ------------------------------ Boutons 📌 des chapitres (format historique) */
export function injectPins(root, chap) {
  const addPin = (host, headingEl, label) => {
    if (host.querySelector(':scope > .gm-pin')) return;
    const pin = el('button', 'gm-pin', '📌');
    pin.type = 'button';
    pin.title = 'Épingler comme scène en cours (mode séance)';
    pin.addEventListener('click', (e) => {
      e.preventDefault();
      pinScene(chap.id, headingEl?.id || null, label);
    });
    host.appendChild(pin);
  };
  for (const head of root.querySelectorAll('.gm-scene-head')) {
    const t = head.querySelector('.gm-scene-title');
    if (t) addPin(head, t, t.textContent.trim());
  }
  for (const h of root.querySelectorAll('.journal-content > h2, .note-view > h2')) {
    addPin(h, h, h.textContent.replace(/📌/g, '').trim());
  }
}
