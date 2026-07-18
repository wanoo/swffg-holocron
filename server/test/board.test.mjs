// Tests de l'éditeur de campagne : assainissement du board (GET/PUT), des
// séquences de handouts, du sommaire d'acte (+ vue joueur masquable) et
// construction du catalogue (fiches CC + actes, atlas astronav exclu).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  sanitizeBoard, sanitizeSequence, sanitizeHandout, HANDOUT_TYPES, buildCatalog, EDGE_TYPES,
  sanitizeStoryboard, actTagOps, actNumberOf, ACT_TAG_PREFIX,
} from '../lib/board.mjs';
import { sanitizeActSummary, actSummaryView } from '../lib/transform/journals.mjs';

/* ------------------------------------------------------------------- board -- */
test('sanitizeBoard : positions clampées, ids invalides rejetés, son conservé', () => {
  const out = sanitizeBoard({
    nodes: {
      ABCDEFGHIJKLMNOP: { x: 120.7, y: -99999, pinned: 1, sound: { playlist: 'Cantina' } },
      'seq:abc': { x: 10, y: 20 },
      '<script>': { x: 0, y: 0 },
      BADNODE123456789: 'pas un objet',
    },
    edges: 'pas une liste',
    hidden: ['ABCDEFGHIJKLMNOP', '../etc', 42],
  });
  assert.deepEqual(Object.keys(out.nodes).sort(), ['ABCDEFGHIJKLMNOP', 'seq:abc']);
  assert.equal(out.nodes.ABCDEFGHIJKLMNOP.x, 121);
  assert.equal(out.nodes.ABCDEFGHIJKLMNOP.y, -20000); // clamp
  assert.equal(out.nodes.ABCDEFGHIJKLMNOP.pinned, true);
  assert.deepEqual(out.nodes.ABCDEFGHIJKLMNOP.sound, { playlist: 'Cantina' });
  assert.equal(out.nodes['seq:abc'].sound, undefined);
  assert.deepEqual(out.edges, []);
  assert.deepEqual(out.hidden, ['ABCDEFGHIJKLMNOP']);
});

test('sanitizeBoard : arêtes custom — libellé borné, doublons et boucles retirés', () => {
  const out = sanitizeBoard({
    nodes: {},
    edges: [
      { from: 'A1', to: 'B2', label: 'x'.repeat(200) },
      { from: 'A1', to: 'B2', label: 'doublon' },
      { from: 'A1', to: 'A1' },
      { from: 'A1' },
      null,
      { from: 'B2', to: 'A1' },
    ],
  });
  assert.equal(out.edges.length, 2);
  assert.equal(out.edges[0].label.length, 80);
  assert.deepEqual(out.edges[1], { from: 'B2', to: 'A1' });
});

test('sanitizeBoard : type de relation — table fermée, inconnu retiré', () => {
  const out = sanitizeBoard({ edges: [
    { from: 'A1', to: 'B2', type: 'revele' },
    { from: 'B2', to: 'C3', type: 'hack<script>' },
  ] });
  assert.equal(out.edges[0].type, 'revele');
  assert.equal(out.edges[1].type, undefined);
  assert.ok(EDGE_TYPES.revele.fwd && EDGE_TYPES.revele.back, 'libellés aller/retour');
});

test('sanitizeBoard : entrée vide/malveillante → board par défaut', () => {
  assert.deepEqual(sanitizeBoard(null), { nodes: {}, edges: [], hidden: [] });
  assert.deepEqual(sanitizeBoard('__proto__'), { nodes: {}, edges: [], hidden: [] });
});

/* --------------------------------------------------------------- séquences -- */
test('sanitizeSequence : items bornés, src sans traversée, id généré', () => {
  const out = sanitizeSequence({
    name: 'Séance 12' + 'x'.repeat(200),
    items: [
      { src: 'worlds/star-wars/assets/handout1.webp', title: 'Le message', note: 'lu par Maz' },
      { src: '../../etc/passwd', title: 'niet' },
      { title: 'sans image' },
      { src: 'https://exemple.test/img.png' },
    ],
  });
  assert.match(out.id, /^seq-/);
  assert.equal(out.name.length, 80);
  assert.equal(out.items.length, 2);
  assert.equal(out.items[0].src, 'worlds/star-wars/assets/handout1.webp');
  assert.equal(out.items[1].src, 'https://exemple.test/img.png');
});

