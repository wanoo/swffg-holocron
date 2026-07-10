// gm-screen.js — Écran de MJ « live » : une vue compacte (1-2 écrans) à garder
// sous les yeux en table. Cartes PJ (stats de combat), difficultés/symboles,
// puis blocs CONFIGURABLES (gm:cfg:screen, partagés entre appareils MJ) :
// règle de peur, rappels d'or, PNJ clés, blocs libres. Les défauts embarqués
// servent de repli hors-ligne ; l'édition (✎) écrit côté serveur gated.
import { Data } from './data.js';
import { makeGlyph } from './render-dice.js';
import { REGISTRY, ROUTE } from './pnj-registry-data.js';
import { loadCfg, saveCfg } from './gm-config.js';

// Défauts GÉNÉRIQUES (règles F&D, zéro contenu de campagne — ce fichier est dans
// le bundle public). Le contenu de campagne vit côté serveur : seed gated
// gm:cfg:screen (server/seed/gm-screen-config.json), écrasable via ✎.
const DEFAULTS = {
  v: 1,
  fear: {
    title: '😱 Test de peur (F&D)',
    html: `<p class="gms-p">Face à une menace surnaturelle : <b>Discipline</b> ou <b>Sang-froid</b>, difficulté selon la source. Échec = stress / désorientation / hésitation ; <b>désespoir</b> = effet aggravé.</p>
  <p class="gms-p"><b>Toujours</b> accompagner d'une <b>image de peur</b> propre au personnage.</p>`,
  },
  gold: {
    title: "⭐ Rappels d'or",
    items: [
      '<b>Personne ne meurt sur un jet raté « à sec »</b> — c\'est scénarisé.',
      'Un <b>point de Destinée obscure</b> améliore un jet ennemi ou déclenche un danger de décor.',
      'Les nemesis <b>décrochent</b> plutôt que mourir bêtement — garde tes méchants récurrents.',
    ],
  },
  pnjIds: [],
  extras: [],
};

const el = (t, c, h) => { const e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; };
let overlay = null;
let cfgCache = null; // { cfg, updatedAt } — chargé une fois par session MJ

async function getCfg(force) {
  if (!cfgCache || force) cfgCache = await loadCfg('screen', DEFAULTS);
  return cfgCache;
}

// Pool de dés d'une compétence : maîtrise = min(rang,carac), aptitude = |rang-carac|.
function skillPool(row, rank, char) {
  const prof = Math.min(rank, char), abil = Math.max(rank, char) - prof;
  for (let i = 0; i < prof; i++) row.appendChild(makeGlyph('proficiency'));
  for (let i = 0; i < abil; i++) row.appendChild(makeGlyph('ability'));
}

function pcCard(pc) {
  const s = pc.stats || {};
  const chars = pc.characteristics || {};
  const card = el('div', 'gms-pc');
  card.appendChild(el('div', 'gms-pc-name', `${pc.name}<span class="gms-pc-sub">${[pc.species, pc.career].filter(Boolean).join(' · ')}</span>`));
  // Ligne de survie.
  const line = el('div', 'gms-pc-stats');
  const def = s.defence || {};
  line.innerHTML = `<span><b>Enc.</b> ${s.soak ?? '—'}</span><span><b>Bl.</b> ${s.wounds?.max ?? '—'}</span>` +
    `<span><b>Str.</b> ${s.strain?.max ?? '—'}</span><span><b>Déf</b> ${def.melee ?? 0}/${def.ranged ?? 0}</span>` +
    (s.forcePool?.max ? `<span><b>FR</b> ${s.forcePool.max}</span>` : '');
  card.appendChild(line);
  // Compétences clés (combat + peur/init).
  const KEY = ['Lightsaber', 'Melee', 'Ranged: Light', 'Ranged: Heavy', 'Brawl', 'Discipline', 'Cool', 'Vigilance'];
  const skills = (pc.skills || []).filter((sk) => KEY.includes(sk.en) && (sk.rank > 0));
  const sg = el('div', 'gms-pc-skills');
  for (const sk of skills.slice(0, 5)) {
    const r = el('div', 'gms-skill');
    r.appendChild(el('span', 'gms-skill-name', sk.name));
    const pool = el('span', 'gms-skill-pool');
    skillPool(pool, sk.rank, chars[sk.characteristic] ?? 0);
    r.appendChild(pool);
    sg.appendChild(r);
  }
  card.appendChild(sg);
  // Arme principale.
  const w = (pc.weapons || [])[0];
  if (w) card.appendChild(el('div', 'gms-pc-weapon', `⚔️ ${w.name} — ${w.damage ?? '?'} / crit ${w.crit ?? '?'}${w.special ? ' · ' + w.special : ''}`));
  return card;
}

