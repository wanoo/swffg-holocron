// Tests « la bible devient une collection d'éléments » : découpage d'un chapitre
// HTML représentatif, formats des fiches élément (parité CC_SHEET), idempotence
// de l'archive, rapprochement PNJ par nom, catalogue, et ÉTANCHÉITÉ — ni les
// éléments ni l'archive ne sortent JAMAIS par /api/content/*.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  splitSections, plainText, chapterKindHint, extractPlaylist, extractWeather,
  guessElement, scanChapterElements, scanNpcSections, dossierHints,
  npcMergeBlock, npcMarker, isNpcChapter,
} from '../lib/transform/elements.mjs';
import {
  ELEM_TEMPLATES, ELEM_KINDS, TAG_SHEET_CLASS, mjSheetDoc, elemSheetView,
  elemKindOf, mjKindOf, elemDescription,
} from '../lib/transform/mj-sheets.mjs';
import { archiveFolderName, archiveDocBody, createBibleService } from '../lib/bible-tools.mjs';
import { buildCatalog } from '../lib/board.mjs';
import { relevantJournalFolderIds } from '../lib/sync-store.mjs';
import { createContentService } from '../lib/content.mjs';
import { CC_SHEET } from '../../module-foundry/scripts/convert-mej.mjs';

const ID = (n) => n.padEnd(16, '0').slice(0, 16);

/* ---------------------------------------------- chapitre HTML représentatif -- */
// Fabriqué d'après les chapitres réels : encadrés à lire, playlist citée,
// image de banque visuelle, vision titrée par PJ.
const CHAPTER_HTML = `
<p>Introduction du chapitre — contexte général de l'acte.</p>
<h2>Arrivée au spatioport</h2>
<blockquote><p>Vous débarquez sous une pluie fine. Les néons du spatioport grésillent.</p>
<p>Une silhouette encapuchonnée vous observe depuis la passerelle.</p></blockquote>
<p>Note MJ : le contact n'arrive qu'à la scène suivante.</p>
<h2>Cantina du Bantha Ivre</h2>
<p>Playlist : Tension basse. Météo : brouillard et braises dans la ruelle.</p>
<h3>Vision — Kael</h3>
<p>Tu vois ton frère tomber, encore et encore, dans un puits sans fond.</p>
<h2>Le spatioport de nuit</h2>
<figure><img src="worlds/star-wars/assets/gm-spatioport.webp" alt="Spatioport">
<figcaption>Le spatioport de nuit, vu des quais</figcaption></figure>
`;

test('splitSections : h2/h3 + section d’introduction, texte de titre nettoyé', () => {
  const sections = splitSections(CHAPTER_HTML);
  assert.equal(sections.length, 5);
  assert.equal(sections[0].heading, '');
  assert.deepEqual(sections.map((s) => s.heading).slice(1),
    ['Arrivée au spatioport', 'Cantina du Bantha Ivre', 'Vision — Kael', 'Le spatioport de nuit']);
  assert.equal(sections[3].level, 3);
});

test('guessElement : blockquote → 📣 lecture (texte complet, paragraphes gardés)', () => {
  const s = splitSections(CHAPTER_HTML)[1];
  const g = guessElement(s);
  assert.equal(g.kind, 'lecture');
  assert.match(g.data.texte, /pluie fine/);
  assert.match(g.data.texte, /silhouette encapuchonnée/);
  // la note MJ hors blockquote ne part PAS dans le texte à lire
  assert.doesNotMatch(g.data.texte, /Note MJ/);
});

test('guessElement : playlist citée → 🔊 ambiance (playlist + météo traduite)', () => {
  const s = splitSections(CHAPTER_HTML)[2];
  const g = guessElement(s);
  assert.equal(g.kind, 'ambiance');
  assert.equal(g.data.playlist, 'Tension basse');
  assert.equal(g.data.weather, 'fog, embers');
});

