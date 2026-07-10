// gm-session.js — mode séance « jour J » : un bandeau sticky avec la scène en
// cours (épinglée 📌), la checklist de préparation, les notes de séance et des
// raccourcis 1-clic vers les ambiances/handouts/visuels de la scène active.
// La séance vit dans gm:cfg:session (serveur gated, partagée entre appareils).
import { loadCfg, saveCfg } from './gm-config.js';
import { openNotes } from './notes.js';

export const SESSION_DEFAULTS = { v: 1, title: '', date: '', pinned: null, checklist: [], noteRef: '' };
const ON_KEY = 'holocron-gm-session';

let state = { cfg: { ...SESSION_DEFAULTS }, updatedAt: null, loaded: false };
let bar = null;
let ctxRef = null; // { selectChap(id, heading?), getCurrentChap() }

const el = (t, c, h) => { const e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; };
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const slug = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'seance';

export function isSessionOn() { return localStorage.getItem(ON_KEY) === '1'; }

// Initialise le module (contexte + config serveur). À appeler une fois la vue
// MJ montée ; ré-appelable sans effet de bord.
export async function initSession(ctx) {
  ctxRef = ctx;
  if (!state.loaded) {
    const { cfg, updatedAt } = await loadCfg('session', SESSION_DEFAULTS);
    state = { cfg, updatedAt, loaded: true };
  }
  if (isSessionOn()) enable();
}

async function persist() {
  const res = await saveCfg('session', state.cfg, state.updatedAt);
  if (res.conflict) state.cfg = { ...SESSION_DEFAULTS, ...(res.current || {}) };
  state.updatedAt = res.updatedAt;
  renderBar();
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
  renderBar();
}
function disable() {
  document.body.classList.remove('gm-session');
  bar?.remove();
  bar = null;
}
// Nettoyage complet (sortie de l'espace MJ).
export function teardownSession() { disable(); }

// Épingle une scène (appelé par les boutons 📌 injectés dans les chapitres).
export async function pinScene(chapId, headingId, label) {
  state.cfg.pinned = { chap: chapId, heading: headingId || null, label: label || '' };
  if (!state.cfg.title) state.cfg.title = 'Séance en cours';
  await persist();
}

// À appeler après chaque changement de chapitre : met à jour les chips.
export function refreshSessionBar() { if (bar) renderBar(); }

// --- Rendu du bandeau -------------------------------------------------------
function renderBar() {
  if (!bar) return;
  bar.innerHTML = '';
  const cfg = state.cfg;

  const title = el('span', 'gm-session-title', `🎬 ${esc(cfg.title || 'Séance')}${cfg.date ? ` <span class="gm-session-date">${esc(cfg.date)}</span>` : ''}`);
  bar.appendChild(title);

  // Scène en cours.
  if (cfg.pinned) {
    const go = el('button', 'gm-session-go', `📌 ${esc(cfg.pinned.label || 'Scène en cours')}`);
    go.type = 'button';
    go.title = 'Aller à la scène épinglée';
    go.addEventListener('click', () => ctxRef?.selectChap(cfg.pinned.chap, cfg.pinned.heading || undefined));
    bar.appendChild(go);
  } else {
    bar.appendChild(el('span', 'gm-session-hint', 'Épingle une scène avec 📌'));
  }

  // Chips ambiance/handout/visuels de la scène épinglée (si son chapitre est affiché).
  const chips = sceneChips();
  if (chips.length) {
    const wrap = el('span', 'gm-session-chips');
    for (const c of chips) wrap.appendChild(c);
    bar.appendChild(wrap);
  }

  const spacer = el('span', 'gm-session-spacer');
  bar.appendChild(spacer);

  // Checklist (repliable).
  const ckBtn = el('button', 'gm-session-tool', checklistLabel());
  ckBtn.type = 'button';
  ckBtn.title = 'Checklist de séance';
  ckBtn.addEventListener('click', () => {
    const open = bar.querySelector('.gm-session-ck');
    if (open) { open.remove(); return; }
    bar.appendChild(checklistPanel());
  });
  bar.appendChild(ckBtn);

  // Notes de séance.
  const notesBtn = el('button', 'gm-session-tool', '📝');
  notesBtn.type = 'button';
  notesBtn.title = 'Notes de cette séance';
  notesBtn.addEventListener('click', () => {
    if (!state.cfg.noteRef) { state.cfg.noteRef = slug(state.cfg.title || 'seance'); persist(); }
    openNotes({ type: 'seance', ref: state.cfg.noteRef, label: state.cfg.title || 'Séance' });
  });
  bar.appendChild(notesBtn);
}

function checklistLabel() {
  const list = state.cfg.checklist || [];
  const done = list.filter((c) => c.done).length;
  return list.length ? `☑ ${done}/${list.length}` : '☑';
}

function checklistPanel() {
  const panel = el('div', 'gm-session-ck');
  const list = el('div', 'gm-session-ck-list');
  const items = state.cfg.checklist || (state.cfg.checklist = []);
  items.forEach((item, i) => {
    const row = el('label', 'gm-session-ck-item');
    const cb = el('input');
    cb.type = 'checkbox';
    cb.checked = !!item.done;
    cb.addEventListener('change', () => { item.done = cb.checked; persist(); });
    const txt = el('span', item.done ? 'done' : '', esc(item.text));
    const del = el('button', 'gm-session-ck-del', '✕');
    del.type = 'button';
    del.addEventListener('click', (e) => { e.preventDefault(); items.splice(i, 1); persist(); });
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
    persist();
  });
  panel.appendChild(form);
  return panel;
}

// Chips 1-clic : scanne la scène épinglée (si affichée) pour ses callouts
// ambiance 🔊, handout 📄, image 🖼️ et figures — scroll direct vers l'élément.
function sceneChips() {
  const p = state.cfg.pinned;
  if (!p || !ctxRef || ctxRef.getCurrentChap() !== p.chap) return [];
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

// --- Boutons 📌 (injectés par l'enhance du chapitre courant) ----------------
// Sur chaque tête de scène et chaque h2 : visible en mode séance uniquement (CSS).
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
