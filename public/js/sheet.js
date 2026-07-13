// sheet.js — vue « fiche » lisible pour PJ, PNJ du monde et adversaires.
import { makeGlyph, enrichDiceString } from './render-dice.js';
import { renderRichHTML } from './render-journal.js';
import { openGenerator } from './dice-roller.js';
import { openCard } from './modal.js';
import { foundryAsset, Data } from './data.js';
import { getGMKey, gmGetBackrefs, gmGetDossiers } from './collab.js';

const normSkillKey = (en) => (en || '').replace(/[^A-Za-z]/g, '');

// Vrai quand la fiche affichée est celle du personnage du joueur connecté :
// active alors le « vrai jet » Foundry depuis les compétences (sinon aperçu local).
let sheetMine = false;

const CHAR_FR = {
  Brawn: 'Vigueur',
  Agility: 'Agilité',
  Intellect: 'Intelligence',
  Cunning: 'Ruse',
  Willpower: 'Volonté',
  Presence: 'Présence',
};
const CHAR_ORDER = ['Brawn', 'Agility', 'Intellect', 'Cunning', 'Willpower', 'Presence'];

const SKILL_GROUP_FR = {
  General: 'Compétences générales',
  Combat: 'Compétences de combat',
  Social: 'Social',
  Knowledge: 'Connaissances',
  Magic: 'Compétences de Force',
};
// Abréviation de caractéristique (fiche officielle).
const CHAR_ABBR = { Brawn: 'VIG', Agility: 'AG', Intellect: 'INT', Cunning: 'RU', Willpower: 'VOL', Presence: 'PRÉ' };

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}
function initials(name) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] || '')
    .join('')
    .toUpperCase();
}

