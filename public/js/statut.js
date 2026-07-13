// statut.js — pastille d'allégeance d'un PNJ « rencontré ».
// Partagée entre la barre latérale (liste Personnages) et la vue journal.
export const STATUT = {
  allie: { label: 'Allié', color: '#8ad17a' },
  ennemi: { label: 'Ennemi', color: '#e5544b' },
  neutre: { label: 'Neutre', color: '#8b9bc0' },
  mentor: { label: 'Mentor', color: '#d9b45b' },
  contact: { label: 'Contact', color: '#7ec8d9' },
};

// Construit une pastille <span> pour un journal { statut, mort }.
// Renvoie null si le journal n'a pas de statut (→ pas une fiche PNJ typée).
export function statutPill(journal, { compact = false } = {}) {
  const meta = STATUT[journal?.statut];
  if (!meta) return null;
  const span = document.createElement('span');
  span.className = 'statut-pill' + (journal.mort ? ' is-dead' : '') + (compact ? ' compact' : '');
  span.style.setProperty('--sc', meta.color);
  span.textContent = meta.label + (journal.mort ? ' †' : '');
  span.title = journal.mort ? `${meta.label} — décédé(e)` : meta.label;
  return span;
}
