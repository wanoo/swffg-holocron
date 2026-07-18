// act-summary.js — rendu du SOMMAIRE D'ACTE (« tableau au début de l'acte ») en
// tête de la page de lecture d'un journal d'acte. La donnée vient de la vue
// journaux (journal.actSummary — flags.holocron.actSummary côté Foundry) :
// le serveur a DÉJÀ retiré les champs masqués aux joueurs ; une session MJ
// reçoit tout + la liste `hidden` (badge 🔒 sur les champs masqués).
import { Data } from './data.js';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const FIELD_LABELS = {
  situation: 'Situation',
  objectifs: 'Objectifs',
  protagonistes: 'Protagonistes',
  lieux: 'Lieux',
  fronts: 'Fronts en mouvement',
};

// id Foundry → lien cliquable si le journal est visible, sinon nom seul.
function refChip(id) {
  const j = Data.journalById.get(id);
  if (!j) return '';
  return `<a class="acts-chip" href="#/journal/${esc(j.id)}">${esc(j.name)}</a>`;
}

/** Encart de sommaire d'acte (ou null si rien à montrer). */
export function actSummaryCard(journal) {
  const s = journal.actSummary;
  if (!s) return null;
  const hidden = new Set(s.hidden || []);
  const lock = (f) => (hidden.has(f) ? ' <span class="acts-lock" title="Masqué aux joueurs">🔒</span>' : '');

  const box = document.createElement('section');
  box.className = 'act-summary page-surface';
  let html = '<p class="acts-eyebrow">📜 Sommaire de l’acte</p>';
  if (s.crawl) {
    html += `<div class="acts-crawl">${esc(s.crawl).replace(/\n/g, '<br>')}${lock('crawl')}</div>`;
  }
  const rows = [];
  if (s.situation) rows.push([FIELD_LABELS.situation + lock('situation'), `<p>${esc(s.situation).replace(/\n/g, '<br>')}</p>`]);
  if (s.objectifs?.length) rows.push([FIELD_LABELS.objectifs + lock('objectifs'), `<ul class="acts-list">${s.objectifs.map((o) => `<li>${esc(o)}</li>`).join('')}</ul>`]);
  if (s.protagonistes?.length) {
    const chips = s.protagonistes.map(refChip).filter(Boolean).join('');
    if (chips) rows.push([FIELD_LABELS.protagonistes + lock('protagonistes'), `<div class="acts-chips">${chips}</div>`]);
  }
  if (s.lieux?.length) {
    const chips = s.lieux.map(refChip).filter(Boolean).join('');
    if (chips) rows.push([FIELD_LABELS.lieux + lock('lieux'), `<div class="acts-chips">${chips}</div>`]);
  }
  if (s.fronts?.length) rows.push([FIELD_LABELS.fronts + lock('fronts'), `<ul class="acts-list fronts">${s.fronts.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>`]);
  if (rows.length) {
    html += `<dl class="acts-grid">${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>`;
  }
  if (!s.crawl && !rows.length) return null;
  box.innerHTML = html;
  return box;
}