// Avatar : portrait si présent, sinon initiales colorées (repli propre).
function avatar(entity) {
  if (entity.img) {
    const img = el('img', 'sheet-portrait');
    const src = foundryAsset(entity.img);
    img.src = src;
    img.alt = entity.name;
    img.loading = 'lazy';
    img.title = 'Agrandir';
    img.addEventListener('error', () => img.replaceWith(fallbackAvatar(entity.name)), { once: true });
    img.addEventListener('click', () => openImageFull(src, entity.name));
    return img;
  }
  return fallbackAvatar(entity.name);
}
function fallbackAvatar(name) {
  const d = el('div', 'sheet-portrait fallback', initials(name));
  const hue = [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
  d.style.setProperty('--h', hue);
  return d;
}
// Portrait en plein écran (clic sur l'avatar) — voir l'illustration entière.
function openImageFull(src, alt) {
  const ov = el('div', 'img-full');
  const im = el('img'); im.src = src; im.alt = alt || '';
  ov.appendChild(im);
  ov.addEventListener('click', () => ov.remove());
  const onKey = (e) => { if (e.key === 'Escape') { ov.remove(); document.removeEventListener('keydown', onKey); } };
  document.addEventListener('keydown', onKey);
  document.body.appendChild(ov);
}

// Pool de dés d'une compétence : min(rang,car) maîtrise + reste aptitude.
function skillPool(rank, charVal) {
  const span = el('span', 'skill-pool');
  const yellow = Math.min(rank, charVal);
  const green = Math.max(rank, charVal) - yellow;
  for (let i = 0; i < yellow; i++) span.appendChild(makeGlyph('proficiency'));
  for (let i = 0; i < green; i++) span.appendChild(makeGlyph('ability'));
  if (!yellow && !green) span.textContent = '—';
  return span;
}

// Lien vers la page de règle de compétence correspondante (si trouvée).
let compIndex = null;
function competencesHref(frName) {
  if (compIndex === null) {
    compIndex = { journal: null, pages: new Map() };
    const j = Data.journals.find((x) => x.name.toLowerCase() === 'compétences');
    if (j) {
      compIndex.journal = j.id;
      for (const p of j.pages) compIndex.pages.set(p.name.toLowerCase(), p.id);
    }
  }
  if (!compIndex.journal) return null;
  const pid = compIndex.pages.get(frName.toLowerCase());
  return pid ? `#/journal/${compIndex.journal}/${pid}` : `#/journal/${compIndex.journal}`;
}

// Page de règle de compétence correspondante (pour la popup), ou null.
function competencesPage(frName) {
  competencesHref(frName); // amorce compIndex
  if (!compIndex.journal) return null;
  const pid = compIndex.pages.get(frName.toLowerCase());
  const entry = pid ? Data.pageById.get(pid) : null;
  return entry ? entry.page : null;
}

// --- blocs ---------------------------------------------------------------

function headerBlock(entity, kind) {
  const head = el('div', 'sheet-head');
  head.appendChild(avatar(entity));
  const info = el('div', 'sheet-headinfo');
  const eyebrow =
    kind === 'adversary'
      ? `${typeLabel(entity.type)} · ${entity.source || ''}`
      : [entity.species, entity.career].filter(Boolean).join(' · ') ||
        (kind === 'npc' ? 'PNJ du monde' : 'Personnage joueur');
  info.innerHTML = `<p class="eyebrow">${escape(eyebrow)}</p><h1>${escape(entity.name)}</h1>`;

  const badges = el('div', 'sheet-badges');
  if (kind !== 'adversary') {
    if (entity.experience) badges.appendChild(badge('XP', `${entity.experience.available}/${entity.experience.total}`));
    if (entity.gauges?.forceRating) badges.appendChild(badge('Force', entity.gauges.forceRating));
    if (entity.specialisations?.length) badges.appendChild(badge('Spéc.', entity.specialisations.join(', ')));
  } else {
    badges.appendChild(badge('Type', typeLabel(entity.type)));
  }
  info.appendChild(badges);
  head.appendChild(info);
  return head;
}
function typeLabel(t) {
  return { minion: 'Sbire', rival: 'Comparse', nemesis: 'Nemesis' }[t] || t;
}
function badge(k, v) {
  return el('span', 'sheet-badge', `<span class="bk">${escape(String(k))}</span> ${escape(String(v))}`);
}
function escape(s = '') {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function charBlock(entity) {
  const wrap = el('div', 'char-row');
  for (const key of CHAR_ORDER) {
    const v = entity.characteristics?.[key] ?? 0;
    const c = el('div', 'char-cell');
    c.innerHTML = `<div class="char-val">${v}</div><div class="char-name">${CHAR_FR[key]}</div>`;
    wrap.appendChild(c);
  }
  return wrap;
}

function statsBlock(entity, kind) {
  const s = entity.stats || {};
  const cells = [];
  const w = s.wounds || {};
  const st = s.strain || {};
  if (kind === 'adversary') {
    cells.push(['Blessures', s.wounds ?? 0]);
    if (s.strain) cells.push(['Tension', s.strain]);
    cells.push(['Encaissement', s.soak ?? 0]);
    cells.push(['Défense M/D', `${s.defence?.melee ?? 0} / ${s.defence?.ranged ?? 0}`]);
  } else {
    cells.push(['Blessures', `${w.value ?? 0} / ${w.max ?? 0}`]);
    cells.push(['Tension', `${st.value ?? 0} / ${st.max ?? 0}`]);
    cells.push(['Encaissement', s.soak ?? 0]);
    cells.push(['Défense M/D', `${s.defence?.melee ?? 0} / ${s.defence?.ranged ?? 0}`]);
    if (s.forcePool?.max) cells.push(['Réserve de Force', `${s.forcePool.value} / ${s.forcePool.max}`]);
    if (s.credits) cells.push(['Crédits', s.credits]);
  }
  const wrap = el('div', 'stat-row');
  for (const [k, v] of cells) wrap.appendChild(el('div', 'stat-cell', `<div class="stat-val">${escape(String(v))}</div><div class="stat-name">${k}</div>`));
  return wrap;
}

function gaugesBlock(entity) {
  const g = entity.gauges || {};
  const items = [];
  if (g.morality) items.push(['Moralité', g.morality]);
  if (g.forceRating) items.push(['Niveau de Force', g.forceRating]);
  if (g.conflict) items.push(['Conflit', g.conflict]);
  if (g.obligation) items.push(['Obligation', g.obligation]);
  if (g.duty) items.push(['Devoir', g.duty]);
  // Motivations = items typés (Force/Faiblesse/Désir/Peur/Défi…).
  const motivs = Array.isArray(entity.motivations) ? entity.motivations : [];
  if (!items.length && !motivs.length && !g.moralityStrength) return null;

  const sec = section('Profil narratif');
  const row = el('div', 'stat-row');
  for (const [k, v] of items) row.appendChild(el('div', 'stat-cell', `<div class="stat-val">${v}</div><div class="stat-name">${k}</div>`));
  if (items.length) sec.appendChild(row);
  const notes = el('div', 'gauge-notes');
  if (g.moralityStrength) notes.appendChild(labelRich('Force morale', g.moralityStrength));
  if (g.moralityWeakness) notes.appendChild(labelRich('Faiblesse morale', g.moralityWeakness));
  for (const mo of motivs) {
    if (!mo.name && !mo.description) continue;
    const d = el('div', 'kv');
    d.innerHTML = `<span class="kv-k">${escape(MOTIV_FR[mo.category] || mo.category || 'Motivation')} :</span> <b>${escape(mo.name)}</b> `;
    if (mo.description) { const det = el('details', 'kv-desc'); det.appendChild(el('summary', null, 'détail')); det.appendChild(renderRichHTML(mo.description)); d.appendChild(det); }
    notes.appendChild(d);
  }
  if (notes.childNodes.length) sec.appendChild(notes);
  return sec;
}
const MOTIV_FR = { Strength: 'Force émotionnelle', Weakness: 'Faiblesse émotionnelle', Desire: 'Désir', Fear: 'Peur', Challenges: 'Défi', Challenge: 'Défi', Cause: 'Cause', Relationship: 'Relation', Emotion: 'Émotion' };
function labelRich(label, html) {
  const d = el('div', 'kv');
  d.innerHTML = `<span class="kv-k">${label} :</span> `;
  d.appendChild(renderRichHTML(html));
  return d;
}

// Construit une case de compétence cliquable (ouvre le générateur amorcé).
function skillCell(s, charVal, kind) {
  const cell = el('div', 'skill-cell' + (s.rank > 0 ? ' has-rank' : '') + (s.career ? ' career' : ''));
  cell.tabIndex = 0;
  cell.setAttribute('role', 'button');
  cell.title = 'Lancer cette compétence';

  if (s.career) cell.appendChild(el('span', 'career-dot', ''));
  cell.appendChild(el('span', 'skill-name', escape(s.name)));
  cell.appendChild(el('span', 'skill-rank', String(s.rank)));

  // Pool de dés : PJ/PNJ = min/abs ; adversaire = rang en aptitude.
  const prof = kind === 'adversary' ? 0 : Math.min(s.rank, charVal);
  const abil = kind === 'adversary' ? s.rank : Math.max(s.rank, charVal) - prof;
  const pool = el('span', 'skill-pool');
  for (let i = 0; i < prof; i++) pool.appendChild(makeGlyph('proficiency'));
  for (let i = 0; i < abil; i++) pool.appendChild(makeGlyph('ability'));
  if (!prof && !abil) pool.textContent = '—';
  cell.appendChild(pool);

  // Règles de la compétence (secondaire) : ouvre une popup, sans changer de page.
  const rulePage = kind !== 'adversary' ? competencesPage(s.name) : null;
  if (rulePage) {
    const book = el('button', 'skill-rules');
    book.type = 'button';
    book.textContent = '📖';
    book.title = 'Voir les règles de la compétence';
    book.setAttribute('aria-label', `Règles : ${s.name}`);
    book.addEventListener('click', (e) => {
      e.stopPropagation();
      openCard(rulePage.name, renderRichHTML(rulePage.html), 'Compétences');
    });
    cell.appendChild(book);
  }

  const roll = () => openGenerator({ proficiency: prof, ability: abil, skillKey: normSkillKey(s.en || s.name), skillName: s.name, mine: sheetMine });
  cell.addEventListener('click', roll);
  cell.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); roll(); }
  });
  return cell;
}

