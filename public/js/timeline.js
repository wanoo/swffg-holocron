// timeline.js — frise chronologique (#/timeline) : fiches MEJ « event » du dossier
// d'événements du monde, datées en BBY/ABY (attribut `date`) et classées par
// l'attribut `position` (Canon / Campagne). Tri serveur (/api/content/timeline) ;
// chaque événement est une fiche navigable (#/journal/<id>).

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
    status.innerHTML = 'Aucun événement. Créez des fiches MEJ de type <b>📅 Événement</b> avec les attributs '
      + '<code>date</code> (ex. « 19 BBY ») et <code>position</code> (Canon / Campagne) dans le dossier '
      + 'd\'événements déclaré <code>kind:"timeline"</code> (⚙️ Holocron Config). Le compendium '
      + '« 📅 Événements canon » du module fournit 20 fiches prêtes à importer dans ce dossier.';
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
    if (ev) location.hash = `#/journal/${ev.id}`;
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