/* ---------------------------------------------------------------- handouts -- */
test('sanitizeHandout : type fermé, src bornée sans traversée, targets = ids Foundry dédupliqués', () => {
  assert.deepEqual(HANDOUT_TYPES, ['image', 'audio', 'video', 'chat']);
  const out = sanitizeHandout({
    type: 'video', src: '  worlds/demo/briefing.mp4  ', title: 't'.repeat(200),
    targets: ['ABCDEFGHIJKLMNOP', 'ABCDEFGHIJKLMNOP', 'pas-un-id', '<script>', 'QRSTUVWXYZABCDEF', 42],
  });
  assert.equal(out.type, 'video');
  assert.equal(out.src, 'worlds/demo/briefing.mp4');
  assert.equal(out.title.length, 120);
  assert.deepEqual(out.targets, ['ABCDEFGHIJKLMNOP', 'QRSTUVWXYZABCDEF']);
  assert.equal(sanitizeHandout({ type: 'image', src: '../../etc/passwd' }), null, 'traversée rejetée');
  assert.equal(sanitizeHandout({ type: 'hack', src: 'x'.repeat(400) }).type, 'image', 'type inconnu → image');
  assert.equal(sanitizeHandout({ type: 'image', src: 'x'.repeat(400) }).src.length, 300, 'src ≤ 300');
  assert.equal(sanitizeHandout({ type: 'audio' }), null, 'média sans src → null');
  assert.equal(sanitizeHandout('niet'), null);
});

test('sanitizeHandout : chat — texte requis ≤ 4000, HTML léger sans script/handlers, targets ≤ 30', () => {
  const out = sanitizeHandout({
    type: 'chat', title: 'Message de Maz',
    text: '<p onclick="hack()">Bonjour</p><script>evil()</script><em>fin</em><a href="javascript:x()">l</a>' + 'x'.repeat(5000),
    targets: Array.from({ length: 40 }, (_, i) => `USER${i}`.padEnd(16, '0').slice(0, 16)),
  });
  assert.equal(out.type, 'chat');
  assert.equal(out.src, undefined);
  assert.ok(out.text.includes('<p>Bonjour</p>') && out.text.includes('<em>fin</em>'), 'HTML léger conservé');
  assert.ok(!/script|onclick|javascript:/i.test(out.text), 'script/handlers retirés');
  assert.ok(out.text.length <= 4000);
  assert.equal(out.targets.length, 30);
  assert.equal(sanitizeHandout({ type: 'chat', text: '   ' }), null, 'chat sans texte → null');
  assert.equal(sanitizeHandout({ type: 'chat', text: 'ok' }).targets, undefined, 'sans cible = toute la table');
});

test('sanitizeSequence : items multi-média — rétrocompat sans type = image, targets conservés', () => {
  const out = sanitizeSequence({ id: 'seq-mixte', items: [
    { src: 'worlds/demo/handout.webp', title: 'Legacy', note: 'sans type' },
    { type: 'audio', src: 'worlds/demo/theme.mp3', targets: ['ABCDEFGHIJKLMNOP'] },
    { type: 'chat', text: '<em>Un message urgent…</em>', title: 'HoloNet' },
    { type: 'chat', text: '' }, // chat vide : retiré
  ] });
  assert.equal(out.items.length, 3);
  assert.equal(out.items[0].type, 'image', 'item legacy sans type = image');
  assert.equal(out.items[0].note, 'sans type', 'la note MJ reste portée par l’item');
  assert.deepEqual(out.items[1].targets, ['ABCDEFGHIJKLMNOP']);
  assert.equal(out.items[2].text, '<em>Un message urgent…</em>');
  assert.equal(out.items[2].src, undefined);
});