function skillsBlock(entity, kind) {
  const skills = entity.skills || [];
  if (!skills.length) return null;
  const sec = section('Compétences');

  if (kind === 'adversary') {
    const ranked = skills.filter((s) => s.rank > 0).sort((a, b) => b.rank - a.rank);
    if (!ranked.length) {
      sec.appendChild(el('p', 'muted', 'Aucune compétence notable.'));
      return sec;
    }
    const grid = el('div', 'skill-grid adversary');
    for (const s of ranked) grid.appendChild(skillCell(s, 0, kind));
    sec.appendChild(grid);
    return sec;
  }

  // PJ / PNJ : grille de « chips » responsive, groupées par catégorie. Chaque chip
  // remplit l'espace (auto-fill) → peu de vide, dense et lisible, jouable en ligne.
  const chars = entity.characteristics || {};
  const groups = {};
  for (const s of skills) (groups[s.type] || (groups[s.type] = [])).push(s);
  const order = ['General', 'Combat', 'Social', 'Knowledge', 'Magic'];
  const keys = Object.keys(groups).sort((a, b) => order.indexOf(a) - order.indexOf(b));

  for (const gk of keys) {
    const list = groups[gk].sort((a, b) => (b.rank - a.rank) || a.name.localeCompare(b.name, 'fr'));
    sec.appendChild(el('h4', 'skill-cat', SKILL_GROUP_FR[gk] || gk));
    const grid = el('div', 'skill-chips');
    for (const s of list) grid.appendChild(skillChip(s, chars[s.characteristic] ?? 0, kind));
    sec.appendChild(grid);
  }
  return sec;
}

// Chip de compétence : [carrière] Nom (CAR) · rang en pips · pool de dés. Clic = jet.
function skillChip(s, charVal, kind) {
  const prof = kind === 'adversary' ? 0 : Math.min(s.rank, charVal);
  const abil = kind === 'adversary' ? s.rank : Math.max(s.rank, charVal) - prof;
  const boost = kind === 'adversary' ? 0 : (s.boost || 0);
  const abbr = CHAR_ABBR[s.characteristic] || '';
  const chip = el('div', 'skchip' + (s.rank > 0 ? ' trained' : '') + (s.career ? ' career' : ''));
  chip.tabIndex = 0; chip.setAttribute('role', 'button'); chip.title = `Lancer : ${s.name}`;
  const pips = Array.from({ length: 5 }, (_, i) => `<i class="pip${i < s.rank ? ' on' : ''}"></i>`).join('');
  const head = el('div', 'skchip-head');
  head.innerHTML = `<span class="skchip-name">${enrichDiceString(s.name)}</span><span class="skchip-car">${abbr}</span>`;
  const rules = kind !== 'adversary' ? competencesPage(s.name) : null;
  if (rules) {
    const book = el('button', 'skchip-book', '📖'); book.type = 'button'; book.title = 'Règles';
    book.addEventListener('click', (e) => { e.stopPropagation(); openCard(rules.name, renderRichHTML(rules.html), 'Compétences'); });
    head.appendChild(book);
  }
  const bottom = el('div', 'skchip-bottom');
  bottom.innerHTML = `<span class="skchip-pips">${pips}</span>`;
  const jet = el('span', 'skchip-jet');
  for (let i = 0; i < prof; i++) jet.appendChild(makeGlyph('proficiency'));
  for (let i = 0; i < abil; i++) jet.appendChild(makeGlyph('ability'));
  for (let i = 0; i < boost; i++) jet.appendChild(makeGlyph('boost'));
  if (s.setbackRemove) { jet.appendChild(makeGlyph('setback')); const b = el('span', 'sk-rmsb', `−${s.setbackRemove}`); b.title = `${s.setbackRemove} contrainte(s) retirée(s) par un talent`; jet.appendChild(b); }
  if (!prof && !abil && !boost) jet.textContent = '—';
  bottom.appendChild(jet);
  chip.append(head, bottom);
  const roll = () => openGenerator({ proficiency: prof, ability: abil, boost, skillKey: normSkillKey(s.en || s.name), skillName: s.name, mine: sheetMine });
  chip.addEventListener('click', roll);
  chip.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); roll(); } });
  return chip;
}

