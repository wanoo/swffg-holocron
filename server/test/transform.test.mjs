// Tests unitaires du transform (node --test)
import { test } from 'node:test';
import assert from 'node:assert';
import { transformCharacter, transformAdversary, transformVehicle } from '../lib/transform/actors.mjs';
import { parseDateBBY, buildTimelineView, buildJournalsView } from '../lib/transform/journals.mjs';

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

test('buildTimelineView : tri par date, position Canon/Campagne, dossier par uuid', () => {
  const page = (attrs) => ({ _id: 'p1', type: 'text', text: { content: '<p>Texte.</p>' },
    flags: { 'monks-enhanced-journal': { type: 'event', attributes: attrs, relationships: {} } } });
  const doc = (id, name, attrs) => ({ _id: id, name, pages: [page(attrs)] });
  const out = buildTimelineView({
    config: { categories: [{ folder: 'Folder.F1', kind: 'timeline' }] }, // uuid, pas le nom
    folders: [{ _id: 'F1', type: 'JournalEntry', name: '📅 Événements' }],
    journalsIndex: [
      { _id: 'j1', folder: 'F1', flags: {} },
      { _id: 'j2', folder: 'F1', flags: {} },
      { _id: 'j3', folder: 'F1', flags: {} },
      { _id: 'j4', folder: 'AUTRE', flags: {} }, // hors catégorie timeline : ignoré
    ],
    getJournal: (id) => ({
      // j1 : convention NATIVE de la fiche event MEJ (date + location=Canon, lieu en attribut)
      j1: { _id: 'j1', name: 'Empire', pages: [{ _id: 'p1', type: 'text', text: { content: '<p>Texte.</p>' },
        flags: { 'monks-enhanced-journal': { type: 'event', date: '19 BBY', location: 'Canon', attributes: { lieu: 'Coruscant' }, relationships: {} } } }] },
      // j2 : ancienne convention par attributs (repli toléré)
      j2: doc('j2', 'Chute de la base', { date: '2 ABY', position: 'Campagne' }),
      j3: doc('j3', 'Sans date', {}),
      j4: doc('j4', 'Ignoré', { date: '1 ABY' }),
    })[id],
    visibleFilter: null,
    gm: false,
  });
  assert.deepEqual(out.events.map((e) => e.name), ['Empire', 'Chute de la base', 'Sans date']);
  assert.deepEqual(out.events.map((e) => e.source), ['canon', 'campagne', 'campagne'], 'Position → source, défaut campagne');
  assert.equal(out.events[0].dateValue, -19);
  assert.equal(out.events[0].location, 'Coruscant', "le lieu réel vient de l'attribut lieu");
});

test('buildJournalsView : catégorie DOSSIER kind rules — préfixe retiré, pack ignoré', () => {
  const doc = (id, name) => ({ _id: id, name, pages: [{ _id: 'p' + id, type: 'text', text: { content: '<p>.</p>' } }] });
  const out = buildJournalsView({
    config: { categories: [{ folder: 'Folder.FR', kind: 'rules', label: 'Règles du jeu' }], packs: {} },
    folders: [{ _id: 'FR', type: 'JournalEntry', name: '📖 Règles & Références (FR)' }],
    journalsIndex: [
      { _id: 'r2', folder: 'FR', sort: 1, flags: {} }, // sort Foundry inversé exprès
      { _id: 'r1', folder: 'FR', sort: 2, flags: {} },
    ],
    getJournal: (id) => ({ r1: doc('r1', '01 Mécanique de base'), r2: doc('r2', '02 Compétences') })[id],
    rulesPack: [doc('pk', '01 · Doublon du pack')], // doit être IGNORÉ (catégorie rules déclarée)
    visibleFilter: null,
    gm: false,
  });
  assert.equal(out.categories.length, 1, 'pas de catégorie __rules__ en plus du dossier');
  assert.deepEqual(out.journals.map((j) => j.name), ['Mécanique de base', 'Compétences'], 'préfixe « NN » retiré, tri alphanumérique');
});