/* --------------------------------------------------------------- storyboard -- */
test('sanitizeStoryboard : kinds/status en table fermée, uuids normalisés dédupliqués', () => {
  const out = sanitizeStoryboard({ beats: [
    {
      id: 'beat-abc', kind: 'combat', title: ' L’abordage ' + 'x'.repeat(200), note: 'n'.repeat(3000),
      uuids: ['JournalEntry.ABCDEFGHIJKLMNOP::page', 'QRSTUVWXYZABCDEF', 'ABCDEFGHIJKLMNOP', 'pas-un-id', 42],
      encounterId: 'enc-12345678', sequenceId: 'seq-x', status: 'encours', x: 120.6, y: -99999,
    },
    { kind: 'inconnu', status: 'hack', title: 'défauts' },
    { id: 'beat-abc', kind: 'note', title: 'id dupliqué → retiré' },
    'pas un objet',
  ] });
  assert.equal(out.beats.length, 2);
  const [b1, b2] = out.beats;
  assert.equal(b1.title.length, 120);
  assert.equal(b1.note.length, 2000);
  assert.deepEqual(b1.uuids, ['JournalEntry.ABCDEFGHIJKLMNOP', 'JournalEntry.QRSTUVWXYZABCDEF']);
  assert.equal(b1.encounterId, 'enc-12345678'); // kind combat : rencontre gardée
  assert.equal(b1.sequenceId, undefined); // … mais pas de séquence sur un combat
  assert.equal(b1.status, 'encours');
  assert.equal(b1.x, 121);
  assert.equal(b1.y, -20000); // clamp
  assert.equal(b2.kind, 'scene'); // kind inconnu → scène
  assert.equal(b2.status, 'todo');
  assert.match(b2.id, /^beat-/);
  assert.equal(b2.x, undefined, 'position absente non inventée');
});

test('sanitizeStoryboard : pièces jointes selon le kind (séquence ≠ note, son partout)', () => {
  const out = sanitizeStoryboard({ beats: [
    { id: 'b1', kind: 'handout', sequenceId: 'seq-abc', encounterId: 'enc-abc', sound: { playlist: 'Cantina' } },
    { id: 'b2', kind: 'note', sequenceId: 'seq-abc', sound: { playlist: 'x'.repeat(300) } },
  ] });
  assert.equal(out.beats[0].sequenceId, 'seq-abc');
  assert.equal(out.beats[0].encounterId, undefined, 'rencontre réservée au kind combat');
  assert.deepEqual(out.beats[0].sound, { playlist: 'Cantina' });
  assert.equal(out.beats[1].sequenceId, undefined);
  assert.equal(out.beats[1].sound.playlist.length, 100);
});

test('sanitizeStoryboard : handout UNITAIRE inline réservé au kind handout, assaini', () => {
  const out = sanitizeStoryboard({ beats: [
    { id: 'b1', kind: 'handout', handout: { type: 'chat', text: 'Un datapad grésille…', targets: ['ABCDEFGHIJKLMNOP'] } },
    { id: 'b2', kind: 'scene', handout: { type: 'image', src: 'worlds/demo/x.webp' } },
    { id: 'b3', kind: 'handout', handout: { type: 'image', src: '' } }, // vide : retiré
  ] });
  assert.deepEqual(out.beats[0].handout, { type: 'chat', title: '', text: 'Un datapad grésille…', targets: ['ABCDEFGHIJKLMNOP'] });
  assert.equal(out.beats[1].handout, undefined, 'inline réservé au kind handout');
  assert.equal(out.beats[2].handout, undefined, 'handout vide retiré');
});

test('sanitizeStoryboard : entrée vide/malveillante → { beats: [] }', () => {
  assert.deepEqual(sanitizeStoryboard(null), { beats: [] });
  assert.deepEqual(sanitizeStoryboard({ beats: 'niet' }), { beats: [] });
});

test('actNumberOf : numéro du nom d’acte, sinon rang dans les actes triés', () => {
  const story = [{ _id: 'A', name: 'Prologue' }, { _id: 'B', name: 'Acte 6 — Chute' }, { _id: 'C', name: 'Finale' }];
  assert.equal(actNumberOf(story[1], story), 6);
  assert.equal(actNumberOf(story[0], story), 1);
  assert.equal(actNumberOf(story[2], story), 3);
  assert.equal(ACT_TAG_PREFIX + actNumberOf(story[1], story), 'mj:acte-6');
});

test('actTagOps : idempotent — pose sur les référencées, retire ailleurs, CC only', () => {
  const cc = (id, name, tags, extra = {}) =>
    ({ _id: id, name, flags: { 'campaign-codex': { type: 'npc', data: { tags } }, ...extra } });
  const journalsIndex = [
    cc('NPC1000000000001', 'Maz', ['Favori']),                       // référencée, pas de tag → pose
    cc('NPC2000000000002', 'Krayt', ['mj:acte-6', 'Favori']),        // référencée, déjà taguée → rien
    cc('NPC3000000000003', 'Oublié', ['mj:acte-6']),                 // plus référencée → retrait
    cc('ATL4000000000004', 'Planète', [], { 'swffg-astronavigation': { uid: 'x' } }), // atlas : jamais
    { _id: 'ACTE000000000005', name: 'Acte 6', flags: { holocron: {} } }, // pas une fiche CC
  ];
  const uuids = ['JournalEntry.NPC1000000000001', 'JournalEntry.NPC2000000000002'];
  const ops = actTagOps({ tag: 'mj:acte-6', uuids, journalsIndex, getJournal: () => null });
  assert.deepEqual(ops.add, [{ id: 'NPC1000000000001', tags: ['Favori', 'mj:acte-6'] }]);
  assert.deepEqual(ops.remove, [{ id: 'NPC3000000000003', tags: [] }]);
  // retrait complet (« retirable ») : uuids vides → toutes les porteuses perdent le tag
  const off = actTagOps({ tag: 'mj:acte-6', uuids: [], journalsIndex, getJournal: () => null });
  assert.deepEqual(off.add, []);
  assert.deepEqual(off.remove.map((o) => o.id), ['NPC2000000000002', 'NPC3000000000003']);
  assert.deepEqual(off.remove[0].tags, ['Favori'], 'les autres tags survivent');
});

