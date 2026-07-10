// session-tools.mjs — pilotage de séance côté Foundry : jets de dés dans le
// chat (pool starwarsffg), handouts, ambiances sonores, combat. Porté de
// l'Archive Holocron. Toutes les fonctions parlent au monde via mcpCall.
import { mcpCall, mcpAuthorId } from './mcp.mjs';

const GLYPH = { ability: '[ab]', proficiency: '[pr]', difficulty: '[di]', challenge: '[ch]', boost: '[bo]', setback: '[se]', force: '[fo]' };
const RESULT = { success: '[su]', failure: '[fa]', advantage: '[ad]', threat: '[th]', triumph: '[tr]', despair: '[de]', light: '[li]', dark: '[da]' };

// Poste un jet dans le chat Foundry : soit un pool proposé (bouton
// .ffg-pool-to-player côté starwarsffg), soit un résultat déjà calculé.
export async function postRoll({ player, description, pool = {}, result = null, skillName = '' }) {
  const cleanPool = {};
  for (const k of Object.keys(GLYPH)) {
    const v = Number(pool?.[k] || 0);
    if (v > 0) cleanPool[k] = Math.min(v, 10);
  }
  const poolTxt = Object.entries(cleanPool).map(([k, v]) => GLYPH[k].repeat(v)).join('') || '—';
  const who = String(player || 'Joueur').slice(0, 40);
  const desc = String(description || 'Jet').slice(0, 200);
  let content;
  if (result && typeof result === 'object') {
    const syms = Object.entries(RESULT).map(([k, g]) => g.repeat(Math.min(Number(result[k] || 0), 20))).join('');
    const ok = Number(result.success || 0) > 0;
    content = `<h4>🎲 ${who} — ${desc}</h4><p>Pool : ${poolTxt}</p>`
      + `<p><strong>${ok ? '✅ Réussite' : Number(result.failure || 0) > 0 ? '❌ Échec' : '➖ Neutre'}</strong> : ${syms || 'aucun symbole net'}</p>`
      + `<p style="font-size:.85em;opacity:.8">Lancé depuis le Holocron</p>`;
  } else {
    content = `<h4>🎲 ${who} — ${desc}</h4><p>Pool proposé : ${poolTxt}</p>`
      + `<button class="ffg-pool-to-player">Ouvrir le jet dans Foundry</button>`;
  }
  await mcpCall('create_document', { type: 'ChatMessage', data: [{
    author: await mcpAuthorId(),
    speaker: { alias: who },
    content,
    ...(result && typeof result === 'object' ? {} : {
      flags: { starwarsffg: { dicePool: cleanPool, description: desc, roll: { data: {}, skillName: String(skillName || desc).slice(0, 100), item: {}, flavor: '', sound: null } } },
    }),
  }] });
}

const ID_RE = /^[A-Za-z0-9]{16}$/;

export async function listHandouts() {
  const list = await mcpCall('get_journals', { requested_fields: ['_id', 'name'] });
  return (Array.isArray(list) ? list : []).map((j) => ({ id: j._id, name: j.name }))
    .filter((j) => j.name && !/^(sequencerDatabase|dice_helper)$/.test(j.name));
}

export async function showHandout(id, name) {
  if (!ID_RE.test(String(id))) throw new Error('id de journal requis');
  await mcpCall('modify_document', { type: 'JournalEntry', _id: id, updates: [{ 'ownership.default': 2 }] });
  await mcpCall('create_document', { type: 'ChatMessage', data: [{
    author: await mcpAuthorId(),
    content: `<h4>📄 Handout</h4><p>@UUID[JournalEntry.${id}]{${String(name || 'Document').slice(0, 120)}}</p>`,
  }] });
}

export async function listPlaylists() {
  const list = await mcpCall('get_playlists', { requested_fields: ['_id', 'name', 'playing'] });
  return (Array.isArray(list) ? list : []).map((p) => ({ id: p._id, name: p.name, playing: !!p.playing }));
}

export async function setAmbiance(id, action, exclusive) {
  if (!ID_RE.test(String(id))) throw new Error('id de playlist requis');
  if (exclusive) {
    const list = await mcpCall('get_playlists', { requested_fields: ['_id', 'playing'] });
    for (const p of Array.isArray(list) ? list : []) {
      if (p.playing && p._id !== id) await mcpCall('modify_document', { type: 'Playlist', _id: p._id, updates: [{ playing: false }] });
    }
  }
  await mcpCall('modify_document', { type: 'Playlist', _id: id, updates: [{ playing: action !== 'stop' }] });
}

// État du combat actif (tracker MJ) — round, tour, combattants + initiative.
export async function combatState() {
  const list = await mcpCall('get_combats', {});
  const combat = (Array.isArray(list) ? list : []).find((c) => c && c.active) || (Array.isArray(list) ? list[0] : null);
  if (!combat) return { active: false };
  return {
    active: true,
    round: combat.round || 0,
    turn: combat.turn ?? null,
    combatants: (combat.combatants || []).map((c) => ({
      id: c._id, name: c.name, initiative: c.initiative ?? null,
      defeated: !!c.defeated, hidden: !!c.hidden,
    })).sort((a, b) => (b.initiative ?? -1) - (a.initiative ?? -1)),
  };
}
