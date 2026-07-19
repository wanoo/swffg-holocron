// Les trois gabarits de fiches MJ (Front / Secret / Prépa) en fiches Campaign
// Codex `tag` privées. Ce qui compte ici : la FORME exacte de la fiche (pour
// qu'elle s'ouvre et s'édite dans Foundry), le miroir des tags des DEUX côtés,
// et le caractère non destructif des mises à jour.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MJ_TEMPLATES, TAG_SHEET_CLASS, mjSheetDoc, mjSheetUpdates, mjSheetView,
  mjKindOf, mjStateOf, mjTags, mjFields, mjDescription, frontsMigration,
} from '../lib/transform/mj-sheets.mjs';
import { CC_SHEET } from '../../module-foundry/scripts/convert-mej.mjs';
import { buildCatalog } from '../lib/board.mjs';

test('la sheet posée est bien celle du module Foundry (sinon fiche nue dans Foundry)', () => {
  assert.equal(TAG_SHEET_CLASS, CC_SHEET.tag);
});

test('mjSheetDoc : forme EXACTE d’une fiche CC `tag`, MJ only', () => {
  const doc = mjSheetDoc({
    kind: 'front', title: 'L’étau impérial',
    data: { intention: 'Boucler le secteur', horloge: '2/6', cible: 'Ryloth', signes: 'Patrouilles doublées' },
  });
  assert.equal(doc.name, 'L’étau impérial');
  assert.deepEqual(doc.ownership, { default: 0 }); // jamais visible d'un joueur
  assert.equal(doc.flags.core.sheetClass, 'campaign-codex.TagSheet');
  const cc = doc.flags['campaign-codex'];
  assert.equal(cc.type, 'tag');
  assert.equal(cc.data.tagMode, true);
  assert.equal(cc.data.sheetTypeLabelOverride, 'Front'); // libellé relabellisé
  assert.equal(cc.data.intention, 'Boucler le secteur');
  assert.equal(cc.data.horloge, '2/6');
  assert.equal(doc.flags.holocron.mjSheet, 'front');
});

test('mjSheetDoc : tags MIROITÉS Campaign Codex ↔ Asset Librarian', () => {
  const doc = mjSheetDoc({ kind: 'front', title: 'X', tags: ['Impérial'] });
  const tags = doc.flags['campaign-codex'].data.tags;
  assert.deepEqual(tags, ['Impérial', 'mj:front', 'mj:front-actif']);
  assert.equal(doc.flags['asset-librarian'].filterTag, 'Impérial, mj:front, mj:front-actif');
});

test('mjSheetDoc : état par défaut par gabarit (front actif, secret non semé)', () => {
  assert.ok(mjSheetDoc({ kind: 'front', title: 'X' }).flags['campaign-codex'].data.tags.includes('mj:front-actif'));
  const secret = mjSheetDoc({ kind: 'secret', title: 'X' }).flags['campaign-codex'].data.tags;
  assert.deepEqual(secret, ['mj:secret']); // pas encore semé = pas de tag d'état
  assert.deepEqual(mjSheetDoc({ kind: 'prepa', title: 'X' }).flags['campaign-codex'].data.tags, ['mj:prepa']);
});

test('mjSheetDoc : relations NATIVES CC (jamais un flag maison)', () => {
  const doc = mjSheetDoc({
    kind: 'secret', title: 'La vraie identité',
    links: {
      associates: ['JournalEntry.aaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbb', 'JournalEntry.aaaaaaaaaaaaaaaa'],
      linkedLocations: ['JournalEntry.cccccccccccccccc'],
      linkedActor: 'Actor.dddddddddddddddd',
    },
  });
  const d = doc.flags['campaign-codex'].data;
  assert.deepEqual(d.associates, ['JournalEntry.aaaaaaaaaaaaaaaa', 'JournalEntry.bbbbbbbbbbbbbbbb']);
  assert.deepEqual(d.linkedLocations, ['JournalEntry.cccccccccccccccc']);
  assert.equal(d.linkedActor, 'Actor.dddddddddddddddd');
});

test('mjSheetDoc : description = miroir LISIBLE des champs (ce que la sheet CC montre)', () => {
  const html = mjDescription('secret', { verite: 'C’est son père', indices: 'Le médaillon' });
  assert.match(html, /<strong>La vérité :<\/strong> C’est son père/);
  assert.match(html, /Indices semables/);
  assert.equal(mjDescription('secret', {}), ''); // rien à dire = rien à afficher
});