test('buildCatalog : le storyboard d’un acte sort dans le catalogue (assaini)', () => {
  const F = { actes: 'FACT000000000001' };
  const folders = [{ _id: F.actes, name: '🎬 Actes', type: 'JournalEntry' }];
  const config = { categories: [{ folder: '🎬 Actes', kind: 'story' }], journals: {} };
  const journalsIndex = [
    { _id: 'ACTE000000000001', name: 'Acte 1', folder: F.actes, sort: 1, ownership: { default: 2 },
      flags: { holocron: { storyboard: { beats: [{ id: 'b1', kind: 'scene', title: 'Ouverture', status: 'fait' }, 'niet'] } } } },
    { _id: 'ACTE000000000002', name: 'Acte 2', folder: F.actes, sort: 2, ownership: { default: 2 }, flags: {} },
  ];
  const cat = buildCatalog({ config, folders, journalsIndex, getJournal: () => null });
  const a1 = cat.nodes.find((n) => n.id === 'ACTE000000000001');
  assert.equal(a1.storyboard.beats.length, 1);
  assert.equal(a1.storyboard.beats[0].status, 'fait');
  const a2 = cat.nodes.find((n) => n.id === 'ACTE000000000002');
  assert.equal(a2.storyboard, undefined, 'pas de storyboard vide dans le catalogue');
});

/* ---------------------------------------------------------- sommaire d'acte -- */
test('sanitizeActSummary : champs bornés, uuids normalisés, hidden filtré', () => {
  const out = sanitizeActSummary({
    crawl: 'Il est une période de guerre civile…',
    situation: '<p>Les PJ sont recherchés.</p>',
    objectifs: ['Livrer la cargaison', '', 42],
    protagonistes: ['JournalEntry.ABCDEFGHIJKLMNOP::x', 'QRSTUVWXYZABCDEF', 'pas-un-id'],
    lieux: ['JournalEntry.LIEU000000000001'],
    fronts: ['L’Empire resserre l’étau'],
    hidden: ['fronts', 'crawl', 'pasunchamp'],
  });
  assert.deepEqual(out.objectifs, ['Livrer la cargaison']);
  assert.deepEqual(out.protagonistes, ['ABCDEFGHIJKLMNOP', 'QRSTUVWXYZABCDEF']);
  assert.deepEqual(out.lieux, ['LIEU000000000001']);
  assert.deepEqual(out.hidden, ['fronts', 'crawl']);
});

test('sanitizeActSummary : bloc vide → null (rien à afficher)', () => {
  assert.equal(sanitizeActSummary(null), null);
  assert.equal(sanitizeActSummary({ crawl: '', objectifs: [] }), null);
});

test('actSummaryView : le joueur ne voit JAMAIS les champs masqués ni hidden', () => {
  const raw = {
    crawl: 'Ouverture', situation: 'Ça brûle', fronts: ['SPOILER MJ'],
    hidden: ['fronts'],
  };
  const player = actSummaryView(raw, false);
  assert.equal(player.crawl, 'Ouverture');
  assert.equal(player.fronts, undefined);
  assert.equal(player.hidden, undefined);
  const gm = actSummaryView(raw, true);
  assert.deepEqual(gm.fronts, ['SPOILER MJ']); // le MJ voit tout (éditeur)
  assert.deepEqual(gm.hidden, ['fronts']);
});

test('actSummaryView : tout masqué → null pour le joueur', () => {
  const raw = { situation: 'secret', hidden: ['situation'] };
  assert.equal(actSummaryView(raw, false), null);
  assert.ok(actSummaryView(raw, true));
});

