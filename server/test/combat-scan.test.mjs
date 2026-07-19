// Moulinette « combats en texte → bibliothèque de rencontres ». Enjeu : ce qui
// est proposé doit être STRICTEMENT ce que le bloc dit (même grammaire que le
// tracker du front), et re-scanner deux fois ne doit jamais créer de doublon.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { extractCombatBlocks, parseCombatBlock, scanChapters } from '../lib/transform/combat-scan.mjs';

const BLOCK = [
  'id: hangar-12',
  'title: Embuscade au hangar 12',
  'map: worlds/star-wars/maps/hangar.webp',
  'note: Déclenché si les PJ forcent la porte.',
  '== Vague 1 ==',
  'Pillard weequay | ×4 | W12 | 3 | Blaster — Dég 6 · Crit 3 | Sbires',
  'Chef de bande | ×1 | W18 S15 | 4 | Vibrolame — Dég 7 | Némésis',
  '== Renforts ==',
  'Droïde de sécurité | ×2 | W14 | 5 | Canon — Dég 8 |',
].join('\n');

test('parseCombatBlock : méta, groupes et lignes de combattants', () => {
  const spec = parseCombatBlock(BLOCK);
  assert.equal(spec.id, 'hangar-12');
  assert.equal(spec.title, 'Embuscade au hangar 12');
  assert.equal(spec.map, 'worlds/star-wars/maps/hangar.webp');
  assert.match(spec.note, /forcent la porte/);
  assert.deepEqual(spec.groups.map((g) => g.name), ['Vague 1', 'Renforts']);
  assert.deepEqual(spec.groups[0].rows[0], {
    name: 'Pillard weequay', count: 4, w: 12, s: 0, soak: '3',
    attack: 'Blaster — Dég 6 · Crit 3', key: 'Sbires',
  });
  assert.equal(spec.groups[0].rows[1].s, 15);
});

test('parseCombatBlock : « ×N » devient un NOMBRE borné 1..12 (format bibliothèque)', () => {
  const spec = parseCombatBlock('Sbire | ×99 | W5\nSolo | (unique) | W9');
  assert.equal(spec.groups[0].rows[0].count, 12);
  assert.equal(spec.groups[0].rows[1].count, 1); // pas de nombre → 1
});

test('parseCombatBlock : groupe implicite quand le bloc n’en déclare aucun', () => {
  const spec = parseCombatBlock('Stormtrooper | ×6 | W12 | 4 | E-11 | ');
  assert.equal(spec.groups.length, 1);
  assert.equal(spec.groups[0].name, '');
  assert.equal(spec.groups[0].rows.length, 1);
});

test('parseCombatBlock : les lignes sans « | » ne sont pas des combattants', () => {
  const spec = parseCombatBlock('Du texte libre au milieu\nSbire | ×2 | W5');
  assert.equal(spec.groups[0].rows.length, 1);
});

test('extractCombatBlocks : <pre class="combat">, <code class="language-combat"> et ```combat', () => {
  assert.equal(extractCombatBlocks('<pre class="combat">Sbire | ×2</pre>').length, 1);
  assert.equal(extractCombatBlocks('<pre class="lang combat x">Sbire | ×2</pre>').length, 1);
  assert.equal(extractCombatBlocks('<pre><code class="language-combat">Sbire | ×2</code></pre>').length, 1);
  assert.equal(extractCombatBlocks('```combat\nSbire | ×2\n```').length, 1);
  assert.equal(extractCombatBlocks('<pre class="js">const x = 1;</pre>').length, 0);
  assert.equal(extractCombatBlocks('').length, 0);
});

test('extractCombatBlocks : entités HTML décodées, <br> → saut de ligne', () => {
  const [raw] = extractCombatBlocks('<pre class="combat">title: Duel&nbsp;&amp; poursuite<br>Sbire | ×2 | W5</pre>');
  assert.match(raw, /Duel & poursuite/);
  const spec = parseCombatBlock(raw);
  assert.equal(spec.title, 'Duel & poursuite');
  assert.equal(spec.groups[0].rows[0].name, 'Sbire');
});

const chapters = [
  { id: 'gm-acte-3', name: 'Acte 3 — Ryloth', html: `<h2>Combat</h2><pre class="combat">${BLOCK}</pre>` },
  { id: 'gm-annexes', name: 'Annexes', html: `<pre class="combat">${BLOCK}</pre>` }, // le MÊME bloc, recopié
  { id: 'gm-vide', name: 'Notes', html: '<p>Rien à combattre ici.</p>' },
];

test('scanChapters : une proposition par bloc, dédupliquée quand la bible se répète', () => {
  const found = scanChapters(chapters);
  assert.equal(found.length, 1); // le bloc copié dans deux chapitres ne compte qu'une fois
  assert.equal(found[0].chapterId, 'gm-acte-3');
  assert.equal(found[0].encounter.id, 'hangar-12');
  assert.equal(found[0].encounter.title, 'Embuscade au hangar 12');
  assert.equal(found[0].exists, false);
});

test('scanChapters : idempotent — deux scans proposent exactement les mêmes ids', () => {
  const a = scanChapters(chapters).map((f) => f.encounter.id);
  const b = scanChapters(chapters).map((f) => f.encounter.id);
  assert.deepEqual(a, b);
});

test('scanChapters : marque ce qui est DÉJÀ en bibliothèque (par id puis par titre)', () => {
  const byId = scanChapters(chapters, [{ id: 'hangar-12', title: 'Autre nom' }]);
  assert.equal(byId[0].exists, true);
  assert.equal(byId[0].reason, 'même id');
  const byTitle = scanChapters(chapters, [{ id: 'zzz', title: 'Embuscade au hangar 12' }]);
  assert.equal(byTitle[0].exists, true);
  assert.equal(byTitle[0].reason, 'même titre');
});

test('scanChapters : bloc sans titre → titre dérivé du chapitre ; bloc sans combattant ignoré', () => {
  const found = scanChapters([
    { id: 'c1', name: 'Acte 1', html: '<pre class="combat">Garde | ×2 | W10</pre>' },
    { id: 'c2', name: 'Acte 2', html: '<pre class="combat">note: rien ici</pre>' },
  ]);
  assert.equal(found.length, 1);
  assert.match(found[0].encounter.title, /Acte 1/);
  assert.match(found[0].encounter.id, /^enc-/);
});

test('scanChapters : la sortie a la FORME attendue par la bibliothèque', () => {
  const [{ encounter }] = scanChapters(chapters);
  assert.deepEqual(Object.keys(encounter).sort(), ['groups', 'id', 'map', 'note', 'title']);
  for (const g of encounter.groups) {
    for (const r of g.rows) {
      assert.deepEqual(Object.keys(r).sort(), ['attack', 'count', 'key', 'name', 's', 'soak', 'w']);
    }
  }
});

test('« W7/grp » : le seuil partagé est dit dans la note clé, jamais perdu', () => {
  const spec = parseCombatBlock('Belonuk | ×4 | W7/grp | 4 | Croc | meute');
  assert.equal(spec.groups[0].rows[0].w, 7);
  assert.equal(spec.groups[0].rows[0].key, 'meute · seuil par groupe');
  // le bloc qui le dit déjà n'est pas paraphrasé
  assert.equal(parseCombatBlock('Belonuk | ×4 | W7/grp | 4 | Croc | sbires en groupe')
    .groups[0].rows[0].key, 'sbires en groupe');
  // seuil individuel : rien n'est ajouté
  assert.equal(parseCombatBlock('Chef | ×1 | W18 S15 | 4 | Lame | némésis')
    .groups[0].rows[0].key, 'némésis');
});
