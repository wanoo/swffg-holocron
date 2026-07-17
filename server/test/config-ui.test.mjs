// Tests du bloc `ui` de la config de campagne : fusion/assainissement
// (mergeUiConfig), rétrocompat (mondes sans bloc ui), exposition publique,
// et sélection du « dernier acte » (tri naturel par nom).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { mergeUiConfig, campaignConfig, publicConfig, UI_DEFAULTS } from '../lib/config.mjs';
import { latestByName } from '../../public/js/ui-shared.js';

const fakeStore = (config) => ({ get: (name) => (name === 'config' ? config : null) });

test('mergeUiConfig : patch partiel — les clés absentes sont préservées', () => {
  const base = { theme: 'force-sith', emblem: 'sith', dashboard: { order: ['a', 'b'], headerImage: 'x.png' } };
  const out = mergeUiConfig(base, { title: 'Ma campagne', dashboard: { resumeJournalId: 'abc' } });
  assert.equal(out.theme, 'force-sith');
  assert.equal(out.emblem, 'sith');
  assert.equal(out.title, 'Ma campagne');
  assert.deepEqual(out.dashboard.order, ['a', 'b']);
  assert.equal(out.dashboard.headerImage, 'x.png');
  assert.equal(out.dashboard.resumeJournalId, 'abc');
});

test('mergeUiConfig : assainissement — thème inconnu rejeté, listes bornées, ids nettoyés', () => {
  const out = mergeUiConfig(null, {
    theme: 'hot-pink',
    themeLocked: 'oui',
    emblem: 'Rebel Alliance!',
    title: '  Holocron  ',
    partsHidden: ['pj', 42, null, 'cat:abc'],
    dashboard: { order: ['status', { evil: true }], resumeJournalId: 'id<script>' },
  });
  assert.equal(out.theme, ''); // thème hors liste = pas de thème de monde
  assert.equal(out.themeLocked, true);
  assert.equal(out.emblem, 'ebellliance'); // caractères hors [a-z0-9-] retirés
  assert.equal(out.title, 'Holocron');
  assert.deepEqual(out.partsHidden, ['pj', 'cat:abc']);
  assert.deepEqual(out.dashboard.order, ['status']);
  assert.equal(out.dashboard.resumeJournalId, 'idscript');
});

test('mergeUiConfig : vider un champ est possible (chaîne vide = retour au défaut)', () => {
  const base = { theme: 'force-jedi', dashboard: { headerImage: 'x.png' } };
  const out = mergeUiConfig(base, { theme: '', dashboard: { headerImage: '' } });
  assert.equal(out.theme, '');
  assert.equal(out.dashboard.headerImage, '');
});

test('rétrocompat : config sans bloc ui → défauts complets (jamais undefined)', () => {
  const cc = campaignConfig(fakeStore({ meta: { title: 'Vieux monde' } }));
  assert.deepEqual(cc.ui, UI_DEFAULTS);
  const pub = publicConfig(cc);
  assert.deepEqual(pub.ui, UI_DEFAULTS);
});

test('publicConfig expose le bloc ui normalisé', () => {
  const cc = campaignConfig(fakeStore({ ui: { theme: 'age-of-rebellion', partsHidden: ['tools'] } }));
  const pub = publicConfig(cc);
  assert.equal(pub.ui.theme, 'age-of-rebellion');
  assert.deepEqual(pub.ui.partsHidden, ['tools']);
  assert.deepEqual(pub.ui.dashboard, UI_DEFAULTS.dashboard);
});

test('latestByName : tri naturel — « Acte 10 » après « Acte 2 »', () => {
  const acts = [{ name: 'Acte 1 — Départ' }, { name: 'Acte 10 — Chute' }, { name: 'Acte 2 — Fuite' }];
  assert.equal(latestByName(acts).name, 'Acte 10 — Chute');
});

test('latestByName : liste vide ou trous → null / éléments nuls ignorés', () => {
  assert.equal(latestByName([]), null);
  assert.equal(latestByName(null), null);
  assert.equal(latestByName([null, { name: 'Acte 3' }, undefined]).name, 'Acte 3');
});
