// Tests unitaires du transform (node --test)
import { test } from 'node:test';
import assert from 'node:assert';
import { transformCharacter, transformAdversary } from '../lib/transform/actors.mjs';

test('transformCharacter tolère une fiche vide', () => {
  const out = transformCharacter({ _id: 'x', name: 'Test', type: 'character' });
  assert.equal(out.name, 'Test');
  assert.equal(out.characteristics.Brawn, 0);
  assert.deepEqual(out.weapons, []);
});

test('transformCharacter lit le schéma v2 (values imbriquées)', () => {
  const out = transformCharacter({
    _id: 'x', name: 'T', type: 'character',
    system: {
      characteristics: { Brawn: { value: 3 } },
      stats: { wounds: { value: 2, max: 12 }, credits: { value: 500 } },
      species: { value: 'Twi\'lek' },
      skills: { Gunnery: { rank: 2, characteristic: 'Agility' } },
    },
    items: [{ type: 'weapon', name: 'Blaster', system: { damage: { value: 6 }, crit: { value: 3 } } }],
  });
  assert.equal(out.characteristics.Brawn, 3);
  assert.equal(out.stats.wounds.max, 12);
  assert.equal(out.stats.credits, 500);
  assert.equal(out.species, "Twi'lek");
  assert.equal(out.skills.find((s) => s.en === 'Gunnery').name, 'Artillerie');
  assert.equal(out.weapons[0].damage, 6);
});

test('transformAdversary produit la forme attendue', () => {
  const out = transformAdversary({ _id: 'a', name: 'Trooper', type: 'minion', system: {}, items: [] }, 'world.pack');
  assert.equal(out.source, 'world.pack');
  assert.ok(Array.isArray(out.weapons));
});
