// sheet.js — vue « fiche » lisible pour PJ, PNJ du monde et adversaires.
import { makeGlyph } from './render-dice.js';
import { renderRichHTML } from './render-journal.js';
import { openGenerator } from './dice-roller.js';
import { openCard } from './modal.js';
import { foundryAsset, Data } from './data.js';
import { getGMKey, gmGetBackrefs, gmGetDossiers } from './collab.js';

const normSkillKey = (en) => (en || '').replace(/[^A-Za-z]/g, '');

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
  Combat: 'Compétences de combat',
  General: 'Compétences générales',
  Knowledge: 'Connaissances',
  Social: 'Compétences sociales',
  Magic: 'Compétences de Force',
};

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
    img.src = foundryAsset(entity.img);
    img.alt = entity.name;
    img.loading = 'lazy';
    img.addEventListener('error', () => img.replaceWith(fallbackAvatar(entity.name)), { once: true });
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
  if (g.conflict) items.push(['Conflit', g.conflict]);
  if (g.obligation) items.push(['Obligation', g.obligation]);
  if (g.duty) items.push(['Devoir', g.duty]);
  const m = entity.motivations || {};
  const motiv = [m.m1, m.m2].filter(Boolean);
  if (!items.length && !motiv.length && !g.moralityStrength) return null;

  const sec = section('Profil narratif');
  const row = el('div', 'stat-row');
  for (const [k, v] of items) row.appendChild(el('div', 'stat-cell', `<div class="stat-val">${v}</div><div class="stat-name">${k}</div>`));
  if (items.length) sec.appendChild(row);
  const notes = el('div', 'gauge-notes');
  if (g.moralityStrength) notes.appendChild(labelRich('Force morale', g.moralityStrength));
  if (g.moralityWeakness) notes.appendChild(labelRich('Faiblesse', g.moralityWeakness));
  if (motiv.length) notes.appendChild(labelRich('Motivations', motiv.join(' — ')));
  if (notes.childNodes.length) sec.appendChild(notes);
  return sec;
}
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

  const roll = () => openGenerator({ proficiency: prof, ability: abil, skillKey: normSkillKey(s.en || s.name), skillName: s.name });
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

  // PJ / PNJ : groupés par type, pool de dés calculé.
  const chars = entity.characteristics || {};
  const groups = {};
  for (const s of skills) (groups[s.type] || (groups[s.type] = [])).push(s);
  const order = ['Combat', 'General', 'Social', 'Knowledge', 'Magic'];
  const keys = Object.keys(groups).sort((a, b) => order.indexOf(a) - order.indexOf(b));

  for (const gk of keys) {
    const list = groups[gk].sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    sec.appendChild(el('h4', 'skill-group-title', SKILL_GROUP_FR[gk] || gk));
    const grid = el('div', 'skill-grid');
    for (const s of list) grid.appendChild(skillCell(s, chars[s.characteristic] ?? 0, kind));
    sec.appendChild(grid);
  }
  return sec;
}

// Ouvre la modale d'explication d'une case (talent ou amélioration).
function openTreeCard(cell, metaText) {
  const html = cell.explain || cell.description || '<p class="muted">Aucune description.</p>';
  openCard(cell.name || 'Talent', renderRichHTML(html), metaText);
}

const SIZE_N = { single: 1, double: 2, triple: 3, full: 4 };

