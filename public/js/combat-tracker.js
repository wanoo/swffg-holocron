// combat-tracker.js — fiches de combat interactives (section MJ), v2.
// Transforme les blocs ```combat en trackers « prêts à jouer » : initiative FFG
// (file de slots PJ/PNJ), compteur de round, suivi Blessures/Stress, sbires
// « debout », ajout de combattants à la volée. L'état vit en localStorage
// (par appareil MJ, remis à zéro d'un clic) — clé STABLE : ligne `id:` du bloc,
// sinon hash de son contenu (renommer le titre ne perd plus le suivi).
import { enrichDice } from './render-dice.js';
import { resolveAdversary, internalAdvRoute, swadvUrl } from './adversary-links.js';

const LS = 'holocron-combat-';
const slug = (s) =>
  String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'x';
function djb2(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

// --- parse du spec (texte du bloc ```combat) -----------------------------
// Lignes `id:/title:/map:/note:` = méta ; `== Groupe ==` ; sinon combattant :
//   Nom | ×N | W24 S23 | soak | attaque | note-clé
function parseSpec(text) {
  const meta = { id: '', title: 'Rencontre', map: '', note: '', groups: [] };
  let group = null;
  for (const raw of String(text).split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const kv = line.match(/^(id|title|map|note)\s*:\s*(.*)$/i);
    if (kv) { meta[kv[1].toLowerCase()] = kv[2].trim(); continue; }
    const gh = line.match(/^==\s*(.+?)\s*==$/);
    if (gh) { group = { name: gh[1], rows: [] }; meta.groups.push(group); continue; }
    const parts = line.split('|').map((s) => s.trim());
    if (parts.length < 2) continue; // pas une ligne de combattant
    if (!group) { group = { name: '', rows: [] }; meta.groups.push(group); }
    const [name, count = '', thr = '', soak = '', attack = '', key = ''] = parts;
    const w = (thr.match(/W\s*(\d+)/i) || [])[1];
    const s = (thr.match(/S\s*(\d+)/i) || [])[1];
    const perGroup = /grp|grpe|groupe/i.test(thr);
    const n = (count.match(/(\d+)/) || [])[1];
    group.rows.push({ name, count, n: n ? +n : 0, w: w ? +w : 0, s: s ? +s : 0, perGroup, soak, attack, key });
  }
  return meta;
}

// --- persistance & migration ----------------------------------------------
function loadRaw(key) {
  try { return JSON.parse(localStorage.getItem(key)) || {}; } catch { return {}; }
}
function saveState(key, state) {
  try { localStorage.setItem(key, JSON.stringify(state)); } catch { /* quota */ }
}
// Charge l'état v2 ; migre (copie, sans suppression) un état v1 trouvé sous la
// nouvelle clé ou sous l'ancienne clé « slug(titre) ».
function loadState(key, legacyKey) {
  let st = loadRaw(key);
  if (st.v === 2) return st;
  const src = Object.keys(st).length ? st : (legacyKey ? loadRaw(legacyKey) : {});
  const fighters = {};
  for (const [k, v] of Object.entries(src)) {
    if (/^\d+\.\d+$/.test(k) && v && typeof v === 'object') fighters[k] = { wd: v.wd || 0, sd: v.sd || 0, down: !!v.down };
  }
  return { v: 2, round: src.round || 1, turn: 0, slots: [], fighters, added: [] };
}

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}

// Compteur de dégâts : − [barre n/max] + . onChange(delta, paint).
function counter(label, cls, cur, max, onChange) {
  const wrap = el('div', `ct-meter ${cls}`);
  wrap.appendChild(el('span', 'ct-meter-label', label));
  const minus = el('button', 'ct-step', '−'); minus.type = 'button';
  const bar = el('div', 'ct-bar');
  const fill = el('div', 'ct-fill');
  const num = el('span', 'ct-num');
  bar.appendChild(fill);
  const plus = el('button', 'ct-step', '+'); plus.type = 'button';
  const paint = (v) => {
    fill.style.width = max ? `${Math.min(100, (v / max) * 100)}%` : '0%';
    num.textContent = `${v}/${max}`;
    wrap.classList.toggle('ct-full', max > 0 && v >= max);
  };
  minus.addEventListener('click', () => onChange(-1, paint));
  plus.addEventListener('click', () => onChange(+1, paint));
  wrap.append(minus, bar, num, plus);
  paint(cur);
  return wrap;
}

