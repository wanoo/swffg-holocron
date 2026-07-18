// Tests de l'éditeur de campagne : assainissement du board (GET/PUT), des
// séquences de handouts, du sommaire d'acte (+ vue joueur masquable) et
// construction du catalogue (fiches CC + actes, atlas astronav exclu).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { sanitizeBoard, sanitizeSequence, buildCatalog, EDGE_TYPES } from '../lib/board.mjs';
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
