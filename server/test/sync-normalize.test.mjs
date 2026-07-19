// Normalisation des réponses du gateway + construction des clauses `where`
// (sync-store.mjs). Contrat : https://github.com/wanoo/foundry-mcp-gateway
// → docs/integrators.md (tableaux nus, _id/name toujours projetés).
import { test } from 'node:test';
import assert from 'node:assert';
import {
  asDocs, whereIdIn, whereOp, isFresh, indexSignature,
  journalRelevance, relevantJournalFolderIds,
} from '../lib/sync-store.mjs';

test('asDocs : tableau nu de documents, entrées sans _id écartées', () => {
  assert.deepEqual(asDocs([{ _id: 'a' }, { _id: 'b' }]), [{ _id: 'a' }, { _id: 'b' }]);
  assert.deepEqual(asDocs([{ _id: 'a' }, null, {}, 'bruit']), [{ _id: 'a' }]);
  assert.deepEqual(asDocs([]), []);
});

test('asDocs : une réponse anormale vaut « vide » — un tick ne plante pas dessus', () => {
  // le gateway remonte ses erreurs en exception (mcp.mjs), jamais en valeur :
  // tout ce qui n'est pas un tableau ici est une anomalie, pas une erreur métier.
  assert.deepEqual(asDocs(null), []);
  assert.deepEqual(asDocs(undefined), []);
  assert.deepEqual(asDocs({ error: 'boom' }), []);
  assert.deepEqual(asDocs('texte'), []);
});

// ⚠️ NON-RÉGRESSION du piège vérifié contre le monde de prod : les opérateurs de
// `where` sont des SUFFIXES de clé. La forme imbriquée ne lève aucune erreur et
// renvoie silencieusement 0 document — le bug le plus coûteux à diagnostiquer.
test('whereIdIn : forme SUFFIXE `_id__in`, jamais la forme imbriquée', () => {
  assert.deepEqual(whereIdIn(['a', 'b']), { _id__in: ['a', 'b'] });
  assert.notDeepEqual(whereIdIn(['a']), { _id: { __in: ['a'] } });
  assert.ok('_id__in' in whereIdIn([]), 'la clé doit porter le suffixe __in');
  assert.equal(typeof whereIdIn(['a'])._id__in[0], 'string');
  // accepte un Set aussi bien qu'un tableau
  assert.deepEqual(whereIdIn(new Set(['x'])), { _id__in: ['x'] });
});

test('whereOp : chemin pointé + suffixe d’opérateur', () => {
  assert.deepEqual(whereOp('flags.campaign-codex.type', 'in', ['npc', 'tag']),
    { 'flags.campaign-codex.type__in': ['npc', 'tag'] });
  assert.deepEqual(whereOp('flags.campaign-codex.type', 'exists', true),
    { 'flags.campaign-codex.type__exists': true });
  assert.deepEqual(whereOp('name', 'contains', 'Yoda'), { name__contains: 'Yoda' });
  // sans opérateur : égalité stricte
  assert.deepEqual(whereOp('folder', '', 'F1'), { folder: 'F1' });
});

test('isFresh : le cache est frais si son modifiedTime a rattrapé celui de l’index', () => {
  const idx = { _id: 'a', _stats: { modifiedTime: 100 } };
  assert.equal(isFresh({ _stats: { modifiedTime: 100 } }, idx), true);
  assert.equal(isFresh({ _stats: { modifiedTime: 101 } }, idx), true);
  assert.equal(isFresh({ _stats: { modifiedTime: 99 } }, idx), false);
  assert.equal(isFresh(null, idx), false);          // jamais tiré
  assert.equal(isFresh({}, idx), false);            // cache sans _stats : à re-tirer
});

test('indexSignature : change si un document bouge, stable sinon (ETag)', () => {
  const a = [{ _id: 'x', _stats: { modifiedTime: 1 } }, { _id: 'y', _stats: { modifiedTime: 2 } }];
  assert.equal(indexSignature(a), indexSignature([...a]));
  assert.notEqual(indexSignature(a), indexSignature([{ _id: 'x', _stats: { modifiedTime: 9 } }, a[1]]));
  assert.notEqual(indexSignature(a), indexSignature([a[0]]));       // suppression
  assert.equal(indexSignature([]), '');
  assert.equal(indexSignature(null), '');
});

/* ------------------------------------------------------------ pertinence -- */
const folders = [
  { _id: 'F_NOTES', name: '📓 Notes des joueurs', type: 'JournalEntry' },
  { _id: 'F_BIBLE', name: '🎲 MJ — Bible de campagne', type: 'JournalEntry' },
  { _id: 'F_CC', name: 'Campaign Codex - NPCs', type: 'JournalEntry' },
  { _id: 'F_ATLAS', name: '🌌 Atlas', type: 'JournalEntry' },
];
const config = {
  categories: [{ folder: '📓 Notes des joueurs', kind: 'notes' }],
  gmBibleFolder: '🎲 MJ — Bible de campagne',
};
const e = (id, { folder = 'F_ATLAS', flags = {}, name = id } = {}) => ({ _id: id, name, folder, flags });

test('relevantJournalFolderIds : catégories déclarées + bible MJ (pas le reste)', () => {
  const ids = relevantJournalFolderIds({ config, folders });
  assert.equal(ids.has('F_NOTES'), true);
  assert.equal(ids.has('F_BIBLE'), true);
  assert.equal(ids.has('F_ATLAS'), false);
});

test('pertinence : une fiche Campaign Codex compte OÙ QU’ELLE VIVE (virage CC-first)', () => {
  const rel = journalRelevance({ config, folders });
  // hors de tout dossier déclaré, mais c'est une fiche CC → synchronisée
  assert.equal(rel(e('cc', { folder: 'F_CC', flags: { 'campaign-codex': { type: 'npc' } } })), true);
  assert.equal(rel(e('ccAtlas', { flags: { 'campaign-codex': { type: 'location' } } })), true);
  // journal quelconque d'un dossier hors scope → ignoré
  assert.equal(rel(e('vrac')), false);
});

test('pertinence : dossiers déclarés, racine, journaux techniques, bruit exclu', () => {
  const rel = journalRelevance({ config, folders });
  assert.equal(rel(e('note', { folder: 'F_NOTES' })), true);
  assert.equal(rel(e('bible', { folder: 'F_BIBLE' })), true);
  assert.equal(rel(e('racine', { folder: null })), true);
  assert.equal(rel(e('vaisseau', { name: '🚀 Vaisseau du groupe' })), true);
  // bruit connu : DB de module / barème (synchronisés à part)
  assert.equal(rel(e('sequencerDatabase', { name: 'sequencerDatabase', folder: null })), false);
  assert.equal(rel(e('dice_helper', { name: 'dice_helper', folder: null })), false);
  assert.equal(rel(null), false);
  assert.equal(rel({ name: 'sans id' }), false);
});

test('pertinence : une catégorie par TAG rend la fiche pertinente hors de tout dossier', () => {
  const rel = journalRelevance({
    config: { ...config, categories: [...config.categories, { tag: 'mj:front', kind: 'org' }] },
    folders,
  });
  assert.equal(rel(e('front', { flags: { 'asset-librarian': { filterTag: 'mj:front' } } })), true);
  assert.equal(rel(e('autre')), false);
});
