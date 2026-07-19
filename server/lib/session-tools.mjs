// session-tools.mjs — pilotage de séance côté Foundry : jets de dés dans le
// chat (pool starwarsffg), handouts, ambiances sonores, combat. Porté de
// l'Archive Holocron. Toutes les fonctions parlent au monde via mcpCall.
import { mcpCall, mcpAuthorId } from './mcp.mjs';
import { sanitizeHandout, sanitizeStoryboard } from './board.mjs';

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

// Demande de jet « vrai Foundry » : on poste un message porteur du pool
// (flags.starwarsffg.dicePool) marqué flags.holocron.req. La macro « Pont de jets
// Holocron » (côté navigateur MJ) l'évalue avec le VRAI moteur du système et
// réémet un message de résultat estampillé flags.holocron.resultFor=token, que
// readRollResult() récupère par polling. Message chuchoté à l'auteur → pas de
// bruit dans le chat public (la macro le supprime après évaluation).
// Résultats mémorisés des jets évalués par le connecteur (token → résultat) :
// le front continue de sonder /roll-result, mais la réponse est déjà là.
const rollResults = new Map();   // token → { result, at }
const ROLL_KEEP = 200;

/** Normalise le retour d'un outil de jet en symboles NETS {success, failure, …}.
 * Deux formats connus : client_roll_pool_native (clés singulières, déjà nettes)
 * et roll_ffg_pool (bloc `detail` au pluriel + netSuccesses/netAdvantages). */
export function readSymbols(payload) {
  const src = (payload && typeof payload === 'object')
    ? (payload.detail || payload.result || payload.symbols || payload) : null;
  if (!src || typeof src !== 'object') return null;
  const num = (...keys) => {
    for (const k of keys) { const v = Number(src[k]); if (Number.isFinite(v) && src[k] !== undefined) return v; }
    return 0;
  };
  const netSuccess = src.netSuccesses !== undefined
    ? Number(src.netSuccesses)
    : num('success') - num('failure');
  const netAdv = src.netAdvantages !== undefined
    ? Number(src.netAdvantages)
    : num('advantage') - num('threat');
  const out = {
    success: Math.max(netSuccess, 0),
    failure: Math.max(-netSuccess, 0),
    advantage: Math.max(netAdv, 0),
    threat: Math.max(-netAdv, 0),
    triumph: num('triumph', 'triumphs'),
    despair: num('despair', 'despairs'),
    light: num('light'),
    dark: num('dark'),
  };
  for (const k of Object.keys(out)) if (!out[k]) delete out[k];
  return Object.keys(out).length ? out : { success: 0 };
}

export async function requestRoll({ token, player, characterId, description, pool = {}, skillName = '' }) {
  const cleanPool = {};
  for (const k of Object.keys(GLYPH)) {
    const v = Number(pool?.[k] || 0);
    if (v > 0) cleanPool[k] = Math.min(v, 15);
  }
  const who = String(player || 'Joueur').slice(0, 40);
  const desc = String(description || 'Jet').slice(0, 200);
  const actor = ID_RE.test(String(characterId || '')) ? String(characterId) : undefined;
  const label = `${who} — ${desc}`;

  // 1. moteur FFG natif du client (carte de chat officielle + dés 3D Dice So
  //    Nice sur la table) — nécessite le module compagnon côté Foundry.
  try {
    const r = await mcpCall('client_roll_pool_native', { pool: cleanPool, description: label, ...(actor ? { actor } : {}) });
    rememberRoll(token, readSymbols(r));
    return String(token);
  } catch (e) { lastRollFallback = String(e.message || e).slice(0, 120); }

  // 2. évaluation SERVEUR par le connecteur (faces officielles, posté au chat) :
  //    autonome, aucun navigateur MJ requis.
  try {
    const r = await mcpCall('roll_ffg_pool', { description: label, post: true, ...cleanPool });
    rememberRoll(token, readSymbols(r));
    return String(token);
  } catch (e) { lastRollFallback = String(e.message || e).slice(0, 120); }

  // 3. repli historique : message porteur du pool, évalué par la macro
  //    « Pont de jets Holocron » ouverte sur un navigateur MJ.
  const author = await mcpAuthorId();
  const speaker = { alias: who };
  if (actor) speaker.actor = actor;
  const poolTxt = Object.entries(cleanPool).map(([k, v]) => GLYPH[k].repeat(v)).join('') || '—';
  await mcpCall('create_document', { type: 'ChatMessage', data: [{
    author,
    speaker,
    whisper: [author],
    content: `<p style="opacity:.55;font-size:.85em">🎲 ${who} prépare un jet — ${desc} · ${poolTxt}</p>`,
    flags: {
      holocron: { req: true, token: String(token), skill: String(skillName || ''), description: desc },
      starwarsffg: {
        dicePool: cleanPool,
        description: desc,
        roll: { data: {}, skillName: String(skillName || desc).slice(0, 100), item: {}, flavor: '', sound: null },
      },
    },
  }] });
  return String(token);
}

