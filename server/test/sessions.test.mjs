// Tests de LA TRACE (flags.holocron.sessions) : assainissement d'une séance et
// de la collection, ajout ATOMIQUE d'une entrée (played/reveal/shown) et
// ÉTANCHÉITÉ — aucune donnée de séance ne doit fuiter par /api/content/*.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { sanitizeSession, sanitizeSessions, appendEvent, SESSION_EVENTS } from '../lib/board.mjs';
import { createContentService } from '../lib/content.mjs';

const ID = (n) => n.padEnd(16, '0').slice(0, 16);

/* ------------------------------------------------------------- assainissement */
test('sanitizeSession : défauts complets sur une entrée vide (ne jette jamais)', () => {
  const s = sanitizeSession(null);
  assert.match(s.id, /^sess-/);
  assert.equal(s.no, 1);
  assert.deepEqual([s.played, s.reveals, s.shown, s.present], [[], [], [], []]);
  assert.deepEqual(s.recap, { gm: '', players: '' });
  assert.equal(s.startedAt, 0);
  assert.equal(s.endedAt, 0);
  assert.doesNotThrow(() => sanitizeSession('__proto__'));
});

test('sanitizeSession : bornes strictes (no, titre, date, récaps)', () => {
  const s = sanitizeSession({
    id: 'sess-abc12345', no: 99999.7, title: 't'.repeat(300), date: 'd'.repeat(90),
    recap: { gm: 'g'.repeat(9000), players: 'p'.repeat(9000) },
  });
  assert.equal(s.id, 'sess-abc12345');
  assert.equal(s.no, 9999);
  assert.equal(s.title.length, 120);
  assert.equal(s.date.length, 40);
  assert.equal(s.recap.gm.length, 8000);
  assert.equal(s.recap.players.length, 8000);
  assert.equal(sanitizeSession({ no: 'niet' }).no, 1);
});

test('sanitizeSession : horodatages ISO ou epoch ms → epoch ms, absurdes rejetés', () => {
  const iso = sanitizeSession({ startedAt: '2026-07-18T20:00:00.000Z', endedAt: 1_760_000_000_000 });
  assert.equal(iso.startedAt, Date.parse('2026-07-18T20:00:00.000Z'));
  assert.equal(iso.endedAt, 1_760_000_000_000);
  assert.equal(sanitizeSession({ startedAt: 'jamais' }).startedAt, 0);
  assert.equal(sanitizeSession({ startedAt: -5 }).startedAt, 0);
  assert.equal(sanitizeSession({ startedAt: 9e15 }).startedAt, 4102444800000, 'borne 2100');
});

test('sanitizeSession : played — beatId requis, kind en table fermée, actId id Foundry', () => {
  const s = sanitizeSession({ played: [
    { actId: ID('ACT1'), beatId: 'beat-abc', title: ' L’abordage ' + 'x'.repeat(200), kind: 'combat', at: 1_700_000_000_000 },
    { beatId: 'beat-def', kind: 'hack', actId: 'pas-un-id' },
    { title: 'sans beat' },   // retiré : rien à référencer
    'pas un objet',
  ] });
  assert.equal(s.played.length, 2);
  assert.equal(s.played[0].actId, ID('ACT1'));
  assert.equal(s.played[0].kind, 'combat');
  assert.equal(s.played[0].title.length, 120);
  assert.equal(s.played[0].at, 1_700_000_000_000);
  assert.equal(s.played[1].kind, 'scene', 'kind inconnu → scène');
  assert.equal(s.played[1].actId, '', 'actId invalide → vide (jamais inventé)');
  assert.ok(s.played[1].at > 0, 'horodatage manquant → maintenant');
});

