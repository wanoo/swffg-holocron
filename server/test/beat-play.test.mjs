// Tests du PILOTAGE DE SÉANCE cousu au storyboard (étapes 2 & 3) :
//   · sanitizeTrigger  — ce que chaque beat DÉCLARE déclencher (bornes strictes)
//   · planBeat         — le plan d'exécution PUR de « ▶ Jouer ce beat »
//   · normalizePinned  — COMPAT ASCENDANTE de l'épinglage (beat / chapitre)
//   · describeTrigger  — l'annonce didactique et les manques signalés
//   · buildForget      — le panneau « ne pas oublier » (storyboard × trace)
//   · étanchéité       — un trigger ne fuit JAMAIS par /api/content/*
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { sanitizeTrigger, sanitizeStoryboard, sanitizeSession, WEATHER_EFFECTS } from '../lib/board.mjs';
import { planBeat, encounterCombatants } from '../lib/session-tools.mjs';
import { createContentService } from '../lib/content.mjs';
import {
  normalizePinned, chainInfo, paceState, describeTrigger, buildForget, SESSION_DEFAULTS,
} from '../../public/js/session-model.js';

const ID = (n) => n.padEnd(16, '0').slice(0, 16);

/* ------------------------------------------------------------ sanitizeTrigger */
test('sanitizeTrigger : rien de déclaré → null (pas de clé morte dans le flag)', () => {
  assert.equal(sanitizeTrigger(null), null);
  assert.equal(sanitizeTrigger({}), null);
  assert.equal(sanitizeTrigger('__proto__'), null);
  assert.equal(sanitizeTrigger([1, 2]), null);
  assert.doesNotThrow(() => sanitizeTrigger({ pan: 'niet', weather: 3, handout: 7 }));
});

test('sanitizeTrigger : scène, pullUsers et playlist bornés', () => {
  const t = sanitizeTrigger({ scene: '  Cantina  ', pullUsers: 'oui', playlist: 'p'.repeat(300) });
  assert.equal(t.scene, 'Cantina');
  assert.equal(t.pullUsers, undefined, 'pullUsers n’est vrai que sur le booléen true');
  assert.equal(t.playlist.length, 100);
  assert.equal(sanitizeTrigger({ scene: 'x', pullUsers: true }).pullUsers, true);
  assert.equal(sanitizeTrigger({ scene: ' '.repeat(5) }), null, 'scène vide = rien');
});

test('sanitizeTrigger : météo en table fermée, dédupliquée, « clear » exclusif', () => {
  assert.deepEqual(sanitizeTrigger({ weather: ['FOG', 'fog', 'hack', 'rain'] }).weather, ['fog', 'rain']);
  assert.deepEqual(sanitizeTrigger({ weather: ['rain', 'clear'] }).weather, ['clear'], 'couper gagne');
  assert.equal(sanitizeTrigger({ weather: ['hack'] }), null);
  assert.equal(sanitizeTrigger({ weather: WEATHER_EFFECTS }).weather.length, 1, 'clear présent → exclusif');
  assert.equal(sanitizeTrigger({ weather: ['rain', 'snow', 'fog', 'stars', 'clouds'] }).weather.length, 4, 'borné à 4');
});

test('sanitizeTrigger : ids, handout assaini et caméra bornée', () => {
  const t = sanitizeTrigger({
    sequenceId: 'seq-abc', encounterId: 'enc-42', pan: { x: 99999, y: -12.6, scale: 99 },
    handout: { type: 'image', src: 'worlds/w/a.webp', title: 't', targets: [ID('U1'), 'niet'] },
  });
  assert.equal(t.sequenceId, 'seq-abc');
  assert.equal(t.encounterId, 'enc-42');
  assert.deepEqual(t.pan, { x: 20000, y: -13, scale: 4 });
  assert.deepEqual(t.handout.targets, [ID('U1')]);
  assert.equal(sanitizeTrigger({ handout: { type: 'image' } }), null, 'handout sans src = rien');
  assert.equal(sanitizeTrigger({ sequenceId: 'a b c/../x' }), null, 'id non conforme rejeté');
  assert.equal(sanitizeTrigger({ pan: { scale: 2 } }), null, 'pan sans x ni y = rien');
});