// Ouvre la modale d'explication d'une case (talent ou amélioration).
function openTreeCard(cell, metaText) {
  const html = cell.explain || cell.description || '<p class="muted">Aucune description.</p>';
  openCard(cell.name || 'Talent', renderRichHTML(html), metaText);
}

// Carte détaillée d'un objet (arme/armure/matériel) : caractéristiques + qualités
// (avec leurs règles) + description.
function openItemCard(name, rows, description, qualities) {
  const node = el('div', 'item-card');
  const dl = el('dl', 'item-card-dl');
  for (const [k, v] of rows) {
    if (v == null || v === '' || v === '—') continue;
    dl.innerHTML += `<dt>${escape(k)}</dt><dd>${enrichDiceString(String(v))}</dd>`;
  }
  if (dl.childNodes.length) node.appendChild(dl);
  if (qualities && qualities.length) {
    node.appendChild(el('h4', 'item-card-h', 'Qualités'));
    const ul = el('ul', 'item-qual-list');
    for (const q of qualities) {
      const li = el('li');
      li.innerHTML = `<b>${enrichDiceString(q.name)}${q.rank > 1 ? ` ${q.rank}` : ''}</b>`;
      if (q.description) li.appendChild(renderRichHTML(q.description));
      ul.appendChild(li);
    }
    node.appendChild(ul);
  }
  if (description && String(description).trim()) node.appendChild(renderRichHTML(description));
  else if (!dl.childNodes.length && !(qualities || []).length) node.appendChild(el('p', 'muted', 'Aucun détail.'));
  openCard(name, node);
}

const SIZE_N = { single: 1, double: 2, triple: 3, full: 4 };

// Rend une case d'arbre (talent ou amélioration de Force).
// opts.suppressTop : n'affiche pas les connecteurs vers le haut (rangée du haut).
// Teinte selon l'activation FFG : passif → bleu, actif → rouge.
function activationClass(activation) {
  const a = String(activation || '').toLowerCase();
  if (a.startsWith('passi')) return 'act-passive';
  if (a.startsWith('activ')) return 'act-active';
  return '';
}

function treeCell(cell, extraClass, opts = {}) {
  const div = el('div', `tree-cell ${extraClass} ${cell.learned ? 'learned' : 'unlearned'} ${activationClass(cell.activation)}`);
  // Connecteurs (barres) — colorés si la case est apprise.
  if (!opts.suppressTop) {
    if (Array.isArray(cell.linkTop)) {
      const n = SIZE_N[cell.size] || 1;
      cell.linkTop.forEach((on, i) => {
        if (!on) return;
        const c = el('span', 'conn conn-top');
        c.style.left = `${((i + 0.5) / n) * 100}%`;
        div.appendChild(c);
      });
    } else if (cell.linkTop) {
      const c = el('span', 'conn conn-top');
      c.style.left = '50%';
      div.appendChild(c);
    }
  }
  if (cell.linkRight) div.appendChild(el('span', 'conn conn-right'));

  const name = el('span', 'tree-name', enrichDiceString(cell.name));
  div.appendChild(name);
  const foot = el('span', 'tree-foot');
  if (cell.ranked && cell.rank) foot.appendChild(el('span', 'tree-rank', `Rang ${cell.rank}`));
  if (cell.cost) foot.appendChild(el('span', 'tree-cost', `${cell.cost} PX`));
  div.appendChild(foot);

  if (cell.name) {
    div.tabIndex = 0;
    div.setAttribute('role', 'button');
    const meta = [cell.activation, cell.cost ? `${cell.cost} PX` : ''].filter(Boolean).join(' · ');
    const open = () => openTreeCard(cell, meta);
    div.addEventListener('click', open);
    div.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
  }
  return div;
}

// Arbre de talents d'une spécialisation (grille 4×5).
function renderSpecTree(spec) {
  const wrap = el('div', 'spec-tree');
  // Description dans un encart repliable (le nom est déjà porté par l'onglet).
  if (spec.description) {
    const det = el('details', 'spec-desc');
    det.appendChild(el('summary', null, 'Description de la spécialisation'));
    det.appendChild(renderRichHTML(spec.description));
    wrap.appendChild(det);
  }

  const byIndex = {};
  for (const c of spec.talents) byIndex[c.index] = c;

  const grid = el('div', 'talent-tree');
  for (let row = 0; row < 5; row++) {
    grid.appendChild(el('span', 'tier-cost', `${(row + 1) * 5} PX`));
    for (let col = 0; col < 4; col++) {
      const cell = byIndex[row * 4 + col];
      grid.appendChild(cell ? treeCell(cell, 'talent', { suppressTop: row === 0 }) : el('div', 'tree-cell empty'));
    }
  }
  const scroll = el('div', 'tree-scroll');
  scroll.appendChild(grid);
  wrap.appendChild(scroll);
  return wrap;
}

// Composant onglets : une tuile par entrée, un panneau visible à la fois.
function tabs(entries) {
  const wrap = el('div', 'sheet-tabs-wrap');
  const bar = el('div', 'sheet-tabs');
  const panels = el('div', 'sheet-tab-panels');
  entries.forEach((e, i) => {
    const btn = el('button', 'sheet-tab' + (i === 0 ? ' active' : ''), enrichDiceString(e.label));
    btn.type = 'button';
    const panel = el('div', 'sheet-tab-panel' + (i === 0 ? ' active' : ''));
    panel.appendChild(e.node);
    btn.addEventListener('click', () => {
      bar.querySelectorAll('.sheet-tab').forEach((b) => b.classList.remove('active'));
      panels.querySelectorAll('.sheet-tab-panel').forEach((p) => p.classList.remove('active'));
      btn.classList.add('active'); panel.classList.add('active');
    });
    bar.appendChild(btn); panels.appendChild(panel);
  });
  wrap.append(bar, panels);
  return wrap;
}

