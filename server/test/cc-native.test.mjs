// Logique PURE de la conversion « 100 % Campaign Codex » du module Foundry
// (module-foundry/scripts/convert-cc-native.mjs) : fusion NON DESTRUCTIVE des
// tags et rattachement note → PJ. Les fonctions qui écrivent dans le monde ne
// sont pas testées ici (elles exigent Foundry) — seules les décisions le sont.
import { test } from 'node:test';
import assert from 'node:assert';
import {
  NOTE_TAG, PC_TAG, currentTags, mergeTags, noteOwnerPc,
} from '../../module-foundry/scripts/convert-cc-native.mjs';

const doc = (flags = {}, ownership = {}) => ({ flags, ownership });
const ccTags = (...tags) => doc({ 'campaign-codex': { data: { tags } } });

test('currentTags : lit les DEUX côtés (Campaign Codex et Asset Librarian)', () => {
  assert.deepEqual(currentTags(ccTags('A', 'B')), ['A', 'B']);
  assert.deepEqual(currentTags(doc({ 'asset-librarian': { filterTag: 'A, B' } })), ['A', 'B']);
  assert.deepEqual(currentTags(doc({
    'campaign-codex': { data: { tags: ['CC'] } },
    'asset-librarian': { filterTag: 'AL' },
  })), ['CC', 'AL']);
  assert.deepEqual(currentTags(doc()), []);
});

test('mergeTags : AJOUTE sans jamais retirer ce que le MJ a posé à la main', () => {
  const d = ccTags('Favori', 'Intrigue');
  assert.deepEqual(mergeTags(d, [NOTE_TAG]), ['Favori', 'Intrigue', NOTE_TAG]);
});

test('mergeTags : null quand il n’y a rien à ajouter — on n’écrit pas pour rien', () => {
  assert.equal(mergeTags(ccTags(NOTE_TAG, 'Uchebe'), [NOTE_TAG, 'Uchebe']), null);
  assert.equal(mergeTags(ccTags(NOTE_TAG), [NOTE_TAG]), null);
  assert.equal(mergeTags(ccTags('X'), []), null);
});

test('mergeTags : pas de doublon, comparaison insensible casse/accents', () => {
  assert.equal(mergeTags(ccTags('MJ:Note-Joueur'), [NOTE_TAG]), null);
  assert.equal(mergeTags(ccTags('Uchebé'), ['UCHEBE']), null);
  // un tag déjà posé côté Asset Librarian compte comme présent côté CC
  assert.equal(mergeTags(doc({ 'asset-librarian': { filterTag: 'mj:pj' } }), [PC_TAG]), null);
});

test('mergeTags : dédoublonne aussi la liste demandée', () => {
  assert.deepEqual(mergeTags(doc(), [NOTE_TAG, NOTE_TAG, 'Kara']), [NOTE_TAG, 'Kara']);
  assert.deepEqual(mergeTags(doc(), ['', null, 'Kara']), ['Kara']);
});

/* --------------------------------------------- rattachement note → PJ ------ */
// Même règle que l'app web (server/lib/transform/notes.mjs) : le TAG au nom du
// PJ fait foi, sinon repli sur l'ownership OWNER d'un joueur (jamais le MJ).
const pc = (id, name, ownership = {}) => ({ id, name, ownership });

function withGame(users, fn) {
  const prev = globalThis.game;
  globalThis.game = { users: Object.assign(users, { get: (id) => users.find((u) => u.id === id) }) };
  try { return fn(); } finally { globalThis.game = prev; }
}

test('noteOwnerPc : le tag au nom du PJ est prioritaire', () => {
  const pcs = [pc('PC1', 'Kara Solnée'), pc('PC2', 'Dex')];
  withGame([], () => {
    assert.equal(noteOwnerPc(ccTags('KARA SOLNEE'), pcs)?.id, 'PC1');
    assert.equal(noteOwnerPc(doc({ 'asset-librarian': { filterTag: 'Dex' } }), pcs)?.id, 'PC2');
    assert.equal(noteOwnerPc(ccTags('inconnu'), pcs), null);
  });
});