test('sanitizeStoryboard : le trigger est porté par TOUS les kinds et re-assaini', () => {
  const sb = sanitizeStoryboard({ beats: [
    { id: 'beat-1', kind: 'note', title: 'Ambiance seule', trigger: { playlist: 'Tension' } },
    { id: 'beat-2', kind: 'combat', trigger: { encounterId: 'enc-1', scene: 'Docks', pullUsers: true } },
    { id: 'beat-3', kind: 'scene', trigger: {} },
  ] });
  assert.deepEqual(sb.beats[0].trigger, { playlist: 'Tension' });
  assert.deepEqual(sb.beats[1].trigger, { scene: 'Docks', pullUsers: true, encounterId: 'enc-1' });
  assert.equal(sb.beats[2].trigger, undefined, 'trigger vide non stocké');
  assert.deepEqual(sanitizeStoryboard(sb), sb, 'idempotent');
});

/* ------------------------------------------------------------------ planBeat */
const enc = { id: 'enc-1', title: 'Embuscade', map: 'worlds/w/docks.webp',
  groups: [{ name: 'g', rows: [{ name: 'Stormtrooper', count: 4 }, { name: 'Officier' }] }] };
const seq = { id: 'seq-1', name: 'Le contrat', items: [{ type: 'image', src: 'worlds/w/a.webp', title: 'Contrat' }] };

test('planBeat : aucun trigger → plan vide (le beat n’envoie RIEN à Foundry)', () => {
  assert.deepEqual(planBeat({ id: 'b', kind: 'scene' }), []);
  assert.deepEqual(planBeat(null), []);
  assert.deepEqual(planBeat({ trigger: 'niet' }), []);
});

test('planBeat : beat 🎭 « ambiance seule » ne touche à AUCUNE scène', () => {
  const steps = planBeat({ kind: 'scene', trigger: { playlist: 'Cantina Band' } });
  assert.deepEqual(steps.map((s) => s.action), ['playlist']);
  assert.equal(steps[0].playlist, 'Cantina Band');
});

test('planBeat : l’ORDRE est scène → combat → ambiance → météo → handout/séquence → caméra', () => {
  const steps = planBeat({ kind: 'scene', trigger: {
    scene: 'Cantina', pullUsers: true, playlist: 'Tension', weather: ['fog'],
    handout: { type: 'image', src: 'worlds/w/a.webp', title: 'Contrat' },
    sequenceId: 'seq-1', pan: { x: 10, y: 20, scale: 1.5 },
  } }, { sequence: seq });
  assert.deepEqual(steps.map((s) => s.action), ['scene', 'playlist', 'weather', 'handout', 'sequence', 'pan']);
  assert.equal(steps[0].pullUsers, true);
  assert.deepEqual(steps[2].effects, ['fog']);
  assert.equal(steps[4].item.title, 'Contrat', 'la séquence part sur son 1er élément');
});

test('planBeat : beat ⚔️ — la rencontre monte SA scène, ses tokens, puis le combat', () => {
  const steps = planBeat({ kind: 'combat', trigger: { encounterId: 'enc-1', pullUsers: true } }, { encounter: enc });
  assert.deepEqual(steps.map((s) => s.action), ['combat-scene', 'scene', 'combat']);
  assert.deepEqual(steps[0].encounter.combatants, [{ name: 'Stormtrooper', count: 4 }, { name: 'Officier', count: 1 }]);
  assert.equal(steps[1].fromCombatScene, true, 'on active la scène GÉNÉRÉE, pas une autre');
  assert.equal(steps[1].pullUsers, true);
});

test('planBeat : rencontre liée absente ou vide → étape « missing » (jamais d’action muette)', () => {
  const steps = planBeat({ kind: 'combat', trigger: { encounterId: 'enc-9' } }, { encounter: null });
  assert.equal(steps.length, 1);
  assert.equal(steps[0].action, 'combat-scene');
  assert.equal(steps[0].missing, true);
  const vide = planBeat({ kind: 'combat', trigger: { encounterId: 'enc-1' } }, { encounter: { id: 'enc-1', groups: [] } });
  assert.equal(vide[0].missing, true);
  const noSeq = planBeat({ kind: 'handout', trigger: { sequenceId: 'seq-9' } }, {});
  assert.equal(noSeq[0].missing, true);
});