// Tableau récapitulatif : Talent | Activation | Rang | Description (talents/améliorations
// APPRIS). Le nom ouvre la carte détaillée au clic (réutilise openTreeCard).
function talentRecap(rows, col2 = 'Activation') {
  if (!rows.length) return null;
  const scroll = el('div', 'table-scroll');
  const table = el('table', 'sheet-table talent-recap');
  table.innerHTML = `<thead><tr><th>Talent</th><th>${escape(col2)}</th><th>Rang</th><th>Description</th></tr></thead>`;
  const tb = el('tbody');
  for (const r of rows) {
    const tr = el('tr', (r.base ? 'tr-base ' : '') + activationClass(r.activation));
    tr.innerHTML = `<td class="tr-name">${r.base ? '★ ' : ''}${enrichDiceString(r.name)}</td><td>${escape(r.activation || '—')}</td><td class="tr-rank">${r.rank ? escape(String(r.rank)) : '—'}</td><td class="tr-desc">${enrichDiceString(plainFirst(r.description))}</td>`;
    if (r.cell) { tr.querySelector('.tr-name').classList.add('link'); tr.querySelector('.tr-name').addEventListener('click', () => openTreeCard(r.cell, [r.activation, r.rank ? `Rang ${r.rank}` : ''].filter(Boolean).join(' · '))); }
    tb.appendChild(tr);
  }
  table.appendChild(tb); scroll.appendChild(table);
  return scroll;
}
// Première phrase / texte court d'une description HTML, pour la colonne récap.
function plainFirst(html) {
  const t = String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return t.length > 160 ? t.slice(0, 157) + '…' : t;
}

// Lignes de synthèse des talents appris, GROUPÉES par nom (Endurci ×3 = une ligne,
// rang = nb d'exemplaires).
function talentRecapRows(entity) {
  const byName = new Map();
  for (const spec of entity.specializations || []) {
    for (const t of spec.talents || []) {
      if (!t.learned || !t.name) continue;
      const g = byName.get(t.name);
      if (g) g.count += 1;
      else byName.set(t.name, { name: t.name, activation: t.activation, ranked: t.ranked, description: t.description, cell: t, count: 1 });
    }
  }
  return [...byName.values()].map((g) => ({ name: g.name, activation: g.activation, rank: (g.ranked || g.count > 1) ? g.count : 0, description: g.description, cell: g.cell }));
}
function forceRecapRows(entity) {
  const rows = [];
  for (const p of entity.forcepowers || []) {
    rows.push({ name: p.name, activation: p.name, rank: 0, description: p.description, base: true, cell: { name: p.name, description: p.description } });
    const seen = new Map();
    for (const u of (p.upgrades || []).slice(1)) {
      if (!u.learned || !u.name) continue;
      const g = seen.get(u.name);
      if (g) g.count += 1; else { const o = { name: u.name, activation: p.name, description: u.description, count: 1, cell: { name: u.name, description: u.description } }; seen.set(u.name, o); rows.push(o); }
    }
  }
  return rows.map((g) => ({ name: g.name, activation: g.activation, rank: g.count > 1 ? g.count : 0, description: g.description, base: g.base, cell: g.cell }));
}

// Petite légende passif/actif.
function actLegend() {
  return el('div', 'act-legend', '<span><span class="dot p"></span><b>Passif</b></span><span><span class="dot a"></span><b>Actif</b></span>');
}

// Synthèse (onglet Jeu) : tableaux récap Talents + Pouvoirs, sous les compétences.
function talentSynthesis(entity) {
  const tr = talentRecapRows(entity), fr = forceRecapRows(entity);
  if (!tr.length && !fr.length) return null;
  const sec = section('Synthèse — Talents & Pouvoirs');
  const tRecap = talentRecap(tr);
  if (tRecap) { sec.appendChild(el('h4', 'skill-group-title', `Talents appris (${tr.length})`)); sec.appendChild(actLegend()); sec.appendChild(tRecap); }
  const fRecap = talentRecap(fr, 'Pouvoir');
  if (fRecap) { sec.appendChild(el('h4', 'skill-group-title', 'Pouvoirs de la Force')); sec.appendChild(fRecap); }
  return sec;
}
// Onglet « Spécialisations » : uniquement les arbres (sous-onglets par spé) + légende.
function specTreesOnly(entity) {
  const specs = entity.specializations || [];
  if (!specs.length) return null;
  const wrap = el('div');
  wrap.appendChild(actLegend());
  wrap.appendChild(tabs(specs.map((s) => ({ label: s.name, node: renderSpecTree(s) }))));
  return wrap;
}
// Onglet « Pouvoirs de Force » : uniquement les arbres.
function forceTreesOnly(entity) {
  const powers = entity.forcepowers || [];
  if (!powers.length) return null;
  return tabs(powers.map((p) => ({ label: p.name, node: renderForceTree(p) })));
}

