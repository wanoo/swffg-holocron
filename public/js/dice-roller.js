// dice-roller.js — générateur de dés FFG : construction de pool, lancer simulé
// (vraies faces du système), résolution nette, et aide de dépense par compétence.
import { makeGlyph } from './render-dice.js';
import { renderRichHTML } from './render-journal.js';
import { Data } from './data.js';

// Faces des dés : chaque face = [succès, échec, avantage, menace, triomphe, désespoir, lumière, obscur].
// (Triomphe inclut +1 succès ; désespoir +1 échec — comme dans le système.)
const FACES = {
  boost: [[0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0],[1,0,0,0,0,0,0,0],[1,0,1,0,0,0,0,0],[0,0,2,0,0,0,0,0],[0,0,1,0,0,0,0,0]],
  ability: [[0,0,0,0,0,0,0,0],[1,0,0,0,0,0,0,0],[1,0,0,0,0,0,0,0],[2,0,0,0,0,0,0,0],[0,0,1,0,0,0,0,0],[0,0,1,0,0,0,0,0],[1,0,1,0,0,0,0,0],[0,0,2,0,0,0,0,0]],
  proficiency: [[0,0,0,0,0,0,0,0],[1,0,0,0,0,0,0,0],[1,0,0,0,0,0,0,0],[2,0,0,0,0,0,0,0],[2,0,0,0,0,0,0,0],[0,0,1,0,0,0,0,0],[1,0,1,0,0,0,0,0],[1,0,1,0,0,0,0,0],[1,0,1,0,0,0,0,0],[0,0,2,0,0,0,0,0],[0,0,2,0,0,0,0,0],[1,0,0,0,1,0,0,0]],
  setback: [[0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0],[0,1,0,0,0,0,0,0],[0,1,0,0,0,0,0,0],[0,0,0,1,0,0,0,0],[0,0,0,1,0,0,0,0]],
  difficulty: [[0,0,0,0,0,0,0,0],[0,1,0,0,0,0,0,0],[0,2,0,0,0,0,0,0],[0,0,0,1,0,0,0,0],[0,0,0,1,0,0,0,0],[0,0,0,1,0,0,0,0],[0,0,0,2,0,0,0,0],[0,1,0,1,0,0,0,0]],
  challenge: [[0,0,0,0,0,0,0,0],[0,1,0,0,0,0,0,0],[0,1,0,0,0,0,0,0],[0,2,0,0,0,0,0,0],[0,2,0,0,0,0,0,0],[0,0,0,1,0,0,0,0],[0,0,0,1,0,0,0,0],[0,1,0,1,0,0,0,0],[0,1,0,1,0,0,0,0],[0,0,0,2,0,0,0,0],[0,0,0,2,0,0,0,0],[0,1,0,0,0,1,0,0]],
  force: [[0,0,0,0,0,0,0,1],[0,0,0,0,0,0,0,1],[0,0,0,0,0,0,0,1],[0,0,0,0,0,0,0,1],[0,0,0,0,0,0,0,1],[0,0,0,0,0,0,0,1],[0,0,0,0,0,0,0,2],[0,0,0,0,0,0,1,0],[0,0,0,0,0,0,1,0],[0,0,0,0,0,0,2,0],[0,0,0,0,0,0,2,0],[0,0,0,0,0,0,2,0]],
};
const KEYS = ['success', 'failure', 'advantage', 'threat', 'triumph', 'despair', 'light', 'dark'];

// Types de dés du sélecteur (ordre + libellé FR + type de glyphe).
const DIE_ROWS = [
  { key: 'proficiency', fr: 'Maîtrise' },
  { key: 'ability', fr: 'Aptitude' },
  { key: 'boost', fr: 'Fortune' },
  { key: 'challenge', fr: 'Défi' },
  { key: 'difficulty', fr: 'Difficulté' },
  { key: 'setback', fr: 'Infortune' },
  { key: 'force', fr: 'Force' },
];