test('planBeat : la scène déclarée est IGNORÉE quand une rencontre en monte une', () => {
  const steps = planBeat({ kind: 'combat', trigger: { encounterId: 'enc-1', scene: 'Cantina' } }, { encounter: enc });
  assert.ok(!steps.some((s) => s.scene === 'Cantina'), 'une seule scène activée, celle de la rencontre');
});

test('planBeat : météo « clear » coupe au lieu de poser', () => {
  const [step] = planBeat({ kind: 'scene', trigger: { weather: ['clear'] } });
  assert.equal(step.clear, true);
  assert.equal(step.effects, undefined);
});

test('encounterCombatants : bornes (≤ 12 par ligne, ≤ 20 lignes, sans nom = jeté)', () => {
  const big = { groups: [{ rows: Array.from({ length: 30 }, (_, i) => ({ name: `x${i}`, count: 99 })) }, { rows: [{ count: 3 }] }] };
  const out = encounterCombatants(big);
  assert.equal(out.length, 20);
  assert.equal(out[0].count, 12);
  assert.deepEqual(encounterCombatants(null), []);
});

/* -------------------------------------------- épinglage : compat ascendante */
test('normalizePinned : COMPAT — l’ancien épinglage « chapitre + heading » vit toujours', () => {
  const old = normalizePinned({ chap: 'gm-acte-5', heading: 'h-gm-acte-5-2', label: 'La cantina' });
  assert.deepEqual(old, { kind: 'chap', chap: 'gm-acte-5', heading: 'h-gm-acte-5-2', label: 'La cantina' });
  assert.equal(normalizePinned({ chap: 'c' }).heading, null, 'heading facultatif');
});

test('normalizePinned : nouveau format = un BEAT du storyboard', () => {
  const p = normalizePinned({ actId: ID('ACT1'), beatId: 'beat-abc', label: 'Embuscade' });
  assert.deepEqual(p, { kind: 'beat', actId: ID('ACT1'), beatId: 'beat-abc', label: 'Embuscade' });
  // un objet portant LES DEUX formes est lu comme un beat (le plus récent gagne)
  assert.equal(normalizePinned({ chap: 'c', beatId: 'b' }).kind, 'beat');
});

test('normalizePinned : rien d’exploitable → null (ne devine jamais)', () => {
  for (const v of [null, undefined, {}, 'x', 42, { label: 'orphelin' }]) assert.equal(normalizePinned(v), null);
  assert.equal(SESSION_DEFAULTS.pinned, null);
  assert.equal(SESSION_DEFAULTS.currentId, '', 'la séance courante vit ici — source unique');
});

test('chainInfo : position dans la chaîne, voisins et progression de l’acte', () => {
  const beats = [{ id: 'a', status: 'fait' }, { id: 'b', status: 'encours' }, { id: 'c', status: 'todo' }];
  const mid = chainInfo(beats, 'b');
  assert.deepEqual([mid.index, mid.total, mid.done], [1, 3, 1]);
  assert.equal(mid.prev.id, 'a');
  assert.equal(mid.next.id, 'c');
  assert.equal(chainInfo(beats, 'a').prev, null);
  assert.equal(chainInfo(beats, 'c').next, null);
  const nulle = chainInfo(beats, 'zz');
  assert.equal(nulle.index, -1);
  assert.equal(nulle.beat, null);
  assert.equal(chainInfo(null, 'a').total, 0);
});

test('paceState : alerte DOUCE à trois crans, désactivable', () => {
  assert.equal(paceState(5 * 60000, 25), 'ok');
  assert.equal(paceState(25 * 60000, 25), 'warn');
  assert.equal(paceState(40 * 60000, 25), 'over');
  assert.equal(paceState(999 * 60000, 0), 'ok', 'seuil 0 = pas d’alerte');
  assert.equal(paceState(0, 25), 'ok');
});

