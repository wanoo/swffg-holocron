// render-journal.js — transforme le HTML d'une page Foundry en contenu affichable :
//  1. résout les @UUID (liens internes + pastilles compendium)
//  2. rend les dés/symboles (glyphes)
//  3. rend les grands tableaux scrollables horizontalement
//  4. neutralise les images cassées
import { enrichDice } from './render-dice.js';
import { compendiumEntry } from './data.js';

const UUID_RE = /@UUID\[([^\]]+)\](?:\{([^}]*)\})?/g;

function esc(s = '') {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Convertit un @UUID en HTML (chaîne). N'insère que du markup contrôlé.
function uuidToHTML(target, label) {
  const parts = target.split('.');
  // Le libellé provient de données Foundry locales de confiance et peut déjà
  // contenir des entités HTML (ex. "Fiert&eacute;") : on l'insère tel quel comme
  // texte, sans ré-échapper (ce qui produirait "Fiert&amp;eacute;").
  const text = label || '';

  if (target.startsWith('JournalEntry.')) {
    // JournalEntry.<jid>[.JournalEntryPage.<pid>]
    const jid = parts[1];
    const pid = parts[2] === 'JournalEntryPage' ? parts[3] : '';
    const lbl = text || 'Voir la page';
    const href = pid ? `#/journal/${esc(jid)}/${esc(pid)}` : `#/journal/${esc(jid)}`;
    return `<a class="xref" href="${href}">${lbl}</a>`;
  }

  if (target.startsWith('Compendium.')) {
    // Compendium.world.<pack>.<id>  (parfois Compendium.<pack>.<id>)
    let pack, id;
    if (parts.length >= 4) {
      pack = parts[parts.length - 2];
      id = parts[parts.length - 1];
    }
    const ref = `${pack}.${id}`;
    const entry = compendiumEntry(ref);
    const lbl = text || esc(entry?.name || 'Référence');
    const known = entry ? ' is-known' : '';
    const title = entry ? esc(entry.name) : 'Référence de compendium (hors export)';
    return `<button type="button" class="citem${known}" data-ref="${esc(ref)}" title="${title}"><span class="citem-ico" aria-hidden="true">◈</span>${lbl}</button>`;
  }

  // Autres cibles (Actor, Item hors compendium…) : simple libellé.
  return `<span class="ref-plain">${text || esc(target)}</span>`;
}

function replaceUUID(raw) {
  return raw.replace(UUID_RE, (_m, target, label) => uuidToHTML(target, label));
}

// Enveloppe chaque tableau dans un conteneur scrollable et applique le style ".results".
function decorateTables(root) {
  for (const table of root.querySelectorAll('table')) {
    table.classList.add('journal-table');
    // Les tableaux Foundry de résultats (blessures critiques…) portent .results.
    const wrap = document.createElement('div');
    wrap.className = 'table-scroll';
    table.parentNode.insertBefore(wrap, table);
    wrap.appendChild(table);
  }
}

// Marque les images cassées pour un repli propre (pas de logo cassé).
function guardImages(root) {
  for (const img of root.querySelectorAll('img')) {
    img.loading = 'lazy';
    img.addEventListener('error', () => img.classList.add('img-broken'), { once: true });
  }
}

// Rend le HTML d'une page dans un conteneur.
export function renderJournalHTML(container, rawHTML) {
  container.innerHTML = replaceUUID(rawHTML || '');
  enrichDice(container);
  decorateTables(container);
  guardImages(container);
  return container;
}

// Rend un fragment HTML « riche » (descriptions de talents, armes, capacités…)
// sans décoration de tableau lourde, mais avec dés + @UUID.
export function renderRichHTML(rawHTML) {
  const span = document.createElement('div');
  span.className = 'rich';
  span.innerHTML = replaceUUID(rawHTML || '');
  enrichDice(span);
  guardImages(span);
  return span;
}