// Arbre d'améliorations d'un pouvoir de la Force (flex, empans selon size).
function renderForceTree(power) {
  const wrap = el('div', 'force-tree');
  if (power.description) {
    const det = el('details', 'spec-desc');
    det.appendChild(el('summary', null, 'Description du pouvoir'));
    det.appendChild(renderRichHTML(power.description));
    wrap.appendChild(det);
  }

  const grid = el('div', 'upgrade-tree');
  // Calcule la rangée visuelle (flex-wrap 4 colonnes, empans selon size) pour
  // supprimer les connecteurs vers le haut de la première rangée (rien au-dessus).
  let col = 0;
  let vrow = 0;
  for (const cell of power.upgrades) {
    if (!cell.visible) continue;
    const w = SIZE_N[cell.size] || 1;
    if (col + w > 4) { vrow++; col = 0; }
    grid.appendChild(treeCell(cell, `upgrade size-${cell.size || 'single'}`, { suppressTop: vrow === 0 }));
    col += w;
  }
  const scroll = el('div', 'tree-scroll');
  scroll.appendChild(grid);
  wrap.appendChild(scroll);
  return wrap;
}

function forceTreesBlock(entity) {
  const powers = entity.forcepowers || [];
  if (!powers.length) return null;
  const sec = section('Pouvoirs de la Force');
  // Récap groupé par POUVOIR : ligne « base » (le pouvoir lui-même) puis ses
  // améliorations apprises. La colonne 2 identifie le pouvoir.
  const rows = [];
  for (const p of powers) {
    rows.push({ name: p.name, activation: p.name, rank: 0, description: p.description, base: true });
    const seen = new Map();
    for (const u of (p.upgrades || []).slice(1)) { // [0] = le pouvoir de base
      if (!u.learned || !u.name) continue;
      const g = seen.get(u.name);
      if (g) g.count += 1; else { const o = { name: u.name, activation: p.name, description: u.description, count: 1 }; seen.set(u.name, o); rows.push(o); }
    }
  }
  const recap = talentRecap(rows.map((g) => ({ name: g.name, activation: g.activation, rank: g.count > 1 ? g.count : 0, description: g.description, base: g.base })), 'Pouvoir');
  if (recap) { const d = el('details', 'talent-recap-wrap'); d.open = true; d.appendChild(el('summary', null, `Améliorations apprises (${rows.length})`)); d.appendChild(recap); sec.appendChild(d); }
  sec.appendChild(tabs(powers.map((p) => ({ label: p.name, node: renderForceTree(p) }))));
  return sec;
}

// Adversaires : talents (chaînes) + capacités (nom/description).
function abilitiesBlock(entity) {
  const talents = entity.talents || [];
  const abilities = entity.abilities || [];
  if (!talents.length && !abilities.length) return null;
  const sec = section('Talents & Capacités');
  if (talents.length) {
    const tags = el('div', 'tag-list');
    for (const t of talents) tags.appendChild(el('span', 'tag', enrichDiceString(t)));
    sec.appendChild(tags);
  }
  for (const a of abilities) {
    if (!a.name && !a.description) continue;
    const card = el('div', 'talent-card');
    card.innerHTML = `<div class="talent-head"><span class="talent-name">${enrichDiceString(a.name)}</span></div>`;
    if (a.description) card.appendChild(renderRichHTML(a.description));
    sec.appendChild(card);
  }
  return sec;
}

function weaponsBlock(entity) {
  const weapons = entity.weapons || [];
  if (!weapons.length) return null;
  const sec = section('Armes');
  const scroll = el('div', 'table-scroll');
  const table = el('table', 'sheet-table');
  table.innerHTML =
    '<thead><tr><th>Arme</th><th>Compétence</th><th>Dégâts</th><th>Crit</th><th>Portée</th><th>Spécial</th></tr></thead>';
  const tb = el('tbody');
  for (const w of weapons) {
    const qual = (w.qualities || []).map((q) => q.name + (q.rank > 1 ? ` ${q.rank}` : ''));
    const special = [w.special, ...qual].filter(Boolean).join(', ');
    const tr = el('tr', 'clickable');
    tr.innerHTML = `<td>${enrichDiceString(w.name)}</td><td>${escape(w.skill)}</td><td>${escape(String(w.damage))}</td><td>${escape(String(w.crit))}</td><td>${escape(w.range)}</td><td>${enrichDiceString(special)}</td>`;
    tr.tabIndex = 0; tr.setAttribute('role', 'button'); tr.title = 'Détails de l\'arme';
    const open = () => openItemCard(w.name, [
      ['Compétence', w.skill], ['Dégâts', w.damage], ['Critique', w.crit], ['Portée', w.range],
    ], w.description, w.qualities);
    tr.addEventListener('click', open);
    tr.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    tb.appendChild(tr);
  }
  table.appendChild(tb);
  scroll.appendChild(table);
  sec.appendChild(scroll);
  return sec;
}

