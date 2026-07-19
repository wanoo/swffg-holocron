// Dossiers MJ (`flags.holocron.dossiers`) : la couche narrative par entité.
// Le flag est éditable dans Foundry ET par un assistant MCP — l'app ne doit donc
// écrire QUE ce que son formulaire porte, et jamais effacer le reste.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { sanitizeDossier, DOSSIER_FIELDS } from '../lib/write.mjs';

test('patch PARTIEL : les champs absents du patch ne bougent pas', () => {
  const base = { role: 'Contrebandier', veut: 'Sa liberté', replique: '« Rien de personnel. »' };
  const out = sanitizeDossier({ veut: 'De l’argent' }, base);
  assert.deepEqual(out, { role: 'Contrebandier', veut: 'De l’argent', replique: '« Rien de personnel. »' });
});

test('un champ envoyé VIDE est retiré (c’est le geste « effacer » de l’UI)', () => {
  const out = sanitizeDossier({ replique: '   ' }, { role: 'Contact', replique: 'x' });
  assert.deepEqual(out, { role: 'Contact' });
});

test('les clés inconnues sont ignorées (le flag reste au gabarit)', () => {
  const out = sanitizeDossier({ role: 'Contact', spoiler: 'à ne pas stocker' }, {});
  assert.deepEqual(out, { role: 'Contact' });
});

test('chaque champ est borné à sa taille de gabarit', () => {
  const out = sanitizeDossier(Object.fromEntries(Object.keys(DOSSIER_FIELDS).map((k) => [k, 'x'.repeat(4000)])), {});
  for (const [k, max] of Object.entries(DOSSIER_FIELDS)) assert.equal(out[k].length, max, k);
});

test('patch vide ou absurde : le dossier existant est rendu tel quel', () => {
  const base = { role: 'Contact' };
  assert.deepEqual(sanitizeDossier({}, base), base);
  assert.deepEqual(sanitizeDossier(null, base), base);
  assert.deepEqual(sanitizeDossier('nope', base), base);
  assert.deepEqual(sanitizeDossier({ role: 'X' }, null), { role: 'X' });
});

test('les sauts de ligne Windows sont normalisés (copier-coller depuis un doc)', () => {
  assert.equal(sanitizeDossier({ indices: 'a\r\nb' }, {}).indices, 'a\nb');
});

test('le gabarit couvre bien ce que la fiche affiche', () => {
  for (const f of ['role', 'statut', 'veut', 'levier', 'indices', 'attitude', 'replique', 'advId']) {
    assert.ok(f in DOSSIER_FIELDS, `champ ${f} manquant`);
  }
});
