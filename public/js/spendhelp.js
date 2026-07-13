// spendhelp.js — weblet « Symboles & dépenses » : explorer ce qu'on peut FAIRE
// avec ses avantages / menaces / triomphes / désespoirs / succès. Données live du
// journal Foundry « dice_helper » (via /api/content/dice-helper, cf. Data.spendHelp)
// + repli générique pour toute compétence non couverte. Le journal Foundry reste
// intact (utile aux modules) ; ici on le présente joliment, jamais en brut.
import { makeGlyph } from './render-dice.js';
import { renderRichHTML } from './render-journal.js';
import { Data } from './data.js';

const SKILL_FR = {
  Melee: 'Mêlée', Brawl: 'Pugilat', Lightsaber: 'Sabre laser',
  RangedLight: 'Armes légères', RangedHeavy: 'Armes lourdes', Gunnery: 'Artillerie',
};

// Repli générique (mêmes textes que le lanceur de dés) — guide surtout succès/avantages.
const GENERIC_SPEND = {
  su: [{ text: 'Chaque succès net = l’action réussit ; les succès nets en plus augmentent l’ampleur (arme : +1 dégât par succès net).', required: 1 }],
  ad: [
    { text: 'Récupérer 1 stress ; ou +[bo] au prochain jet d’un allié ; ou un détail mineur en votre faveur.', required: 1 },
    { text: 'Réaliser une manœuvre gratuite ; ou infliger +[se] au prochain jet de la cible.', required: 2 },
  ],
  tr: [{ text: 'Réussite spectaculaire : un effet narratif marquant, en plus d’un succès.', required: 1 }],
  th: [{ text: 'Revers mineur : subir 1 stress, ou une petite complication.', required: 1 }],
  de: [{ text: 'Revers majeur : blessure, panne d’arme, ou tournant défavorable de la scène.', required: 1 }],
};

// bucket clé → { glyphe, libellé, ton (bon/mauvais) }
const BUCKETS = [
  ['su', 'success', 'Succès', 'good'],
  ['ad', 'advantage', 'Avantages', 'good'],
  ['tr', 'triumph', 'Triomphes', 'good'],
  ['th', 'threat', 'Menaces', 'bad'],
  ['de', 'despair', 'Désespoirs', 'bad'],
];

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}

async function loadData() {
  if (Data.spendHelp && Object.keys(Data.spendHelp).length) return Data.spendHelp;
  try {
    const d = await (await fetch('/api/content/dice-helper', { credentials: 'same-origin' })).json();
    Data.spendHelp = d && typeof d === 'object' ? d : {};
  } catch { Data.spendHelp = Data.spendHelp || {}; }
  return Data.spendHelp;
}

export async function mountSpendHelp(container) {
  const data = await loadData();
  const skillKeys = Object.keys(data).filter((k) => data[k] && typeof data[k] === 'object');

  // état : compétence sélectionnée (null = Générique) + filtre symbole (null = tous)
  let curSkill = null;
  let curBucket = null;

  container.innerHTML = '';
  const root = el('section', 'spendhelp on-dark');
  root.appendChild(el('h1', 'sh-title', '🎲 Symboles &amp; dépenses'));
  root.appendChild(el('p', 'sh-intro muted',
    'Qu’est-ce que je peux faire avec mes symboles ? Choisis une compétence (ou le barème générique), puis un symbole pour filtrer. Barème maintenu dans Foundry (<code>dice_helper</code>).'));

  // --- sélecteur de compétence -------------------------------------------------
  const skillBar = el('div', 'sh-skills');
  const mkSkill = (key, label) => {
    const b = el('button', 'sh-chip' + ((curSkill === key) ? ' active' : ''), label);
    b.type = 'button';
    b.addEventListener('click', () => { curSkill = key; render(); });
    return b;
  };
  root.appendChild(skillBar);

  // --- filtre par symbole ------------------------------------------------------
  const symBar = el('div', 'sh-syms');
  root.appendChild(symBar);

  const panel = el('div', 'sh-panel');
  root.appendChild(panel);
  container.appendChild(root);

  function table() { return (curSkill && data[curSkill]) ? data[curSkill] : GENERIC_SPEND; }

  function renderSkills() {
    skillBar.innerHTML = '';
    skillBar.appendChild(mkSkill(null, '✨ Générique'));
    for (const k of skillKeys) skillBar.appendChild(mkSkill(k, SKILL_FR[k] || k));
  }

  function renderSyms() {
    symBar.innerHTML = '';
    const t = table();
    const all = el('button', 'sh-sym' + (curBucket === null ? ' active' : ''), 'Tous');
    all.type = 'button';
    all.addEventListener('click', () => { curBucket = null; render(); });
    symBar.appendChild(all);
    for (const [k, glyph, label] of BUCKETS) {
      if (!Array.isArray(t[k]) || !t[k].length) continue;
      const b = el('button', 'sh-sym ' + (curBucket === k ? 'active ' : '') + (BUCKETS.find((x) => x[0] === k)[3]));
      b.type = 'button';
      b.appendChild(makeGlyph(glyph));
      b.appendChild(el('span', null, label));
      b.addEventListener('click', () => { curBucket = k; render(); });
      symBar.appendChild(b);
    }
  }

  function renderPanel() {
    panel.innerHTML = '';
    const t = table();
    const generic = t === GENERIC_SPEND;
    if (generic && curSkill) {
      panel.appendChild(el('p', 'sh-note muted', 'Pas de barème spécifique pour cette compétence — barème générique affiché.'));
    }
    let shown = 0;
    for (const [k, glyph, label, tone] of BUCKETS) {
      if (curBucket && curBucket !== k) continue;
      const list = t[k];
      if (!Array.isArray(list) || !list.length) continue;
      shown++;
      const sec = el('div', 'sh-bucket ' + tone);
      const head = el('div', 'sh-bucket-head');
      head.appendChild(makeGlyph(glyph));
      head.appendChild(el('span', 'sh-bucket-name', label));
      sec.appendChild(head);
      const ul = el('ul', 'sh-list');
      for (const opt of list.slice().sort((a, b) => (a.required || 1) - (b.required || 1))) {
        const li = el('li', 'sh-item');
        const cost = el('span', 'sh-cost');
        for (let i = 0; i < (opt.required || 1); i++) cost.appendChild(makeGlyph(glyph));
        li.appendChild(cost);
        li.appendChild(renderRichHTML(opt.text || ''));
        ul.appendChild(li);
      }
      sec.appendChild(ul);
      panel.appendChild(sec);
    }
    if (!shown) panel.appendChild(el('p', 'muted', 'Aucune dépense pour ce filtre.'));
  }

  function render() { renderSkills(); renderSyms(); renderPanel(); }
  render();
}