/* ---------------------------------------------------- annonce DIDACTIQUE */
test('describeTrigger : annonce en clair ce qui partira', () => {
  const d = describeTrigger({ kind: 'scene', trigger: { scene: 'Cantina', pullUsers: true, playlist: 'Tension', sequenceId: 'seq-1' } },
    { sequences: [seq], playlists: [{ name: 'Tension' }], playerCount: 4 });
  assert.ok(d.lines.some((l) => l.includes('Cantina') && l.includes('amener les joueurs')));
  assert.ok(d.lines.some((l) => l.includes('Tension')));
  assert.ok(d.lines.some((l) => l.includes('Le contrat')));
  assert.deepEqual(d.warnings, []);
  assert.equal(d.empty, false);
});

test('describeTrigger : signale les MANQUES (rien de caché, rien de muet)', () => {
  const combat = describeTrigger({ kind: 'combat', trigger: {} }, { encounters: [] });
  assert.ok(combat.warnings.some((w) => w.includes('sans rencontre liée')));
  assert.equal(combat.empty, true);

  const pl = describeTrigger({ kind: 'scene', trigger: { playlist: 'Fantôme' } }, { playlists: [{ name: 'Tension' }] });
  assert.ok(pl.warnings.some((w) => w.includes('introuvable dans le monde')));

  const both = describeTrigger({ kind: 'combat', trigger: { encounterId: 'enc-1', scene: 'Cantina' } }, { encounters: [enc] });
  assert.ok(both.warnings.some((w) => w.includes('sera ignorée')));

  const ho = describeTrigger({ kind: 'handout', trigger: {} }, {});
  assert.ok(ho.warnings.some((w) => w.includes('sans handout ni séquence')));
});

test('describeTrigger : une liste non chargée (null) n’invente AUCUNE alerte', () => {
  const d = describeTrigger({ kind: 'scene', trigger: { playlist: 'Fantôme', sequenceId: 'seq-9' } },
    { playlists: null, sequences: null, encounters: null });
  assert.deepEqual(d.warnings, []);
  assert.equal(d.lines.length, 2);
});

/* ------------------------------------------------- 🧠 « ne pas oublier » */
const catalog = { nodes: [
  { id: ID('ACT1'), name: 'Acte 1', type: 'acte', storyboard: { beats: [
    { id: 'b1', kind: 'scene', title: 'Arrivée', status: 'fait', uuids: [`JournalEntry.${ID('NPC1')}`] },
    { id: 'b2', kind: 'combat', title: 'Embuscade', status: 'encours', uuids: [`JournalEntry.${ID('NPC2')}`, `JournalEntry.${ID('LOC1')}`] },
  ] } },
  { id: ID('ACT2'), name: 'Acte 2', type: 'acte', storyboard: { beats: [{ id: 'b3', title: 'Fuite', kind: 'scene', status: 'todo' }] } },
  { id: ID('ACT0'), name: 'Acte 0', type: 'acte', storyboard: { beats: [{ id: 'b0', title: 'Prologue', kind: 'scene', status: 'fait' }] } },
  { id: ID('NPC1'), name: 'Maz', type: 'npc' },
  { id: ID('NPC2'), name: 'Trelon', type: 'npc' },
  { id: ID('LOC1'), name: 'Les Docks', type: 'location' },
] };
const sessions = [{ id: 'sess-a', reveals: [{ uuid: `JournalEntry.${ID('NPC1')}`, label: 'Maz' }] }];
const dossiers = { [ID('NPC2')]: { veut: 'la cargaison', levier: 'sa sœur', attitude: 'méfiant', replique: 'Tu es en retard.' } };

test('buildForget : les secrets NON encore révélés, croisés avec la trace', () => {
  const f = buildForget({ actId: ID('ACT1'), beatId: 'b2', catalog, sessions, dossiers });
  const noms = f.secrets.map((s) => s.name);
  assert.ok(!noms.includes('Maz'), 'déjà révélé en séance → sorti de la liste');
  assert.deepEqual(noms.sort(), ['Les Docks', 'Trelon']);
  assert.equal(f.secrets[0].beatTitle, 'Embuscade', 'on dit d’où vient le secret');
});

