// Génération du registre des personnages. Sans lui, `config.registry` reste vide
// et les backrefs « Mentionné dans » (writer.backrefs) n'affichent RIEN — deux
// fonctionnalités codées mais muettes en production.
//
// Deux exigences : les formes déduites ne doivent pas produire de faux positifs
// dans 33 000 mots de bible (d'où les mots courts et les titres écartés), et la
// fusion ne doit JAMAIS effacer ce que le MJ a écrit à la main.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { nameForms, buildRegistry, sanitizeEntry } from '../lib/transform/registry.mjs';
import * as moduleSide from '../../module-foundry/scripts/registry-build.mjs';

test('nameForms : nom complet + mots portants, la forme longue en tête', () => {
  assert.deepEqual(nameForms('Kael Ordo'), ['Kael Ordo', 'Kael', 'Ordo']);
  assert.deepEqual(nameForms('Hera'), ['Hera']);
});

test('nameForms : qualificatif entre parenthèses et alias retirés du nom de base', () => {
  assert.deepEqual(nameForms('Kael Ordo (contrebandier)'), ['Kael Ordo (contrebandier)', 'Kael Ordo', 'Kael', 'Ordo']);
  assert.deepEqual(nameForms('Zeb Orrelios, dit le Fauve'),
    ['Zeb Orrelios, dit le Fauve', 'Zeb Orrelios', 'Orrelios']); // « Zeb » : 3 lettres, écarté
});

test('nameForms : mots courts et titres écartés (sinon la moitié de la bible matche)', () => {
  assert.deepEqual(nameForms('Dr Vex Tarnis'), ['Dr Vex Tarnis', 'Tarnis']); // « Dr », « Vex » écartés
  assert.deepEqual(nameForms('Moff Kalast'), ['Moff Kalast', 'Kalast']);
  assert.deepEqual(nameForms('Le Rat des Docks'), ['Le Rat des Docks', 'Docks']);
});

test('nameForms : ni doublon, ni forme vide, comparaison insensible aux accents', () => {
  assert.deepEqual(nameForms('Uchebe Uchebé'), ['Uchebe Uchebé', 'Uchebe']);
  assert.deepEqual(nameForms(''), []);
  assert.deepEqual(nameForms(null), []);
});

const pcs = [{ _id: 'pc00000000000001', name: 'Kael Ordo' }];
const npcs = [
  { _id: 'np00000000000001', name: 'Moff Kalast' },
  { _id: 'np00000000000002', name: 'Hera' },
];

test('buildRegistry : une entrée par PJ et par PNJ, marquée « auto »', () => {
  const out = buildRegistry({ pcs, npcs, existing: [] });
  assert.equal(out.added, 3);
  assert.equal(out.kept, 0);
  assert.deepEqual(out.registry.map((e) => e.kind), ['pc', 'npc', 'npc']);
  assert.ok(out.registry.every((e) => e.auto === true));
  assert.deepEqual(out.registry[0], { kind: 'pc', id: 'pc00000000000001', forms: ['Kael Ordo', 'Kael', 'Ordo'], auto: true });
});

test('buildRegistry : NON DESTRUCTIF — les formes manuelles survivent et sont complétées', () => {
  const existing = [{ kind: 'npc', id: 'np00000000000001', forms: ['le Moff', 'Kalasst'] }];
  const out = buildRegistry({ pcs: [], npcs, existing });
  const kalast = out.registry.find((e) => e.id === 'np00000000000001');
  assert.deepEqual(kalast.forms, ['le Moff', 'Kalasst', 'Moff Kalast', 'Kalast']);
  assert.equal(kalast.auto, undefined); // entrée manuelle : elle le reste
  assert.equal(out.kept, 1);
  assert.equal(out.enriched, 1);
  assert.equal(out.added, 1); // seule « Hera » est nouvelle
});

test('buildRegistry : une entrée dont l’entité a disparu de Foundry est CONSERVÉE', () => {
  const existing = [{ kind: 'npc', id: 'disparu000000001', forms: ['Fantôme'] }];
  const out = buildRegistry({ pcs: [], npcs: [], existing });
  assert.deepEqual(out.registry, existing.map((e) => ({ ...e })));
});

test('buildRegistry : idempotent — deux passes donnent le même registre', () => {
  const first = buildRegistry({ pcs, npcs, existing: [] });
  const second = buildRegistry({ pcs, npcs, existing: first.registry });
  assert.deepEqual(second.registry, first.registry);
  assert.equal(second.added, 0);
  assert.equal(second.enriched, 0);
});

test('sanitizeEntry : rejette ce qui n’a ni id ni forme, borne le reste', () => {
  assert.equal(sanitizeEntry({ forms: ['x'] }), null);
  assert.equal(sanitizeEntry({ id: 'a', forms: [] }), null);
  assert.equal(sanitizeEntry(null), null);
  assert.equal(sanitizeEntry({ id: 'a', kind: 'inconnu', forms: ['X', 'X'] }).kind, 'npc');
  assert.deepEqual(sanitizeEntry({ id: 'a', forms: ['X', 'X'] }).forms, ['X']);
});

// --- parité serveur ↔ module Foundry -----------------------------------------
// Le module Foundry embarque une COPIE de cette logique (l'image Docker du
// service ne contient pas module-foundry, et le module ne peut pas importer le
// serveur). Ce test est le garde-fou de la duplication.
test('parité : le module Foundry et le serveur produisent EXACTEMENT le même registre', () => {
  const noms = ['Kael Ordo', 'Dr Vex Tarnis', 'Zeb Orrelios, dit le Fauve', 'Hera',
    'Moff Kalast', 'Le Rat des Docks', 'Uchebe Uchebé', ''];
  for (const n of noms) assert.deepEqual(moduleSide.nameForms(n), nameForms(n), `formes de « ${n} »`);
  const existing = [{ kind: 'npc', id: 'np00000000000001', forms: ['le Moff'] }];
  assert.deepEqual(
    moduleSide.buildRegistry({ pcs, npcs, existing }),
    buildRegistry({ pcs, npcs, existing }),
  );
});
