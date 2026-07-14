// Tests unitaires du transform (node --test)
import { test } from 'node:test';
import assert from 'node:assert';
import { transformCharacter, transformAdversary, transformVehicle } from '../lib/transform/actors.mjs';
import { parseDateBBY, buildTimelineView } from '../lib/transform/journals.mjs';

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

test('transformVehicle tolère une fiche vide', () => {
  const out = transformVehicle({ _id: 'v', name: 'Cargo', type: 'vehicle' });
  assert.equal(out.name, 'Cargo');
  assert.equal(out.silhouette, 0);
  assert.deepEqual(out.weapons, []);
  assert.deepEqual(out.defence, { fore: 0, aft: 0, port: 0, starboard: 0 });
});

test('transformVehicle lit les stats starwarsffg', () => {
  const out = transformVehicle({
    _id: 'v', name: 'YT-1300', type: 'vehicle',
    system: {
      spaceShip: true,
      stats: {
        silhouette: { value: 4 }, speed: { value: 3, max: 5 }, handling: { value: -1 },
        armour: { value: 3, adjusted: 4 },
        hullTrauma: { value: 2, max: 22 }, systemStrain: { value: 0, max: 14 },
        shields: { fore: 1, port: 1, starboard: 1, aft: 0 },
        sensorRange: { value: 'Short' }, passengerCapacity: { value: 6 },
        consumables: { value: 2, duration: '2 mois' }, hyperdrive: { value: 0.5 },
        customizationHardPoints: { value: 5 }, navicomputer: { value: true },
      },
    },
    items: [
      { type: 'shipweapon', name: 'Tourelle laser', system: {
        damage: { value: 6 }, crit: { value: 3 }, range: { value: 'Close' },
        firingarc: { fore: true, aft: true, port: false, starboard: false, dorsal: true, ventral: false },
      } },
      { type: 'shipattachment', name: 'Compartiments cachés', system: { hardpoints: { value: 1 }, description: 'Cachettes.' } },
    ],
  });
  assert.equal(out.silhouette, 4);
  assert.equal(out.armour, 4); // adjusted prime quand il est plus haut
  assert.equal(out.hullTrauma.max, 22);
  assert.deepEqual(out.defence, { fore: 1, aft: 0, port: 1, starboard: 1 });
  assert.equal(out.hyperdrive, 0.5);
  assert.equal(out.navicomputer, true);
  assert.equal(out.weapons[0].damage, 6);
  assert.deepEqual(out.weapons[0].firingArc, ['fore', 'aft', 'dorsal']);
  assert.equal(out.attachments[0].hardpoints, 1);
});

test('parseDateBBY interprète les dates galactiques', () => {
  assert.equal(parseDateBBY('19 BBY'), -19);
  assert.equal(parseDateBBY('4 ABY'), 4);
  assert.equal(parseDateBBY('0'), 0);
  assert.equal(parseDateBBY('0 BBY/ABY'), -0);
  assert.equal(parseDateBBY('3,5 aby'), 3.5);
  assert.equal(parseDateBBY('inconnue'), null);
  assert.equal(parseDateBBY(''), null);
  assert.equal(parseDateBBY(null), null);
});

test('buildTimelineView trie canon + campagne, non-datés en fin', () => {
  const mejEvent = (date, extra = {}) => ({
    'monks-enhanced-journal': { type: 'event', attributes: date ? { date } : {}, relationships: {}, ...extra },
  });
  const page = (flags, content = '<p>Texte.</p>') => ({ _id: 'p1', type: 'text', text: { content }, flags });
  const out = buildTimelineView({
    config: { categories: [{ folder: '📅 Événements', kind: 'timeline' }] },
    folders: [{ _id: 'F1', type: 'JournalEntry', name: '📅 Événements' }],
    journalsIndex: [
      { _id: 'j1', folder: 'F1', flags: {} },
      { _id: 'j2', folder: 'F1', flags: {} },
      { _id: 'j3', folder: 'AUTRE', flags: {} }, // hors catégorie timeline : ignoré
    ],
    getJournal: (id) => ({
      j1: { _id: 'j1', name: 'Sans date', pages: [page(mejEvent(null))] },
      j2: { _id: 'j2', name: 'Chute de la base', pages: [page(mejEvent('2 ABY'))] },
      j3: { _id: 'j3', name: 'Ignoré', pages: [page(mejEvent('1 ABY'))] },
    })[id],
    eventsPack: [
      { _id: 'c1', name: '0 BBY — Yavin', pages: [page(mejEvent('0 BBY'))] },
      { _id: 'c2', name: '19 BBY — Empire', pages: [page(mejEvent('19 BBY'))] },
      { _id: 'c3', name: 'Pas un event', pages: [page({ 'monks-enhanced-journal': { type: 'place' } })] },
    ],
    visibleFilter: null,
    gm: false,
  });
  assert.deepEqual(out.events.map((e) => e.name), ['19 BBY — Empire', '0 BBY — Yavin', 'Chute de la base', 'Sans date']);
  assert.deepEqual(out.events.map((e) => e.source), ['canon', 'canon', 'campagne', 'campagne']);
  assert.equal(out.events[0].dateValue, -19);
  assert.ok(out.events[0].html, 'les événements canon embarquent leur HTML');
  assert.equal(out.events[2].html, undefined, 'les événements campagne restent navigables (pas de HTML embarqué)');
});