// Rend une case d'arbre (talent ou amélioration de Force).
// opts.suppressTop : n'affiche pas les connecteurs vers le haut (rangée du haut).
function treeCell(cell, extraClass, opts = {}) {
  const div = el('div', `tree-cell ${extraClass} ${cell.learned ? 'learned' : 'unlearned'}`);
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

  const name = el('span', 'tree-name', escape(cell.name));
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
  const head = el('div', 'spec-tree-head');
  head.appendChild(el('h4', 'spec-name', escape(spec.name)));
  if (spec.description) head.appendChild(renderRichHTML(spec.description));
  wrap.appendChild(head);

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

function specTreesBlock(entity) {
  const specs = entity.specializations || [];
  const sec = section('Spécialisations & Talents');
  if (!specs.length) { sec.appendChild(el('p', 'muted', 'Non renseigné.')); return sec; }
  for (const spec of specs) sec.appendChild(renderSpecTree(spec));
  return sec;
}

// Arbre d'améliorations d'un pouvoir de la Force (flex, empans selon size).
function renderForceTree(power) {
  const wrap = el('div', 'force-tree');
  const head = el('div', 'force-tree-head');
  head.appendChild(el('h4', 'force-name', escape(power.name)));
  if (power.description) head.appendChild(renderRichHTML(power.description));
  wrap.appendChild(head);

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
  for (const p of powers) sec.appendChild(renderForceTree(p));
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
    for (const t of talents) tags.appendChild(el('span', 'tag', escape(t)));
    sec.appendChild(tags);
  }
  for (const a of abilities) {
    if (!a.name && !a.description) continue;
    const card = el('div', 'talent-card');
    card.innerHTML = `<div class="talent-head"><span class="talent-name">${escape(a.name)}</span></div>`;
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
    const special = w.special || (w.qualities && w.qualities.length ? w.qualities.join(', ') : '');
    const tr = el('tr');
    tr.innerHTML = `<td>${escape(w.name)}</td><td>${escape(w.skill)}</td><td>${escape(String(w.damage))}</td><td>${escape(String(w.crit))}</td><td>${escape(w.range)}</td><td>${escape(special)}</td>`;
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

  if (armour.length) {
    const ul = el('ul', 'equip-list');
    for (const a of armour) ul.appendChild(el('li', null, `<strong>${escape(a.name)}</strong> — Déf ${escape(String(a.defence))}, Enc ${escape(String(a.soak))}`));
    sec.appendChild(el('h4', 'skill-group-title', 'Armures'));
    sec.appendChild(ul);
  }
  if (gearArr.length) {
    const ul = el('ul', 'equip-list');
    for (const g of gearArr) ul.appendChild(el('li', null, `${escape(g.name)}${g.quantity > 1 ? ` ×${g.quantity}` : ''}`));
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

// Enveloppe une section : rend `node`, ou un état vide discret si absent.
function orEmpty(title, node) {
  if (node) return node;
  const s = section(title);
  s.appendChild(el('p', 'muted', 'Non renseigné.'));
  return s;
}

// Point d'entrée : construit la fiche complète.
export function renderSheet(entity, kind) {
  const root = el('article', 'sheet on-dark');
  root.appendChild(headerBlock(entity, kind));
  root.appendChild(charBlock(entity));
  root.appendChild(statsBlock(entity, kind));

  let blocks;
  if (kind === 'adversary') {
    blocks = [skillsBlock(entity, kind), weaponsBlock(entity), abilitiesBlock(entity), gearBlock(entity)];
  } else if (kind === 'pc') {
    // Les 3 fiches PJ : sections dans un ordre FIXE, avec états vides cohérents,
    // pour qu'elles soient structurellement identiques.
    blocks = [
      gaugesBlock(entity),
      orEmpty('Compétences', skillsBlock(entity, kind)),
      specTreesBlock(entity),
      orEmpty('Pouvoirs de la Force', forceTreesBlock(entity)),
      orEmpty('Armes', weaponsBlock(entity)),
      orEmpty('Équipement', gearBlock(entity)),
      bioBlock(entity),
    ];
  } else {
    // PNJ du monde : sections conditionnelles (pas d'états vides superflus).
    blocks = [
      gaugesBlock(entity),
      skillsBlock(entity, kind),
      entity.specializations?.length ? specTreesBlock(entity) : null,
      forceTreesBlock(entity),
      weaponsBlock(entity),
      gearBlock(entity),
      bioBlock(entity),
    ];
  }

  for (const b of blocks) if (b) root.appendChild(b);
  appendGmSections(root, entity, kind); // Dossier MJ + « Mentionné dans » — gated, async
  return root;
}

// Sections gated (Dossier MJ + back-links) — n'apparaissent QUE clé MJ présente.
async function appendGmSections(root, entity, kind) {
  if (!getGMKey() || !entity?.id) return;
  let dossiers = {}, backrefs = {};
  try { [dossiers, backrefs] = await Promise.all([gmGetDossiers(), gmGetBackrefs()]); } catch { return; }
  const anchor = root; // insère après les blocs existants

  // 1) Dossier MJ narratif (gabarit constant).
  const d = dossiers[entity.id];
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
