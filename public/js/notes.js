// notes.js — bloc-notes MJ (privé, persisté serveur, jamais côté joueur).
// Un panneau latéral 📝 ouvrable en contexte : notes globales (campagne), par
// chapitre/acte, par PNJ, par rencontre. Édition inline, auto-save + horodatage,
// suppression, recherche. Persistance via /api/gm/notes (gated x-gm-key).
import { gmNotesList, gmNoteSave, gmNoteDelete } from './collab.js';

const TYPE_META = {
  global: { ico: '🌐', label: 'Global' },
  chapter: { ico: '📄', label: 'Chapitre' },
  pnj: { ico: '🎭', label: 'PNJ' },
  rencontre: { ico: '⚔️', label: 'Rencontre' },
  seance: { ico: '🎬', label: 'Séance' },
};

let notes = [];          // cache mémoire
let currentTarget = { type: 'global', ref: '', label: 'Campagne (global)' };
let panel, listEl, searchEl, ctxEl, composerEl, wired = false;
let loaded = false;

const el = (t, c, h) => { const e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; };
const uid = () => 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
function fmt(ts) {
  if (!ts) return '';
  try { return new Date(ts).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch { return ''; }
}
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

function build() {
  if (panel) return;
  panel = el('aside', 'gm-notes-panel');
  panel.hidden = true;
  panel.setAttribute('aria-label', 'Notes du Maître du Jeu');
  panel.innerHTML = `
    <div class="gm-notes-head">
      <strong>📝 Notes MJ</strong>
      <button class="gm-notes-close" type="button" aria-label="Fermer">✕</button>
    </div>
    <input class="gm-notes-search" type="search" placeholder="Rechercher dans les notes…" aria-label="Rechercher dans les notes">
    <div class="gm-notes-ctx"></div>
    <div class="gm-notes-list" tabindex="-1"></div>`;
  document.body.appendChild(panel);
  const backdrop = el('div', 'gm-notes-backdrop');
  backdrop.hidden = true;
  document.body.appendChild(backdrop);

  listEl = panel.querySelector('.gm-notes-list');
  searchEl = panel.querySelector('.gm-notes-search');
  ctxEl = panel.querySelector('.gm-notes-ctx');
  panel.querySelector('.gm-notes-close').addEventListener('click', close);
  backdrop.addEventListener('click', close);
  searchEl.addEventListener('input', render);
  panel._backdrop = backdrop;
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !panel.hidden) close(); });
}

function open() { build(); panel.hidden = false; panel._backdrop.hidden = false; document.body.classList.add('gm-notes-open'); }
function close() { if (!panel) return; panel.hidden = true; panel._backdrop.hidden = true; document.body.classList.remove('gm-notes-open'); }

async function ensureLoaded() {
  if (loaded) return;
  try { notes = (await gmNotesList()) || []; loaded = true; } catch { notes = []; }
}

function noteCard(n) {
  const card = el('div', 'gm-note-card');
  if (n.targetType === currentTarget.type && n.targetRef === currentTarget.ref) card.classList.add('is-ctx');
  const meta = TYPE_META[n.targetType] || TYPE_META.global;
  const head = el('div', 'gm-note-top');
  head.innerHTML = `<span class="gm-note-chip">${meta.ico} ${n.targetLabel || meta.label}</span>`;
  const del = el('button', 'gm-note-del', '🗑'); del.type = 'button'; del.title = 'Supprimer';
  del.addEventListener('click', async () => {
    if (!confirm('Supprimer cette note ?')) return;
    try { await gmNoteDelete(n.id); } catch {}
    notes = notes.filter((x) => x.id !== n.id);
    render();
  });
  head.appendChild(del);
  const ta = el('textarea', 'gm-note-text');
  ta.value = n.text || '';
  ta.rows = Math.min(10, Math.max(2, (n.text || '').split('\n').length));
  const status = el('div', 'gm-note-status');
  status.textContent = n.updatedAt ? 'Modifié ' + fmt(n.updatedAt) : '';
  let timer = null;
  ta.addEventListener('input', () => {
    ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px';
    status.textContent = 'Modification…';
    clearTimeout(timer);
    timer = setTimeout(async () => {
      n.text = ta.value;
      try {
        const r = await gmNoteSave(n.id, { targetType: n.targetType, targetRef: n.targetRef, targetLabel: n.targetLabel, text: n.text });
        n.updatedAt = r.updatedAt; status.textContent = 'Enregistré ✓ ' + fmt(n.updatedAt);
      } catch { status.textContent = '⚠️ non enregistré'; }
    }, 700);
  });
  card.append(head, ta, status);
  return card;
}