// Symboles de résultat -> type de glyphe (render-dice) + libellé FR (singulier/pluriel).
const RESULT_GLYPH = {
  success: 'success', failure: 'failure', advantage: 'advantage', threat: 'threat',
  triumph: 'triumph', despair: 'despair', light: 'light', dark: 'dark',
};
const RESULT_FR = {
  success: ['succès', 'succès'], failure: ['échec', 'échecs'],
  advantage: ['avantage', 'avantages'], threat: ['menace', 'menaces'],
  triumph: ['triomphe', 'triomphes'], despair: ['désespoir', 'désespoirs'],
  light: ['point Lumineux', 'points Lumineux'], dark: ['point Obscur', 'points Obscur'],
};

let backdrop, body;
const pool = { proficiency: 0, ability: 0, boost: 0, setback: 0, difficulty: 0, challenge: 0, force: 0 };
let currentSkill = null; // { key, name } pour l'aide de dépense
let lastResult = null; // dernier jet (pour l'envoi Foundry)
let canFoundry = false; // peut-on lancer ce pool dans Foundry ? (sa fiche, ou MJ)
let rollAs = null; // { name, actorId } — pour QUI on lance (MJ : n'importe quelle fiche)

// --- Pont Foundry : le VRAI jet est évalué dans Foundry (moteur du système +
// Dice So Nice), l'Holocron poste le pool puis récupère le résultat par polling.
// Jets réservés au joueur connecté (sa fiche) ou au MJ (n'importe quelle fiche).
let foundryEnabled = null; // null = pas encore sondé
export async function foundryAvailable() {
  if (foundryEnabled === null) {
    try { foundryEnabled = Boolean((await (await fetch('/api/foundry/enabled')).json()).enabled); }
    catch { foundryEnabled = false; }
  }
  return foundryEnabled;
}
// Peut-on lancer dans Foundry ? Connecté (session) ET jet autorisé (sa fiche, ou MJ).
function canRollFoundry() { return Boolean(Data.me) && canFoundry; }

async function pollRollResult(token, tries = 24, delayMs = 1000) {
  for (let i = 0; i < tries; i++) {
    await new Promise((r) => setTimeout(r, delayMs));
    let data;
    try { data = await (await fetch(`/api/foundry/roll-result?token=${encodeURIComponent(token)}`, { credentials: 'same-origin' })).json(); }
    catch { continue; }
    if (data && data.ready) return data.result || {};
  }
  return null;
}

async function sendToFoundry(btn, slot) {
  if (!Data.me) { btn.textContent = '✗ Connecte-toi'; return; }
  btn.disabled = true;
  const orig = btn.textContent;
  btn.textContent = '⏳ Jet dans Foundry…';
  slot.innerHTML = '';
  slot.appendChild(el('div', 'dg-foundry-wait muted', '🎲 Foundry lance les dés…'));
  try {
    const res = await fetch('/api/foundry/roll', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        description: currentSkill ? currentSkill.name : 'Jet libre',
        pool,
        skillName: currentSkill ? currentSkill.key : '',
        asName: rollAs ? rollAs.name : undefined,
        asActorId: rollAs ? rollAs.actorId || undefined : undefined,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.token) throw new Error(data.error || `HTTP ${res.status}`);
    const result = await pollRollResult(data.token);
    slot.innerHTML = '';
    if (!result) {
      slot.appendChild(el('div', 'dg-outcome ko', 'Foundry n’a pas répondu'));
      slot.appendChild(el('div', 'dg-net muted', 'Vérifie que le MJ a lancé la macro « Pont de jets Holocron » et que Foundry est ouvert.'));
      btn.textContent = '✗ Pas de réponse';
    } else {
      lastResult = result;
      const box = renderResult(result);
      box.insertBefore(el('div', 'dg-foundry-tag', '✓ Résultat Foundry (vrais dés)'), box.firstChild);
      slot.appendChild(box);
      btn.textContent = '✓ Lancé dans Foundry';
    }
  } catch (e) {
    slot.innerHTML = '';
    slot.appendChild(el('div', 'dg-outcome ko', 'Échec de l’envoi'));
    slot.appendChild(el('div', 'dg-net muted', String(e.message).slice(0, 120)));
    btn.textContent = '✗ Échec';
  }
  setTimeout(() => { btn.textContent = orig; btn.disabled = false; }, 2200);
}