test('noteOwnerPc : repli ownership OWNER d’un joueur, jamais le MJ', () => {
  const pcs = [pc('PC1', 'Kara', { u1: 3 }), pc('PC2', 'Dex', { u2: 3 })];
  const users = [
    { id: 'u1', isGM: false, character: { id: 'PC1' } },
    { id: 'u2', isGM: false, character: null },
    { id: 'gm', isGM: true, character: null },
  ];
  withGame(users, () => {
    // via user.character
    assert.equal(noteOwnerPc(doc({}, { default: 0, u1: 3 }), pcs)?.id, 'PC1');
    // via ownership de l'acteur quand le user n'a pas de personnage assigné
    assert.equal(noteOwnerPc(doc({}, { default: 0, u2: 3 }), pcs)?.id, 'PC2');
    // OBSERVER (2) n'est pas OWNER (3)
    assert.equal(noteOwnerPc(doc({}, { default: 0, u1: 2 }), pcs), null);
    // note possédée par le MJ seul : rattachée à personne
    assert.equal(noteOwnerPc(doc({}, { default: 0, gm: 3 }), pcs), null);
  });
});

test('noteOwnerPc : le tag gagne même si l’ownership dit autre chose', () => {
  const pcs = [pc('PC1', 'Kara', { u1: 3 }), pc('PC2', 'Dex', { u2: 3 })];
  const users = [{ id: 'u2', isGM: false, character: { id: 'PC2' } }];
  withGame(users, () => {
    const note = { flags: { 'campaign-codex': { data: { tags: ['Kara'] } } }, ownership: { u2: 3 } };
    assert.equal(noteOwnerPc(note, pcs)?.id, 'PC1');
  });
});

/* ------------------------------- format de la note promue, vu par l'app ---- */
// Vérifie que la FORME posée par le module (fiche CC `tag`) traverse la chaîne
// de vues sans rien laisser fuir : c'est le contrat entre le module et l'app.
import { ccView, buildJournalsView } from '../lib/transform/journals.mjs';

// ids Foundry : 16 caractères alphanumériques (seule forme que ccRef résout)
const PC_SHEET_ID = 'PcSheet000000000';

const promotedNote = {
  _id: 'NOTE1', name: 'Carnet de Uchebe', folder: 'F_NOTES', sort: 0,
  ownership: { default: 0, u1: 3 },
  flags: {
    core: { sheetClass: 'campaign-codex.TagSheet' },
    'campaign-codex': {
      type: 'tag',
      data: {
        tagMode: true,
        sheetTypeLabelOverride: 'Note de joueur',
        linkedActor: 'Actor.PC1',
        associates: [`JournalEntry.${PC_SHEET_ID}`],
        tags: [NOTE_TAG, 'Uchebe'],
        description: '<p>Contenu de la note</p>',
      },
    },
    'asset-librarian': { filterTag: 'mj:note-joueur, Uchebe' },
    holocron: { noteCcConverted: true },
  },
  pages: [{ _id: 'P1', name: 'Notes', type: 'text', text: { content: '<p>Contenu de la note</p>' } }],
};

test('note promue : ccView n’expose ni linkedActor ni les drapeaux internes CC', () => {
  const v = ccView(promotedNote);
  assert.equal(v.ccType, 'tag');
  assert.equal(v.attributes?.tags, `${NOTE_TAG}, Uchebe`);  // les tags restent visibles
  assert.equal(v.attributes?.linkedActor, undefined);       // uuid d'acteur : jamais affiché
  assert.equal(v.attributes?.tagMode, undefined);
  assert.equal(v.attributes?.sheetTypeLabelOverride, undefined);
  assert.equal(v.attributes?.description, undefined);
  // le lien vers la fiche du PJ est une RELATION, pas un attribut
  assert.deepEqual(v.relationships, [{ ref: PC_SHEET_ID, rel: 'Associé' }]);
});

test('note promue : classée dans la catégorie notes, par dossier comme par tag', () => {
  const folders = [{ _id: 'F_NOTES', name: '📓 Notes des joueurs', type: 'JournalEntry' }];
  const build = (categories) => buildJournalsView({
    config: { categories },
    folders,
    journalsIndex: [promotedNote],
    getJournal: () => promotedNote,
    gm: true,
  });
  // (a) catégorie par DOSSIER — comportement historique, la promotion ne change rien
  const byFolder = build([{ folder: '📓 Notes des joueurs', kind: 'notes', editable: true }]);
  assert.equal(byFolder.journals.length, 1);
  assert.equal(byFolder.journals[0].categoryId, 'F_NOTES');
  assert.equal(byFolder.journals[0].pages[0].html, '<p>Contenu de la note</p>');

  // (b) catégorie par TAG — la note est trouvée même sortie de son dossier
  const orphan = { ...promotedNote, folder: 'AILLEURS' };
  const byTag = buildJournalsView({
    config: { categories: [{ tag: NOTE_TAG, kind: 'notes', label: 'Notes' }] },
    folders, journalsIndex: [orphan], getJournal: () => orphan, gm: true,
  });
  assert.equal(byTag.journals.length, 1);
  assert.equal(byTag.categories[0].label, 'Notes');
});