function buildTracker(spec, state, key) {
  const persist = () => saveState(key, state);
  const root = el('section', 'combat-sheet');
  const render = () => root.replaceWith(buildTracker(spec, state, key));

  // --- En-tête : titre + carte + round + reset ------------------------------
  const head = el('div', 'ct-head');
  const title = el('div', 'ct-title');
  title.innerHTML = `<span class="ct-flag">⚔️</span> ${spec.title}`;
  if (spec.map) title.appendChild(el('span', 'ct-map', spec.map));
  head.appendChild(title);

  const controls = el('div', 'ct-controls');
  const rdLabel = el('span', 'ct-round');
  const paintRound = () => { rdLabel.textContent = `Round ${state.round}`; };
  const initBtn = el('button', 'ct-step', '⚑'); initBtn.type = 'button';
  initBtn.title = 'Initiative (file de slots PJ/PNJ)';
  initBtn.addEventListener('click', () => { state.initOpen = !state.initOpen; persist(); render(); });
  const reset = el('button', 'ct-reset', '⟲ Réinitialiser'); reset.type = 'button';
  reset.addEventListener('click', () => {
    if (!confirm('Réinitialiser le suivi de cette rencontre ?')) return;
    const fresh = { v: 2, round: 1, turn: 0, slots: [], fighters: {}, added: [] };
    for (const k of Object.keys(state)) delete state[k];
    Object.assign(state, fresh);
    persist();
    render();
  });
  const noteBtn = el('button', 'ct-step', '📝'); noteBtn.type = 'button'; noteBtn.title = 'Notes de rencontre (MJ)';
  noteBtn.addEventListener('click', () => window.dispatchEvent(new CustomEvent('gm-open-notes', { detail: { type: 'rencontre', ref: spec.id || slug(spec.title), label: spec.title } })));
  const rMinus = el('button', 'ct-step', '◀'); rMinus.type = 'button'; rMinus.title = 'Round précédent';
  const rPlus = el('button', 'ct-step', '▶'); rPlus.type = 'button'; rPlus.title = 'Round suivant';
  rMinus.addEventListener('click', () => { state.round = Math.max(1, state.round - 1); state.turn = 0; paintRound(); persist(); render(); });
  rPlus.addEventListener('click', () => { state.round += 1; state.turn = 0; paintRound(); persist(); render(); });
  controls.append(initBtn, rMinus, rdLabel, rPlus, reset, noteBtn);
  head.appendChild(controls);
  root.appendChild(head);

  if (spec.note) root.appendChild(el('div', 'ct-note', spec.note));

  // --- Initiative FFG : file de slots PJ/PNJ --------------------------------
  const slots = state.slots || (state.slots = []);
  if (slots.length || state.initOpen) {
    const init = el('div', 'ct-init');
    const lane = el('div', 'ct-init-lane');
    slots.forEach((kind, i) => {
      const chip = el('button', `ct-slot ${kind}${i === state.turn ? ' current' : ''}${i < state.turn ? ' done' : ''}`,
        kind === 'pj' ? 'PJ' : 'PNJ');
      chip.type = 'button';
      chip.title = state.initOpen ? 'Retirer ce slot' : `Slot ${i + 1} — ${kind === 'pj' ? 'personnage joueur' : 'adversaire'}`;
      chip.addEventListener('click', () => {
        if (state.initOpen) {
          slots.splice(i, 1);
          if (state.turn >= slots.length) state.turn = 0;
        } else {
          state.turn = i; // pointer directement un slot (rattrapage)
        }
        persist(); render();
      });
      lane.appendChild(chip);
    });
    if (state.initOpen) {
      const addPj = el('button', 'ct-slot-add pj', '+ PJ'); addPj.type = 'button';
      const addPnj = el('button', 'ct-slot-add pnj', '+ PNJ'); addPnj.type = 'button';
      addPj.addEventListener('click', () => { slots.push('pj'); persist(); render(); });
      addPnj.addEventListener('click', () => { slots.push('pnj'); persist(); render(); });
      lane.append(addPj, addPnj);
      init.appendChild(el('div', 'ct-init-hint', 'Construis la file dans l\'ordre d\'initiative (clic sur un slot = retirer), puis referme ⚑.'));
    } else if (slots.length) {
      const next = el('button', 'ct-next', 'Suivant ▶'); next.type = 'button';
      next.title = 'Slot suivant (fin de file → round suivant)';
      next.addEventListener('click', () => {
        state.turn += 1;
        if (state.turn >= slots.length) { state.turn = 0; state.round += 1; }
        persist(); render();
      });
      lane.appendChild(next);
    }
    init.appendChild(lane);
    root.appendChild(init);
  }

  // --- Corps : groupes + combattants ----------------------------------------
  const fighters = state.fighters || (state.fighters = {});
  const renderRow = (row, id, removable) => {
    const st = (fighters[id] = fighters[id] || { wd: 0, sd: 0, down: false });
    // Sbires : un « ×N » avec un seuil W = groupe de sbires FFG (total = W×N,
    // un sbire tombe tous les W dégâts) — que la notation porte « /grp » ou non.
    const isMinionGroup = row.n > 1 && row.w > 0;
    const wMax = isMinionGroup ? row.w * row.n : row.w;
    const standing = isMinionGroup ? Math.max(0, row.n - Math.floor(st.wd / row.w)) : null;

    const line = el('div', 'ct-row');
    if (st.down) line.classList.add('ct-down');

    const info = el('div', 'ct-info');
    const nm = el('div', 'ct-name');
    nm.appendChild(document.createTextNode(row.name));
    if (row.count) nm.appendChild(el('span', 'ct-count', row.count));
    if (isMinionGroup) {
      const badge = el('span', `ct-standing${standing === 0 ? ' zero' : ''}`, `${standing}/${row.n} debout`);
      nm.appendChild(badge);
    }
    const advId = resolveAdversary(row.name);
    if (advId) {
      const fiche = el('a', 'ct-fiche', '📊 Fiche');
      fiche.href = internalAdvRoute(advId);
      fiche.title = 'Ouvrir la fiche de stats (interne)';
      nm.appendChild(fiche);
    }
    const ext = el('a', 'ct-ext', '↗');
    ext.href = swadvUrl(); ext.target = '_blank'; ext.rel = 'noopener';
    ext.title = `Chercher « ${row.name} » sur SW Adversaries (externe)`;
    nm.appendChild(ext);
    info.appendChild(nm);
    const meta = el('div', 'ct-stats');
    const bits = [];
    if (row.soak) bits.push(`Enc. ${String(row.soak).replace(/soak\s*/i, '')}`);
    if (row.attack) bits.push(row.attack);
    if (row.key) bits.push(`<em>${row.key}</em>`);
    meta.innerHTML = bits.join(' · ');
    info.appendChild(meta);
    line.appendChild(info);

    const meters = el('div', 'ct-meters');
    if (wMax) {
      meters.appendChild(counter(isMinionGroup ? 'Bl. grp' : (row.perGroup ? 'Bl./grp' : 'Bl.'), 'ct-w', st.wd, wMax, (d, paint) => {
        st.wd = Math.max(0, Math.min(wMax, st.wd + d));
        st.down = st.wd >= wMax;
        line.classList.toggle('ct-down', st.down);
        paint(st.wd);
        if (isMinionGroup) {
          const s2 = Math.max(0, row.n - Math.floor(st.wd / row.w));
          const badge = nm.querySelector('.ct-standing');
          if (badge) { badge.textContent = `${s2}/${row.n} debout`; badge.classList.toggle('zero', s2 === 0); }
        }
        persist();
      }));
    }
    if (row.s) {
      meters.appendChild(counter('Str.', 'ct-s', st.sd, row.s, (d, paint) => {
        st.sd = Math.max(0, Math.min(row.s, st.sd + d));
        paint(st.sd); persist();
      }));
    }
    if (removable) {
      const del = el('button', 'ct-ko', '🗑'); del.type = 'button';
      del.title = 'Retirer ce combattant (ajouté à la volée)';
      del.addEventListener('click', () => {
        state.added = (state.added || []).filter((a) => a.id !== id);
        delete fighters[id];
        persist(); render();
      });
      meters.appendChild(del);
    } else {
      const ko = el('button', 'ct-ko', '✖'); ko.type = 'button';
      ko.title = 'Hors combat';
      ko.addEventListener('click', () => { st.down = !st.down; line.classList.toggle('ct-down', st.down); persist(); });
      meters.appendChild(ko);
    }
    line.appendChild(meters);
    root.appendChild(line);
  };

  spec.groups.forEach((g, gi) => {
    if (g.name) root.appendChild(el('div', 'ct-group', g.name));
    g.rows.forEach((row, ri) => renderRow(row, `${gi}.${ri}`, false));
  });

  // Renforts ajoutés à la volée (vivent dans l'état, survivent aux re-rendus).
  const added = state.added || (state.added = []);
  if (added.length) root.appendChild(el('div', 'ct-group', 'Renforts'));
  for (const a of added) renderRow(a.row, a.id, true);

  // Formulaire d'ajout.
  const addWrap = el('div', 'ct-add');
  const addBtn = el('button', 'ct-add-toggle', '＋ Ajouter un combattant'); addBtn.type = 'button';
  addBtn.addEventListener('click', () => {
    addBtn.hidden = true;
    const form = el('form', 'ct-add-form');
    const name = el('input', 'ct-add-input'); name.placeholder = 'Nom'; name.required = true;
    const cnt = el('input', 'ct-add-input sm'); cnt.placeholder = '×N'; cnt.size = 3;
    const w = el('input', 'ct-add-input sm'); w.placeholder = 'Bl.'; w.type = 'number'; w.min = '0'; w.size = 4;
    const s = el('input', 'ct-add-input sm'); s.placeholder = 'Str.'; s.type = 'number'; s.min = '0'; s.size = 4;
    const soak = el('input', 'ct-add-input sm'); soak.placeholder = 'Enc.'; soak.size = 4;
    const ok = el('button', 'ct-add-ok', 'Ajouter'); ok.type = 'submit';
    const ko = el('button', 'ct-add-cancel', 'Annuler'); ko.type = 'button';
    ko.addEventListener('click', () => render());
    form.append(name, cnt, w, s, soak, ok, ko);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const n = (cnt.value.match(/(\d+)/) || [])[1];
      added.push({
        id: 'add-' + Date.now().toString(36),
        row: {
          name: name.value.trim() || 'Renfort', count: cnt.value.trim(), n: n ? +n : 0,
          w: +w.value || 0, s: +s.value || 0, perGroup: !!n && +n > 1,
          soak: soak.value.trim(), attack: '', key: '',
        },
      });
      persist(); render();
    });
    addWrap.appendChild(form);
    name.focus();
  });
  addWrap.appendChild(addBtn);
  root.appendChild(addWrap);

  enrichDice(root); // rend les jetons [di]/[se]… en glyphes EotESymbol
  paintRound();
  persist();
  return root;
}

// Point d'entrée : rend tous les blocs ```combat non encore traités.
export function renderCombat(container) {
  for (const pre of container.querySelectorAll('pre.combat:not([data-done])')) {
    pre.setAttribute('data-done', '1');
    let spec;
    try { spec = parseSpec(pre.textContent); } catch { pre.removeAttribute('data-done'); continue; }
    const key = LS + (spec.id ? slug(spec.id) : 'h' + djb2(pre.textContent.trim()));
    const legacyKey = LS + slug(spec.title);
    try {
      pre.replaceWith(buildTracker(spec, loadState(key, legacyKey), key));
    } catch { pre.removeAttribute('data-done'); }
  }
}