test('sanitizeSession : reveals — uuid « Type.<id> » ou id nu, note bornée', () => {
  const s = sanitizeSession({ reveals: [
    { uuid: `JournalEntry.${ID('NPC1')}::page`, label: 'Maz', at: 1_700_000_000_000, note: 'n'.repeat(900) },
    { uuid: ID('NPC2') },
    { uuid: `Actor.${ID('ACT9')}` },
    { uuid: 'pas-un-id', label: 'niet' },
    { label: 'sans uuid' },
  ] });
  assert.equal(s.reveals.length, 3);
  assert.equal(s.reveals[0].uuid, `JournalEntry.${ID('NPC1')}`);
  assert.equal(s.reveals[0].note.length, 500);
  assert.equal(s.reveals[1].uuid, `JournalEntry.${ID('NPC2')}`, 'id nu → JournalEntry');
  assert.equal(s.reveals[2].uuid, `Actor.${ID('ACT9')}`, 'le type est conservé');
  assert.equal(s.reveals[1].note, undefined, 'note vide non stockée');
});

test('sanitizeSession : shown — type de handout fermé, targets = ids Foundry ≤ 30', () => {
  const s = sanitizeSession({ shown: [
    { type: 'video', title: 'Briefing', targets: [ID('U1'), ID('U1'), 'niet', 42] },
    { type: 'hack', title: 'défaut' },
  ] });
  assert.deepEqual(s.shown[0].targets, [ID('U1')]);
  assert.equal(s.shown[1].type, 'image');
  assert.equal(s.shown[1].targets, undefined, 'sans cible = toute la table');
});

test('sanitizeSession : present = ids Foundry dédupliqués, listes bornées à 400', () => {
  const s = sanitizeSession({
    present: [ID('U1'), ID('U1'), 'pas-un-id'],
    played: Array.from({ length: 500 }, (_, i) => ({ beatId: `beat-${i}` })),
  });
  assert.deepEqual(s.present, [ID('U1')]);
  assert.equal(s.played.length, 400);
});

test('sanitizeSessions : ≤ 200 séances, ids dupliqués retirés, formes tolérées', () => {
  const many = Array.from({ length: 250 }, (_, i) => ({ id: `sess-${i}`, no: i + 1 }));
  assert.equal(sanitizeSessions(many).length, 200);
  const dup = sanitizeSessions([{ id: 'sess-a', title: 'premier' }, { id: 'sess-a', title: 'doublon' }]);
  assert.equal(dup.length, 1);
  assert.equal(dup[0].title, 'premier');
  assert.deepEqual(sanitizeSessions(null), []);
  assert.deepEqual(sanitizeSessions({ sessions: 'niet' }), []);
  assert.equal(sanitizeSessions({ sessions: [{ id: 'sess-a' }] }).length, 1, 'objet enveloppe accepté');
});

test('sanitizeSessions : idempotent (re-assainir ne change plus rien)', () => {
  const once = sanitizeSessions([{ id: 'sess-a', no: 3, startedAt: 1_700_000_000_000,
    played: [{ beatId: 'beat-1', at: 1_700_000_000_001 }] }]);
  assert.deepEqual(sanitizeSessions(once), once);
});

/* ------------------------------------------------------------- ajout atomique */
test('appendEvent : ajoute UNE entrée dans la bonne liste sans toucher au reste', () => {
  const base = sanitizeSessions([{ id: 'sess-a', no: 1 }, { id: 'sess-b', no: 2 }]);
  const played = appendEvent(base, 'sess-b', { kind: 'played', beatId: 'beat-1', title: 'Ouverture', kind2: 'x' });
  assert.equal(played[1].played.length, 1);
  assert.equal(played[1].played[0].title, 'Ouverture');
  assert.deepEqual(played[0], base[0], 'les autres séances ne bougent pas');
  assert.equal(base[1].played.length, 0, 'entrée d’origine non mutée');

  const rev = appendEvent(played, 'sess-b', { kind: 'reveal', uuid: ID('NPC1'), label: 'Maz' });
  assert.equal(rev[1].reveals.length, 1);
  assert.equal(rev[1].played.length, 1, 'l’ajout précédent survit');

  const shown = appendEvent(rev, 'sess-b', { kind: 'shown', type: 'image', title: 'Contrat' });
  assert.equal(shown[1].shown[0].title, 'Contrat');
  // ENVELOPPE EXPLICITE : indispensable pour `played`, dont l'entrée porte son
  // propre `kind` (celui du BEAT) — à plat il écrasait le type d'événement.
  const env = appendEvent(base, 'sess-a', { kind: 'played', entry: { beatId: 'beat-9', title: 'Duel', kind: 'combat' } });
  assert.equal(env[0].played[0].kind, 'combat', 'le kind du beat est préservé');
  assert.equal(env[0].played[0].title, 'Duel');
  assert.equal(appendEvent(base, 'sess-a', { kind: 'played', beatId: 'b', kind2: 'combat' })[0].played.length, 1, 'forme plate encore lue');
  assert.deepEqual(Object.keys(SESSION_EVENTS).sort(), ['acted', 'played', 'reveal', 'shown']);
});