test('guessElement : « Vision — <PJ> » → 🔮 vision (PJ extrait du titre)', () => {
  const s = splitSections(CHAPTER_HTML)[3];
  const g = guessElement(s);
  assert.equal(g.kind, 'vision');
  assert.equal(g.data.pj, 'Kael');
  assert.match(g.data.texte, /ton frère tomber/);
});

test('guessElement : image → 🖼️ visuel (src + légende de figcaption)', () => {
  const s = splitSections(CHAPTER_HTML)[4];
  const g = guessElement(s);
  assert.equal(g.kind, 'visuel');
  assert.equal(g.data.src, 'worlds/star-wars/assets/gm-spatioport.webp');
  assert.equal(g.data.legende, 'Le spatioport de nuit, vu des quais');
});

test('guessElement : hint de chapitre en repli (chapitre 📣 sans blockquote)', () => {
  const g = guessElement({ heading: 'Le discours du Moff', html: '<p>Citoyens, l’Empire veille sur vous.</p>' }, 'lecture');
  assert.equal(g.kind, 'lecture');
  const v = guessElement({ heading: 'Nym', html: '<p>Une salle de trophées en flammes.</p>' }, 'vision');
  assert.equal(v.kind, 'vision');
  assert.equal(v.data.pj, 'Nym'); // chapitre « par PJ » : le titre EST le PJ
});

test('chapterKindHint : les chapitres réels de la prod sont reconnus', () => {
  assert.equal(chapterKindHint('📣 Lectures & dialogues'), 'lecture');
  assert.equal(chapterKindHint('🔮 Les Visions (par PJ)'), 'vision');
  assert.equal(chapterKindHint('🔊 Ambiances sonores par zone'), 'ambiance');
  assert.equal(chapterKindHint('🖼️ Banque visuelle'), 'visuel');
  assert.equal(chapterKindHint('📜 Histoire complète'), '');
});

test('extractPlaylist / extractWeather : bornés, jamais de faux id météo', () => {
  assert.equal(extractPlaylist('playlist « Cantina Band »'), 'Cantina Band');
  assert.equal(extractPlaylist('rien ici'), '');
  assert.deepEqual(extractWeather('tempête de neige, puis fog'), ['rainStorm', 'snow', 'fog']);
  assert.deepEqual(extractWeather('un texte sans météo'), []);
});

/* ----------------------------------------------------- scan : ids stables --- */
test('scanChapterElements : ids STABLES (re-scan = mêmes ids) et doublons marqués', () => {
  const chapters = [{ id: 'chap-1', name: '📣 Lectures & dialogues', html: CHAPTER_HTML }];
  const a = scanChapterElements(chapters, []);
  const b = scanChapterElements(chapters, []);
  assert.ok(a.length >= 4);
  assert.deepEqual(a.map((x) => x.id), b.map((x) => x.id));
  assert.ok(a.every((x) => !x.exists));
  // un élément déjà créé depuis cette section (provenance) est marqué
  const again = scanChapterElements(chapters, [{ kind: a[0].kind, title: 'Autre titre', source: { propId: a[0].id } }]);
  assert.equal(again.find((x) => x.id === a[0].id).exists, true);
  // même titre + même gabarit = doublon aussi (fiche créée à la main dans Foundry)
  const byTitle = scanChapterElements(chapters, [{ kind: a[1].kind, title: a[1].title.toUpperCase() }]);
  assert.equal(byTitle.find((x) => x.id === a[1].id).exists, true);
});

