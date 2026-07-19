// session-model.js — modèle PUR de la séance en cours : aucun DOM, aucun réseau,
// aucun import. C'est la SEULE définition des défauts `gm:cfg:session` (fini le
// doublon gm-home/gm-session) et le lieu des règles qui doivent être TESTÉES :
//   · format d'épinglage `pinned` (beat du storyboard, compat ascendante chapitre) ;
//   · position dans la chaîne de beats + progression de l'acte ;
//   · rythme (alerte DOUCE, jamais bloquante) ;
//   · description DIDACTIQUE d'un déclencheur `trigger` (« ▶ jouera : … ») ;
//   · panneau « ne pas oublier » (secrets non révélés, fils ouverts, PNJ du beat).
// Importé par gm-session.js, gm-home.js, gm-campaign.js — et par les tests Node.

/** Défauts de la config MJ partagée `gm:cfg:session` — SOURCE UNIQUE. */
export const SESSION_DEFAULTS = {
  v: 1,
  title: '',
  date: '',
  pinned: null,      // { actId, beatId } — ou l'ANCIEN { chap, heading, label }
  checklist: [],
  noteRef: '',
  currentId: '',     // id de la séance ouverte (flags.holocron.sessions) = la trace
  pinnedAt: 0,       // epoch ms du dernier épinglage → minuteur « temps sur ce beat »
  paceMin: 25,       // seuil d'alerte douce (minutes) ; 0 = pas d'alerte
};

/* ------------------------------------------------------------------ pinned --
 * DEUX formes historiques, toutes deux lues :
 *   · { actId, beatId }            — depuis l'étape 2 : la séance épingle un BEAT
 *   · { chap, heading?, label? }   — ancien bandeau : un chapitre de bible + heading
 * `null` quand rien n'est épinglé. Ne jette jamais, ne devine jamais. */
export function normalizePinned(p) {
  if (!p || typeof p !== 'object') return null;
  if (p.beatId) {
    return {
      kind: 'beat',
      actId: String(p.actId || ''),
      beatId: String(p.beatId),
      label: String(p.label || ''),
    };
  }
  if (p.chap) {
    return {
      kind: 'chap',
      chap: String(p.chap),
      heading: p.heading ? String(p.heading) : null,
      label: String(p.label || ''),
    };
  }
  return null;
}

/** Position d'un beat dans la chaîne de son acte + progression (X/Y). */
export function chainInfo(beats, beatId) {
  const list = Array.isArray(beats) ? beats : [];
  const index = list.findIndex((b) => b && b.id === beatId);
  const done = list.filter((b) => b && b.status === 'fait').length;
  return {
    index,
    total: list.length,
    done,
    beat: index >= 0 ? list[index] : null,
    prev: index > 0 ? list[index - 1] : null,
    next: index >= 0 && index + 1 < list.length ? list[index + 1] : null,
  };
}

/* ------------------------------------------------------------------ rythme --
 * Purement INDICATIF : on change une teinte, on n'ouvre jamais de modale et on
 * n'interrompt jamais le MJ. 'ok' → 'warn' au seuil → 'over' à 1,5× le seuil. */
export function paceState(elapsedMs, thresholdMin) {
  const t = Number(thresholdMin) > 0 ? Number(thresholdMin) * 60000 : 0;
  if (!t || !(elapsedMs > 0)) return 'ok';
  if (elapsedMs >= t * 1.5) return 'over';
  if (elapsedMs >= t) return 'warn';
  return 'ok';
}

const two = (n) => String(n).padStart(2, '0');

