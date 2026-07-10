// gm-home.js — « Poste de pilotage » : landing MJ interactive (#/mj sans chapitre).
// Widgets : Reprendre (position mémorisée) · Prochaine séance (gm:cfg:session) ·
// État des fronts (gm:cfg:fronts, édition inline autosave) · Accès rapides.
// Les données vivent côté serveur (gated) via gm-config.js — rien dans le bundle.
import { loadCfg, saveCfg } from './gm-config.js';
import { openNotes } from './notes.js';
import { openScreen } from './gm-screen.js';
import { foundryCard } from './gm-foundry.js';

const FRONTS_DEFAULTS = { v: 1, fronts: [] };
export const SESSION_DEFAULTS = { v: 1, title: '', date: '', pinned: null, checklist: [], noteRef: '' };

const STATUTS = [
  { key: 'ok', label: 'Stable', icon: '🟢' },
  { key: 'warn', label: 'Sous tension', icon: '🟠' },
  { key: 'hot', label: 'Critique', icon: '🔴' },
];

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Rend le poste de pilotage dans `main`.
// ctx = { all (chapitres chargés), selectChap(id, heading?), getPos() }.
export function renderGmHome(main, ctx, homeCleanup) {
  main.innerHTML = '';
  const wrap = el('div', 'gmh');
  wrap.appendChild(el('div', 'gmh-head', `
    <p class="eyebrow">🧭 Poste de pilotage</p>
    <h1 class="gmh-title">Table de campagne</h1>
    <div class="sep-aurebesh" aria-hidden="true"></div>`));
  const grid = el('div', 'gmh-grid');
  wrap.appendChild(grid);
  main.appendChild(wrap);

  grid.append(
    resumeCard(ctx),
    sessionCard(ctx, homeCleanup),
    frontsCard(homeCleanup),
    quickCard(ctx),
    foundryCard()
  );
}

// --- Widget : Reprendre où on en était -------------------------------------
function resumeCard(ctx) {
  const card = el('section', 'gmh-card holo-frame');
  card.appendChild(el('h2', 'gmh-h', '📖 Reprendre'));
  const pos = ctx.getPos();
  const chap = pos && ctx.all.find((c) => c.id === pos.chap);
  if (chap) {
    const headName = pos.heading ? chap.headings.find((h) => h.id === pos.heading)?.text : null;
    card.appendChild(el('p', 'gmh-p', `${esc(chap.name)}${headName ? `<br><span class="gmh-sub">↳ ${esc(headName)}</span>` : ''}`));
    const btn = el('button', 'gmh-cta', 'Reprendre la lecture →');
    btn.type = 'button';
    btn.addEventListener('click', () => ctx.selectChap(chap.id, pos.heading || undefined));
    card.appendChild(btn);
  } else {
    card.appendChild(el('p', 'gmh-p muted', 'Aucune lecture en cours. Ouvre un chapitre : ta position sera mémorisée ici.'));
  }
  return card;
}

// --- Widget : Prochaine séance ---------------------------------------------
function sessionCard(ctx, homeCleanup) {
  const card = el('section', 'gmh-card holo-frame');
  card.appendChild(el('h2', 'gmh-h', '🎬 Prochaine séance'));
  const body = el('div', 'gmh-body', '<p class="gmh-p muted">Chargement…</p>');
  card.appendChild(body);

  let updatedAt = null;
  let cfg = { ...SESSION_DEFAULTS };

  const render = () => {
    body.innerHTML = '';
    if (!cfg.title && !cfg.pinned) {
      body.appendChild(el('p', 'gmh-p muted', 'Aucune séance préparée.'));
      const btn = el('button', 'gmh-cta ghost', 'Préparer une séance');
      btn.type = 'button';
      btn.addEventListener('click', () => editForm());
      body.appendChild(btn);
      return;
    }
    body.appendChild(el('p', 'gmh-p', `<strong>${esc(cfg.title || 'Séance')}</strong>${cfg.date ? ` · <span class="gmh-sub">${esc(cfg.date)}</span>` : ''}`));
    if (cfg.pinned) {
      const go = el('button', 'gmh-cta', `→ ${esc(cfg.pinned.label || 'Scène en cours')}`);
      go.type = 'button';
      go.addEventListener('click', () => ctx.selectChap(cfg.pinned.chap, cfg.pinned.heading || undefined));
      body.appendChild(go);
    } else {
      body.appendChild(el('p', 'gmh-p muted gmh-sub', 'Aucune scène épinglée — utilise 📌 dans un chapitre (mode séance).'));
    }
    if (cfg.checklist?.length) {
      const done = cfg.checklist.filter((c) => c.done).length;
      body.appendChild(el('p', 'gmh-p gmh-sub', `☑ Checklist : ${done}/${cfg.checklist.length}`));
    }
    const edit = el('button', 'gmh-mini', '✎ Modifier');
    edit.type = 'button';
    edit.addEventListener('click', () => editForm());
    body.appendChild(edit);
  };

  const editForm = () => {
    body.innerHTML = '';
    const form = el('form', 'gmh-form');
    const title = el('input', 'gmh-input');
    title.placeholder = 'Titre (ex. Séance 12 — Phoenix Rise)';
    title.value = cfg.title || '';
    const date = el('input', 'gmh-input');
    date.type = 'date';
    date.value = cfg.date || '';
    const save = el('button', 'gmh-cta', 'Enregistrer');
    save.type = 'submit';
    const cancel = el('button', 'gmh-mini', 'Annuler');
    cancel.type = 'button';
    cancel.addEventListener('click', render);
    form.append(title, date, save, cancel);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      cfg.title = title.value.trim();
      cfg.date = date.value;
      const res = await saveCfg('session', cfg, updatedAt);
      if (res.conflict) { cfg = { ...SESSION_DEFAULTS, ...(res.current || {}) }; }
      updatedAt = res.updatedAt;
      render();
    });
    body.appendChild(form);
    title.focus();
  };

  loadCfg('session', SESSION_DEFAULTS).then(({ cfg: c, updatedAt: u }) => { cfg = c; updatedAt = u; render(); });
  return card;
}