test('mjSheetDoc : gabarit inconnu → 400, jamais une fiche bancale', () => {
  assert.throws(() => mjSheetDoc({ kind: 'lubie', title: 'X' }), /gabarit inconnu/);
});

test('mjFields : champs bornés, clés inconnues ignorées', () => {
  const f = mjFields('front', { intention: ' a '.repeat(400), inconnu: 'x', horloge: '1/4' });
  assert.ok(f.intention.length <= 500);
  assert.equal(f.inconnu, undefined);
  assert.equal(f.horloge, '1/4');
});

// --- lecture d'une fiche existante -------------------------------------------
const sheetDoc = (tags, data = {}) => ({
  _id: 'ff00000000000001', name: 'L’étau impérial',
  flags: { 'campaign-codex': { type: 'tag', data: { tags, ...data } } },
});

test('mjKindOf / mjStateOf : les TAGS font foi, des deux côtés', () => {
  assert.equal(mjKindOf(sheetDoc(['mj:front'])), 'front');
  assert.equal(mjKindOf(sheetDoc(['MJ:Front'])), 'front'); // casse indifférente
  assert.equal(mjKindOf(sheetDoc(['mj:note-joueur'])), ''); // une note promue n'est pas une fiche MJ
  assert.equal(mjKindOf({ flags: { 'campaign-codex': { type: 'npc' } } }), '');
  // tag posé à la main depuis Asset Librarian : reconnu tout pareil
  assert.equal(mjKindOf({ flags: {
    'campaign-codex': { type: 'tag', data: {} },
    'asset-librarian': { filterTag: 'mj:secret' },
  } }), 'secret');
  assert.equal(mjStateOf(sheetDoc(['mj:front', 'mj:front-eteint']), 'front'), 'eteint');
  assert.equal(mjStateOf(sheetDoc(['mj:front']), 'front'), 'actif');   // défaut du gabarit
  assert.equal(mjStateOf(sheetDoc(['mj:secret']), 'secret'), '');      // pas encore semé
  assert.equal(mjStateOf(sheetDoc(['mj:secret', 'mj:secret-seme']), 'secret'), 'seme');
});

test('mjTags : l’état est EXCLUSIF, les tags du MJ ne bougent pas', () => {
  assert.deepEqual(mjTags('front', 'eteint', ['Impérial', 'mj:front', 'mj:front-actif']),
    ['Impérial', 'mj:front', 'mj:front-eteint']);
  assert.deepEqual(mjTags('secret', '', ['Ryloth', 'mj:secret', 'mj:secret-seme']),
    ['Ryloth', 'mj:secret']); // « dé-semer » retire bien le tag d'état
});

test('mjSheetView : vue complète, null si ce n’est pas une fiche MJ', () => {
  const v = mjSheetView(sheetDoc(['mj:secret', 'mj:secret-seme'], { verite: 'C’est son père' }));
  assert.equal(v.kind, 'secret');
  assert.equal(v.state, 'seme');
  assert.equal(v.label, 'Secret');
  assert.deepEqual(v.data, { verite: 'C’est son père' });
  assert.equal(mjSheetView({ flags: { 'campaign-codex': { type: 'npc' } } }), null);
});

// --- mises à jour non destructives -------------------------------------------
test('mjSheetUpdates : PATCH PARTIEL — seuls les champs fournis sont écrits', () => {
  const doc = sheetDoc(['mj:front', 'mj:front-actif'], { intention: 'Boucler', cible: 'Ryloth' });
  const u = mjSheetUpdates(doc, { kind: 'front', data: { intention: 'Écraser' } });
  assert.equal(u['flags.campaign-codex.data.intention'], 'Écraser');
  assert.equal('flags.campaign-codex.data.cible' in u, false); // pas touché
  // le miroir affiché reste complet : il est régénéré à partir de la FUSION
  assert.match(u['flags.campaign-codex.data.description'], /Écraser/);
  assert.match(u['flags.campaign-codex.data.description'], /Ryloth/);
});

test('mjSheetUpdates : changer l’état réécrit les tags des DEUX côtés', () => {
  const doc = sheetDoc(['Impérial', 'mj:front', 'mj:front-actif']);
  const u = mjSheetUpdates(doc, { kind: 'front', state: 'eteint' });
  assert.deepEqual(u['flags.campaign-codex.data.tags'], ['Impérial', 'mj:front', 'mj:front-eteint']);
  assert.equal(u['flags.asset-librarian.filterTag'], 'Impérial, mj:front, mj:front-eteint');
});

