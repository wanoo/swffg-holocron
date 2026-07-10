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

/* ----------------------------------------------------------------------------
 * Génération de scène de combat depuis un bloc ```combat de la bible :
 * résout les combattants dans le pack d'adversaires, importe les acteurs
 * manquants dans le monde (dossier « ⚔️ Rencontres »), crée la scène
 * (fond = map si fournie) et pose les tokens. Poste le lien dans le chat.
 * -------------------------------------------------------------------------- */
const normName = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

export async function createCombatScene({ title, map, combatants }, { store, config }) {
  const cc = config();
  const packId = cc.packs.adversaries;
  const packDocs = (packId && store.get(`pack:${packId}`)) || [];
  const advRules = (cc.advLinks?.map || []).map((m) => {
    try { return [new RegExp(m.pattern, m.flags || ''), m.id]; } catch { return null; }
  }).filter(Boolean);

  // 1. résolution nom → document du pack (advLinks d'abord, puis nom normalisé)
  const bySwa = new Map(packDocs.map((d) => [d.flags?.swa?.id, d]).filter(([k]) => k));
  const byName = new Map(packDocs.map((d) => [normName(d.name), d]));
  const resolved = [], missing = [];
  for (const c of combatants) {
    let doc = null;
    for (const [re, id] of advRules) if (re.test(c.name)) { doc = bySwa.get(id) || doc; if (doc) break; }
    if (!doc) doc = byName.get(normName(c.name)) || null;
    if (!doc) {
      // match partiel : « Trelon » → « “Boss” Trelon » (le plus court qui contient)
      const needle = normName(c.name);
      const partial = packDocs.filter((d) => normName(d.name).includes(needle) || needle.includes(normName(d.name)))
        .sort((a, b) => a.name.length - b.name.length)[0];
      if (partial) doc = partial;
    }
    if (!doc) {
      // repli : acteur monde du même nom (PNJ custom)
      const world = (store.get('actors') || []).find((a) => normName(a.name) === normName(c.name));
      if (world) { resolved.push({ c, actorId: world._id, img: world.img, fromWorld: true }); continue; }
      missing.push(c.name); continue;
    }
    resolved.push({ c, packDoc: doc });
  }

  // 2. dossier + import des acteurs manquants dans le monde
  let folders = await mcpCall('get_folders', {});
  let fid = (Array.isArray(folders) ? folders : []).find((f) => f.type === 'Actor' && f.name === '⚔️ Rencontres')?._id;
  if (!fid) {
    await mcpCall('create_document', { type: 'Folder', data: [{ name: '⚔️ Rencontres', type: 'Actor', color: '#4a1a1a' }] });
    folders = await mcpCall('get_folders', {});
    fid = (Array.isArray(folders) ? folders : []).find((f) => f.type === 'Actor' && f.name === '⚔️ Rencontres')?._id;
  }
  const worldActors = await mcpCall('get_actors', { requested_fields: ['_id', 'name', 'img'] });
  const worldByName = new Map((Array.isArray(worldActors) ? worldActors : []).map((a) => [normName(a.name), a]));
  for (const r of resolved) {
    if (r.actorId) continue;
    const existing = worldByName.get(normName(r.packDoc.name));
    if (existing) { r.actorId = existing._id; r.img = existing.img; continue; }
    const data = { ...r.packDoc, folder: fid };
    delete data._id; delete data._stats; delete data.ownership;
    await mcpCall('create_document', { type: 'Actor', data: [data] });
    const after = await mcpCall('get_actors', { requested_fields: ['_id', 'name', 'img'] });
    const created = (Array.isArray(after) ? after : []).find((a) => a.name === r.packDoc.name);
    if (created) { r.actorId = created._id; r.img = created.img; worldByName.set(normName(created.name), created); }
  }

  // 3. scène (fond = map si c'est un chemin de fichier Foundry)
  const G = 100;
  const sceneName = `⚔️ ${String(title || 'Rencontre').slice(0, 80)}`;
  const bg = map && /^\w[\w\-./ ]+\.(webp|png|jpg|jpeg)$/i.test(map) ? map : null;
  await mcpCall('create_document', { type: 'Scene', data: [{
    name: sceneName, width: 3000, height: 2000, padding: 0.1,
    grid: { type: 1, size: G }, tokenVision: false, globalLight: true,
    backgroundColor: '#101418', ...(bg ? { background: { src: bg } } : {}),
  }] });
  const scenes = await mcpCall('get_scenes', {});
  const scene = (Array.isArray(scenes) ? scenes : []).filter((s) => s.name === sceneName)
    .sort((a, b) => (b._stats?.createdTime || 0) - (a._stats?.createdTime || 0))[0];
  if (!scene) throw new Error('scène introuvable après création');

  // 4. tokens : une rangée par type de combattant, en haut de la carte
  const tokens = [];
  let row = 1;
  for (const r of resolved) {
    if (!r.actorId) continue;
    const count = Math.max(1, Math.min(12, r.c.count || 1));
    for (let i = 0; i < count; i++) {
      tokens.push({
        name: count > 1 ? `${r.c.name} ${i + 1}` : r.c.name,
        actorId: r.actorId, actorLink: false,
        x: G * (1 + i), y: G * row, width: 1, height: 1,
        texture: { src: r.img || 'icons/svg/mystery-man.svg' },
        disposition: -1,
      });
    }
    row += 1;
  }
  if (tokens.length) {
    await mcpCall('create_document', { type: 'Token', parent_uuid: `Scene.${scene._id}`, data: tokens });
  }

  // 5. lien dans le chat
  try {
    await mcpCall('create_document', { type: 'ChatMessage', data: [{
      author: await mcpAuthorId(),
      whisper: [],
      content: `<h4>⚔️ Rencontre préparée</h4><p>@UUID[Scene.${scene._id}]{${sceneName}} — ${tokens.length} token(s)`
        + (missing.length ? `<br>⚠️ introuvables : ${missing.join(', ')}` : '') + `</p>`,
    }] });
  } catch { /* best-effort */ }

  return { ok: true, sceneId: scene._id, sceneName, tokens: tokens.length, missing };
}
