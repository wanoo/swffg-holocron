// gm-fronts.js — les FICHES MJ : Front / Menace, Secret / Vérité, Préparation.
//
// Ce ne sont pas des données de l'app : ce sont des fiches Campaign Codex `tag`
// privées, qui vivent dans Foundry et s'y éditent, s'y taguent et s'y lient
// comme le reste de la campagne (voir server/lib/transform/mj-sheets.mjs). Cet
// écran n'est qu'une porte d'entrée confortable — tout ce qu'il écrit, le MJ
// peut le rouvrir dans Foundry, et l'inverse est vrai.
//
// Les fronts remplacent progressivement la liste plate `gm:cfg:fronts` : le
// bouton de migration crée les fiches manquantes sans vider l'ancienne config.
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

// Libellé d'état lisible (les tags, eux, restent la source de vérité).
const STATE_LABEL = {
  actif: '🔥 actif', eteint: '💤 éteint',
  seme: '🌱 semé', '': '🤫 pas encore semé',
};

// Ce que chaque gabarit explique quand on n'en a encore aucun.
const EMPTY_HELP = {
  front: 'Un <b>front</b>, c’est ce qui avance <b>sans les PJ</b> : une menace, une faction, '
    + 'une horloge. Note son intention et les prochains signes — c’est ce que tu montreras.',
  secret: 'Un <b>secret</b>, c’est une vérité que les PJ ignorent encore. Écris-la, puis liste '
    + 'les <b>indices semables</b> : la checklist te dira s’il n’est semé nulle part.',
  prepa: 'Une <b>prépa</b>, c’est ta feuille de la séance à venir : ce que tu veux semer, les '
    + 'questions restées ouvertes, ta checklist.',
};