function gearBlock(entity) {
  const armour = entity.armour || [];
  const gear = entity.gear;
  const gearArr = Array.isArray(gear) ? gear : [];
  if (!armour.length && !gearArr.length && typeof gear !== 'string') return null;
  const sec = section('Équipement');

  const clickableLi = (label, name, rows, desc) => {
    const li = el('li', 'clickable'); li.innerHTML = label;
    li.tabIndex = 0; li.setAttribute('role', 'button');
    const open = () => openItemCard(name, rows, desc);
    li.addEventListener('click', open);
    li.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    return li;
  };
  if (armour.length) {
    const ul = el('ul', 'equip-list');
    for (const a of armour) ul.appendChild(clickableLi(
      `<strong>${escape(a.name)}</strong> — Déf ${escape(String(a.defence))}, Enc ${escape(String(a.soak))}`,
      a.name, [['Défense', a.defence], ['Encaissement', a.soak]], a.description));
    sec.appendChild(el('h4', 'skill-group-title', 'Armures'));
    sec.appendChild(ul);
  }
  if (gearArr.length) {
    const ul = el('ul', 'equip-list');
    for (const g of gearArr) ul.appendChild(clickableLi(
      `${escape(g.name)}${g.quantity > 1 ? ` ×${g.quantity}` : ''}`,
      g.name, [['Quantité', g.quantity > 1 ? g.quantity : '']], g.description));
    sec.appendChild(el('h4', 'skill-group-title', 'Matériel'));
    sec.appendChild(ul);
  }
  if (typeof gear === 'string' && gear.trim()) {
    sec.appendChild(el('h4', 'skill-group-title', 'Équipement'));
    sec.appendChild(el('p', null, escape(gear)));
  }
  return sec;
}

function bioBlock(entity) {
  if (!entity.biography || !entity.biography.trim()) return null;
  const sec = section('Biographie');
  sec.appendChild(renderRichHTML(entity.biography));
  return sec;
}

function section(title) {
  const s = el('section', 'sheet-section');
  s.appendChild(el('h3', 'sheet-section-title', escape(title)));
  return s;
}

// Progression XP : total/dispo/dépensé + journal des achats (groupé par Acte via les
// entrées « adjusted »). Les descriptions viennent du système (EN) — traduites au vol.
const XP_ICON = { characteristic: '💪', skill: '🎯', talent: '✦', force: '✧', adjust: '🎬', grant: '🎁', other: '•' };
function xpDescFr(desc) {
  return String(desc || '')
    .replace(/^characteristic\s+(\w+)\s+level\s+(\d+)\s*-+>\s*(\d+)/i, (_, c, a, b) => `Caractéristique ${c} ${a} → ${b}`)
    .replace(/^skill rank\s+(.+?)\s+(\d+)\s*-+>\s*(\d+)/i, (_, s, a, b) => `Compétence ${s} ${a} → ${b}`)
    .replace(/^new specialization\s+/i, 'Nouvelle spécialisation ')
    .replace(/^specialization\s+(.+?)\s+upgrade\s+/i, '$1 : ')
    .replace(/^new forcepower\s+/i, 'Nouveau pouvoir de Force ')
    .replace(/^force ?power\s+(.+?)\s+upgrade\s+/i, 'Force · $1 : ');
}
function xpBlock(entity) {
  const e = entity.experience || {};
  const log = e.log || [];
  if (!e.total && !log.length) return null;
  const sec = section('📈 Progression (XP)');
  const row = el('div', 'stat-row');
  row.appendChild(el('div', 'stat-cell', `<div class="stat-val">${e.total || 0}</div><div class="stat-name">Total</div>`));
  row.appendChild(el('div', 'stat-cell', `<div class="stat-val">${e.spent ?? ((e.total || 0) - (e.available || 0))}</div><div class="stat-name">Dépensé</div>`));
  row.appendChild(el('div', 'stat-cell', `<div class="stat-val">${e.available || 0}</div><div class="stat-name">Disponible</div>`));
  sec.appendChild(row);
  if (log.length) {
    const det = el('details', 'xp-log');
    det.appendChild(el('summary', null, `Journal des achats (${log.filter((l) => l.action === 'purchased').length})`));
    const list = el('div', 'xp-log-list');
    for (const l of log) {
      if (l.category === 'adjust') { list.appendChild(el('div', 'xp-act', `🎬 ${escape(l.desc)} · +${l.cost} XP`)); continue; }
      const line = el('div', 'xp-line');
      line.innerHTML = `<span class="xp-ic">${XP_ICON[l.category] || '•'}</span><span class="xp-desc">${escape(xpDescFr(l.desc))}</span>${l.cost ? `<span class="xp-cost">${l.cost}</span>` : ''}`;
      list.appendChild(line);
    }
    det.appendChild(list);
    sec.appendChild(det);
  }
  return sec;
}

// Enveloppe une section : rend `node`, ou un état vide discret si absent.
function orEmpty(title, node) {
  if (node) return node;
  const s = section(title);
  s.appendChild(el('p', 'muted', 'Non renseigné.'));
  return s;
}

