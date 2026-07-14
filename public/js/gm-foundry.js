// gm-foundry.js — carte « Pont Foundry » du Poste de pilotage.
// Parle aux routes gated /api/gm/foundry/* (proxy MCP côté serveur) :
//   · jets : construit un pool (pré-calcul PJ+compétence possible) → bouton
//     « ffg-pool-to-player » dans le chat Foundry (le joueur clique, le dialogue
//     de jet s'ouvre pré-rempli).
//   · handouts : rend un journal visible joueurs + lien dans le chat.
//   · ambiances : lance/coupe les playlists Foundry.
// La carte ne s'affiche que si le serveur a FOUNDRY_MCP_URL (status.enabled).
import { apiBase, getGMKey } from './collab.js';
import { toFoundrySrc } from './show-image.js';

const DICE = [
  ['ability', 'Aptitude', 'gmf-ab'], ['proficiency', 'Maîtrise', 'gmf-pr'],
  ['difficulty', 'Difficulté', 'gmf-di'], ['challenge', 'Défi', 'gmf-ch'],
  ['boost', 'Fortune', 'gmf-bo'], ['setback', 'Infortune', 'gmf-se'],
  ['force', 'Force', 'gmf-fo'],
];

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function api(path, opts = {}) {
  const res = await fetch(`${apiBase()}/gm/foundry/${path}`, {
    ...opts,
    headers: { ...(getGMKey() ? { 'x-gm-key': getGMKey() } : {}), 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// Pool d'une compétence FFG : carac & rang → aptitude/maîtrise.
function skillPool(chars, skill) {
  const c = Number(chars[skill.characteristic] || 0);
  const r = Number(skill.rank || 0);
  return { ability: Math.max(c, r) - Math.min(c, r), proficiency: Math.min(c, r) };
}

export function foundryCard() {
  const card = el('section', 'gmh-card holo-frame gmf');
  card.appendChild(el('h2', 'gmh-h', '🛰️ Pont Foundry'));
  const body = el('div', 'gmf-body', '<p class="gmh-sub">connexion…</p>');
  card.appendChild(body);
  init(body).catch((e) => { body.innerHTML = `<p class="gmh-sub">⚠️ ${esc(e.message)}</p>`; });
  return card;
}

async function init(body) {
  const status = await api('status').catch(() => ({ enabled: false }));
  if (!status.enabled) {
    body.innerHTML = '<p class="gmh-sub">Pont non configuré (FOUNDRY_MCP_URL) ou Foundry hors ligne.</p>';
    return;
  }
  body.innerHTML = '';
  body.appendChild(el('p', 'gmh-sub', `Monde : <strong>${esc(status.world || '?')}</strong>`));

  // --- Jets -----------------------------------------------------------------
  const pool = Object.fromEntries(DICE.map(([k]) => [k, 0]));
  const jets = el('div', 'gmf-block');
  jets.appendChild(el('h3', 'gmf-h3', '🎲 Envoyer un jet'));

  // pré-calcul PJ + compétence
  let pcs = [];
  try { pcs = (await (await fetch(`${apiBase()}/content/pcs`)).json()) || []; } catch { /* offline */ }
  if (!Array.isArray(pcs)) pcs = pcs.pcs || [];
  const picker = el('div', 'gmf-row');
  const selPj = el('select', 'gmf-sel');
  selPj.innerHTML = '<option value="">PJ…</option>' + pcs.map((p, i) => `<option value="${i}">${esc(p.name)}</option>`).join('');
  const selSkill = el('select', 'gmf-sel');
  selSkill.innerHTML = '<option value="">Compétence…</option>';
  selPj.addEventListener('change', () => {
    const p = pcs[selPj.value];
    selSkill.innerHTML = '<option value="">Compétence…</option>' +
      (p ? p.skills.map((s, i) => `<option value="${i}">${esc(s.name)} (${s.rank})</option>`).join('') : '');
  });
  selSkill.addEventListener('change', () => {
    const p = pcs[selPj.value];
    const s = p && p.skills[selSkill.value];
    if (!s) return;
    const sp = skillPool(p.characteristics || {}, s);
    pool.ability = sp.ability; pool.proficiency = sp.proficiency;
    desc.value = `${s.name} — ${p.name}`;
    refresh();
  });
  picker.append(selPj, selSkill);
  jets.appendChild(picker);

  // compteurs de dés
  const counters = el('div', 'gmf-dice');
  const counts = {};
  for (const [key, label, cls] of DICE) {
    const c = el('div', `gmf-die ${cls}`);
    c.title = label;
    const minus = el('button', 'gmf-btn', '−'); minus.type = 'button';
    const n = el('span', 'gmf-n', '0');
    const plus = el('button', 'gmf-btn', '+'); plus.type = 'button';
    minus.addEventListener('click', () => { pool[key] = Math.max(0, pool[key] - 1); refresh(); });
    plus.addEventListener('click', () => { pool[key] = Math.min(9, pool[key] + 1); refresh(); });
    c.append(minus, n, plus);
    counters.appendChild(c);
    counts[key] = n;
  }
  jets.appendChild(counters);
  function refresh() { for (const [k] of DICE) counts[k].textContent = pool[k]; }

  const desc = el('input', 'gmf-input');
  desc.placeholder = 'Description (ex. Test de Peur — la statue s’éveille)';
  jets.appendChild(desc);
  const rowSend = el('div', 'gmf-row');
  const diffBtns = el('div', 'gmf-diffs');
  ['1', '2', '3', '4', '5'].forEach((d) => {
    const b = el('button', 'gmf-chip', `${'◆'.repeat(Number(d))}`);
    b.type = 'button'; b.title = `Difficulté ${d}`;
    b.addEventListener('click', () => { pool.difficulty = Number(d); refresh(); });
    diffBtns.appendChild(b);
  });
  const send = el('button', 'gmf-cta', 'Envoyer au chat →');
  send.type = 'button';
  send.addEventListener('click', async () => {
    send.disabled = true;
    try {
      await api('roll', { method: 'POST', body: JSON.stringify({ pool, description: desc.value || 'Jet demandé par le MJ' }) });
      send.textContent = '✓ Envoyé'; setTimeout(() => { send.textContent = 'Envoyer au chat →'; send.disabled = false; }, 1200);
    } catch (e) { send.textContent = `✗ ${e.message}`.slice(0, 40); send.disabled = false; }
  });
  rowSend.append(diffBtns, send);
  jets.appendChild(rowSend);
  body.appendChild(jets);

  // --- Handouts ---------------------------------------------------------------
  const ho = el('div', 'gmf-block');
  ho.appendChild(el('h3', 'gmf-h3', '📄 Montrer un handout'));
  const rowH = el('div', 'gmf-row');
  const selH = el('select', 'gmf-sel gmf-grow');
  selH.innerHTML = '<option value="">chargement…</option>';
  api('handouts').then(({ journals }) => {
    selH.innerHTML = '<option value="">Choisir un journal…</option>' +
      journals.map((j) => `<option value="${j.id}">${esc(j.name)}</option>`).join('');
  }).catch(() => { selH.innerHTML = '<option value="">indisponible</option>'; });
  const showBtn = el('button', 'gmf-cta', 'Montrer');
  showBtn.type = 'button';
  showBtn.addEventListener('click', async () => {
    const id = selH.value;
    if (!id) return;
    showBtn.disabled = true;
    try {
      await api('handout', { method: 'POST', body: JSON.stringify({ id, name: selH.selectedOptions[0].textContent }) });
      showBtn.textContent = '✓'; setTimeout(() => { showBtn.textContent = 'Montrer'; showBtn.disabled = false; }, 1200);
    } catch (e) { showBtn.textContent = '✗'; showBtn.title = e.message; showBtn.disabled = false; }
  });
  rowH.append(selH, showBtn);
  ho.appendChild(rowH);
  body.appendChild(ho);

  // --- Image aux joueurs (ImagePopout partagé via le module) --------------------
  const imB = el('div', 'gmf-block');
  imB.appendChild(el('h3', 'gmf-h3', '📡 Montrer une image'));
  const rowI = el('div', 'gmf-row');
  const urlI = el('input', 'gmf-input gmf-grow');
  urlI.type = 'text';
  urlI.placeholder = 'URL https://… ou chemin Foundry worlds/…';
  const sendI = el('button', 'gmf-cta', 'Montrer');
  sendI.type = 'button';
  sendI.title = "Ouvre l'image en plein écran chez tous les joueurs (client MJ Foundry requis)";
  sendI.addEventListener('click', async () => {
    const src = urlI.value.trim();
    if (!src) return;
    sendI.disabled = true;
    try {
      await api('show-image', { method: 'POST', body: JSON.stringify({ src: toFoundrySrc(src) }) });
      sendI.textContent = '✓'; setTimeout(() => { sendI.textContent = 'Montrer'; sendI.disabled = false; }, 1200);
    } catch (e) { sendI.textContent = '✗'; sendI.title = e.message; sendI.disabled = false; }
  });
  rowI.append(urlI, sendI);
  imB.appendChild(rowI);
  body.appendChild(imB);

  // --- Ambiances ----------------------------------------------------------------
  const amb = el('div', 'gmf-block');
  amb.appendChild(el('h3', 'gmf-h3', '🔊 Ambiances'));
  const list = el('div', 'gmf-playlists', '<span class="gmh-sub">chargement…</span>');
  amb.appendChild(list);
  async function loadPlaylists() {
    try {
      const { playlists } = await api('playlists');
      list.innerHTML = playlists.length ? '' : '<span class="gmh-sub">Aucune playlist dans le monde.</span>';
      for (const p of playlists) {
        const b = el('button', `gmf-chip gmf-pl${p.playing ? ' on' : ''}`, `${p.playing ? '⏸' : '▶'} ${esc(p.name)}`);
        b.type = 'button';
        b.addEventListener('click', async () => {
          b.disabled = true;
          try {
            await api('ambiance', { method: 'POST', body: JSON.stringify({ id: p.id, action: p.playing ? 'stop' : 'play', exclusive: true }) });
            await loadPlaylists();
          } catch (e) { b.textContent = '✗'; b.title = e.message; }
        });
        list.appendChild(b);
      }
    } catch (e) { list.innerHTML = `<span class="gmh-sub">⚠️ ${esc(e.message)}</span>`; }
  }
  loadPlaylists();
  body.appendChild(amb);
}
