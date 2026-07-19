// Checklist « prêt-à-jouer » DÉRIVÉE d'un acte. Chaque ligne doit désigner un
// manque CONCRET et le geste qui le répare — sinon elle vaut moins que la
// checklist manuelle qu'elle remplace.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { checkAct } from '../lib/transform/act-check.mjs';

const ACT_ID = 'ac00000000000001';
const NPC = 'np00000000000001';
const LIEU = 'lo00000000000001';

const act = (beats) => ({ id: ACT_ID, name: 'Acte 3 — Ryloth', storyboard: { beats } });
const base = { encounters: [{ id: 'enc-1', title: 'Embuscade' }], sequences: [{ id: 'seq-1', name: 'Ouverture' }],
  knownIds: [NPC, LIEU, ACT_ID] };
const codes = (issues) => issues.map((i) => i.code);

test('acte sans beat : un seul message, qui dit quoi faire', () => {
  const issues = checkAct({ ...base, act: act([]) });
  assert.deepEqual(codes(issues), ['act-empty']);
  assert.match(issues[0].fix, /storyboard/);
});

test('beat 🎭 sans lieu ni PNJ attaché', () => {
  const issues = checkAct({ ...base, act: act([
    { id: 'b1', kind: 'scene', title: 'La cantina', uuids: [] },
    { id: 'b2', kind: 'scene', title: 'Le hangar', uuids: [`JournalEntry.${LIEU}`] },
  ]) });
  const hit = issues.filter((i) => i.code === 'beat-no-entity');
  assert.equal(hit.length, 1);
  assert.equal(hit[0].beatId, 'b1');
  assert.match(hit[0].message, /La cantina/);
});

test('beat ⚔️ sans rencontre → ERREUR (le beat ne peut pas se jouer)', () => {
  const issues = checkAct({ ...base, act: act([{ id: 'b1', kind: 'combat', title: 'Embuscade', uuids: [`JournalEntry.${NPC}`] }]) });
  const hit = issues.find((i) => i.code === 'combat-no-encounter');
  assert.equal(hit.severity, 'error');
  assert.equal(hit.beatId, 'b1');
});

test('beat ⚔️ pointant une rencontre supprimée de la bibliothèque', () => {
  const issues = checkAct({ ...base, act: act([
    { id: 'b1', kind: 'combat', title: 'Embuscade', encounterId: 'enc-fantome', uuids: [`JournalEntry.${NPC}`] },
  ]) });
  const hit = issues.find((i) => i.code === 'combat-encounter-missing');
  assert.equal(hit.severity, 'error');
  assert.equal(hit.ref, 'enc-fantome');
});

test('beat ⚔️ correctement lié : aucune alerte de combat', () => {
  const issues = checkAct({ ...base, act: act([
    { id: 'b1', kind: 'combat', title: 'Embuscade', encounterId: 'enc-1', uuids: [`JournalEntry.${NPC}`] },
    { id: 'b2', kind: 'handout', title: 'Le contrat', handout: { type: 'image', src: 'x.webp' } },
  ]) });
  assert.equal(codes(issues).filter((c) => c.startsWith('combat')).length, 0);
});

test('référence morte : entité effacée de Foundry depuis que le beat la cite', () => {
  const issues = checkAct({ ...base, act: act([
    { id: 'b1', kind: 'scene', title: 'La cantina', uuids: [`JournalEntry.${LIEU}`, 'JournalEntry.zzzzzzzzzzzzzzzz'] },
  ]) });
  const hit = issues.find((i) => i.code === 'dead-ref');
  assert.equal(hit.severity, 'error');
  assert.equal(hit.ref, 'zzzzzzzzzzzzzzzz');
  assert.equal(hit.beatId, 'b1');
});

test('séquence supprimée sous les pieds du beat', () => {
  const issues = checkAct({ ...base, act: act([
    { id: 'b1', kind: 'handout', title: 'Ouverture', sequenceId: 'seq-perdue' },
  ]) });
  assert.ok(codes(issues).includes('sequence-missing'));
});

test('handout vide : ni image, ni texte, ni séquence', () => {
  const issues = checkAct({ ...base, act: act([{ id: 'b1', kind: 'handout', title: 'À montrer' }]) });
  assert.ok(codes(issues).includes('handout-empty'));
});

test('acte sans aucun handout : information, pas erreur', () => {
  const issues = checkAct({ ...base, act: act([
    { id: 'b1', kind: 'scene', title: 'La cantina', uuids: [`JournalEntry.${LIEU}`] },
  ]) });
  const hit = issues.find((i) => i.code === 'act-no-handout');
  assert.equal(hit.severity, 'info');
  // un beat porteur d'un handout suffit à lever l'alerte, quel que soit son type
  const avec = checkAct({ ...base, act: act([
    { id: 'b1', kind: 'scene', title: 'La cantina', uuids: [`JournalEntry.${LIEU}`], sequenceId: 'seq-1' },
  ]) });
  assert.equal(avec.find((i) => i.code === 'act-no-handout'), undefined);
});

test('secret semé nulle part — la matière du « ne pas oublier »', () => {
  const secrets = [
    { id: 'se00000000000001', title: 'La vraie identité', state: '' },
    { id: 'se00000000000002', title: 'Déjà révélé', state: 'seme' },
    { id: 'se00000000000003', title: 'Rattaché à un beat', state: '' },
  ];
  const issues = checkAct({
    ...base, secrets, referencedIds: ['se00000000000003'],
    act: act([{ id: 'b1', kind: 'scene', title: 'La cantina', uuids: [`JournalEntry.${LIEU}`] }]),
  });
  const hits = issues.filter((i) => i.code === 'secret-unsown');
  assert.equal(hits.length, 1);
  assert.match(hits[0].message, /La vraie identité/);
});

test('tri : erreurs d’abord, puis avertissements, puis informations', () => {
  const issues = checkAct({ ...base, act: act([
    { id: 'b1', kind: 'combat', title: 'Sans rencontre', uuids: [] },
  ]) });
  const sev = issues.map((i) => i.severity);
  assert.deepEqual(sev, [...sev].sort((a, b) => ({ error: 0, warn: 1, info: 2 }[a] - { error: 0, warn: 1, info: 2 }[b])));
});

test('chaque ligne porte un geste réparateur non vide', () => {
  const issues = checkAct({ ...base, act: act([
    { id: 'b1', kind: 'combat', title: '', uuids: ['JournalEntry.zzzzzzzzzzzzzzzz'] },
    { id: 'b2', kind: 'handout', title: 'Vide' },
  ]) });
  assert.ok(issues.length >= 3);
  for (const i of issues) {
    assert.ok(i.message && i.fix, `ligne ${i.code} incomplète`);
    assert.ok(['error', 'warn', 'info'].includes(i.severity));
  }
  // beat sans titre : la ligne reste lisible (type + rang)
  assert.match(issues.find((i) => i.code === 'combat-no-encounter').message, /combat sans titre/);
});

test('acte inconnu → aucune ligne (l’appelant a déjà rendu 404)', () => {
  assert.deepEqual(checkAct({}), []);
  assert.deepEqual(checkAct({ act: null }), []);
});