// Point d'entrée : construit la fiche complète.
// PJ/PNJ : en-tête + caractéristiques + stats TOUJOURS visibles en haut, puis des
// onglets de fiche (Jeu / Spécialisations / Pouvoirs / Progression / Bio) pour tout
// avoir sous la main en jeu sans naviguer de haut en bas.
export function renderSheet(entity, kind) {
  sheetMine = Boolean(Data.me && kind === 'pc' && entity && entity.id && entity.id === Data.me.character);
  const root = el('article', 'sheet on-dark');
  root.appendChild(headerBlock(entity, kind));
  root.appendChild(charBlock(entity));
  root.appendChild(statsBlock(entity, kind));

  if (kind === 'adversary') {
    for (const b of [skillsBlock(entity, kind), weaponsBlock(entity), abilitiesBlock(entity), gearBlock(entity)]) if (b) root.appendChild(b);
    appendGmSections(root, entity, kind);
    return root;
  }

  // Onglet « Jeu » : le nécessaire pour jouer (profil, compétences, synthèse, armes, équipement).
  const jeu = el('div', 'sheet-tab-jeu');
  const jeuBlocks = kind === 'pc'
    ? [gaugesBlock(entity), orEmpty('Compétences', skillsBlock(entity, kind)), talentSynthesis(entity), orEmpty('Armes', weaponsBlock(entity)), orEmpty('Équipement', gearBlock(entity))]
    : [gaugesBlock(entity), skillsBlock(entity, kind), talentSynthesis(entity), weaponsBlock(entity), gearBlock(entity)];
  for (const b of jeuBlocks) if (b) jeu.appendChild(b);

  const entries = [{ label: '🎲 Jeu', node: jeu }];
  const specNode = specTreesOnly(entity); if (specNode) entries.push({ label: 'Spécialisations', node: wrapSection('Arbres de spécialisation', specNode) });
  const forceNode = forceTreesOnly(entity); if (forceNode) entries.push({ label: 'Pouvoirs de Force', node: wrapSection('Arbres de pouvoirs', forceNode) });
  const xp = xpBlock(entity); if (xp) entries.push({ label: '📈 Progression', node: xp });
  const bio = bioBlock(entity); if (bio) entries.push({ label: 'Bio', node: bio });

  root.appendChild(sheetTabs(entries));
  appendGmSections(root, entity, kind); // Dossier MJ + « Mentionné dans » — gated, async
  return root;
}

// Enveloppe un nœud dans une section titrée.
function wrapSection(title, node) { const s = section(title); s.appendChild(node); return s; }

// Onglets AU NIVEAU DE LA FICHE (persiste l'onglet actif en session).
function sheetTabs(entries) {
  const wrap = el('div', 'fiche-tabs-wrap');
  const bar = el('div', 'fiche-tabs');
  const panels = el('div', 'fiche-tab-panels');
  const KEY = 'holocron-sheet-tab';
  let want = 0; try { want = Math.max(0, entries.findIndex((e) => e.label === sessionStorage.getItem(KEY))); } catch { /* noop */ }
  if (want < 0) want = 0;
  entries.forEach((e, i) => {
    const btn = el('button', 'fiche-tab' + (i === want ? ' active' : ''), enrichDiceString(e.label));
    btn.type = 'button';
    const panel = el('div', 'fiche-tab-panel' + (i === want ? ' active' : ''));
    panel.appendChild(e.node);
    btn.addEventListener('click', () => {
      bar.querySelectorAll('.fiche-tab').forEach((b) => b.classList.remove('active'));
      panels.querySelectorAll('.fiche-tab-panel').forEach((p) => p.classList.remove('active'));
      btn.classList.add('active'); panel.classList.add('active');
      try { sessionStorage.setItem(KEY, e.label); } catch { /* noop */ }
    });
    bar.appendChild(btn); panels.appendChild(panel);
  });
  wrap.append(bar, panels);
  return wrap;
}

// Sections gated (Dossier MJ + back-links) — session MJ Foundry ou clé de secours.
async function appendGmSections(root, entity, kind) {
  if (!(Data.gm || getGMKey()) || !entity?.id) return;
  let dossiers = {}, backrefs = {};
  try { [dossiers, backrefs] = await Promise.all([gmGetDossiers(), gmGetBackrefs()]); } catch { return; }
  const anchor = root; // insère après les blocs existants

  // 1) Dossier MJ narratif (gabarit constant). Résolution par id, puis par NOM :
  // les ids d'entités peuvent changer (rebuild de pack), le nom reste stable.
  const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  const d = dossiers[entity.id]
    || Object.values(dossiers).find((x) => x?.name && norm(x.name) === norm(entity.name));
  if (d) {
    const sec = el('section', 'sheet-section gm-dossier');
    sec.appendChild(el('h3', 'sheet-section-title', '🔒 Dossier MJ'));
    const dl = el('dl', 'gm-dossier-dl');
    const row = (label, val) => { if (!val) return; dl.appendChild(el('dt', null, label)); dl.appendChild(el('dd', null, escape(val))); };
    row('Rôle', d.role);
    row('Statut', d.statut);
    row('Ce qu\'il veut', d.veut);
    row('Levier', d.levier);
    row('Indices', d.indices);
    row('Attitude', d.attitude);
    if (d.replique && d.replique !== '—') { dl.appendChild(el('dt', null, 'Réplique')); dl.appendChild(el('dd', 'gm-dossier-rep', '« ' + escape(d.replique) + ' »')); }
    sec.appendChild(dl);
    if (d.advId && kind !== 'adversary') {
      const link = el('a', 'gm-dossier-stats', '↗ Fiche stats (bestiaire)');
      link.href = `#/adv/${d.advId}`;
      sec.appendChild(link);
    }
    anchor.appendChild(sec);
  }

  // 2) « Mentionné dans (MJ) » (index inverse des mentions).
  const refs = backrefs[entity.id];
  if (refs && refs.length) {
    const sec = el('section', 'sheet-section sheet-backrefs');
    sec.appendChild(el('h3', 'sheet-section-title', '🔒 Mentionné dans (MJ)'));
    const ul = el('ul', 'backref-list');
    for (const r of refs) {
      const li = el('li');
      const a = el('a', 'backref-link');
      a.href = `#/mj/${r.id}`;
      a.textContent = r.name.replace(/\s*\*\([^)]*\)\*\s*$/, '').trim();
      li.appendChild(a);
      ul.appendChild(li);
    }
    sec.appendChild(ul);
    anchor.appendChild(sec);
  }
}
