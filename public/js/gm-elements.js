// gm-elements.js — 🧩 La bible en éléments (espace MJ, #/mj/elements).
//
// La bible n'est plus un mur de chapitres : c'est une COLLECTION D'ÉLÉMENTS
// (📣 lectures, 🔊 ambiances, 🖼️ visuels, 🔮 visions) rangés dans des
// répertoires de la bible, attachables aux beats du storyboard.
// Cet écran orchestre les quatre gestes, dans l'ordre sûr :
//   1. 🗄️ archiver la bible (copie de sécurité mensuelle, rien n'est supprimé) ;
//   2. 🧩 décomposer un chapitre : APERÇU d'abord, le MJ coche, PUIS on crée ;
//   3. 🎭 dédoublonner les chapitres PNJ vers les fiches CC (report additif) ;
//   4. consulter les répertoires existants.
// Patron d'UI : l'import des rencontres (gm-encounters.js) — scan → cases → action.
import { gmHeaders } from './collab.js';

const API = (window.HOLOCRON && window.HOLOCRON.api) || '/api';
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };

async function api(path, opts = {}) {
  const res = await fetch(API + path, {
    credentials: 'same-origin', headers: gmHeaders({ 'Content-Type': 'application/json' }), ...opts,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

// Aperçu court d'un champ de données d'élément (une ligne, jamais un roman).
function dataPreview(kind, data) {
  const d = data || {};
  const cutText = (s, n = 160) => (String(s).length > n ? String(s).slice(0, n - 1) + '…' : String(s));
  if (kind === 'lecture') return cutText(d.texte || '');
  if (kind === 'ambiance') return [d.playlist && `🎵 ${d.playlist}`, d.weather && `🌦️ ${d.weather}`].filter(Boolean).join(' · ');
  if (kind === 'visuel') return [d.src && `🖼️ ${d.src}`, d.legende].filter(Boolean).join(' · ');
  if (kind === 'vision') return [d.pj && `→ ${d.pj}`, cutText(d.texte || '', 120)].filter(Boolean).join(' · ');
  return '';
}

export async function mountGmElements(container, cleanup = []) {
  container.innerHTML = '<div class="view-head"><h1>🧩 La bible en éléments</h1>'
    + '<p class="muted">Décompose tes chapitres en éléments réutilisables — lectures, ambiances, visuels, '
    + 'visions — rangés dans des répertoires de la bible et attachables aux beats du storyboard. '
    + 'Rien n’est écrit sans ton accord, et le chapitre d’origine n’est jamais modifié.</p></div>';
  const wrap = el('div', 'elx-wrap');
  container.appendChild(wrap);

  let templates = {};
  let elements = [];
  let chapters = [];

  async function refresh() {
    const [elOut, docsOut] = await Promise.all([api('/gm/bible/elements'), api('/gm/docs')]);
    templates = elOut.templates || {};
    elements = elOut.elements || [];
    // les fiches élément vivent dans la bible : on ne propose pas de les re-décomposer
    const elemIds = new Set(elements.map((e2) => e2.id));
    chapters = (docsOut.docs || []).filter((d) => !elemIds.has(d.id));
  }

  /* ------------------------------------------------- 1. archive de sécurité -- */
  function sectionArchive() {
    const sec = el('section', 'elx-section holo-frame');
    sec.appendChild(el('h2', 'elx-h', '🗄️ 1 · Archive de sécurité'));
    sec.appendChild(el('p', 'muted', 'Copie intégrale des chapitres dans un dossier Foundry '
      + '« 🗄️ Bible — Archive (AAAA-MM) », hors bible. Une archive par mois maximum ; '
      + '<b>rien n’est jamais supprimé</b> — les originaux restent en place. À faire avant de décomposer.'));
    const btn = el('button', 'elx-btn gold', '🗄️ Archiver la bible maintenant');
    btn.type = 'button';
    const msg = el('p', 'muted elx-report', '');
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      msg.textContent = 'Copie des chapitres…';
      try {
        const out = await api('/gm/bible/archive', { method: 'POST', body: '{}' });
        msg.innerHTML = `${out.existed ? 'ℹ️' : '✅'} ${esc(out.message || '')}`
          + (out.skipped?.length ? `<br><small>Ignorés : ${out.skipped.map((s) => esc(s.name)).join(', ')}</small>` : '');
      } catch (e) { msg.textContent = `⚠️ ${e.message}`; }
      finally { btn.disabled = false; }
    });
    sec.append(btn, msg);
    return sec;
  }

  /* --------------------------------------------------- 2. décomposition ----- */
  function sectionDecompose() {
    const sec = el('section', 'elx-section holo-frame');
    sec.appendChild(el('h2', 'elx-h', '🧩 2 · Décomposer un chapitre'));
    sec.appendChild(el('p', 'muted', 'La moulinette découpe le chapitre en sections (titres h2/h3) et '
      + 'propose un élément typé par section : 📣 lecture (encadrés « à voix haute »), 🔊 ambiance '
      + '(playlist citée), 🖼️ visuel (image), 🔮 vision (« Vision — PJ »). Aperçu d’abord, rien n’est '
      + 'créé avant que tu coches.'));

    const row = el('div', 'elx-row');
    const sel = el('select', 'elx-input');
    sel.innerHTML = '<option value="">— toute la bible —</option>'
      + chapters.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
    const scanBtn = el('button', 'elx-btn', '🔍 Scanner (aperçu, zéro écriture)');
    scanBtn.type = 'button';
    row.append(sel, scanBtn);
    sec.appendChild(row);
    const out = el('div', 'elx-scan-out');
    sec.appendChild(out);

    scanBtn.addEventListener('click', async () => {
      scanBtn.disabled = true;
      out.innerHTML = '<p class="muted">Lecture des chapitres…</p>';
      let scan;
      try { scan = await api('/gm/bible/decompose-scan', { method: 'POST', body: JSON.stringify({ chapterId: sel.value }) }); }
      catch (e) { out.innerHTML = `<p class="muted">⚠️ ${esc(e.message)}</p>`; scanBtn.disabled = false; return; }
      scanBtn.disabled = false;
      out.innerHTML = '';
      out.appendChild(el('p', 'muted',
        `${scan.chapters} chapitre(s) parcouru(s) · <b>${scan.found.length}</b> élément(s) proposé(s), `
        + `dont <b>${scan.news}</b> pas encore créé(s). Coche, puis crée — le chapitre d’origine ne bouge pas.`));
      if (!scan.found.length) {
        out.appendChild(el('p', 'muted', 'Rien d’identifiable ici. La moulinette cherche des sections h2/h3 '
          + 'avec encadrés/« à voix haute » (lecture), une playlist citée (ambiance), une image (visuel) '
          + 'ou un titre « Vision — PJ » (vision).'));
        return;
      }
      const boxes = new Map();
      const list = el('div', 'elx-scan');
      for (const f of scan.found) {
        const tpl = templates[f.kind] || { icon: '🧩', label: f.kind };
        const rowEl = el('label', 'elx-scan-row' + (f.exists ? ' elx-known' : ''));
        const cb = el('input');
        cb.type = 'checkbox';
        cb.checked = !f.exists;
        cb.disabled = Boolean(f.exists);
        boxes.set(f.id, cb);
        rowEl.append(cb, el('div', 'elx-scan-info',
          `<b>${tpl.icon} ${esc(f.title)}</b> <span class="elx-kind">${esc(tpl.label)}</span>`
          + `<small>${esc(f.chapterName)}${f.exists ? ` · <em>${esc(f.reason || 'déjà créé')}</em>` : ''}</small>`
          + `<small class="elx-preview">${esc(dataPreview(f.kind, f.data))}</small>`));
        list.appendChild(rowEl);
      }
      out.appendChild(list);
      const actions = el('div', 'elx-row');
      const go = el('button', 'elx-btn gold', '📥 Créer les éléments cochés');
      go.type = 'button';
      const msg = el('span', 'muted');
      go.addEventListener('click', async () => {
        const ids = [...boxes].filter(([, cb]) => cb.checked && !cb.disabled).map(([fid]) => fid);
        if (!ids.length) { msg.textContent = 'Rien de coché.'; return; }
        go.disabled = true;
        msg.textContent = 'Création…';
        try {
          const res = await api('/gm/bible/decompose', { method: 'POST', body: JSON.stringify({ ids, chapterId: sel.value }) });
          msg.textContent = `✅ ${res.created.length} élément(s) créé(s)`
            + (res.skipped.length ? ` · ${res.skipped.length} sauté(s)` : '')
            + ' — chacun est une fiche Campaign Codex, rangée dans son répertoire de la bible.';
          await refresh();
          paintRepertoires();
        } catch (e) { msg.textContent = `⚠️ ${e.message}`; }
        finally { go.disabled = false; }
      });
      actions.append(go, msg);
      out.appendChild(actions);
    });
    return sec;
  }

  /* ----------------------------------------------- 3. dédoublonnage PNJ ----- */
  function sectionNpc() {
    const sec = el('section', 'elx-section holo-frame');
    sec.appendChild(el('h2', 'elx-h', '🎭 3 · Dédoublonner les chapitres PNJ'));
    sec.appendChild(el('p', 'muted', 'Les chapitres PNJ (Casting, Holocron des PNJ, Fiches minute) répètent '
      + 'ce que les fiches Campaign Codex devraient porter. La moulinette rapproche chaque section '
      + 'd’une fiche par son nom, et te montre où chaque bloc irait. Le report est <b>additif</b> : '
      + 'ajouté à la description de la fiche (avec marqueur — jamais deux fois), champs du dossier '
      + 'narratif complétés seulement s’ils sont vides. Les chapitres restent en place.'));
    const scanBtn = el('button', 'elx-btn', '🔍 Scanner les chapitres PNJ');
    scanBtn.type = 'button';
    sec.appendChild(scanBtn);
    const out = el('div', 'elx-scan-out');
    sec.appendChild(out);

    scanBtn.addEventListener('click', async () => {
      scanBtn.disabled = true;
      out.innerHTML = '<p class="muted">Rapprochement par nom…</p>';
      let scan;
      try { scan = await api('/gm/bible/npc-scan', { method: 'POST', body: '{}' }); }
      catch (e) { out.innerHTML = `<p class="muted">⚠️ ${esc(e.message)}</p>`; scanBtn.disabled = false; return; }
      scanBtn.disabled = false;
      out.innerHTML = '';
      out.appendChild(el('p', 'muted',
        `Chapitres parcourus : ${scan.chapters.map((c) => esc(c.name)).join(', ') || 'aucun (aucun nom de chapitre ne contient « PNJ », « Casting » ou « Fiches minute »)'}. `
        + `<b>${scan.found.length}</b> bloc(s) rapproché(s), dont <b>${scan.news}</b> pas encore reporté(s).`));
      if (!scan.found.length) return;
      const boxes = new Map();
      const list = el('div', 'elx-scan');
      for (const f of scan.found) {
        const rowEl = el('label', 'elx-scan-row' + (f.exists ? ' elx-known' : ''));
        const cb = el('input');
        cb.type = 'checkbox';
        cb.checked = !f.exists;
        cb.disabled = Boolean(f.exists);
        boxes.set(f.id, cb);
        const dossierKeys = Object.keys(f.dossier || {});
        rowEl.append(cb, el('div', 'elx-scan-info',
          `<b>${esc(f.heading)}</b> <span class="elx-kind">→ fiche CC de ${esc(f.npcName)}</span>`
          + `<small>${esc(f.chapterName)} · ira dans sa description`
          + (dossierKeys.length ? ` + dossier narratif (${dossierKeys.join(', ')})` : '')
          + (f.exists ? ' · <em>déjà reporté</em>' : '') + '</small>'));
        list.appendChild(rowEl);
      }
      out.appendChild(list);
      const actions = el('div', 'elx-row');
      const go = el('button', 'elx-btn gold', '📥 Reporter la sélection dans les fiches');
      go.type = 'button';
      const msg = el('span', 'muted');
      go.addEventListener('click', async () => {
        const ids = [...boxes].filter(([, cb]) => cb.checked && !cb.disabled).map(([fid]) => fid);
        if (!ids.length) { msg.textContent = 'Rien de coché.'; return; }
        go.disabled = true;
        msg.textContent = 'Report…';
        try {
          const res = await api('/gm/bible/npc-merge', { method: 'POST', body: JSON.stringify({ ids }) });
          msg.textContent = `✅ ${res.merged.length} bloc(s) reporté(s)`
            + (res.skipped.length ? ` · ${res.skipped.length} sauté(s)` : '')
            + ' — ouvre les fiches dans Foundry : tout y est, rien n’a été écrasé.';
        } catch (e) { msg.textContent = `⚠️ ${e.message}`; }
        finally { go.disabled = false; }
      });
      actions.append(go, msg);
      out.appendChild(actions);
    });
    return sec;
  }

  /* ------------------------------------------------------ 4. répertoires ---- */
  const repBox = el('section', 'elx-section holo-frame');
  function paintRepertoires() {
    repBox.innerHTML = '';
    repBox.appendChild(el('h2', 'elx-h', '📚 Les répertoires'));
    repBox.appendChild(el('p', 'muted', 'Chaque élément est une fiche Campaign Codex privée, rangée dans '
      + 'son répertoire de la bible (visible en rubrique dans la sidebar) — lisible, éditable et '
      + 'taggable depuis Foundry comme depuis ici. Le storyboard les attache aux beats : une ambiance '
      + 'pré-remplit la playlist, un visuel le handout, une lecture donne le bouton « 📖 Lire ».'));
    const grid = el('div', 'elx-grid');
    for (const [kind, tpl] of Object.entries(templates)) {
      const mine = elements.filter((e2) => e2.kind === kind);
      const card = el('div', 'elx-card');
      card.appendChild(el('h3', 'elx-h', `${tpl.icon} ${esc(tpl.folder || tpl.label)} <span class="elx-count">${mine.length}</span>`));
      if (!mine.length) {
        card.appendChild(el('p', 'muted', 'Aucun élément — décompose un chapitre ci-dessus, ou crée la fiche dans Foundry avec le tag <code>' + esc(tpl.tag) + '</code>.'));
      }
      for (const e2 of mine) {
        const a = el('a', 'elx-elem', `${tpl.icon} ${esc(e2.title)}`);
        a.href = `#/mj/${encodeURIComponent(e2.id)}`;
        a.title = dataPreview(kind, e2.data) || e2.title;
        card.appendChild(a);
      }
      grid.appendChild(card);
    }
    repBox.appendChild(grid);
  }

  try {
    await refresh();
    wrap.append(sectionArchive(), sectionDecompose(), sectionNpc(), repBox);
    paintRepertoires();
  } catch (e) {
    wrap.innerHTML = `<p class="muted">⚠️ ${esc(e.message)}</p>`;
  }
  cleanup.push(() => {});
}
