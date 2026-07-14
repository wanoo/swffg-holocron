// timeline.js — frise chronologique (#/timeline) : fiches MEJ « event » datées en
// BBY/ABY. Événements Canon (pack du module, en modale) + Campagne (dossier du
// monde, navigables) mêlés et triés par le serveur (/api/content/timeline).
import { openCard } from './modal.js';
import { renderRichHTML } from './render-journal.js';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const SOURCE = {
  canon: { label: 'Canon', cls: 'tl-canon' },
  campagne: { label: 'Campagne', cls: 'tl-campagne' },
};

function itemHTML(ev, i) {
  const src = SOURCE[ev.source] || SOURCE.campagne;
  const dateTxt = ev.date ? esc(ev.date) + (ev.dateEnd ? ` → ${esc(ev.dateEnd)}` : '') : '· · ·';
  return `
    <li class="tl-item ${src.cls}" data-i="${i}">
      <span class="tl-dot" aria-hidden="true"></span>
      <button class="tl-card" type="button">
        <span class="tl-date">${dateTxt}</span>
        <span class="tl-src">${src.label}</span>
        <b class="tl-name">${esc(ev.name)}</b>
        ${ev.location ? `<small class="tl-loc">📍 ${esc(ev.location)}</small>` : ''}
        ${ev.excerpt ? `<small class="tl-excerpt">${esc(ev.excerpt)}</small>` : ''}
      </button>
    </li>`;
}

export async function mountTimeline(container) {
  container.innerHTML = `
    <div class="view-head"><h1>📅 Chronologie galactique</h1>
    <p class="muted">Événements canon et faits de la campagne, datés en BBY/ABY (avant/après la bataille de Yavin).</p></div>
    <p class="muted" id="tl-status">Chargement de la frise…</p>`;
  let data = null;
  try {
    const r = await fetch('/api/content/timeline', { credentials: 'same-origin' });
    if (r.ok) data = await r.json();
  } catch { /* hors-ligne */ }
  const status = container.querySelector('#tl-status');
  const events = data?.events || [];
  if (!events.length) {
    status.innerHTML = 'Aucun événement. Créez des fiches MEJ de type <b>📅 Événement</b> avec un attribut '
      + '<code>date</code> (ex. « 19 BBY ») dans le dossier de campagne déclaré <code>kind:"timeline"</code>, '
      + 'ou renseignez <code>packs.events</code> (⚙️ Holocron Config) pour les événements canon.';
    return;
  }
  status.remove();

  const dated = events.filter((e) => e.dateValue != null);
  const undated = events.filter((e) => e.dateValue == null);
  const wrap = document.createElement('div');
  wrap.className = 'tl-wrap';
  // filtres canon / campagne (simple bascule d'affichage)
  wrap.innerHTML = `
    <div class="tl-filters">
      <label><input type="checkbox" data-src="canon" checked> <span class="tl-pill tl-canon">Canon</span></label>
      <label><input type="checkbox" data-src="campagne" checked> <span class="tl-pill tl-campagne">Campagne</span></label>
    </div>
    <ol class="tl-line">${dated.map((e) => itemHTML(e, events.indexOf(e))).join('')}</ol>
    ${undated.length ? `<h3 class="sheet-section-title">Sans date</h3>
    <ol class="tl-line tl-undated">${undated.map((e) => itemHTML(e, events.indexOf(e))).join('')}</ol>` : ''}`;

  wrap.addEventListener('click', (e) => {
    const li = e.target.closest('.tl-item');
    if (!li) return;
    const ev = events[+li.dataset.i];
    if (!ev) return;
    if (ev.source === 'campagne') { location.hash = `#/journal/${ev.id}`; return; }
    // canon : contenu embarqué, affiché en modale (non navigable)
    const node = document.createElement('div');
    node.className = 'journal-content';
    node.innerHTML = renderRichHTML(ev.html || `<p>${esc(ev.excerpt)}</p>`);
    openCard(ev.name, node, `${ev.date || 'Sans date'} · Canon${ev.location ? ' · ' + ev.location : ''}`);
  });
  for (const box of wrap.querySelectorAll('.tl-filters input')) {
    box.addEventListener('change', () => {
      for (const li of wrap.querySelectorAll(`.tl-item.tl-${box.dataset.src}`)) li.hidden = !box.checked;
    });
  }

  container.appendChild(wrap);
  window.scrollTo(0, 0);
  document.title = 'Chronologie — Archive Holocron';
}
