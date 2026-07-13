// games.js — weblets « Sabacc » et « Ateliers » : les règles des modules
// swffg-sabacc / swffg-workshops proposées dans l'Holocron (contenu FR rebundlé,
// cf. games-content.js). Rendu en onglets ; le HTML passe par renderJournalHTML
// (glyphes de dés FFG + nettoyage). Aucune dépendance à Foundry.
import { GAMES } from './games-content.js';
import { renderJournalHTML } from './render-journal.js';

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}

function mountGame(container, key) {
  const data = GAMES[key];
  container.innerHTML = '';
  if (!data) { container.appendChild(el('div', 'view-head', '<h1>Introuvable</h1>')); return; }

  const root = el('section', 'games-view');
  const head = el('div', 'view-head');
  head.appendChild(el('h1', null, data.title));
  if (data.sub) head.appendChild(el('p', 'muted', data.sub));
  root.appendChild(head);

  const sections = data.sections || [];
  let cur = 0;

  // Barre d'onglets (masquée s'il n'y a qu'une section).
  const tabs = el('div', 'games-tabs');
  const body = el('div', 'games-body page-surface reader journal-content');

  function render() {
    tabs.innerHTML = '';
    if (sections.length > 1) {
      sections.forEach((s, i) => {
        const b = el('button', 'games-tab' + (i === cur ? ' active' : ''), s.name);
        b.type = 'button';
        b.addEventListener('click', () => { cur = i; render(); });
        tabs.appendChild(b);
      });
    }
    body.innerHTML = '';
    renderJournalHTML(body, sections[cur] ? sections[cur].html : '');
  }

  root.appendChild(tabs);
  root.appendChild(body);

  if (data.module) {
    root.appendChild(el('p', 'games-src muted',
      `Règles issues du module Foundry <code>${data.module}</code>. Installe-le dans ton monde pour jouer (macros, cartes, scènes).`));
  }

  container.appendChild(root);
  render();
}

export function mountSabacc(container) { mountGame(container, 'sabacc'); }
export function mountAteliers(container) { mountGame(container, 'ateliers'); }