// --- Widget : État des fronts ----------------------------------------------
function frontsCard(homeCleanup) {
  const card = el('section', 'gmh-card holo-frame');
  card.appendChild(el('h2', 'gmh-h', '🔥 Fronts actifs'));
  const body = el('div', 'gmh-body', '<p class="gmh-p muted">Chargement…</p>');
  card.appendChild(body);

  let updatedAt = null;
  let cfg = { ...FRONTS_DEFAULTS };
  let saveTimer = null;
  const scheduleSave = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      const res = await saveCfg('fronts', cfg, updatedAt);
      if (res.conflict) { cfg = { ...FRONTS_DEFAULTS, ...(res.current || {}) }; render(); }
      updatedAt = res.updatedAt;
    }, 700);
  };
  homeCleanup.push(() => clearTimeout(saveTimer));

  const render = () => {
    body.innerHTML = '';
    const list = el('div', 'gmh-fronts');
    for (const [i, f] of (cfg.fronts || []).entries()) {
      const row = el('div', 'gmh-front');
      const st = STATUTS.find((s) => s.key === f.statut) || STATUTS[0];
      const chip = el('button', 'gmh-front-st', `${st.icon}`);
      chip.type = 'button';
      chip.title = `${st.label} — cliquer pour changer`;
      chip.addEventListener('click', () => {
        const next = STATUTS[(STATUTS.findIndex((s) => s.key === f.statut) + 1) % STATUTS.length] || STATUTS[0];
        f.statut = next.key;
        chip.textContent = next.icon;
        chip.title = `${next.label} — cliquer pour changer`;
        scheduleSave();
      });
      const label = el('input', 'gmh-front-label');
      label.value = f.label || '';
      label.placeholder = 'Front (fil narratif)';
      label.addEventListener('input', () => { f.label = label.value; scheduleSave(); });
      const note = el('input', 'gmh-front-note');
      note.value = f.note || '';
      note.placeholder = 'état / prochain coup';
      note.addEventListener('input', () => { f.note = note.value; scheduleSave(); });
      const del = el('button', 'gmh-front-del', '✕');
      del.type = 'button';
      del.title = 'Supprimer ce front';
      del.addEventListener('click', () => { cfg.fronts.splice(i, 1); render(); scheduleSave(); });
      row.append(chip, label, note, del);
      list.appendChild(row);
    }
    body.appendChild(list);
    if (!cfg.fronts?.length) body.appendChild(el('p', 'gmh-p muted gmh-sub', 'Suis ici tes fils narratifs (menaces, dettes, factions…).'));
    const add = el('button', 'gmh-mini', '＋ Ajouter un front');
    add.type = 'button';
    add.addEventListener('click', () => { cfg.fronts.push({ label: '', statut: 'ok', note: '' }); render(); });
    body.appendChild(add);
  };

  loadCfg('fronts', FRONTS_DEFAULTS).then(({ cfg: c, updatedAt: u }) => { cfg = c; updatedAt = u; render(); });
  return card;
}

// --- Widget : Accès rapides -------------------------------------------------
function quickCard(ctx) {
  const card = el('section', 'gmh-card holo-frame');
  card.appendChild(el('h2', 'gmh-h', '⚡ Accès rapides'));
  const wrap = el('div', 'gmh-quick');
  const add = (label, fn) => {
    const b = el('button', 'gmh-chip', label);
    b.type = 'button';
    b.addEventListener('click', fn);
    wrap.appendChild(b);
  };
  add('🖥️ Écran live', () => openScreen());
  add('📝 Notes', () => openNotes({ type: 'global', ref: '', label: 'Campagne (global)' }));
  const chip = (id, label) => { const c = ctx.all.find((x) => x.id === id); if (c) add(label, () => ctx.selectChap(c.id)); };
  chip('gm-vue-densemble', '🧭 Vue d\'ensemble');
  chip('gm-acte-5', '🎬 Acte 5 — Phoenix Rise');
  chip('gm-packs-god', '🎲 Packs de rencontre');
  chip('gm-cockpit', '🖥️ Cockpit de table');
  card.appendChild(wrap);
  return card;
}