function legendBlock() {
  const b = el('div', 'gms-block');
  b.appendChild(el('h3', 'gms-h', '🎲 Difficultés & symboles'));
  const diff = el('div', 'gms-legend');
  const D = [['proficiency', 'Maîtrise'], ['ability', 'Aptitude'], ['difficulty', 'Difficulté'], ['challenge', 'Défi'], ['boost', 'Fortune'], ['setback', 'Infortune'], ['force', 'Force']];
  const S = [['success', 'Succès'], ['advantage', 'Avantage'], ['triumph', 'Triomphe'], ['failure', 'Échec'], ['threat', 'Menace'], ['despair', 'Désespoir'], ['light', 'Lumière'], ['dark', 'Obscur']];
  for (const [t, l] of [...D, ...S]) {
    const chip = el('span', 'gms-chip');
    chip.appendChild(makeGlyph(t));
    chip.appendChild(document.createTextNode(' ' + l));
    diff.appendChild(chip);
  }
  b.appendChild(diff);
  b.appendChild(el('p', 'gms-diffscale', 'Simple 1 · Moyen 2 · Difficile 3 · Redoutable 4 · Colossal 5 (dés de Difficulté)'));
  return b;
}

function htmlBlock(title, html, extraCls) {
  const b = el('div', `gms-block${extraCls ? ' ' + extraCls : ''}`);
  b.appendChild(el('h3', 'gms-h', title));
  b.appendChild(el('div', null, html));
  return b;
}

function goldBlock(cfg) {
  const b = el('div', 'gms-block gms-gold');
  b.appendChild(el('h3', 'gms-h', cfg.gold.title));
  const ul = el('ul', 'gms-gold-list');
  for (const t of cfg.gold.items) ul.appendChild(el('li', null, t));
  b.appendChild(ul);
  return b;
}

function pnjBlock(cfg) {
  const b = el('div', 'gms-block');
  b.appendChild(el('h3', 'gms-h', '👥 PNJ clés (fiches)'));
  const wrap = el('div', 'gms-pnj');
  const INDEX = { pc: 'pcById', npc: 'npcById', adv: 'advById' };
  for (const e of REGISTRY) {
    if (!cfg.pnjIds.includes(e.id)) continue;
    const entry = Data[INDEX[e.kind]]?.get(e.id);
    if (!entry) continue;
    const a = el('a', 'gms-pnj-link', entry.name.replace(/\s*\([^)]*\)\s*$/, ''));
    a.href = ROUTE[e.kind] + e.id;
    wrap.appendChild(a);
  }
  b.appendChild(wrap);
  return b;
}