test('appendEvent : séance inconnue, kind inconnu ou entrée vide → null (rien n’est écrit)', () => {
  const base = sanitizeSessions([{ id: 'sess-a' }]);
  assert.equal(appendEvent(base, 'sess-zz', { kind: 'played', beatId: 'b1' }), null);
  assert.equal(appendEvent(base, 'sess-a', { kind: 'hack', beatId: 'b1' }), null);
  assert.equal(appendEvent(base, 'sess-a', { kind: 'played' }), null, 'played sans beatId');
  assert.equal(appendEvent(base, 'sess-a', { kind: 'reveal', uuid: 'niet' }), null);
  assert.equal(appendEvent(base, 'sess-a', {}), null);
});

test('appendEvent : la liste reste bornée (les plus anciennes entrées tombent)', () => {
  const base = sanitizeSessions([{ id: 'sess-a',
    played: Array.from({ length: 400 }, (_, i) => ({ beatId: `beat-${i}`, at: 1_700_000_000_000 + i })) }]);
  const out = appendEvent(base, 'sess-a', { kind: 'played', beatId: 'beat-neuf' });
  assert.equal(out[0].played.length, 400);
  assert.equal(out[0].played.at(-1).beatId, 'beat-neuf');
  assert.equal(out[0].played[0].beatId, 'beat-1', 'la plus ancienne est tombée');
});

/* ---------------------------------------------------------------- étanchéité */
test('étanchéité : la trace ne sort JAMAIS des vues joueur (/api/content/*)', () => {
  const SECRET = 'SPOILER-DE-SEANCE';
  const boardEntry = {
    _id: ID('BOARD'), name: '🗺️ Carte de campagne (Holocron)', ownership: { default: 0 },
    flags: { holocron: { sessions: [{
      id: 'sess-a', no: 12, title: SECRET, startedAt: 1_700_000_000_000, endedAt: 1_700_000_100_000,
      played: [{ actId: ID('ACT1'), beatId: 'beat-1', title: SECRET }],
      reveals: [{ uuid: `JournalEntry.${ID('NPC1')}`, label: SECRET }],
      shown: [{ type: 'image', title: SECRET }],
      recap: { gm: SECRET, players: SECRET },
    }] } },
  };
  const entries = [
    boardEntry,
    { _id: ID('QST1'), name: 'Livrer', ownership: { default: 2 },
      flags: { 'campaign-codex': { type: 'quest', data: { quests: [{}] } } } },
  ];
  const store = {
    get: (name) => (name === 'journalsIndex' ? entries : name === 'folders' ? [] : name === `journal:${ID('BOARD')}` ? boardEntry : null),
    version: () => 1,
  };
  const config = () => ({ meta: {}, categories: [], packs: {}, journals: { board: '🗺️ Carte de campagne (Holocron)' } });
  const svc = createContentService({ store, config });

  const gm = { userId: ID('GM'), role: 4 };
  for (const session of [null, { userId: ID('U1'), role: 1 }, gm]) {
    for (const view of ['journalsView', 'pcsView', 'timelineView', 'questsPlayerView']) {
      const json = JSON.stringify(svc[view](session) ?? {});
      assert.ok(!json.includes(SECRET), `${view} ne doit rien laisser filtrer (session ${session?.role ?? 'anonyme'})`);
      assert.ok(!json.includes('"reveals"'), `${view} ne doit pas exposer la structure de trace`);
    }
  }
  assert.ok(!JSON.stringify(svc.manifest()).includes(SECRET));
});
