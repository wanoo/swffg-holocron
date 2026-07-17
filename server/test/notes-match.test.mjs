// Tests du rattachement des journaux de notes aux fiches PJ / au vaisseau
// (node --test) : matching pur (transform/notes.mjs) + vues du content service.
import { test } from 'node:test';
import assert from 'node:assert';
import { normName, noteTags, matchNotes } from '../lib/transform/notes.mjs';
import { createContentService } from '../lib/content.mjs';

const entry = (id, { name = id, flags = {}, ownership = {}, folder = 'FN' } = {}) =>
  ({ _id: id, name, flags, ownership, folder });

test('normName : insensible casse/accents/espaces', () => {
  assert.equal(normName('  Kara  SOLNÉE '), 'kara solnee');
  assert.equal(normName('Équipage'), 'equipage');
  assert.equal(normName(null), '');
});

test('noteTags : lit CC data.tags, asset-librarian filterTag (chaîne ou liste) et holocron.tags', () => {
  assert.deepEqual(noteTags(entry('a', { flags: { 'campaign-codex': { data: { tags: ['X', 'Y'] } } } })), ['X', 'Y']);
  assert.deepEqual(noteTags(entry('b', { flags: { 'asset-librarian': { filterTag: ' X , Y ' } } })), ['X', 'Y']);
  assert.deepEqual(noteTags(entry('c', { flags: { holocron: { tags: ['Z'] } } })), ['Z']);
  assert.deepEqual(noteTags(entry('d')), []);
});

test('matchNotes : tag au nom du PJ prioritaire, repli ownership, MJ exclu, groupe', () => {
  const pcs = [
    { _id: 'PC1', name: 'Kara Solnée', ownership: { default: 0, u1: 3 } },
    { _id: 'PC2', name: 'Dex', ownership: { default: 0, u2: 3 } },
  ];
  const users = [
    { _id: 'u1', name: 'Alice', role: 1, character: 'PC1' },
    { _id: 'u2', name: 'Bob', role: 1, character: 'PC2' },
    { _id: 'gm', name: 'MJ', role: 4, character: null },
  ];
  const nTag = entry('nTag', { flags: { 'campaign-codex': { data: { tags: ['KARA SOLNÉE'] } } }, ownership: { default: 2 } });
  const nCrew = entry('nCrew', { flags: { 'asset-librarian': { filterTag: 'Équipage' } }, ownership: { default: 2 } });
  const nShip = entry('nShip', { flags: { holocron: { tags: ['vaisseau'] } }, ownership: { default: 2 } });
  const nOwn = entry('nOwn', { ownership: { default: 0, u1: 3 } }); // sans tag → repli ownership
  const nObs = entry('nObs', { ownership: { default: 0, u1: 2 } }); // OBSERVER ≠ OWNER : pas de repli
  const nGm = entry('nGm', { ownership: { default: 0, gm: 3 } });   // possédé par le MJ : nulle part
  // tag PJ + possédé par u2 : le TAG fait foi, pas de repli vers PC2
  const nPrio = entry('nPrio', { flags: { 'campaign-codex': { data: { tags: ['kara solnee'] } } }, ownership: { default: 0, u2: 3 } });

  const { byPc, group } = matchNotes({ pcs, users, entries: [nTag, nCrew, nShip, nOwn, nObs, nGm, nPrio] });
  assert.deepEqual(byPc.get('PC1').map((e) => e._id), ['nTag', 'nOwn', 'nPrio']);
  assert.deepEqual(byPc.get('PC2').map((e) => e._id), [], 'tag prioritaire : nPrio ne suit pas l’ownership de Bob');
  assert.deepEqual(group.map((e) => e._id), ['nCrew', 'nShip'], 'équipage/vaisseau (accents/casse tolérés)');
});

test('matchNotes : joueur ↔ PJ aussi via user.character (sans OWNER sur l’actor)', () => {
  const pcs = [{ _id: 'PC1', name: 'Rey', ownership: { default: 0 } }];
  const users = [{ _id: 'u1', name: 'Alice', role: 1, character: 'PC1' }];
  const nOwn = entry('nOwn', { ownership: { default: 0, u1: 3 } });
  const { byPc } = matchNotes({ pcs, users, entries: [nOwn] });
  assert.deepEqual(byPc.get('PC1').map((e) => e._id), ['nOwn']);
});

/* --- vues du content service (stub de SyncStore) ------------------------------ */
function makeService() {
  const data = {
    config: {
      pcFolder: '👥 Personnages joueurs',
      categories: [{ folder: '📓 Notes des joueurs', kind: 'notes', editable: true }],
      packs: {}, journals: {}, meta: {},
    },
    folders: [
      { _id: 'FPC', type: 'Actor', name: '👥 Personnages joueurs' },
      { _id: 'FN', type: 'JournalEntry', name: '📓 Notes des joueurs' },
    ],
    users: [
      { _id: 'u1', name: 'Alice', role: 1, character: 'PC1' },
      { _id: 'gm', name: 'MJ', role: 4, character: null },
    ],
    actors: [
      { _id: 'PC1', name: 'Kara Solnée', type: 'character', folder: 'FPC', ownership: { default: 0, u1: 3 } },
      { _id: 'V1', name: 'Le Rossignol', type: 'vehicle', folder: 'FPC', ownership: { default: 2 } },
    ],
    journalsIndex: [
      entry('nTag', { name: 'Carnet de Kara', flags: { 'campaign-codex': { data: { tags: ['Kara Solnée'] } } }, ownership: { default: 2 } }),
      entry('nCrew', { name: 'Journal de bord', flags: { 'asset-librarian': { filterTag: 'équipage' } }, ownership: { default: 2 } }),
      entry('nPriv', { name: 'Brouillon privé', ownership: { default: 0, u1: 3 } }), // repli ownership, invisible anonyme
      entry('hors', { name: 'Hors catégorie', folder: 'AUTRE', flags: { 'campaign-codex': { data: { tags: ['Kara Solnée'] } } }, ownership: { default: 2 } }),
    ],
  };
  const store = { get: (k) => data[k] ?? null, version: () => 1 };
  return createContentService({ store, config: () => data.config });
}

test('pcsView : notes associées (tag « Kara Solnée » ≈ nom accentué), filtrées par canSee', () => {
  const svc = makeService();
  const anon = svc.pcsView(null).find((p) => p.id === 'PC1');
  assert.deepEqual(anon.notes.map((n) => n.id), ['nTag'], 'anonyme : la note privée du joueur est masquée, le hors-dossier ignoré');
  const alice = svc.pcsView({ userId: 'u1', role: 1 }).find((p) => p.id === 'PC1');
  assert.deepEqual(alice.notes.map((n) => n.id), ['nTag', 'nPriv'], 'le joueur voit aussi sa note possédée (repli ownership)');
  assert.equal(alice.notes[0].name, 'Carnet de Kara');
});

test('vehicleView : groupNotes = journaux tagués équipage/groupe/vaisseau visibles', () => {
  const svc = makeService();
  const v = svc.vehicleView(null);
  assert.equal(v.name, 'Le Rossignol');
  assert.deepEqual(v.groupNotes.map((n) => n.id), ['nCrew']);
});