test('mjSheetUpdates : une fiche taguée à la main dans Foundry se répare toute seule', () => {
  const bancale = { _id: 'x', name: 'Secret', flags: { 'campaign-codex': { type: 'tag', data: { tags: ['mj:secret'] } } } };
  const u = mjSheetUpdates(bancale, { state: 'seme' });
  assert.equal(u['flags.core.sheetClass'], TAG_SHEET_CLASS);
  assert.equal(u['flags.campaign-codex.data.tagMode'], true);
  assert.equal(u['flags.campaign-codex.data.sheetTypeLabelOverride'], 'Secret');
  assert.equal(u['flags.holocron.mjSheet'], 'secret');
});

// --- migration gm:cfg:fronts --------------------------------------------------
test('frontsMigration : chaque front de la config devient une fiche, une seule fois', () => {
  const cfg = [
    { label: 'L’étau impérial', statut: 'chaud', note: 'Patrouilles doublées' },
    { label: 'La dette de Kael', statut: 'resolu', note: '' },
    { label: '', statut: 'ok' },                       // ligne vide du widget : ignorée
    { label: 'L’étau impérial', statut: 'ok' },        // doublon dans la config
  ];
  const { create, skip } = frontsMigration(cfg, []);
  assert.equal(create.length, 2);
  assert.deepEqual(create[0], {
    kind: 'front', title: 'L’étau impérial', state: 'actif',
    data: { intention: 'Patrouilles doublées' }, tags: [],
  });
  assert.equal(create[1].state, 'eteint'); // « resolu » → front éteint
  assert.equal(skip.length, 0);
});

test('frontsMigration : idempotente — un front déjà représenté n’est pas recréé', () => {
  const cfg = [{ label: 'L’étau impérial', statut: 'ok' }];
  const existing = [{ kind: 'front', title: 'L’ÉTAU IMPÉRIAL' }]; // rapprochement par NOM normalisé
  const { create, skip } = frontsMigration(cfg, existing);
  assert.deepEqual(create, []);
  assert.equal(skip.length, 1);
});

// --- carte de campagne --------------------------------------------------------
test('buildCatalog : les fiches MJ sont des NŒUDS de la carte, les autres `tag` non', () => {
  const journalsIndex = [
    { _id: 'ff00000000000001', name: 'L’étau impérial', ownership: { default: 0 },
      flags: { 'campaign-codex': { type: 'tag', data: { tags: ['mj:front', 'mj:front-eteint'] } } } },
    { _id: 'ss00000000000001', name: 'La vraie identité', ownership: { default: 0 },
      flags: { 'campaign-codex': { type: 'tag', data: {
        tags: ['mj:secret'], associates: ['JournalEntry.np00000000000001'] } } } },
    { _id: 'nt00000000000001', name: 'Notes de Kael', ownership: { default: 0 },
      flags: { 'campaign-codex': { type: 'tag', data: { tags: ['mj:note-joueur'] } } } },
    { _id: 'np00000000000001', name: 'Moff Kalast', ownership: { default: 0 },
      flags: { 'campaign-codex': { type: 'npc', data: {} } } },
  ];
  const { nodes, edges } = buildCatalog({
    config: { categories: [] }, folders: [], journalsIndex, getJournal: (id) => journalsIndex.find((j) => j._id === id),
  });
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  assert.equal(byId.ff00000000000001.type, 'mj-front');
  assert.equal(byId.ff00000000000001.mjKind, 'front');
  assert.equal(byId.ff00000000000001.mjState, 'eteint');
  assert.equal(byId.ss00000000000001.type, 'mj-secret');
  assert.equal(byId.nt00000000000001, undefined); // une note de joueur n'est pas une fiche MJ
  // les relations NATIVES CC du secret deviennent des arêtes de la carte
  assert.ok(edges.some((e) => e.from === 'ss00000000000001' && e.to === 'np00000000000001'));
});

test('les trois gabarits sont bien ceux décidés (tags et libellés)', () => {
  assert.deepEqual(Object.keys(MJ_TEMPLATES), ['front', 'secret', 'prepa']);
  assert.equal(MJ_TEMPLATES.front.tag, 'mj:front');
  assert.equal(MJ_TEMPLATES.secret.tag, 'mj:secret');
  assert.equal(MJ_TEMPLATES.prepa.tag, 'mj:prepa');
  assert.deepEqual(Object.values(MJ_TEMPLATES.front.states), ['mj:front-actif', 'mj:front-eteint']);
  assert.deepEqual(Object.values(MJ_TEMPLATES.secret.states), ['mj:secret-seme']);
  assert.deepEqual(Object.values(MJ_TEMPLATES).map((t) => t.label), ['Front', 'Secret', 'Prépa']);
});
