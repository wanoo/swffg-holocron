// editor.js — pages éditables (Notes des joueurs, Actes de campagne) :
// vue rendue + édition WYSIWYG partagée/persistée via l'API, avec polling.
import { renderJournalHTML } from './render-journal.js';
import { isAvailable, getDoc, saveDoc, getAuthor } from './collab.js';

const POLL_MS = 15000;

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}
function fmtTime(ts) {
  try {
    return new Date(ts).toLocaleString('fr-FR', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
  } catch {
    return '';
  }
}

const TOOLS = [
  { cmd: 'bold', label: 'G', title: 'Gras', style: 'font-weight:700' },
  { cmd: 'italic', label: 'I', title: 'Italique', style: 'font-style:italic' },
  { block: 'h3', label: 'Titre', title: 'Titre' },
  { block: 'blockquote', label: '❝', title: 'Citation' },
  { cmd: 'insertUnorderedList', label: '• Liste', title: 'Liste à puces' },
  { cmd: 'insertOrderedList', label: '1. Liste', title: 'Liste numérotée' },
  { block: 'p', label: '¶', title: 'Paragraphe' },
];

// Monte une page éditable dans `bodyEl` (.journal-content vide).
// opts.api = { getDoc, saveDoc } pour cibler une autre API (ex. section MJ) ;
// opts.available = true pour forcer le mode connecté (déjà authentifié) ;
// opts.initial = { html, updatedAt, updatedBy } : version partagée DÉJÀ chargée
//   par l'appelant (évite un second fetch au montage) ;
// opts.onChange(html, updatedAt, updatedBy) : notifie l'appelant après save/poll
//   (lui permet de garder sa copie du doc à jour).
// Renvoie une fonction de nettoyage (stoppe le polling).
export function mountEditablePage(bodyEl, page, opts = {}) {
  const api = opts.api || { getDoc, saveDoc };
  const checkAvailable = opts.available != null ? async () => opts.available : isAvailable;
  const state = { html: page.html || '', updatedAt: null, updatedBy: '', editing: false, apiOn: false };
  if (opts.initial) {
    if (opts.initial.html != null) state.html = opts.initial.html;
    state.updatedAt = opts.initial.updatedAt ?? null;
    state.updatedBy = opts.initial.updatedBy || '';
  }
  const notify = () => { try { opts.onChange?.(state.html, state.updatedAt, state.updatedBy); } catch { /* appelant */ } };
  let pollTimer = null;
  let disposed = false;

  function renderView() {
    bodyEl.innerHTML = '';
    const bar = el('div', 'note-bar');
    const status = el('span', 'note-status');
    if (state.apiOn) {
      status.textContent = state.updatedAt
        ? `Enregistré ${fmtTime(state.updatedAt)}${state.updatedBy ? ' · ' + state.updatedBy : ''}`
        : 'Partagé — non modifié';
      const editBtn = el('button', 'note-edit-btn', '✎ Éditer');
      editBtn.type = 'button';
      editBtn.addEventListener('click', enterEdit);
      bar.append(status, editBtn);
    } else {
      status.textContent = 'Édition indisponible (hors-ligne / API absente) — lecture seule';
      bar.appendChild(status);
    }
    bodyEl.appendChild(bar);
    const view = el('div', 'note-view');
    renderJournalHTML(view, state.html);
    bodyEl.appendChild(view);
  }

  function enterEdit() {
    state.editing = true;
    bodyEl.innerHTML = '';

    const toolbar = el('div', 'note-toolbar');
    for (const t of TOOLS) {
      const b = el('button', 'note-tool');
      b.type = 'button';
      b.title = t.title;
      b.innerHTML = t.label;
      if (t.style) b.setAttribute('style', t.style);
      b.addEventListener('mousedown', (e) => e.preventDefault()); // garde la sélection
      b.addEventListener('click', () => {
        if (t.cmd) document.execCommand(t.cmd, false, null);
        else if (t.block) document.execCommand('formatBlock', false, t.block);
        edit.focus();
      });
      toolbar.appendChild(b);
    }
    bodyEl.appendChild(toolbar);

    const edit = el('div', 'note-editor journal-content');
    edit.contentEditable = 'true';
    edit.spellcheck = true;
    edit.innerHTML = state.html;
    bodyEl.appendChild(edit);

    const actions = el('div', 'note-actions');
    const save = el('button', 'note-save', 'Enregistrer');
    save.type = 'button';
    const cancel = el('button', 'note-cancel', 'Annuler');
    cancel.type = 'button';
    const msg = el('span', 'note-msg');
    actions.append(save, cancel, msg);
    bodyEl.appendChild(actions);

    cancel.addEventListener('click', () => { state.editing = false; renderView(); });
    save.addEventListener('click', async () => {
      save.disabled = true;
      msg.textContent = 'Enregistrement…';
      try {
        const res = await api.saveDoc(page.id, edit.innerHTML, state.updatedAt, getAuthor());
        if (res.conflict) {
          msg.textContent = 'Conflit : modifié ailleurs. Rechargez pour voir la version à jour.';
          const reload = el('button', 'note-cancel', 'Recharger');
          reload.type = 'button';
          reload.addEventListener('click', () => {
            state.html = res.current.html;
            state.updatedAt = res.current.updatedAt;
            state.updatedBy = res.current.updatedBy;
            state.editing = false;
            renderView();
          });
          actions.appendChild(reload);
          save.disabled = false;
          return;
        }
        state.html = edit.innerHTML;
        state.updatedAt = res.updatedAt;
        state.updatedBy = getAuthor();
        state.editing = false;
        notify();
        renderView();
      } catch (err) {
        msg.textContent = 'Échec de l’enregistrement : ' + err.message;
        save.disabled = false;
      }
    });
  }

  async function poll() {
    if (disposed || state.editing) return;
    try {
      const doc = await api.getDoc(page.id);
      if (doc && doc.updatedAt !== state.updatedAt) {
        state.html = doc.html;
        state.updatedAt = doc.updatedAt;
        state.updatedBy = doc.updatedBy;
        notify();
        if (!state.editing) renderView();
      }
    } catch {
      /* silencieux */
    }
  }

  // Init : détecte l'API, charge la version partagée (sauf si fournie), puis rend.
  (async () => {
    state.apiOn = await checkAvailable();
    if (state.apiOn) {
      if (!opts.initial) {
        try {
          const doc = await api.getDoc(page.id);
          if (doc) {
            state.html = doc.html;
            state.updatedAt = doc.updatedAt;
            state.updatedBy = doc.updatedBy;
          }
        } catch {
          /* garde le contenu embarqué */
        }
      }
      pollTimer = setInterval(poll, POLL_MS);
    }
    if (!disposed) renderView();
  })();

  return () => {
    disposed = true;
    if (pollTimer) clearInterval(pollTimer);
  };
}