function render() {
  if (!listEl) return;
  // Contexte courant + composer.
  const meta = TYPE_META[currentTarget.type] || TYPE_META.global;
  ctxEl.innerHTML = `<span class="gm-notes-ctx-lbl">Contexte : ${meta.ico} ${currentTarget.label}</span>`;
  // Bascule vers le contexte global si on est ailleurs.
  if (currentTarget.type !== 'global') {
    const g = el('button', 'gm-notes-globalbtn', '🌐 Global'); g.type = 'button'; g.title = 'Notes de campagne (global)';
    g.addEventListener('click', () => { currentTarget = { type: 'global', ref: '', label: 'Campagne (global)' }; render(); });
    ctxEl.appendChild(g);
  }
  const add = el('button', 'gm-notes-add', '＋ Nouvelle note ici'); add.type = 'button';
  add.addEventListener('click', async () => {
    const n = { id: uid(), targetType: currentTarget.type, targetRef: currentTarget.ref, targetLabel: currentTarget.label, text: '', createdAt: Date.now(), updatedAt: Date.now() };
    notes.unshift(n);
    try { await gmNoteSave(n.id, n); } catch {}
    render();
    setTimeout(() => listEl.querySelector('.gm-note-card .gm-note-text')?.focus(), 30);
  });
  ctxEl.appendChild(add);

  // Liste filtrée : contexte courant d'abord, puis le reste.
  const q = norm(searchEl.value.trim());
  const match = (n) => !q || norm(n.text).includes(q) || norm(n.targetLabel).includes(q);
  const isCtx = (n) => n.targetType === currentTarget.type && n.targetRef === currentTarget.ref;
  const ctx = notes.filter((n) => isCtx(n) && match(n));
  const others = notes.filter((n) => !isCtx(n) && match(n));
  listEl.innerHTML = '';
  if (!ctx.length && !others.length) { listEl.appendChild(el('p', 'gm-notes-empty', q ? 'Aucune note ne correspond.' : 'Aucune note. Ajoute-en une ci-dessus.')); return; }
  if (ctx.length) { listEl.appendChild(el('div', 'gm-notes-sec', 'Ce contexte')); ctx.forEach((n) => listEl.appendChild(noteCard(n))); }
  if (others.length) { listEl.appendChild(el('div', 'gm-notes-sec', q ? 'Autres résultats' : 'Toutes les notes')); others.forEach((n) => listEl.appendChild(noteCard(n))); }
}

async function openFor(target) {
  currentTarget = { type: target?.type || 'global', ref: target?.ref || '', label: target?.label || 'Campagne (global)' };
  open();
  await ensureLoaded();
  render();
}

// Point d'entrée : à appeler une fois quand l'espace MJ est monté.
export function mountNotes() {
  build();
  if (!wired) {
    wired = true;
    window.addEventListener('gm-open-notes', (e) => openFor(e.detail));
  }
  loaded = false; // recharge à la prochaine ouverture (nouvelle session MJ)
}

// Ouvre le panneau de notes pour un contexte donné (depuis n'importe quel module).
export function openNotes(target) { window.dispatchEvent(new CustomEvent('gm-open-notes', { detail: target })); }