/* -------------------------------------- formats de fiches (parité CC_SHEET) -- */
test('élément = fiche CC `tag` EXACTE : sheet du module, tags des deux côtés, MJ only', () => {
  assert.equal(TAG_SHEET_CLASS, CC_SHEET.tag); // parité avec le module Foundry
  const doc = mjSheetDoc({
    kind: 'lecture', title: 'Arrivée au spatioport',
    data: { texte: 'Vous débarquez sous une pluie fine.' },
    source: { propId: 'elem-lecture-x', chapterId: 'chap-1' },
  });
  assert.deepEqual(doc.ownership, { default: 0 }); // jamais visible d'un joueur
  assert.equal(doc.flags.core.sheetClass, CC_SHEET.tag);
  const cc = doc.flags['campaign-codex'];
  assert.equal(cc.type, 'tag');
  assert.equal(cc.data.tagMode, true);
  assert.equal(cc.data.sheetTypeLabelOverride, 'Lecture');
  assert.ok(cc.data.tags.includes('elem:lecture'));
  assert.match(doc.flags['asset-librarian'].filterTag, /elem:lecture/);
  assert.equal(doc.flags.holocron.elemSheet, 'lecture');
  assert.equal(doc.flags.holocron.mjSheet, undefined); // pas une fiche Front/Secret/Prépa
  assert.deepEqual(doc.flags.holocron.elemSource, { propId: 'elem-lecture-x', chapterId: 'chap-1' });
  // la PAGE miroir rend l'élément lisible/éditable comme un chapitre de bible
  assert.equal(doc.pages.length, 1);
  assert.match(doc.pages[0].text.content, /pluie fine/);
  assert.equal(cc.data.description, doc.pages[0].text.content);
});

test('elemDescription : miroir SPÉCIFIQUE par type (pas un formulaire)', () => {
  assert.match(elemDescription('lecture', { texte: 'Ligne 1\n\nLigne 2' }), /<blockquote class="elem-lecture">/);
  assert.match(elemDescription('ambiance', { playlist: 'Tension', weather: 'fog' }), /Playlist :<\/strong> Tension/);
  const fig = elemDescription('visuel', { src: 'worlds/a.webp', legende: 'Quais' });
  assert.match(fig, /<img src="worlds\/a\.webp"/);
  assert.match(fig, /<figcaption>Quais<\/figcaption>/);
  assert.match(elemDescription('vision', { pj: 'Kael', texte: 'Tu tombes.' }), /Vision — Kael/);
});

test('elemKindOf / elemSheetView : les tags font foi, des deux côtés, sans confusion mj:*', () => {
  const doc = {
    _id: ID('EL1'), name: 'Ambiance cantina',
    flags: {
      'campaign-codex': { type: 'tag', data: { tags: ['elem:ambiance'], playlist: 'Cantina Band' } },
      holocron: { elemSource: { propId: 'p1' } },
    },
  };
  assert.equal(elemKindOf(doc), 'ambiance');
  assert.equal(mjKindOf(doc), ''); // jamais confondu avec une fiche MJ
  const v = elemSheetView(doc);
  assert.equal(v.kind, 'ambiance');
  assert.deepEqual(v.data, { playlist: 'Cantina Band' });
  assert.deepEqual(v.source, { propId: 'p1' });
  // tag posé À LA MAIN dans Asset Librarian : reconnu tout pareil
  assert.equal(elemKindOf({ flags: {
    'campaign-codex': { type: 'tag', data: {} },
    'asset-librarian': { filterTag: 'Elem:Vision' },
  } }), 'vision');
  assert.equal(elemSheetView({ flags: { 'campaign-codex': { type: 'npc' } } }), null);
});

test('les quatre gabarits déclarent leur répertoire (sous-dossier de la bible)', () => {
  assert.deepEqual(ELEM_KINDS, ['lecture', 'ambiance', 'visuel', 'vision']);
  assert.deepEqual(Object.values(ELEM_TEMPLATES).map((t) => t.folder),
    ['📣 Lectures', '🔊 Ambiances', '🖼️ Visuels', '🔮 Visions']);
  assert.deepEqual(Object.values(ELEM_TEMPLATES).map((t) => t.tag),
    ['elem:lecture', 'elem:ambiance', 'elem:visuel', 'elem:vision']);
});