test('buildForget : les fils ouverts, actes bouclés exclus, acte courant en tête', () => {
  const f = buildForget({ actId: ID('ACT1'), beatId: 'b2', catalog, sessions, dossiers });
  assert.ok(!f.threads.some((t) => t.actName === 'Acte 0'), 'acte entièrement joué = plus un fil ouvert');
  assert.equal(f.threads[0].current, true);
  assert.equal(f.threads[0].title, 'Embuscade');
  assert.ok(f.threads.some((t) => t.actName === 'Acte 2'), 'les autres actes ouverts remontent aussi');
});

test('buildForget : les PNJ du beat courant avec leur intention (dossiers)', () => {
  const f = buildForget({ actId: ID('ACT1'), beatId: 'b2', catalog, sessions, dossiers });
  const trelon = f.npcs.find((n) => n.name === 'Trelon');
  assert.equal(trelon.veut, 'la cargaison');
  assert.equal(trelon.levier, 'sa sœur');
  assert.equal(trelon.hasDossier, true);
  assert.equal(trelon.revealed, false);
  const docks = f.npcs.find((n) => n.name === 'Les Docks');
  assert.equal(docks.hasDossier, false, 'aucun dossier → l’UI le dit au lieu d’inventer');
});

test('buildForget : entrées vides ou acte inconnu → structure vide, jamais d’erreur', () => {
  assert.doesNotThrow(() => buildForget());
  const f = buildForget({ actId: 'inconnu', beatId: 'x', catalog, sessions: null, dossiers: null });
  assert.deepEqual([f.act, f.beat], [null, null]);
  assert.deepEqual([f.secrets, f.npcs], [[], []]);
  assert.ok(f.threads.length, 'les fils des autres actes restent listés');
});

/* ---------------------------------------------------------------- étanchéité */
test('étanchéité : trigger et actions jouées ne sortent JAMAIS des vues joueur', () => {
  const SECRET = 'SPOILER-DE-DECLENCHEUR';
  const actEntry = {
    _id: ID('ACT1'), name: 'Acte 1', ownership: { default: 2 },
    flags: { holocron: { storyboard: { beats: [{
      id: 'beat-1', kind: 'combat', title: SECRET,
      trigger: { scene: SECRET, playlist: SECRET, encounterId: 'enc-1', handout: { type: 'chat', text: SECRET } },
    }] } } },
  };
  const boardEntry = {
    _id: ID('BOARD'), name: '🗺️ Carte de campagne (Holocron)', ownership: { default: 0 },
    flags: { holocron: { sessions: [{ id: 'sess-a', acted: [{ action: 'scene', label: SECRET, ok: true }] }] } },
  };
  const entries = [actEntry, boardEntry];
  const store = {
    get: (n) => (n === 'journalsIndex' ? entries : n === 'folders' ? [] : entries.find((e) => `journal:${e._id}` === n) || null),
    version: () => 1,
  };
  const config = () => ({ meta: {}, categories: [{ kind: 'story', folder: 'Actes' }], packs: {},
    journals: { board: '🗺️ Carte de campagne (Holocron)' } });
  const svc = createContentService({ store, config });
  for (const session of [null, { userId: ID('U1'), role: 1 }, { userId: ID('GM'), role: 4 }]) {
    for (const view of ['journalsView', 'pcsView', 'timelineView', 'questsPlayerView']) {
      const json = JSON.stringify(svc[view](session) ?? {});
      assert.ok(!json.includes(SECRET), `${view} ne doit rien laisser filtrer`);
      assert.ok(!json.includes('"trigger"'), `${view} ne doit pas exposer la structure des déclencheurs`);
      assert.ok(!json.includes('"acted"'), `${view} ne doit pas exposer les actions jouées`);
    }
  }
  // le trigger survit bien, lui, du côté MJ (sinon le test ne prouverait rien)
  assert.equal(sanitizeSession(boardEntry.flags.holocron.sessions[0]).acted[0].label, SECRET);
  assert.equal(sanitizeStoryboard(actEntry.flags.holocron.storyboard).beats[0].trigger.scene, SECRET);
});
