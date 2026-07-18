// Tests de la vue quêtes JOUEUR-SAFE (/api/content/quests) : filtrage par
// visibilité de session (canSee), statut dérivé de data.quests[0], et surtout
// AUCUN champ de graphe (unlocks/dependencies/uuids liés = spoilers MJ).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createContentService } from '../lib/content.mjs';

const ccQuest = (q, extra = {}) => ({ 'campaign-codex': { type: 'quest', data: { quests: [q] }, ...extra } });

const entries = [
  { _id: 'q1AAAAAAAAAAAAAA', name: 'Sauver Hera', ownership: { default: 2 },
    flags: ccQuest({ unlocks: ['JournalEntry.q2AAAAAAAAAAAAAA::x'], dependencies: [] }) },
  { _id: 'q2AAAAAAAAAAAAAA', name: 'Aider Ryloth', ownership: { default: 2 },
    flags: ccQuest({ completed: true }) },
  { _id: 'q3AAAAAAAAAAAAAA', name: 'Trahison secrète', ownership: { default: 0 },
    flags: ccQuest({ inactive: true }) },
  { _id: 'q4AAAAAAAAAAAAAA', name: 'Dette d’Alice', ownership: { default: 0, u1aaaaaaaaaaaaaa: 2 },
    flags: { ...ccQuest({ failed: true }), holocron: { legacyId: 'dette-alice' } } },
  { _id: 'npAAAAAAAAAAAAAA', name: 'Pas une quête', ownership: { default: 2 },
    flags: { 'campaign-codex': { type: 'npc', data: {} } } },
];

const store = {
  get: (name) => (name === 'journalsIndex' ? entries : null),
  version: () => 1,
};
const svc = createContentService({ store, config: () => ({ meta: {}, categories: [], packs: {}, journals: {} }) });

test('vue quêtes joueur : anonyme → fiches default ≥ 2 seulement, sans champs de graphe', () => {
  const { quests } = svc.questsPlayerView(null);
  assert.deepEqual(quests.map((q) => q.name), ['Aider Ryloth', 'Sauver Hera']); // tri par nom
  for (const q of quests) {
    assert.deepEqual(Object.keys(q).sort(), ['id', 'name', 'status']); // JAMAIS unlocks/dependencies
  }
  assert.equal(quests.find((q) => q.name === 'Sauver Hera').status, 'active');
  assert.equal(quests.find((q) => q.name === 'Aider Ryloth').status, 'completed');
});

test('vue quêtes joueur : ownership par utilisateur respecté + id legacy exposé', () => {
  const alice = { userId: 'u1aaaaaaaaaaaaaa', role: 1 };
  const { quests } = svc.questsPlayerView(alice);
  const dette = quests.find((q) => q.name === 'Dette d’Alice');
  assert.ok(dette, 'Alice voit sa quête personnelle');
  assert.equal(dette.id, 'dette-alice'); // flags.holocron.legacyId prioritaire
  assert.equal(dette.status, 'failed');
  assert.equal(quests.find((q) => q.name === 'Trahison secrète'), undefined);
});

test('vue quêtes joueur : le MJ voit tout, y compris les statuts inactifs', () => {
  const gm = { userId: 'gm', role: 4 };
  const { quests } = svc.questsPlayerView(gm);
  assert.equal(quests.length, 4);
  assert.equal(quests.find((q) => q.name === 'Trahison secrète').status, 'inactive');
});

test('vue quêtes joueur : versionnée pour l’ETag (clé quests présente)', () => {
  assert.equal(typeof svc.versions().quests, 'number');
});