/* ------------------------------------------------------------------ archive -- */
test('archiveFolderName : une clé par mois', () => {
  assert.equal(archiveFolderName(new Date('2026-07-24T12:00:00Z')), '🗄️ Bible — Archive (2026-07)');
  assert.equal(archiveFolderName(new Date('2026-01-02T12:00:00Z')), '🗄️ Bible — Archive (2026-01)');
});

test('archiveDocBody : pages copiées, gmChapter RETIRÉ, provenance posée', () => {
  const body = archiveDocBody({
    _id: ID('CH1'), name: '📜 Histoire complète',
    flags: { holocron: { gmChapter: 'histoire', rev: { updatedAt: 5 } } },
    pages: [{ _id: ID('P1'), name: 'Page', type: 'text', text: { content: '<p>Tout le lore.</p>', format: 1 }, sort: 10 }],
  }, { folder: ID('F1'), at: 42 });
  assert.equal(body.name, '📜 Histoire complète');
  assert.deepEqual(body.ownership, { default: 0 });
  assert.equal(body.flags.holocron.gmChapter, undefined); // ne pollue jamais gmList
  assert.deepEqual(body.flags.holocron.archivedFrom, { journalId: ID('CH1'), chapterId: 'histoire', at: 42 });
  assert.equal(body.pages[0].text.content, '<p>Tout le lore.</p>');
  assert.equal(body.pages[0]._id, undefined); // Foundry pose les siens
});

test('archive : IDEMPOTENTE — le dossier du mois existe → no-op, zéro écriture', async () => {
  let wrote = false;
  const store = {
    get: (name) => (name === 'folders'
      ? [{ _id: ID('AF'), type: 'JournalEntry', name: archiveFolderName() }]
      : name === 'journalsIndex' ? [] : null),
    sync: { folders: async () => { wrote = true; } },
    patch: () => { wrote = true; },
  };
  const bible = createBibleService({
    store, config: () => ({ gmBibleFolder: '📖 Bible' }),
    writer: { gmList: () => [], gmGet: () => null, dossiers: () => ({}) },
    logger: { warn: () => {} },
  });
  const out = await bible.archive();
  assert.equal(out.existed, true);
  assert.equal(wrote, false, 'aucune écriture quand l’archive du mois existe déjà');
  assert.match(out.message, /rien n’a été réécrit/i);
});

/* --------------------------------------------------- PNJ : rapprochement ----- */
const NPC_CHAPTER = `
<p>Le casting de la campagne.</p>
<h2>Kael Ordo, dit le Rat</h2>
<p>Contrebandier au grand cœur.</p>
<p>Veut : retrouver son frère.</p>
<p>Levier : sa dette envers Jabba.</p>
<h2>Moff Kalast</h2>
<p>Attitude : glacial, méthodique.</p>
<h2>Un inconnu quelconque</h2>
<p>Personne ne le connaît.</p>
`;

test('scanNpcSections : rapprochement par NOM (nameForms), dossier détecté', () => {
  const chapters = [{ id: 'chap-cast', name: '🎭 Casting', html: NPC_CHAPTER }];
  const npcs = [
    { id: ID('KAEL'), name: 'Kael Ordo', description: '' },
    { id: ID('MOFF'), name: 'Moff Kalast', description: '' },
  ];
  const found = scanNpcSections(chapters, npcs);
  assert.equal(found.length, 2); // « Un inconnu quelconque » ne matche personne
  const kael = found.find((f) => f.npcId === ID('KAEL'));
  assert.equal(kael.npcName, 'Kael Ordo');
  assert.equal(kael.heading, 'Kael Ordo, dit le Rat'); // forme « dit le Rat » rapprochée
  assert.deepEqual(kael.dossier, { veut: 'retrouver son frère.', levier: 'sa dette envers Jabba.' });
  assert.equal(kael.exists, false);
  const moff = found.find((f) => f.npcId === ID('MOFF'));
  assert.deepEqual(moff.dossier, { attitude: 'glacial, méthodique.' });
});