function randInt(n) {
  return Math.floor(Math.random() * n);
}

// Lance le pool courant : renvoie les résultats nets après annulations.
function rollPool(counts) {
  const sum = [0, 0, 0, 0, 0, 0, 0, 0];
  for (const [type, n] of Object.entries(counts)) {
    const faces = FACES[type];
    if (!faces) continue;
    for (let i = 0; i < n; i++) {
      const face = faces[randInt(faces.length)];
      for (let k = 0; k < 8; k++) sum[k] += face[k];
    }
  }
  const r = {};
  KEYS.forEach((k, i) => (r[k] = sum[i]));
  // Annulations : succès<->échec, avantage<->menace. Triomphe/désespoir/lumière/obscur conservés.
  if (r.success >= r.failure) { r.success -= r.failure; r.failure = 0; }
  else { r.failure -= r.success; r.success = 0; }
  if (r.advantage >= r.threat) { r.advantage -= r.threat; r.threat = 0; }
  else { r.threat -= r.advantage; r.advantage = 0; }
  return r;
}

// --- rendu de l'UI --------------------------------------------------------

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}

function renderPoolSelector() {
  const grid = el('div', 'dg-pool');
  for (const row of DIE_ROWS) {
    const cell = el('div', 'dg-die');
    const label = el('div', 'dg-die-label');
    label.appendChild(makeGlyph(row.key === 'force' ? 'light' : row.key));
    label.appendChild(el('span', 'dg-die-name', row.fr));
    const ctrl = el('div', 'dg-stepper');
    const minus = el('button', 'dg-btn', '−');
    minus.type = 'button';
    minus.setAttribute('aria-label', `Retirer un dé ${row.fr}`);
    const val = el('span', 'dg-count', String(pool[row.key]));
    const plus = el('button', 'dg-btn', '+');
    plus.type = 'button';
    plus.setAttribute('aria-label', `Ajouter un dé ${row.fr}`);
    minus.addEventListener('click', () => { pool[row.key] = Math.max(0, pool[row.key] - 1); val.textContent = pool[row.key]; });
    plus.addEventListener('click', () => { pool[row.key] = Math.min(20, pool[row.key] + 1); val.textContent = pool[row.key]; });
    ctrl.append(minus, val, plus);
    cell.append(label, ctrl);
    grid.appendChild(cell);
  }
  return grid;
}

function fillPoolGlyphs(wrap) {
  wrap.innerHTML = '';
  for (const row of DIE_ROWS) {
    for (let i = 0; i < pool[row.key]; i++) {
      wrap.appendChild(makeGlyph(row.key === 'force' ? (i % 2 ? 'dark' : 'light') : row.key));
    }
  }
  if (!wrap.childNodes.length) wrap.textContent = 'Pool vide';
}

