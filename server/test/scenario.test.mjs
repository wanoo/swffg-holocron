// Saisie rapide d'un scénario : découpage d'un texte collé en beats proposés.
// Deux exigences non négociables : on ne perd JAMAIS de texte, et le type deviné
// reste un DEVIS (le MJ retouche) — d'où des tests sur les cas typiques, pas sur
// des subtilités de langue.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseScenarioToBeats, guessKind } from '../lib/transform/scenario.mjs';

test('guessKind : combat / handout / note MJ / repli scène', () => {
  assert.equal(guessKind('Embuscade dans le hangar'), 'combat');
  assert.equal(guessKind('Attaque des pillards'), 'combat');
  assert.equal(guessKind('À lire à voix haute'), 'handout');
  assert.equal(guessKind('Handout : le contrat'), 'handout');
  assert.equal(guessKind('Note MJ — ne pas oublier'), 'note');
  assert.equal(guessKind('Rappel'), 'note');
  assert.equal(guessKind('La cantina de Mos Eisley'), 'scene');
});

test('guessKind : le TITRE prime sur la note (c’est lui que le MJ a écrit exprès)', () => {
  assert.equal(guessKind('Rappel', 'un combat éclate peut-être ici'), 'note');
  assert.equal(guessKind('La cantina', 'une embuscade attend les PJ'), 'combat');
});

test('titres markdown : un beat par titre, les paragraphes suivants en note', () => {
  const { beats } = parseScenarioToBeats([
    '# Arrivée sur Ryloth',
    'Les PJ sortent de l’hyperespace.',
    'Le spatioport est bouclé.',
    '',
    '## Embuscade au hangar 12',
    'Quatre pillards ouvrent le feu.',
  ].join('\n'));
  assert.equal(beats.length, 2);
  assert.deepEqual(beats.map((b) => b.title), ['Arrivée sur Ryloth', 'Embuscade au hangar 12']);
  assert.deepEqual(beats.map((b) => b.kind), ['scene', 'combat']);
  assert.match(beats[0].note, /hyperespace/);
  assert.match(beats[0].note, /spatioport/);
  assert.match(beats[1].note, /pillards/);
});

test('lignes en MAJUSCULES et titres soulignés valent aussi des titres', () => {
  const { beats } = parseScenarioToBeats([
    'LE MARCHÉ NOIR',
    'Un contact attend les PJ.',
    '',
    'Le repaire',
    '=========',
    'Une porte blindée.',
  ].join('\n'));
  assert.deepEqual(beats.map((b) => b.title), ['LE MARCHÉ NOIR', 'Le repaire']);
});

test('« Scène 3 : … » est un titre, pas un paragraphe', () => {
  const { beats } = parseScenarioToBeats('Scène 3 : Le duel\nDark Vador surgit.');
  assert.equal(beats.length, 1);
  assert.equal(beats[0].title, 'Scène 3 : Le duel');
  assert.equal(beats[0].kind, 'combat'); // « duel »
});

test('paragraphes sans titre : un beat par paragraphe, titré par sa 1re phrase', () => {
  const { beats } = parseScenarioToBeats(
    'Les PJ atterrissent de nuit. La pluie tombe.\n\nUn droïde les attend au bout de la piste.',
  );
  assert.equal(beats.length, 2);
  assert.equal(beats[0].title, 'Les PJ atterrissent de nuit');
  assert.match(beats[1].title, /^Un droïde les attend/);
  assert.match(beats[0].note, /pluie/); // le texte complet reste dans la note
});

test('aucune perte de texte : chaque paragraphe se retrouve dans une note', () => {
  const src = '# Acte\nAlpha.\n\nBeta.\n\n# Suite\nGamma.';
  const { beats } = parseScenarioToBeats(src);
  const all = beats.map((b) => b.note).join('\n');
  for (const w of ['Alpha', 'Beta', 'Gamma']) assert.match(all, new RegExp(w));
});

test('les puces sont du CONTENU, jamais des titres', () => {
  const { beats } = parseScenarioToBeats('# Indices\n- une carte mémoire\n- un badge impérial');
  assert.equal(beats.length, 1);
  assert.match(beats[0].note, /carte mémoire/);
  assert.match(beats[0].note, /badge impérial/);
});

test('texte vide → aucun beat (état vide franc, pas un beat fantôme)', () => {
  assert.deepEqual(parseScenarioToBeats('').beats, []);
  assert.deepEqual(parseScenarioToBeats('   \n\n  ').beats, []);
  assert.deepEqual(parseScenarioToBeats(null).beats, []);
});

test('bornes : titre 120, note 2000, 60 beats au plus (mêmes bornes que sanitizeStoryboard)', () => {
  const long = parseScenarioToBeats('x'.repeat(300) + '\n\n' + 'y'.repeat(5000));
  assert.ok(long.beats[0].title.length <= 120);
  assert.ok(long.beats.every((b) => b.note.length <= 2000));
  const many = parseScenarioToBeats(Array.from({ length: 90 }, (_, i) => `# Titre ${i}\ncorps`).join('\n'));
  assert.equal(many.beats.length, 60);
});

test('CRLF (copier-coller Windows) traité comme des sauts de ligne simples', () => {
  const { beats } = parseScenarioToBeats('# Titre\r\nUne ligne.\r\n\r\n# Autre\r\nSuite.');
  assert.deepEqual(beats.map((b) => b.title), ['Titre', 'Autre']);
});
