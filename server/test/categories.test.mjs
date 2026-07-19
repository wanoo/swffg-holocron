// Résolution des CATÉGORIES (transform/categories.mjs) : par dossier (historique),
// par tag ou par type Campaign Codex — plus la rétrocompatibilité stricte.
import { test } from 'node:test';
import assert from 'node:assert';
import {
  resolveCategories, categoryOf, entriesOfKind, declaredFolderIds, resolveFolder, tagCatId, typeCatId,
} from '../lib/transform/categories.mjs';

const folders = [
  { _id: 'F_NOTES', name: '📓 Notes des joueurs', type: 'JournalEntry' },
  { _id: 'F_ACTES', name: '🎬 Campagne — Actes', type: 'JournalEntry' },
  { _id: 'F_ACTOR', name: '👥 Personnages joueurs', type: 'Actor' },
];
const entry = (id, { folder = null, flags = {}, name = id } = {}) => ({ _id: id, name, folder, flags });
const ccEntry = (id, type, tags = []) =>
  entry(id, { flags: { 'campaign-codex': { type, data: { tags } } } });

test('resolveFolder : nom Foundry, _id ou uuid « Folder.<id> » — jamais un dossier d’acteurs', () => {
  assert.equal(resolveFolder(folders, '📓 Notes des joueurs')._id, 'F_NOTES');
  assert.equal(resolveFolder(folders, 'F_NOTES')._id, 'F_NOTES');
  assert.equal(resolveFolder(folders, 'Folder.F_NOTES')._id, 'F_NOTES');
  assert.equal(resolveFolder(folders, '👥 Personnages joueurs'), null); // type Actor
  assert.equal(resolveFolder(folders, 'inconnu'), null);
});

test('catégorie par DOSSIER : comportement historique inchangé (id = id du dossier)', () => {
  const cats = resolveCategories({
    config: { categories: [{ folder: '📓 Notes des joueurs', kind: 'notes', editable: true }] },
    folders,
  });
  assert.equal(cats.length, 1);
  assert.equal(cats[0].id, 'F_NOTES');
  assert.equal(cats[0].kind, 'notes');
  assert.equal(cats[0].editable, true);
  assert.equal(cats[0].source, 'folder');
  assert.equal(cats[0].label, 'Notes des joueurs'); // emoji de tête retiré
  assert.equal(cats[0].match(entry('a', { folder: 'F_NOTES' })), true);
  assert.equal(cats[0].match(entry('b', { folder: 'F_ACTES' })), false);
});

test('catégorie par TAG : reconnue où que vive la fiche, dans les DEUX conventions', () => {
  const cats = resolveCategories({
    config: { categories: [{ tag: 'mj:front', kind: 'org', label: 'Fronts' }] },
    folders,
  });
  assert.equal(cats[0].id, tagCatId('mj:front'));
  assert.equal(cats[0].label, 'Fronts');
  assert.equal(cats[0].source, 'tag');
  // tag côté Campaign Codex
  assert.equal(cats[0].match(ccEntry('a', 'group', ['mj:front'])), true);
  // tag côté Asset Librarian (chaîne), casse différente, sans dossier
  assert.equal(cats[0].match(entry('b', { flags: { 'asset-librarian': { filterTag: 'MJ:Front' } } })), true);
  assert.equal(cats[0].match(entry('c')), false);
});

test('catégorie par TYPE CC : toutes les fiches d’un type, quel que soit leur dossier', () => {
  const cats = resolveCategories({
    config: { categories: [{ ccType: 'quest', kind: 'quest', label: 'Quêtes' }] },
    folders,
  });
  assert.equal(cats[0].id, typeCatId('quest'));
  assert.equal(cats[0].source, 'ccType');
  assert.equal(cats[0].match(ccEntry('q', 'quest')), true);
  assert.equal(cats[0].match(ccEntry('n', 'npc')), false);
  assert.equal(cats[0].match(entry('x')), false);
});

test('catégories non résolvables ignorées (dossier absent, tag vide) — la vue ne casse pas', () => {
  const cats = resolveCategories({
    config: { categories: [
      { folder: 'Dossier supprimé', kind: 'misc' },
      { tag: '   ', kind: 'misc' },
      { ccType: '', kind: 'misc' },
      null,
      { folder: '📓 Notes des joueurs', kind: 'notes' },
    ] },
    folders,
  });
  assert.equal(cats.length, 1);
  assert.equal(cats[0].id, 'F_NOTES');
});

test('categoryOf : la PREMIÈRE catégorie qui matche gagne — jamais de doublon', () => {
  // la fiche est à la fois dans le dossier Actes ET taguée mj:front
  const cats = resolveCategories({
    config: { categories: [
      { folder: '🎬 Campagne — Actes', kind: 'story' },
      { tag: 'mj:front', kind: 'org' },
    ] },
    folders,
  });
  const e = entry('a', { folder: 'F_ACTES', flags: { 'campaign-codex': { data: { tags: ['mj:front'] } } } });
  assert.equal(categoryOf(cats, e).id, 'F_ACTES'); // le dossier, déclaré en tête
  // ordre inversé : c'est le tag qui l'emporte
  const inv = resolveCategories({
    config: { categories: [{ tag: 'mj:front', kind: 'org' }, { folder: '🎬 Campagne — Actes', kind: 'story' }] },
    folders,
  });
  assert.equal(categoryOf(inv, e).id, tagCatId('mj:front'));
  assert.equal(categoryOf(cats, entry('z')), null);
});

test('entriesOfKind : mélange proprement dossier et tag pour un même kind', () => {
  const cats = resolveCategories({
    config: { categories: [
      { folder: '📓 Notes des joueurs', kind: 'notes' },
      { tag: 'mj:note-joueur', kind: 'notes' },
      { folder: '🎬 Campagne — Actes', kind: 'story' },
    ] },
    folders,
  });
  const index = [
    entry('nDossier', { folder: 'F_NOTES' }),
    entry('nTag', { flags: { 'asset-librarian': { filterTag: 'mj:note-joueur' } } }),
    entry('acte', { folder: 'F_ACTES' }),
    entry('ailleurs'),
  ];
  assert.deepEqual(entriesOfKind(cats, index, 'notes').map((e) => e._id), ['nDossier', 'nTag']);
  assert.deepEqual(entriesOfKind(cats, index, 'story').map((e) => e._id), ['acte']);
  assert.deepEqual(entriesOfKind(cats, index, 'inconnu'), []);
});

test('declaredFolderIds : seuls les dossiers réellement déclarés (garde d’étanchéité)', () => {
  const cats = resolveCategories({
    config: { categories: [{ folder: '📓 Notes des joueurs', kind: 'notes' }, { tag: 't', kind: 'misc' }] },
    folders,
  });
  assert.deepEqual([...declaredFolderIds(cats)], ['F_NOTES']);
});

test('rétrocompat : une config 100 % « folder » se résout exactement comme avant', () => {
  const config = { categories: [
    { folder: '🎬 Campagne — Actes', kind: 'story', editable: true },
    { folder: '📓 Notes des joueurs', kind: 'notes', editable: true },
  ] };
  const cats = resolveCategories({ config, folders });
  assert.deepEqual(cats.map((c) => [c.id, c.kind, c.editable]), [
    ['F_ACTES', 'story', true],
    ['F_NOTES', 'notes', true],
  ]);
  // le classement reste celui du dossier de l'entrée
  assert.equal(categoryOf(cats, entry('a', { folder: 'F_NOTES' })).id, 'F_NOTES');
});