/* ---------------------------------------------------------------- catalogue -- */
const ID = (n) => n.padEnd(16, '0').slice(0, 16);
const entry = (id, name, { folder = null, flags = {}, sort = 0, ownership = { default: 2 } } = {}) =>
  ({ _id: ID(id), name, folder, sort, flags, ownership });

test('buildCatalog : actes + fiches CC, liens auto, atlas astronav exclu', () => {
  const F = { actes: ID('FACT'), atlas: ID('FATL') };
  const folders = [{ _id: F.actes, name: '🎬 Actes', type: 'JournalEntry' }];
  const config = { categories: [{ folder: '🎬 Actes', kind: 'story' }], journals: {} };
  const npcId = ID('NPC1'), orgId = ID('ORG1'), lieuId = ID('LIEU'), atlasId = ID('PLAN');
  const q1 = ID('QST1'), q2 = ID('QST2');
  const journalsIndex = [
    entry('ACT1', 'Acte 1', { folder: F.actes, sort: 10, flags: { holocron: { actSummary: { crawl: 'Ouverture' } } } }),
    entry('NPC1', 'Maz', { flags: { 'campaign-codex': { type: 'npc' }, holocron: { statut: 'allie' } } }),
    entry('ORG1', 'Soleil Noir', { flags: { 'campaign-codex': { type: 'group' } } }),
    entry('LIEU', 'Ord Mantell', { flags: { 'campaign-codex': { type: 'location' } } }),
    entry('PLAN', 'Coruscant (atlas)', { flags: { 'campaign-codex': { type: 'location' }, 'swffg-astronavigation': { uid: 'coruscant' } } }),
    entry('QST1', 'Livrer', { flags: { 'campaign-codex': { type: 'quest' } } }),
    entry('QST2', 'Prime', { flags: { 'campaign-codex': { type: 'quest' } }, ownership: { default: 0 } }),
    entry('CONF', '⚙️ Holocron Config', { flags: { holocron: { config: {} } } }),
  ];
  const docs = {
    [npcId]: { _id: npcId, flags: { 'campaign-codex': { type: 'npc', data: {
      associates: [`JournalEntry.${orgId}`], linkedLocations: [`JournalEntry.${lieuId}`, `JournalEntry.${atlasId}`],
    } } }, pages: [{ _id: 'p', src: 'assets/maz.png' }] },
    [q1]: { _id: q1, flags: { 'campaign-codex': { type: 'quest', data: { quests: [{ unlocks: [`JournalEntry.${q2}::a`] }] } } }, pages: [] },
    [q2]: { _id: q2, flags: { 'campaign-codex': { type: 'quest', data: { quests: [{ dependencies: [`JournalEntry.${q1}::a`] }] } } }, pages: [] },
  };
  const cat = buildCatalog({ config, folders, journalsIndex, getJournal: (id) => docs[id] || null });

  const byId = new Map(cat.nodes.map((n) => [n.id, n]));
  assert.ok(byId.has(ID('ACT1')) && byId.get(ID('ACT1')).type === 'acte');
  assert.equal(byId.get(ID('ACT1')).actSummary.crawl, 'Ouverture');
  assert.equal(byId.get(npcId).type, 'npc');
  assert.equal(byId.get(npcId).statut, 'allie');
  assert.equal(byId.get(npcId).img, 'assets/maz.png');
  assert.equal(byId.get(orgId).type, 'group');
  assert.equal(byId.get(lieuId).type, 'location');
  assert.ok(!byId.has(atlasId), 'atlas astronav exclu');
  assert.ok(!byId.has(ID('CONF')), 'journal technique exclu');
  assert.equal(byId.get(npcId).playerVisible, true, 'ownership 2 → visible joueurs');
  assert.equal(byId.get(q2).playerVisible, false, 'ownership 0 → MJ-only (pastille 🙈)');

  // liens auto : associates + linkedLocations (vers l'atlas : abandonné), quêtes dédupliquées
  const rels = cat.edges.map((e) => `${e.from}>${e.to}:${e.rel}`).sort();
  assert.ok(rels.includes(`${npcId}>${orgId}:Associé`));
  assert.ok(rels.includes(`${npcId}>${lieuId}:Lieu`));
  assert.ok(!rels.some((r) => r.includes(atlasId)), 'arête vers l’atlas retirée');
  assert.deepEqual(cat.edges.filter((e) => e.rel === 'débloque'), [{ from: q1, to: q2, rel: 'débloque' }]);
});