// --- Mode édition (✎) ------------------------------------------------------
function editPanel(cfg, updatedAt) {
  const panel = el('div', 'gms-edit');
  panel.appendChild(el('p', 'gms-edit-hint', 'Personnalise l\'écran pour ta séance — partagé entre tes appareils MJ. HTML simple accepté (<b>, <em>…).'));

  // Règle mise en avant (peur/Influence…).
  panel.appendChild(el('h4', 'gms-edit-h', 'Règle mise en avant'));
  const fearTitle = el('input', 'gms-edit-input');
  fearTitle.value = cfg.fear.title;
  const fearHtml = el('textarea', 'gms-edit-ta');
  fearHtml.value = cfg.fear.html;
  panel.append(fearTitle, fearHtml);

  // Rappels d'or.
  panel.appendChild(el('h4', 'gms-edit-h', 'Rappels d\'or (un par ligne)'));
  const goldTa = el('textarea', 'gms-edit-ta tall');
  goldTa.value = cfg.gold.items.join('\n');
  panel.appendChild(goldTa);

  // PNJ clés (cases à cocher depuis le registre).
  panel.appendChild(el('h4', 'gms-edit-h', 'PNJ clés affichés'));
  const pnjWrap = el('div', 'gms-edit-pnj');
  const INDEX = { pc: 'pcById', npc: 'npcById', adv: 'advById' };
  const boxes = [];
  for (const e of REGISTRY) {
    const entry = Data[INDEX[e.kind]]?.get(e.id);
    if (!entry) continue;
    const lab = el('label', 'gms-edit-check');
    const cb = el('input');
    cb.type = 'checkbox';
    cb.checked = cfg.pnjIds.includes(e.id);
    cb.dataset.id = e.id;
    lab.append(cb, document.createTextNode(' ' + entry.name.replace(/\s*\([^)]*\)\s*$/, '')));
    pnjWrap.appendChild(lab);
    boxes.push(cb);
  }
  panel.appendChild(pnjWrap);

  // Actions.
  const actions = el('div', 'gms-edit-actions');
  const save = el('button', 'gmh-cta', 'Enregistrer'); save.type = 'button';
  const cancel = el('button', 'gmh-mini', 'Annuler'); cancel.type = 'button';
  const msg = el('span', 'gms-edit-msg');
  actions.append(save, cancel, msg);
  panel.appendChild(actions);

  cancel.addEventListener('click', () => rebuild());
  save.addEventListener('click', async () => {
    save.disabled = true;
    msg.textContent = 'Enregistrement…';
    const next = {
      ...cfg,
      fear: { title: fearTitle.value.trim() || DEFAULTS.fear.title, html: fearHtml.value },
      gold: { ...cfg.gold, items: goldTa.value.split('\n').map((s) => s.trim()).filter(Boolean) },
      pnjIds: boxes.filter((b) => b.checked).map((b) => b.dataset.id),
    };
    try {
      const res = await saveCfg('screen', next, updatedAt);
      if (res.conflict) {
        cfgCache = { cfg: { ...DEFAULTS, ...(res.current || {}) }, updatedAt: res.updatedAt };
        msg.textContent = 'Modifié ailleurs — rechargé.';
        setTimeout(rebuild, 700);
        return;
      }
      cfgCache = { cfg: next, updatedAt: res.updatedAt };
      rebuild();
    } catch (err) {
      msg.textContent = 'Échec : ' + err.message;
      save.disabled = false;
    }
  });
  return panel;
}

function rebuild() {
  if (overlay) { overlay.remove(); overlay = null; }
  openScreen();
}

async function build() {
  const { cfg, updatedAt } = await getCfg();
  overlay = el('div', 'gms-overlay');
  overlay.hidden = true;
  const panel = el('div', 'gms-panel holo-frame');
  const head = el('div', 'gms-head');
  head.innerHTML = '<strong>🖥️ Écran de MJ — live</strong>';
  const btns = el('div', 'gms-head-btns');
  const edit = el('button', 'gms-close', '✎'); edit.type = 'button'; edit.title = 'Personnaliser l\'écran (partagé entre appareils MJ)';
  const close = el('button', 'gms-close', '✕'); close.type = 'button'; close.setAttribute('aria-label', 'Fermer');
  close.addEventListener('click', hide);
  btns.append(edit, close);
  head.appendChild(btns);
  panel.appendChild(head);

  const pcRow = el('div', 'gms-pcs');
  for (const pc of Data.pcs || []) pcRow.appendChild(pcCard(pc));
  panel.appendChild(pcRow);

  const grid = el('div', 'gms-grid');
  grid.append(
    legendBlock(),
    htmlBlock(cfg.fear.title, cfg.fear.html),
    goldBlock(cfg),
    pnjBlock(cfg),
    ...(cfg.extras || []).map((x) => htmlBlock(x.title, x.html))
  );
  panel.appendChild(grid);

  // Hôte du panneau d'édition (replié par défaut, ✎ pour l'ouvrir).
  const editHost = el('div');
  panel.appendChild(editHost);
  edit.addEventListener('click', () => {
    if (editHost.childElementCount) { editHost.innerHTML = ''; return; }
    editHost.appendChild(editPanel(cfg, updatedAt));
    editHost.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });

  overlay.appendChild(panel);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) hide(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && overlay && !overlay.hidden) hide(); });
  document.body.appendChild(overlay);
}
function hide() { if (overlay) overlay.hidden = true; }

export async function openScreen() {
  if (!overlay) await build();
  overlay.hidden = false;
}