function renderResult(r) {
  const out = el('div', 'dg-result');
  // Synthèse texte.
  const net = [];
  if (r.success) net.push(`${r.success} ${RESULT_FR.success[r.success > 1 ? 1 : 0]}`);
  if (r.failure) net.push(`${r.failure} ${RESULT_FR.failure[r.failure > 1 ? 1 : 0]}`);
  if (r.advantage) net.push(`${r.advantage} ${RESULT_FR.advantage[r.advantage > 1 ? 1 : 0]}`);
  if (r.threat) net.push(`${r.threat} ${RESULT_FR.threat[r.threat > 1 ? 1 : 0]}`);
  if (r.triumph) net.push(`${r.triumph} ${RESULT_FR.triumph[r.triumph > 1 ? 1 : 0]}`);
  if (r.despair) net.push(`${r.despair} ${RESULT_FR.despair[r.despair > 1 ? 1 : 0]}`);
  if (r.light) net.push(`${r.light} ${RESULT_FR.light[r.light > 1 ? 1 : 0]}`);
  if (r.dark) net.push(`${r.dark} ${RESULT_FR.dark[r.dark > 1 ? 1 : 0]}`);

  const outcome = r.success > 0 ? 'Réussite' : r.failure > 0 ? 'Échec' : 'Neutre';
  out.appendChild(el('div', 'dg-outcome ' + (r.success > 0 ? 'ok' : r.failure > 0 ? 'ko' : ''), outcome));

  // Glyphes nets.
  const sym = el('div', 'dg-symbols');
  const add = (type, n) => { for (let i = 0; i < n; i++) sym.appendChild(makeGlyph(RESULT_GLYPH[type])); };
  add('success', r.success); add('failure', r.failure);
  add('advantage', r.advantage); add('threat', r.threat);
  add('triumph', r.triumph); add('despair', r.despair);
  add('light', r.light); add('dark', r.dark);
  if (!sym.childNodes.length) sym.textContent = 'Aucun symbole';
  out.appendChild(sym);

  out.appendChild(el('div', 'dg-net muted', net.length ? net.join(' · ') : 'Aucun résultat net'));
  return out;
}

// Dépenses génériques FFG (repli pour toute compétence absente du dice_helper) :
// guide surtout les succès et avantages, comme demandé.
const GENERIC_SPEND = {
  su: [
    { text: 'Chaque succès net = l’action réussit ; les succès nets en plus augmentent l’ampleur (arme : +1 dégât par succès net).', required: 1 },
  ],
  ad: [
    { text: 'Récupérer 1 stress ; ou +[bo] au prochain jet d’un allié ; ou un détail mineur en votre faveur.', required: 1 },
    { text: 'Réaliser une manœuvre gratuite ; ou infliger +[se] au prochain jet de la cible.', required: 2 },
  ],
  tr: [
    { text: 'Réussite spectaculaire : un effet narratif marquant, en plus d’un succès.', required: 1 },
  ],
  th: [
    { text: 'Revers mineur : subir 1 stress, ou une petite complication.', required: 1 },
  ],
  de: [
    { text: 'Revers majeur : blessure, panne d’arme, ou tournant défavorable de la scène.', required: 1 },
  ],
};

// Panneau d'aide « que dépenser » pour la compétence amorçante.
function renderSpendHelp() {
  if (!currentSkill) return null;
  const table = (Data.spendHelp || {})[currentSkill.key] || GENERIC_SPEND;
  const generic = table === GENERIC_SPEND;
  const wrap = el('div', 'dg-help');
  wrap.appendChild(el('h4', 'dg-help-title', `Dépenses — ${currentSkill.name}${generic ? ' (générique)' : ''}`));
  const buckets = [
    ['su', 'success', 'Succès'],
    ['ad', 'advantage', 'Avantages'],
    ['tr', 'triumph', 'Triomphes'],
    ['th', 'threat', 'Menaces'],
    ['de', 'despair', 'Désespoirs'],
  ];
  let any = false;
  for (const [k, glyph, label] of buckets) {
    const list = table[k];
    if (!Array.isArray(list) || !list.length) continue;
    any = true;
    const sec = el('div', 'dg-help-bucket');
    const h = el('div', 'dg-help-head');
    h.appendChild(makeGlyph(glyph));
    h.appendChild(el('span', null, label));
    sec.appendChild(h);
    const ul = el('ul', 'dg-help-list');
    for (const opt of list) {
      const li = el('li');
      const cost = el('span', 'dg-help-cost');
      for (let i = 0; i < (opt.required || 1); i++) cost.appendChild(makeGlyph(glyph));
      li.appendChild(cost);
      li.appendChild(renderRichHTML(opt.text || ''));
      ul.appendChild(li);
    }
    sec.appendChild(ul);
    wrap.appendChild(sec);
  }
  return any ? wrap : null;
}