test('scanNpcSections : IDEMPOTENT — le marqueur dans la description fait foi', () => {
  const chapters = [{ id: 'c', name: '🎭 Casting', html: NPC_CHAPTER }];
  const npcs1 = [{ id: ID('KAEL'), name: 'Kael Ordo', description: '' }];
  const first = scanNpcSections(chapters, npcs1)[0];
  const merged = npcMergeBlock(first);
  assert.match(merged, /data-holocron-import=/);
  assert.match(merged, /Kael Ordo, dit le Rat/);
  assert.match(merged, /Contrebandier au grand cœur/);
  // re-scan avec la description enrichie : le bloc est marqué « déjà reporté »
  const npcs2 = [{ id: ID('KAEL'), name: 'Kael Ordo', description: '<p>Fiche.</p>' + merged }];
  assert.equal(scanNpcSections(chapters, npcs2)[0].exists, true);
});

test('dossierHints / isNpcChapter : lignes narratives et ciblage des chapitres', () => {
  assert.deepEqual(dossierHints('Rôle : mentor\nVeut : la paix\nblabla'), { role: 'mentor', veut: 'la paix' });
  assert.deepEqual(dossierHints('rien'), {});
  assert.ok(isNpcChapter('🎭 Casting — les visages de la campagne'));
  assert.ok(isNpcChapter('📇 Fiches minute PNJ'));
  assert.ok(!isNpcChapter('📜 Histoire complète'));
  assert.match(npcMarker('x1'), /data-holocron-import="x1"/);
});

/* ------------------------------------------------------- catalogue & synchro -- */
test('buildCatalog : les éléments remontent en nœuds elem-* avec leurs données', () => {
  const journalsIndex = [
    { _id: ID('EL1'), name: 'Ambiance cantina', ownership: { default: 0 },
      flags: { 'campaign-codex': { type: 'tag', data: { tags: ['elem:ambiance'], playlist: 'Cantina Band', weather: 'fog' } } } },
    { _id: ID('EL2'), name: 'Arrivée au spatioport', ownership: { default: 0 },
      flags: { 'campaign-codex': { type: 'tag', data: { tags: ['elem:lecture'], texte: 'Vous débarquez.' } } } },
    { _id: ID('FR1'), name: 'L’étau', ownership: { default: 0 },
      flags: { 'campaign-codex': { type: 'tag', data: { tags: ['mj:front'] } } } },
  ];
  const { nodes } = buildCatalog({
    config: { categories: [] }, folders: [], journalsIndex,
    getJournal: (id) => journalsIndex.find((j) => j._id === id),
  });
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  assert.equal(byId[ID('EL1')].type, 'elem-ambiance');
  assert.deepEqual(byId[ID('EL1')].elemData, { playlist: 'Cantina Band', weather: 'fog' });
  assert.equal(byId[ID('EL2')].type, 'elem-lecture');
  assert.equal(byId[ID('EL2')].elemData.texte, 'Vous débarquez.');
  assert.equal(byId[ID('FR1')].type, 'mj-front'); // les fiches MJ ne bougent pas
});

test('synchro : les sous-dossiers DIRECTS de la bible sont pertinents (rubriques/répertoires)', () => {
  const folders = [
    { _id: ID('BIB'), type: 'JournalEntry', name: '📖 Bible' },
    { _id: ID('LEC'), type: 'JournalEntry', name: '📣 Lectures', folder: ID('BIB') },
    { _id: ID('AUT'), type: 'JournalEntry', name: '🗄️ Bible — Archive (2026-07)' }, // hors bible
  ];
  const ids = relevantJournalFolderIds({ config: { gmBibleFolder: '📖 Bible', categories: [] }, folders });
  assert.ok(ids.has(ID('BIB')));
  assert.ok(ids.has(ID('LEC')), 'un chapitre rangé dans une rubrique reste synchronisé');
  assert.ok(!ids.has(ID('AUT')), 'l’archive ne devient jamais une collection servie');
});