/** Durée lisible (« 4 min », « 1 h 05 »). Chaîne vide si nulle/négative. */
export function fmtDur(ms) {
  if (!(ms > 0)) return '';
  const m = Math.round(ms / 60000);
  if (m < 1) return '< 1 min';
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${two(m % 60)}`;
}

/** Effets météo proposés à la coche dans l'éditeur de beat — MIROIR de la table
 * fermée serveur (WEATHER_EFFECTS de board.mjs). `clear` est exclusif. */
export const WEATHER_UI = [
  ['clear', '🌤️ couper'], ['rain', '🌧️ pluie'], ['rainStorm', '⛈️ orage'],
  ['snow', '❄️ neige'], ['blizzard', '🌨️ blizzard'], ['fog', '🌫️ brouillard'],
  ['leaves', '🍃 feuilles'], ['embers', '🔥 braises'], ['birds', '🐦 oiseaux'],
  ['bubbles', '🫧 bulles'], ['stars', '✨ étoiles'], ['clouds', '☁️ nuages'],
];

/* --------------------------------------------------------------- trigger --
 * DIDACTIQUE (exigence explicite) : l'éditeur doit dire EN CLAIR ce que « ▶
 * Jouer ce beat » va faire, et signaler ce qui manque. Aucun effet surprise.
 * Miroir de l'ordre d'exécution serveur (planBeat dans session-tools.mjs).
 * `ctx.playlists` / `ctx.encounters` / `ctx.sequences` à null = liste inconnue
 * (pas encore chargée) → on n'invente AUCUNE alerte. */
export function describeTrigger(beat, ctx = {}) {
  const b = beat && typeof beat === 'object' ? beat : {};
  const t = b.trigger && typeof b.trigger === 'object' ? b.trigger : {};
  const lines = [];
  const warnings = [];
  const encounters = ctx.encounters || null;
  const sequences = ctx.sequences || null;
  const playlists = ctx.playlists || null;
  const nPlayers = Number(ctx.playerCount || 0);

  // 1. la scène (une rencontre liée crée la SIENNE — elle gagne, on le dit)
  if (t.encounterId) {
    const enc = encounters ? encounters.find((e) => e && e.id === t.encounterId) : undefined;
    if (encounters && !enc) warnings.push('la rencontre liée est introuvable dans la bibliothèque');
    lines.push(`⚔️ monter la scène de rencontre « ${enc ? enc.title : t.encounterId} » (tokens compris) et l’activer`);
    lines.push('⚔️ ouvrir le combat avec les combattants de la rencontre');
    if (t.scene) warnings.push(`la scène « ${t.scene} » sera ignorée : la rencontre crée et active la sienne`);
  } else if (t.scene) {
    lines.push(`🎬 activer la scène « ${t.scene} »${t.pullUsers ? ' et y amener les joueurs' : ''}`);
  } else if (t.pullUsers) {
    warnings.push('« amener les joueurs » est coché mais aucune scène n’est déclarée');
  }
  if (b.kind === 'combat' && !t.encounterId) {
    warnings.push('beat ⚔️ sans rencontre liée — rien ne montera de combat');
  }

  // 2. ambiance
  if (t.playlist) {
    lines.push(`🎵 lancer la playlist « ${t.playlist} »`);
    if (playlists && !playlists.some((p) => p && String(p.name).toLowerCase() === String(t.playlist).toLowerCase())) {
      warnings.push(`playlist « ${t.playlist} » introuvable dans le monde`);
    }
  }

  // 3. météo (client_weather — module compagnon + navigateur MJ requis)
  const weather = Array.isArray(t.weather) ? t.weather.filter(Boolean) : [];
  if (weather.length) {
    lines.push(weather.includes('clear')
      ? '🌤️ couper les effets météo'
      : `🌦️ poser la météo : ${weather.join(', ')}`);
  }

  // 4. handout unitaire puis séquence
  if (t.handout) {
    const n = (t.handout.targets || []).length;
    lines.push(`📜 envoyer le handout « ${t.handout.title || t.handout.src || 'sans titre'} » `
      + `${n ? `à ${n} joueur(s)` : `à toute la table${nPlayers ? ` (${nPlayers} joueurs)` : ''}`}`);
  }
  if (t.sequenceId) {
    const seq = sequences ? sequences.find((s) => s && s.id === t.sequenceId) : undefined;
    if (sequences && !seq) warnings.push('la séquence liée est introuvable');
    else if (seq && !seq.items.length) warnings.push(`la séquence « ${seq.name} » est vide`);
    lines.push(`🎞️ projeter la séquence « ${seq ? seq.name : t.sequenceId} »`
      + `${seq && seq.items.length ? ` (1er des ${seq.items.length} éléments)` : ''}`);
  }
  if (b.kind === 'handout' && !t.handout && !t.sequenceId && !b.handout && !b.sequenceId) {
    warnings.push('beat 🖼️ sans handout ni séquence — rien ne sera projeté');
  }

  // 5. caméra (client_pan_camera — module compagnon + navigateur MJ requis)
  if (t.pan) {
    lines.push(`🎥 recadrer la caméra des joueurs (x ${t.pan.x}, y ${t.pan.y}`
      + `${t.pan.scale ? `, zoom ${t.pan.scale}` : ''})`);
  }

  return { lines, warnings, empty: lines.length === 0 };
}

/* -------------------------------------------------- « ne pas oublier » (cœur)
 * Croise le STORYBOARD (ce qui est prévu) avec LA TRACE (ce qui a réellement
 * été révélé) pour répondre aux trois questions du MJ en pleine séance :
 *   · qu'est-ce que j'ai semé dans cet acte et qu'ils n'ont PAS encore appris ?
 *   · quels fils sont restés ouverts (ici et dans les actes précédents) ?
 *   · le PNJ que j'ai devant moi, il veut quoi, il a quel levier ?
 * PUR : reçoit le catalogue, les séances et les dossiers, ne lit rien. */
export function buildForget({ actId, beatId, catalog = {}, sessions = [], dossiers = {} } = {}) {
  const nodes = Array.isArray(catalog.nodes) ? catalog.nodes : [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const acts = nodes.filter((n) => n.type === 'acte');
  const act = byId.get(actId) || null;
  const beats = (act && act.storyboard && act.storyboard.beats) || [];
  const beat = beats.find((b) => b && b.id === beatId) || null;

  // ce que les joueurs ont DÉJÀ appris, toutes séances confondues
  const revealed = new Set();
  for (const s of (Array.isArray(sessions) ? sessions : [])) {
    for (const r of (s && s.reveals) || []) {
      const id = String(r && r.uuid ? r.uuid : '').split('.').pop();
      if (id) revealed.add(id);
    }
  }

  // 1. semé mais pas encore révélé — dans l'acte courant
  const secrets = [];
  const seenSecret = new Set();
  for (const b of beats) {
    for (const u of (b && b.uuids) || []) {
      const id = String(u).split('.').pop();
      if (!id || revealed.has(id) || seenSecret.has(id)) continue;
      seenSecret.add(id);
      const n = byId.get(id);
      secrets.push({
        id,
        uuid: String(u),
        name: (n && n.name) || '(fiche disparue)',
        type: (n && n.type) || 'quest',
        beatId: b.id,
        beatTitle: b.title || '',
        beatStatus: b.status || 'todo',
      });
    }
  }

  // 2. fils ouverts : beats todo/encours des actes NON terminés (celui-ci compris)
  const threads = [];
  for (const a of acts) {
    const abeats = (a.storyboard && a.storyboard.beats) || [];
    if (!abeats.length) continue;
    if (abeats.every((b) => b && b.status === 'fait')) continue; // acte bouclé
    for (const b of abeats) {
      if (!b || b.status === 'fait') continue;
      threads.push({
        actId: a.id,
        actName: a.name,
        beatId: b.id,
        title: b.title || '',
        kind: b.kind || 'scene',
        status: b.status || 'todo',
        current: a.id === actId,
      });
    }
  }
  // l'acte courant d'abord, puis « en cours » avant « à jouer »
  threads.sort((x, y) => (Number(y.current) - Number(x.current))
    || (Number(y.status === 'encours') - Number(x.status === 'encours')));

  // 3. les PNJ du beat courant, avec leur intention (flags.holocron.dossiers)
  const npcs = [];
  for (const u of (beat && beat.uuids) || []) {
    const id = String(u).split('.').pop();
    const n = byId.get(id);
    const d = dossiers[id] || {};
    npcs.push({
      id,
      uuid: String(u),
      name: (n && n.name) || '(fiche disparue)',
      type: (n && n.type) || 'quest',
      revealed: revealed.has(id),
      role: d.role || '',
      veut: d.veut || '',
      levier: d.levier || '',
      attitude: d.attitude || '',
      replique: d.replique || '',
      indices: d.indices || '',
      hasDossier: Boolean(d.veut || d.levier || d.attitude || d.replique || d.role || d.indices),
    });
  }

  return { act, beat, secrets, threads: threads.slice(0, 20), npcs };
}