let lastRollFallback = '';
export const rollBridgeNote = () => lastRollFallback;

function rememberRoll(token, result) {
  rollResults.set(String(token), { result, at: Date.now() });
  if (rollResults.size > ROLL_KEEP) rollResults.delete(rollResults.keys().next().value);
}

// Résultat d'une demande de jet : immédiat quand le connecteur a évalué le
// pool (moteur natif ou serveur), sinon posté par la macro-pont historique.
export async function readRollResult(token) {
  const done = rollResults.get(String(token));
  if (done) return { ready: true, result: done.result, at: done.at };
  const msgs = await mcpCall('get_messages', { requested_fields: ['flags'] });
  const hit = (Array.isArray(msgs) ? msgs : []).find((m) => m?.flags?.holocron?.resultFor === String(token));
  if (!hit) return { ready: false };
  const h = hit.flags.holocron;
  return { ready: true, result: h.result || null, at: h.at || null };
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

// « 📡 Montrer une image » aux joueurs : d'abord l'outil NATIF `share_image` du
// connecteur (ImagePopout ciblable, exécuté par la session bot — aucun client MJ
// requis) ; en REPLI (connecteur pas encore à jour) le pont historique par
// ChatMessage flaggé holocron.showImage, traité par le module (MJ actif).
// src = URL http(s) OU chemin Foundry (worlds/…). Jamais d'URL /api/… de
// l'Holocron : les clients Foundry ne la connaissent pas, et une clé MJ en
// query fuiterait dans le chat.
export async function showImage({ src, title = '', users = null }) {
  const s = String(src || '').trim().slice(0, 600);
  const ok = /^https?:\/\/\S+$/i.test(s)
    || (!s.includes('..') && /^(worlds|icons|modules|systems|assets)\//.test(s) && /\.(png|jpe?g|webp|gif|svg|avif)(\?.*)?$/i.test(s));
  if (!ok) throw new Error("src d'image invalide (URL http(s) ou chemin Foundry worlds/…)");
  const t = String(title || '').slice(0, 120);
  try {
    await mcpCall('share_image', { image: s, title: t || 'Holocron', ...(users?.length ? { users } : {}) });
    return;
  } catch (e) {
    // ciblé : le pont legacy ne sait pas viser des joueurs → erreur claire
    if (users?.length) throw new Error(`share_image indisponible (connecteur à mettre à jour ?) : ${String(e.message || e).slice(0, 120)}`);
  }
  const author = await mcpAuthorId();
  await mcpCall('create_document', { type: 'ChatMessage', data: [{
    author,
    whisper: [author],
    content: '<p style="opacity:.55;font-size:.85em">📡 Image → joueurs</p>',
    flags: { holocron: { showImage: { src: s, title: t } } },
  }] });
}

// 📜 Handout multi-média CIBLÉ { type: chat|image|audio|video, src|text, title,
// targets? } — targets = ids users Foundry ; absent/vide = toute la table.
// Tuyauterie par type (voir planHandout) :
//   · image → outil NATIF share_image du connecteur (ciblage users natif) ;
//   · chat  → create_document ChatMessage (whisper = targets) — direct ;
//   · audio/vidéo → PAS d'outil natif : pont module (ChatMessage-requête flaggé
//     holocron.handout, le MJ actif diffuse sur le socket module aux visés).
const HANDOUT_EXT = {
  image: /\.(png|jpe?g|webp|gif|svg|avif)(\?.*)?$/i,
  audio: /\.(mp3|ogg|wav|m4a|flac|webm)(\?.*)?$/i,
  video: /\.(mp4|webm|m4v|ogv)(\?.*)?$/i,
};
const escBasic = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Assainit ET valide un handout entrant (route POST /api/gm/foundry/handout).
 * Jette une erreur claire si le payload est inexploitable. */
export function checkHandout(raw) {
  const h = sanitizeHandout(raw);
  if (!h) throw new Error('handout invalide (type fermé chat/image/audio/video, texte ou src requis)');
  if (h.type !== 'chat') {
    // même règle que showImage : URL http(s) OU chemin Foundry avec la bonne
    // extension pour le type — jamais d'URL /api/… de l'Holocron.
    const ok = /^https?:\/\/\S+$/i.test(h.src)
      || (/^(worlds|icons|modules|systems|assets)\//.test(h.src) && HANDOUT_EXT[h.type].test(h.src));
    if (!ok) throw new Error(`src ${h.type} invalide (URL http(s) ou chemin Foundry worlds/… avec extension ${h.type})`);
  }
  return h;
}

/** Plan d'exécution PUR d'un handout assaini (testable, partagé avec le stub). */
export function planHandout(h) {
  if (h.type === 'image') {
    return { kind: 'share_image', args: { image: h.src, title: h.title || 'Holocron', ...(h.targets ? { users: h.targets } : {}) } };
  }
  if (h.type === 'chat') {
    const head = h.title ? `<p style="opacity:.7;font-size:.85em;margin:0 0 .3em">📜 ${escBasic(h.title)}</p>` : '';
    return { kind: 'chat-message', message: {
      speaker: { alias: 'Holocron' },
      content: head + h.text,
      ...(h.targets ? { whisper: h.targets } : {}),
    } };
  }
  return { kind: 'module-bridge', flag: h }; // audio / video
}

export async function handoutBridge(raw) {
  const h = checkHandout(raw);
  const plan = planHandout(h);
  if (plan.kind === 'share_image') {
    // natif + repli pont module (toute la table) géré par showImage
    await showImage({ src: h.src, title: h.title, users: h.targets || null });
  } else if (plan.kind === 'chat-message') {
    await mcpCall('create_document', { type: 'ChatMessage', data: [{
      author: await mcpAuthorId(), ...plan.message,
    }] });
  } else {
    const author = await mcpAuthorId();
    const dest = h.targets ? `${h.targets.length} joueur(s)` : 'la table';
    await mcpCall('create_document', { type: 'ChatMessage', data: [{
      author,
      whisper: [author],
      content: `<p style="opacity:.55;font-size:.85em">📜 Handout ${h.type} → ${dest}</p>`,
      flags: { holocron: { handout: plan.flag } },
    }] });
  }
  return h;
}

// 🎵 Pont son (module ≥ 2.2) : message-requête flaggé holocron.sound — le module
// Foundry (MJ actif) joue/arrête la playlist (ou la piste) avec playAll/stopAll,
// le vrai moteur de lecture (modifier `playing` par MCP ne suffit pas selon le
// mode de la playlist), puis supprime la requête. playlist = NOM ou id.
export async function soundBridge({ playlist, sound = '', action = 'play' }) {
  const p = String(playlist || '').trim().slice(0, 100);
  if (!p) throw new Error('playlist requise');
  const act = action === 'stop' ? 'stop' : 'play';
  const author = await mcpAuthorId();
  await mcpCall('create_document', { type: 'ChatMessage', data: [{
    author,
    whisper: [author],
    content: `<p style="opacity:.55;font-size:.85em">🎵 ${act === 'stop' ? 'Stop' : 'Lecture'} — ${p.replace(/</g, '&lt;')}</p>`,
    flags: { holocron: { sound: { action: act, playlist: p, ...(sound ? { sound: String(sound).trim().slice(0, 100) } : {}) } } },
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

  // 3. scène (fond = map si c'est une image : chemin Foundry OU URL). On accepte
  // accents/espaces/parenthèses/apostrophes ; on refuse seulement la traversée (..).
  const G = 100;
  const sceneName = `⚔️ ${String(title || 'Rencontre').slice(0, 80)}`;
  const mapStr = String(map || '').trim();
  const bg = mapStr && !mapStr.includes('..') && /\.(webp|png|jpg|jpeg|gif|avif|svg)(\?.*)?$/i.test(mapStr) ? mapStr : null;
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

  return { ok: true, sceneId: scene._id, sceneName, tokens: tokens.length, missing, bgSet: Boolean(bg), map: bg || null };
}

/* ============================================================================
 * ▶ JOUER CE BEAT — orchestrateur des déclencheurs (étape 3)
 * ---------------------------------------------------------------------------
 * Chaque beat DÉCLARE ce qu'il déclenche (flags.holocron.storyboard[].trigger,
 * assaini par sanitizeTrigger). `playBeat` exécute EXACTEMENT ce qui est
 * déclaré — rien d'implicite, rien de caché — dans un ordre sensé :
 *     scène → tokens/combat → ambiance → météo → handout/séquence → caméra
 * TOLÉRANT AUX PANNES : une action ratée n'annule pas les suivantes (le MJ est
 * en pleine partie, on ne le laisse jamais devant un écran vide) ; on renvoie
 * un rapport ligne à ligne « ce qui a marché / ce qui a échoué ».
 * Le beat est RELU DEPUIS FOUNDRY par l'appelant : le client n'envoie que
 * { actId, beatId } et ne peut donc pas faire exécuter d'action arbitraire.
 * ========================================================================= */

/** Beat d'un acte, relu depuis le store (jamais depuis le client). */
export function findBeat({ store }, actId, beatId) {
  const entry = (store.get('journalsIndex') || []).find((j) => j._id === actId);
  if (!entry) return null;
  const doc = store.get(`journal:${actId}`) || entry;
  const sb = sanitizeStoryboard(doc.flags?.holocron?.storyboard ?? entry.flags?.holocron?.storyboard);
  return sb.beats.find((b) => b.id === beatId) || null;
}

/** Combattants d'une rencontre de la bibliothèque → [{ name, count }] (≤ 20). */
export function encounterCombatants(enc) {
  const rows = (enc?.groups || []).flatMap((g) => (g?.rows || []));
  return rows
    .map((r) => ({ name: String(r?.name || '').slice(0, 80), count: Math.max(1, Math.min(12, +r?.count || 1)) }))
    .filter((c) => c.name)
    .slice(0, 20);
}

/** PLAN D'EXÉCUTION PUR (testable, sans I/O) d'un beat assaini.
 * `ctx` = { encounter?, sequence? } — les objets déjà résolus par l'appelant.
 * Renvoie la liste ORDONNÉE des actions ; liste vide = le beat ne déclare rien. */
export function planBeat(beat, ctx = {}) {
  const t = beat && typeof beat === 'object' && beat.trigger && typeof beat.trigger === 'object' ? beat.trigger : null;
  if (!t) return [];
  const steps = [];
  const { encounter, sequence } = ctx;

  // 1. la scène. Une rencontre liée MONTE LA SIENNE (scène + tokens) et gagne
  //    donc sur `trigger.scene` — l'éditeur le dit en clair (describeTrigger).
  if (t.encounterId) {
    const combatants = encounterCombatants(encounter);
    if (encounter && combatants.length) {
      steps.push({ action: 'combat-scene', label: `Monter la scène de rencontre « ${encounter.title || t.encounterId} »`,
        encounter: { title: encounter.title || 'Rencontre', map: encounter.map || '', combatants } });
      steps.push({ action: 'scene', label: 'Activer la scène de rencontre', fromCombatScene: true, pullUsers: t.pullUsers === true });
      steps.push({ action: 'combat', label: `Ouvrir le combat (${combatants.length} groupe(s))` });
    } else {
      steps.push({ action: 'combat-scene', label: `Rencontre « ${t.encounterId} » introuvable ou vide`, missing: true });
    }
  } else if (t.scene) {
    steps.push({ action: 'scene', label: `Activer la scène « ${t.scene} »${t.pullUsers ? ' (joueurs amenés)' : ''}`,
      scene: t.scene, pullUsers: t.pullUsers === true });
  }

  // 2. ambiance
  if (t.playlist) steps.push({ action: 'playlist', label: `Jouer la playlist « ${t.playlist} »`, playlist: t.playlist });

  // 3. météo (client_weather : module compagnon + navigateur MJ requis)
  if (Array.isArray(t.weather) && t.weather.length) {
    const clear = t.weather.includes('clear');
    steps.push({ action: 'weather', label: clear ? 'Couper les effets météo' : `Météo : ${t.weather.join(', ')}`,
      ...(clear ? { clear: true } : { effects: t.weather }) });
  }

  // 4. handout unitaire, puis premier élément de la séquence liée (le MJ
  //    enchaîne ensuite au projecteur, Précédent/Suivant).
  if (t.handout) {
    const n = (t.handout.targets || []).length;
    steps.push({ action: 'handout', label: `Handout « ${t.handout.title || t.handout.src || 'sans titre'} » → ${n ? `${n} joueur(s)` : 'toute la table'}`,
      handout: t.handout });
  }
  if (t.sequenceId) {
    const item = sequence?.items?.[0] || null;
    if (item) {
      steps.push({ action: 'sequence', label: `Séquence « ${sequence.name} » — élément 1/${sequence.items.length}`,
        sequenceId: t.sequenceId, item });
    } else {
      steps.push({ action: 'sequence', label: `Séquence « ${t.sequenceId} » introuvable ou vide`, missing: true });
    }
  }

  // 5. caméra
  if (t.pan) steps.push({ action: 'pan', label: 'Recadrer la caméra des joueurs', pan: t.pan });

  return steps;
}

/** Exécute UNE action du plan. Jette en cas d'échec — playBeat encaisse. */
async function runStep(step, deps) {
  if (step.missing) throw new Error('référence introuvable (rencontre ou séquence)');
  switch (step.action) {
    case 'combat-scene': {
      const out = await createCombatScene(step.encounter, deps);
      deps.state.sceneId = out.sceneId;
      deps.state.sceneName = out.sceneName;
      deps.state.combatants = step.encounter.combatants;
      return { tokens: out.tokens, ...(out.missing?.length ? { missing: out.missing } : {}) };
    }
    case 'scene': {
      const args = step.fromCombatScene
        ? (deps.state.sceneId ? { _id: deps.state.sceneId } : null)
        : (/^[A-Za-z0-9]{16}$/.test(step.scene) ? { _id: step.scene } : { name: step.scene });
      if (!args) throw new Error('aucune scène à activer (la génération a échoué)');
      await mcpCall('activate_scene', { ...args, ...(step.pullUsers ? { pull_users: true } : {}) });
      return { scene: args._id || args.name };
    }
    case 'combat': {
      // la scène active porte les tokens fraîchement posés : on crée le combat,
      // on y verse tous les combattants de la scène, puis on lance.
      await mcpCall('manage_combat', { action: 'create', ...(deps.state.sceneId ? { scene_id: deps.state.sceneId } : {}) });
      try { await mcpCall('manage_combat', { action: 'add_combatants' }); } catch { /* déjà peuplé par la création */ }
      try { await mcpCall('manage_combat', { action: 'start' }); } catch { /* le MJ lancera l'initiative */ }
      return { combat: true };
    }
    case 'playlist': {
      // outil natif d'abord ; repli sur le PONT ChatMessage (module ≥ 2.2), le
      // seul chemin fiable quand le connecteur ne pilote pas le vrai lecteur.
      try {
        await mcpCall('control_playlist', { playlist: step.playlist, action: 'play' });
        return { via: 'control_playlist' };
      } catch (e) {
        await soundBridge({ playlist: step.playlist, action: 'play' });
        return { via: 'pont module', note: String(e.message || e).slice(0, 80) };
      }
    }
    case 'weather':
      await mcpCall('client_weather', step.clear ? { clear: true } : { effects: step.effects });
      return { weather: step.clear ? 'clear' : step.effects.join(',') };
    case 'handout':
      await handoutBridge(step.handout);
      return { handout: step.handout.title || step.handout.type };
    case 'sequence':
      await handoutBridge(step.item);
      return { item: step.item.title || step.item.src || step.item.type };
    case 'pan':
      await mcpCall('client_pan_camera', { x: step.pan.x, y: step.pan.y, ...(step.pan.scale ? { scale: step.pan.scale } : {}) });
      return { pan: true };
    default:
      throw new Error(`action inconnue : ${step.action}`);
  }
}

/** Joue un beat : relit le beat depuis Foundry, bâtit le plan, l'exécute pas à
 * pas SANS jamais s'arrêter au premier échec, trace ce qui a marché et renvoie
 * un rapport lisible. `trace(kind, entry)` est facultatif (fire-and-forget). */
export async function playBeat({ actId, beatId }, { store, config, encounters = [], sequences = [], trace = null }) {
  const beat = findBeat({ store }, actId, beatId);
  if (!beat) throw Object.assign(new Error('beat introuvable dans le storyboard de cet acte'), { code: 404 });

  const steps = planBeat(beat, {
    encounter: beat.trigger?.encounterId ? encounters.find((e) => e?.id === beat.trigger.encounterId) : null,
    sequence: beat.trigger?.sequenceId ? sequences.find((s) => s?.id === beat.trigger.sequenceId) : null,
  });
  if (!steps.length) {
    return { ok: true, beat: { id: beat.id, title: beat.title, kind: beat.kind }, empty: true, steps: [],
      message: 'Ce beat ne déclare aucun déclencheur — rien n’a été envoyé à Foundry.' };
  }

  const deps = { store, config, state: {} };
  const report = [];
  for (const step of steps) {
    try {
      const detail = await runStep(step, deps);
      report.push({ action: step.action, label: step.label, ok: true, ...(detail || {}) });
    } catch (e) {
      // TOLÉRANCE AUX PANNES : on note et on continue — le reste de la mise en
      // scène doit partir même si le module compagnon n'est pas là (client_*).
      report.push({ action: step.action, label: step.label, ok: false, error: String(e.message || e).slice(0, 200) });
    }
  }

  // 📓 la trace : une entrée `acted` par action, et un `shown` pour ce qui a
  // RÉELLEMENT été projeté (cohérent avec le reste de la trace).
  if (typeof trace === 'function') {
    for (const r of report) {
      trace('acted', { action: r.action, label: r.label, beatId: beat.id, ok: r.ok });
      if (r.ok && (r.action === 'handout' || r.action === 'sequence')) {
        const h = steps.find((s) => s.action === r.action);
        const src = h?.handout || h?.item || {};
        trace('shown', { type: src.type || 'image', title: src.title || '', ...(src.targets?.length ? { targets: src.targets } : {}) });
      }
    }
  }

  const okN = report.filter((r) => r.ok).length;
  return {
    ok: okN > 0,
    beat: { id: beat.id, title: beat.title, kind: beat.kind },
    steps: report,
    message: okN === report.length
      ? `✅ ${okN} action(s) exécutée(s).`
      : `⚠️ ${okN}/${report.length} action(s) exécutée(s) — voir le détail.`,
  };
}
