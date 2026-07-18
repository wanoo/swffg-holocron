// Tests du pont handout multi-média ciblé (POST /api/gm/foundry/handout) :
// validation d'entrée (checkHandout) et plan d'exécution par type (planHandout —
// image → share_image natif, chat → ChatMessage whisper, audio/vidéo → pont module).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { checkHandout, planHandout } from '../lib/session-tools.mjs';

const U1 = 'ABCDEFGHIJKLMNOP', U2 = 'QRSTUVWXYZABCDEF';

/* ---------------------------------------------------------------- validation -- */
test('checkHandout : types fermés, texte ou src requis', () => {
  assert.throws(() => checkHandout(null), /handout invalide/);
  assert.throws(() => checkHandout({ type: 'chat', text: '  ' }), /handout invalide/);
  assert.throws(() => checkHandout({ type: 'audio' }), /handout invalide/);
  // type inconnu → image par défaut… qui exige alors une src d'image valide
  assert.throws(() => checkHandout({ type: 'exec', src: 'worlds/x/a.mp3' }), /src image invalide/);
});

test('checkHandout : src = URL http(s) ou chemin Foundry avec extension DU type', () => {
  assert.equal(checkHandout({ type: 'video', src: 'worlds/demo/briefing.mp4' }).src, 'worlds/demo/briefing.mp4');
  assert.equal(checkHandout({ type: 'audio', src: 'worlds/demo/theme.mp3' }).type, 'audio');
  assert.equal(checkHandout({ type: 'image', src: 'https://exemple.test/x.png' }).src, 'https://exemple.test/x.png');
  assert.throws(() => checkHandout({ type: 'video', src: 'worlds/demo/pas-une-video.webp' }), /src video invalide/);
  assert.throws(() => checkHandout({ type: 'audio', src: '/etc/passwd' }), /src audio invalide/);
  assert.throws(() => checkHandout({ type: 'image', src: 'worlds/../secrets/x.png' }), /handout invalide/); // traversée → src vidée
});

/* --------------------------------------------------------------------- plans -- */
test('planHandout : image → outil natif share_image, users = targets (absent si table entière)', () => {
  const ciblee = planHandout(checkHandout({ type: 'image', src: 'worlds/d/x.webp', title: 'La carte', targets: [U1, U2] }));
  assert.deepEqual(ciblee, { kind: 'share_image', args: { image: 'worlds/d/x.webp', title: 'La carte', users: [U1, U2] } });
  const table = planHandout(checkHandout({ type: 'image', src: 'worlds/d/x.webp' }));
  assert.deepEqual(table.args, { image: 'worlds/d/x.webp', title: 'Holocron' });
});

test('planHandout : chat → ChatMessage réel, whisper si ciblé, en-tête 📜 échappé', () => {
  const p = planHandout(checkHandout({ type: 'chat', text: '<em>Un signal</em>', title: 'HoloNet <urgent>', targets: [U1] }));
  assert.equal(p.kind, 'chat-message');
  assert.deepEqual(p.message.whisper, [U1]);
  assert.ok(p.message.content.includes('📜 HoloNet &lt;urgent&gt;'), 'titre échappé dans l’en-tête');
  assert.ok(p.message.content.includes('<em>Un signal</em>'), 'HTML léger conservé');
  const pub = planHandout(checkHandout({ type: 'chat', text: 'à tous' }));
  assert.equal(pub.message.whisper, undefined, 'sans cible : message public');
  assert.ok(!pub.message.content.includes('📜'), 'pas d’en-tête sans titre');
});

test('planHandout : audio/vidéo → pont module (flag holocron.handout intact)', () => {
  for (const [type, src] of [['audio', 'worlds/d/theme.mp3'], ['video', 'worlds/d/scene.mp4']]) {
    const p = planHandout(checkHandout({ type, src, title: 'Ambiance', targets: [U2] }));
    assert.equal(p.kind, 'module-bridge');
    assert.deepEqual(p.flag, { type, src, title: 'Ambiance', targets: [U2] });
  }
});
