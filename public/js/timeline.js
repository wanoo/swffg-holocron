// timeline.js — frise chronologique (#/timeline) : fiches MEJ « event » du dossier
// d'événements du monde. Date = champ natif MEJ (BBY/ABY), Canon/Campagne = champ
// natif « Position » (location). Tri serveur (/api/content/timeline), groupé par
// ère (BBY / ABY / sans date) ; chaque événement est une fiche navigable.

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const SOURCE = {
  canon: { label: 'Canon', cls: 'tl-canon' },
  campagne: { label: 'Campagne', cls: 'tl-campagne' },
};

function itemHTML(ev, i) {
  const src = SOURCE[ev.source] || SOURCE.campagne;
  const dateTxt = ev.date ? esc(ev.date).replace(/\s*(BBY|ABY)\s*$/i, ' $1') : '· · ·';
  return `
    <li class="tl-item ${src.cls}${ev.id ? '' : ' tl-nolink'}" data-i="${i}" title="${esc(ev.excerpt || '')}">
      <span class="tl-date">${dateTxt}${ev.dateEnd ? `<small>→ ${esc(ev.dateEnd)}</small>` : ''}</span>
      <span class="tl-dot" aria-hidden="true"></span>
      <span class="tl-body">
        <b class="tl-name">${esc(ev.name.replace(/^\s*[\d.,]+\s*(BBY|ABY)\s*[—–-]\s*/i, ''))}</b>
        ${ev.location ? `<span class="tl-loc">${esc(ev.location)}</span>` : ''}
        <span class="tl-src">${src.label}</span>
      </span>
    </li>`;
}

const eraHTML = (label) => `
  <li class="tl-era" aria-hidden="true"><span>${esc(label)}</span></li>`;

export async function mountTimeline(container) {
  container.innerHTML = `
    <div class="view-head"><h1>📅 Chronologie galactique</h1>
    <p class="muted">Événements canon et faits de la campagne — datés en BBY/ABY (avant/après la bataille de Yavin).</p></div>
    <p class="muted" id="tl-status">Chargement de la frise…</p>`;
  let data = null;
  try {
    const r = await fetch('/api/content/timeline', { credentials: 'same-origin' });
    if (r.ok) data = await r.json();
  } catch { /* hors-ligne */ }
  const status = container.querySelector('#tl-status');
  const events = data?.events || [];
  if (!events.length) {
    status.innerHTML = 'Aucun événement visible. Dans le dossier d\'événements (fiches MEJ '
      + '<b>📅 Événement</b>), la <b>Date</b> se note en BBY/ABY (« 19 BBY ») et le champ '
      + '<b>Position</b> vaut <i>Canon</i> ou <i>Campagne</i>. Le compendium « 📅 Événements canon » '
      + 'du module fournit 20 fiches prêtes à l\'emploi (importées automatiquement à l\'installation).';
    return;
  }
  status.remove();

  // groupes d'ère : BBY (négatif), ABY (0 inclus), sans date en fin
  const rows = [];
  let era = null;
  for (const ev of events) {
    const e = ev.dateValue == null ? 'nodate' : ev.dateValue < 0 ? 'bby' : 'aby';
    if (e !== era) {
      era = e;
      rows.push(eraHTML(e === 'bby' ? 'Avant la bataille de Yavin' : e === 'aby' ? 'Après la bataille de Yavin' : 'Sans date'));
    }
    rows.push(itemHTML(ev, events.indexOf(ev)));
  }

  const wrap = document.createElement('div');
  wrap.className = 'tl-wrap';
  wrap.innerHTML = `
    <div class="tl-filters" role="group" aria-label="Filtres">
      <label class="tl-pill tl-canon"><input type="checkbox" data-src="canon" checked> Canon</label>
      <label class="tl-pill tl-campagne"><input type="checkbox" data-src="campagne" checked> Campagne</label>
      <span class="tl-count">${events.length} événements</span>
    </div>
    <ol class="tl-line">${rows.join('')}</ol>`;

  wrap.addEventListener('click', (e) => {
    const li = e.target.closest('.tl-item');
    if (!li) return;
    const ev = events[+li.dataset.i];
    if (ev?.id) location.hash = `#/journal/${ev.id}`; // les événements Mini Calendar n'ont pas de fiche
  });
  for (const box of wrap.querySelectorAll('.tl-filters input')) {
    box.addEventListener('change', () => {
      for (const li of wrap.querySelectorAll(`.tl-item.tl-${box.dataset.src}`)) li.hidden = !box.checked;
      box.closest('.tl-pill').classList.toggle('off', !box.checked);
    });
  }

  container.appendChild(wrap);
  window.scrollTo(0, 0);
  document.title = 'Chronologie — Archive Holocron';
}