/* --------------------------------------------------------------- étanchéité -- */
test('étanchéité : éléments et archive ne sortent JAMAIS par /api/content/*', () => {
  const SECRET = 'SPOILER-ELEMENT-BIBLE';
  const bibleFolder = { _id: ID('BIB'), type: 'JournalEntry', name: '📖 Bible' };
  const lecturesFolder = { _id: ID('LEC'), type: 'JournalEntry', name: '📣 Lectures', folder: ID('BIB') };
  const archFolder = { _id: ID('ARC'), type: 'JournalEntry', name: '🗄️ Bible — Archive (2026-07)' };
  const notesFolder = { _id: ID('NOT'), type: 'JournalEntry', name: '📓 Notes' };
  const elem = {
    _id: ID('EL1'), name: SECRET, folder: ID('LEC'), ownership: { default: 0 },
    flags: {
      'campaign-codex': { type: 'tag', data: { tags: ['elem:lecture'], texte: SECRET, description: SECRET } },
      holocron: { elemSheet: 'lecture' },
    },
    pages: [{ _id: ID('P1'), name: SECRET, type: 'text', text: { content: `<p>${SECRET}</p>` } }],
  };
  const archived = {
    _id: ID('AR1'), name: SECRET, folder: ID('ARC'), ownership: { default: 0 },
    flags: { holocron: { archivedFrom: { journalId: ID('CH1'), at: 1 } } },
    pages: [{ _id: ID('P2'), name: 'p', type: 'text', text: { content: `<p>${SECRET}</p>` } }],
  };
  const publicNote = {
    _id: ID('PUB'), name: 'Note publique', folder: ID('NOT'), ownership: { default: 2 },
    flags: {}, pages: [{ _id: ID('P3'), name: 'n', type: 'text', text: { content: '<p>ok</p>' } }],
  };
  const entries = [elem, archived, publicNote];
  const docs = Object.fromEntries(entries.map((e) => [`journal:${e._id}`, e]));
  const store = {
    get: (name) => (name === 'journalsIndex' ? entries
      : name === 'folders' ? [bibleFolder, lecturesFolder, archFolder, notesFolder]
        : docs[name] || null),
    version: () => 1,
  };
  // même avec une catégorie DÉCLARÉE par type CC `tag` (le pire cas plausible),
  // l'ownership {default:0} doit bloquer joueurs et anonymes.
  const config = () => ({
    meta: {}, packs: {}, journals: {}, gmBibleFolder: '📖 Bible',
    categories: [{ folder: '📓 Notes', kind: 'notes' }, { ccType: 'tag', kind: 'divers' }],
  });
  const svc = createContentService({ store, config });
  for (const session of [null, { userId: ID('U1'), role: 1 }]) {
    for (const view of ['journalsView', 'pcsView', 'timelineView', 'questsPlayerView']) {
      const json = JSON.stringify(svc[view](session) ?? {});
      assert.ok(!json.includes(SECRET), `${view} ne doit rien laisser filtrer (session ${session?.role ?? 'anonyme'})`);
    }
  }
  assert.ok(!JSON.stringify(svc.manifest()).includes(SECRET));
  // barrière n°2 : SANS catégorie déclarée (config réelle), même le MJ ne voit
  // ni élément ni archive par les vues publiques — la bible ne sort que gm-gated.
  const svcBare = createContentService({ store, config: () => ({ meta: {}, packs: {}, journals: {}, categories: [], gmBibleFolder: '📖 Bible' }) });
  const gmJson = JSON.stringify(svcBare.journalsView({ userId: ID('GM'), role: 4 }));
  assert.ok(!gmJson.includes(SECRET));
});
