// act-summary.js — rendu du SOMMAIRE D'ACTE (« tableau au début de l'acte ») en
// tête de la page de lecture d'un journal d'acte. La donnée vient de la vue
// journaux (journal.actSummary — flags.holocron.actSummary côté Foundry) :
// le serveur a DÉJÀ retiré les champs masqués aux joueurs ; une session MJ
// reçoit tout + la liste `hidden` (badge 🔒 sur les champs masqués).
import { Data } from './data.js';
import { apiBase, getGMKey } from './collab.js';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// --- Progression du storyboard (MJ UNIQUEMENT) --------------------------------
// Les beats vivent dans flags.holocron.storyboard et ne sortent QUE par la
// route gm-gated /api/gm/board (catalogue des actes) : pour un joueur, ce
// fetch n'est jamais tenté et rien n'est rendu. Cache court (30 s).
let sbCache = null; // { t, byId: Map<journalFoundryId, storyboard> }
async function gmStoryboards() {
  if (!(Data.gm || getGMKey())) return null;
  if (sbCache && Date.now() - sbCache.t < 30_000) return sbCache.byId;
  try {
    const res = await fetch(`${apiBase()}/gm/board`, {
      credentials: 'same-origin',
      headers: getGMKey() ? { 'x-gm-key': getGMKey() } : {},
    });
    if (!res.ok) return null;
    const data = await res.json();
    const byId = new Map();
    for (const n of (data.catalog?.nodes || [])) {
      if (n.type === 'acte' && n.storyboard?.beats?.length) byId.set(n.id, n.storyboard);
    }
    sbCache = { t: Date.now(), byId };
    return byId;
  } catch { return null; }
}

/** Pied de sommaire : progression du storyboard de l'acte (async, MJ only). */
function appendStoryboardFooter(box, journal) {
  if (!(Data.gm || getGMKey())) return;
  gmStoryboards().then((byId) => {
    const sb = byId?.get(journal.foundryId);
    if (!sb || !box.isConnected) return;
    const done = sb.beats.filter((b) => b.status === 'fait').length;
    const cur = sb.beats.find((b) => b.status === 'encours');
    const foot = document.createElement('p');
    foot.className = 'acts-sb';
    foot.innerHTML = `🎬 Storyboard : <b>${done}/${sb.beats.length}</b> beats joués`
      + (cur ? ` · en cours : <b>${esc(cur.title || '(sans titre)')}</b>` : '')
      + ` — <a href="#/mj/campagne">ouvrir</a> <span class="acts-lock" title="Visible du MJ seulement">🔒 MJ</span>`;
    box.appendChild(foot);
  });
}

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
  appendStoryboardFooter(box, journal); // MJ only — async, no-op joueur
  return box;
}
