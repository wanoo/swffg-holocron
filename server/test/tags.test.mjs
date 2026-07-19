// Lecture unifiée des tags (transform/tags.mjs) : le MJ tague dans la sheet
// Campaign Codex OU dans Asset Librarian — l'app doit voir les deux.
import { test } from 'node:test';
import assert from 'node:assert';
import { normName, asTagList, docTags, docTagsNorm, hasTag, ccType } from '../lib/transform/tags.mjs';

const doc = (flags) => ({ _id: 'J1', name: 'doc', flags });

test('normName : insensible casse/accents/espaces', () => {
  assert.equal(normName('  Kara  SOLNÉE '), 'kara solnee');
  assert.equal(normName('Équipage'), 'equipage');
  assert.equal(normName(null), '');
});

test('asTagList : tolère le tableau (CC) et la chaîne « a, b » (Asset Librarian)', () => {
  assert.deepEqual(asTagList(['X', 'Y']), ['X', 'Y']);
  assert.deepEqual(asTagList(' X , Y '), ['X', 'Y']);
  assert.deepEqual(asTagList(''), []);
  assert.deepEqual(asTagList(null), []);
});

test('docTags : lit CC data.tags, AL filterTag ET categoryTag, holocron.tags', () => {
  assert.deepEqual(docTags(doc({ 'campaign-codex': { data: { tags: ['CC'] } } })), ['CC']);
  assert.deepEqual(docTags(doc({ 'asset-librarian': { filterTag: 'AF' } })), ['AF']);
  // categoryTag est la SECONDE convention Asset Librarian — elle compte aussi
  assert.deepEqual(docTags(doc({ 'asset-librarian': { categoryTag: 'AC' } })), ['AC']);
  assert.deepEqual(docTags(doc({ holocron: { tags: ['H'] } })), ['H']);
  assert.deepEqual(docTags(doc({})), []);
});

test('docTags : les deux côtés cumulés, sans perte (miroir CC ↔ Asset Librarian)', () => {
  const d = doc({
    'campaign-codex': { data: { tags: ['mj:note-joueur', 'Uchebe'] } },
    'asset-librarian': { filterTag: 'mj:note-joueur, Uchebe', categoryTag: 'Notes' },
  });
  assert.deepEqual(docTags(d), ['mj:note-joueur', 'Uchebe', 'mj:note-joueur', 'Uchebe', 'Notes']);
  // normalisé : dédupliqué, comparable
  assert.deepEqual(docTagsNorm(d), ['mj:note-joueur', 'uchebe', 'notes']);
});

test('hasTag : comparaison normalisée, quelle que soit la convention d’écriture', () => {
  const d = doc({ 'asset-librarian': { filterTag: 'MJ:Note-Joueur' } });
  assert.equal(hasTag(d, 'mj:note-joueur'), true);
  assert.equal(hasTag(d, 'MJ:NOTE-JOUEUR'), true);
  assert.equal(hasTag(d, 'autre'), false);
  assert.equal(hasTag(d, ''), false);
});

test('ccType : type de fiche Campaign Codex, chaîne vide si ce n’est pas une fiche', () => {
  assert.equal(ccType(doc({ 'campaign-codex': { type: 'npc' } })), 'npc');
  assert.equal(ccType(doc({ 'campaign-codex': { type: 'tag' } })), 'tag');
  assert.equal(ccType(doc({})), '');
  assert.equal(ccType(null), '');
});