function rebuild() {
  body.innerHTML = '';
  lastResult = null;
  if (currentSkill) {
    body.appendChild(el('div', 'dg-seed', `Compétence : <strong>${currentSkill.name}</strong>`));
  }
  body.appendChild(renderPoolSelector());

  const actions = el('div', 'dg-actions');
  // Bouton principal : le VRAI jet dans Foundry (si connecté + sa propre fiche).
  const foundryBtn = el('button', 'dg-roll dg-foundry', rollAs ? `🎲 Lancer dans Foundry · ${rollAs.name}` : '🎲 Lancer dans Foundry');
  foundryBtn.type = 'button';
  foundryBtn.title = 'Foundry lance les vrais dés (moteur du système) et l’Holocron affiche le résultat';
  foundryBtn.hidden = true;
  // Aperçu local (secondaire) : simulation instantanée, ne touche pas Foundry.
  const rollBtn = el('button', 'dg-reset dg-local', 'Aperçu local');
  rollBtn.type = 'button';
  rollBtn.title = 'Simulation locale (n’envoie rien à Foundry)';
  const resetBtn = el('button', 'dg-reset', 'Réinitialiser');
  resetBtn.type = 'button';
  actions.append(foundryBtn, rollBtn, resetBtn);
  body.appendChild(actions);

  const viewLabel = el('div', 'dg-pool-label muted', 'Pool :');
  const viewer = el('span', 'dg-poolview');
  fillPoolGlyphs(viewer);
  const line = el('div', 'dg-poolline');
  line.append(viewLabel, viewer);
  body.appendChild(line);

  const resultSlot = el('div', 'dg-result-slot');
  body.appendChild(resultSlot);

  const help = renderSpendHelp();
  if (help) body.appendChild(help);

  // Visibilité du bouton Foundry : connecteur actif + joueur connecté sur SA fiche.
  foundryAvailable().then((on) => {
    if (on && canRollFoundry()) { foundryBtn.hidden = false; rollBtn.textContent = 'Aperçu local'; }
    else { foundryBtn.hidden = true; rollBtn.textContent = 'Lancer les dés'; }
  });
  foundryBtn.addEventListener('click', () => sendToFoundry(foundryBtn, resultSlot));

  rollBtn.addEventListener('click', () => {
    fillPoolGlyphs(viewer);
    resultSlot.innerHTML = '';
    lastResult = rollPool(pool);
    resultSlot.appendChild(renderResult(lastResult));
  });
  resetBtn.addEventListener('click', () => {
    for (const k of Object.keys(pool)) pool[k] = 0;
    currentSkill = null;
    lastResult = null;
    rebuild();
  });
}

export function initGenerator() {
  backdrop = document.getElementById('generator');
  body = document.getElementById('generator-body');
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) backdrop.hidden = true; });
}

// Ouvre le générateur, éventuellement amorcé par une compétence.
// seed = { proficiency, ability, skillKey, skillName } (facultatif)
export function openGenerator(seed) {
  canFoundry = Boolean(seed && seed.foundry);
  rollAs = seed && seed.asName ? { name: seed.asName, actorId: seed.asActorId || null } : null;
  if (seed) {
    for (const k of Object.keys(pool)) pool[k] = 0;
    pool.proficiency = seed.proficiency || 0;
    pool.ability = seed.ability || 0;
    pool.boost = seed.boost || 0;
    currentSkill = seed.skillKey ? { key: seed.skillKey, name: seed.skillName || seed.skillKey } : null;
  }
  rebuild();
  backdrop.hidden = false;
}