export async function mountGmSheets(container, cleanup = []) {
  container.innerHTML = '<div class="view-head"><h1>🔥 Fronts, secrets & prépas</h1>'
    + '<p class="muted">Des fiches Campaign Codex privées : organisables, liables et taggables '
    + 'depuis Foundry, et visibles comme nœuds de la carte de campagne.</p></div>';
  const wrap = el('div', 'mjs-wrap');
  container.appendChild(wrap);

  let templates = {};
  let sheets = [];
  let editing = null; // { kind, id? } — fiche en cours d'édition/création

  async function refresh() {
    const out = await api('/gm/mj-sheets');
    templates = out.templates || {};
    sheets = out.sheets || [];
  }

  function fieldRow(tpl, values, inputs) {
    const box = el('div', 'mjs-fields');
    for (const f of tpl.fields) {
      const lab = el('label', 'mjs-field');
      lab.appendChild(el('span', 'mjs-lbl', f.label));
      const input = el(f.max > 200 ? 'textarea' : 'input');
      if (f.max > 200) input.rows = 3;
      input.value = values[f.key] || '';
      lab.appendChild(input);
      inputs[f.key] = input;
      box.appendChild(lab);
    }
    return box;
  }

  function editor(kind, sheet) {
    const tpl = templates[kind];
    const form = el('form', 'mjs-editor holo-frame');
    form.appendChild(el('h3', 'mjs-h', `${tpl.icon} ${sheet ? 'Modifier' : 'Nouvelle fiche'} — ${esc(tpl.label)}`));

    const title = el('input', 'mjs-title');
    title.placeholder = `Nom du ${tpl.label.toLowerCase()}`;
    title.value = sheet?.title || '';
    title.required = true;
    form.appendChild(title);

    const inputs = {};
    form.appendChild(fieldRow(tpl, sheet?.data || {}, inputs));

    // état (tags exclusifs) — absent pour les prépas, qui n'en ont pas
    let stateSel = null;
    const states = Object.keys(tpl.states);
    if (states.length) {
      const lab = el('label', 'mjs-field');
      lab.appendChild(el('span', 'mjs-lbl', 'État'));
      stateSel = el('select');
      const options = tpl.defaultState ? states : ['', ...states];
      for (const s of options) {
        const o = el('option', null, STATE_LABEL[s] || s);
        o.value = s;
        if ((sheet ? sheet.state : tpl.defaultState) === s) o.selected = true;
        stateSel.appendChild(o);
      }
      lab.appendChild(stateSel);
      form.appendChild(lab);
    }

    const tags = el('input');
    tags.placeholder = 'Tags libres, séparés par des virgules (ils s’ajoutent à mj:' + kind + ')';
    tags.value = (sheet?.tags || []).filter((t) => !/^mj:/i.test(t)).join(', ');
    const tagLab = el('label', 'mjs-field');
    tagLab.appendChild(el('span', 'mjs-lbl', 'Tags'));
    tagLab.appendChild(tags);
    form.appendChild(tagLab);

    const actions = el('div', 'mjs-actions');
    const save = el('button', 'mjs-btn gold', sheet ? '💾 Enregistrer' : '＋ Créer la fiche');
    save.type = 'submit';
    const cancel = el('button', 'mjs-btn', 'Annuler');
    cancel.type = 'button';
    cancel.addEventListener('click', () => { editing = null; paint(); });
    const msg = el('span', 'muted');
    actions.append(save, cancel, msg);
    form.appendChild(actions);

    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      save.disabled = true;
      msg.textContent = 'Enregistrement…';
      const body = {
        kind,
        title: title.value,
        data: Object.fromEntries(Object.entries(inputs).map(([k, i]) => [k, i.value])),
        tags: tags.value.split(',').map((t) => t.trim()).filter(Boolean),
        ...(stateSel ? { state: stateSel.value } : {}),
      };
      try {
        if (sheet) await api(`/gm/mj-sheets/${encodeURIComponent(sheet.id)}`, { method: 'PUT', body: JSON.stringify(body) });
        else await api('/gm/mj-sheets', { method: 'POST', body: JSON.stringify(body) });
        editing = null;
        await refresh();
        paint();
      } catch (e) {
        msg.textContent = e.message;
        save.disabled = false;
      }
    });
    return form;
  }

  function card(sheet) {
    const box = el('article', `mjs-card mjs-${sheet.kind}` + (sheet.state === 'eteint' ? ' mjs-off' : ''));
    const head = el('div', 'mjs-card-head');
    head.appendChild(el('b', null, `${sheet.icon} ${esc(sheet.title)}`));
    head.appendChild(el('span', 'mjs-state', STATE_LABEL[sheet.state] ?? sheet.state));
    box.appendChild(head);
    const tpl = templates[sheet.kind];
    const dl = el('dl', 'mjs-dl');
    for (const f of (tpl?.fields || [])) {
      if (!sheet.data[f.key]) continue;
      dl.appendChild(el('dt', null, esc(f.label)));
      dl.appendChild(el('dd', null, esc(sheet.data[f.key]).replace(/\n/g, '<br>')));
    }
    if (dl.children.length) box.appendChild(dl);
    const libres = (sheet.tags || []).filter((t) => !/^mj:/i.test(t));
    if (libres.length) box.appendChild(el('p', 'mjs-tags', libres.map((t) => `<span>${esc(t)}</span>`).join('')));
    const links = Object.values(sheet.links || {}).flat().filter(Boolean).length;
    const foot = el('div', 'mjs-card-foot');
    const edit = el('button', 'mjs-mini', '✎ Modifier');
    edit.type = 'button';
    edit.addEventListener('click', () => { editing = { kind: sheet.kind, id: sheet.id }; paint(); });
    foot.appendChild(edit);
    if (links) foot.appendChild(el('span', 'muted', `${links} lien(s) Campaign Codex`));
    foot.appendChild(el('span', 'muted mjs-hint', 'Éditable aussi dans Foundry'));
    box.appendChild(foot);
    return box;
  }

  function section(kind) {
    const tpl = templates[kind];
    if (!tpl) return el('div');
    const sec = el('section', 'mjs-section');
    const head = el('div', 'mjs-section-head');
    head.appendChild(el('h2', 'mjs-h', `${tpl.icon} ${esc(tpl.label)}`));
    const add = el('button', 'mjs-mini', `＋ Nouveau ${tpl.label.toLowerCase()}`);
    add.type = 'button';
    add.addEventListener('click', () => { editing = { kind }; paint(); });
    head.appendChild(add);
    sec.appendChild(head);

    if (editing && editing.kind === kind) {
      sec.appendChild(editor(kind, editing.id ? sheets.find((s) => s.id === editing.id) : null));
    }
    const mine = sheets.filter((s) => s.kind === kind);
    if (!mine.length) sec.appendChild(el('p', 'muted mjs-empty', EMPTY_HELP[kind] || ''));
    const grid = el('div', 'mjs-grid');
    for (const s of mine) grid.appendChild(card(s));
    sec.appendChild(grid);
    return sec;
  }

  function paint() {
    wrap.innerHTML = '';
    for (const kind of ['front', 'secret', 'prepa']) wrap.appendChild(section(kind));

    // Migration de l'ancienne liste plate — non destructive, réexécutable.
    const foot = el('div', 'mjs-migrate');
    const btn = el('button', 'mjs-mini', '⇪ Reprendre les fronts de l’ancien widget');
    btn.type = 'button';
    btn.title = 'Crée une fiche pour chaque front de gm:cfg:fronts qui n’en a pas encore (l’ancienne liste n’est pas vidée)';
    const msg = el('span', 'muted');
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      msg.textContent = 'Migration…';
      try {
        const out = await api('/gm/mj-sheets/migrate-fronts', { method: 'POST', body: '{}' });
        msg.textContent = `${out.created.length} fiche(s) créée(s), ${out.skipped.length} déjà présente(s) `
          + `(sur ${out.source} front(s) dans l’ancienne liste).`;
        await refresh();
        paint();
      } catch (e) { msg.textContent = e.message; }
      finally { btn.disabled = false; }
    });
    foot.append(btn, msg);
    wrap.appendChild(foot);
  }

  try {
    await refresh();
    paint();
  } catch (e) {
    wrap.innerHTML = `<p class="muted">${esc(e.message)}</p>`;
  }
  cleanup.push(() => { editing = null; });
}
