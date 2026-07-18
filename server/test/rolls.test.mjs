// Normalisation des résultats de jets FFG renvoyés par le connecteur.
// Les deux charges utiles ci-dessous sont des captures RÉELLES du gateway.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readSymbols } from '../lib/session-tools.mjs';

test('moteur natif du client : symboles déjà nets, repris tels quels', () => {
  const r = readSymbols({ advantage: 0, dark: 0, despair: 0, failure: 0, light: 0, success: 1, threat: 1, triumph: 1 });
  assert.deepEqual(r, { success: 1, threat: 1, triumph: 1 });
});

test('moteur serveur : bloc detail au pluriel, nets calculés', () => {
  const r = readSymbols({
    description: 'Perception',
    detail: { advantages: 4, dark: 0, despairs: 0, failures: 2, isSuccess: false, light: 0, netAdvantages: 3, netSuccesses: 0, successes: 2, threats: 1, triumphs: 0 },
  });
  assert.deepEqual(r, { advantage: 3 }); // 2 succès − 2 échecs = 0 ; 4 avantages − 1 menace = 3
});

test('échec net : failure positif, pas de success', () => {
  const r = readSymbols({ detail: { netSuccesses: -2, netAdvantages: 0, despairs: 1 } });
  assert.deepEqual(r, { failure: 2, despair: 1 });
});

test('sans charge utile exploitable : null', () => {
  assert.equal(readSymbols(null), null);
  assert.equal(readSymbols('texte'), null);
});

test('jet sans symbole net : objet neutre plutôt que null', () => {
  assert.deepEqual(readSymbols({ detail: { netSuccesses: 0, netAdvantages: 0 } }), { success: 0 });
});
