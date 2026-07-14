// show-image.js — « 📡 Montrer aux joueurs » (profil MJ) : envoie une image à tous
// les clients Foundry via POST /api/gm/foundry/show-image → le module Foundry ouvre
// un ImagePopout partagé (pont par ChatMessage flaggé, comme le pont de jets).
import { Data } from './data.js';
import { getGMKey } from './collab.js';

const canShow = () => Boolean(Data.gm || getGMKey());

// Reconvertit un src AFFICHÉ par l'Holocron vers un chemin que les clients Foundry
// savent charger. Jamais d'URL /api/… : l'Holocron leur est inconnu, et le ?k= du
// proxy MJ fuiterait la clé dans le chat Foundry.
export function toFoundrySrc(src) {
  const s = String(src || '').trim();
  if (/^https?:\/\//i.test(s)) {
    try {
      const u = new URL(s);
      if (u.origin === location.origin) return toFoundrySrc(u.pathname);
    } catch { /* URL invalide : laissée telle quelle */ }
    return s; // image externe : telle quelle
  }
  let m = /^\/api\/gm\/asset\/(.+?)(?:\?.*)?$/.exec(s);
  if (m) return decodeURIComponent(m[1]);
  m = /^\/api\/asset\/(.+?)(?:\?.*)?$/.exec(s);
  if (m) return m[1].split('/').map(decodeURIComponent).join('/'); // inverse de foundryAsset()
  return s.replace(/^\//, ''); // déjà un chemin Foundry relatif (worlds/…, icons/…)
}

export async function showToPlayers(src, title = '') {
  const headers = { 'Content-Type': 'application/json' };
  if (getGMKey()) headers['x-gm-key'] = getGMKey();
  const r = await fetch('/api/gm/foundry/show-image', {
    method: 'POST', credentials: 'same-origin', headers,
    body: JSON.stringify({ src, title }),
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
}

// Ajoute le bouton d'envoi dans un overlay plein écran (lightbox, portrait…).
// `src` = src affiché OU chemin Foundry direct ; no-op si le profil n'est pas MJ.
export function addShowButton(overlay, src, title = '') {
  if (!canShow()) return;
  overlay.querySelector('.show-players-btn')?.remove();
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'show-players-btn';
  btn.textContent = '📡 Montrer aux joueurs';
  btn.title = "Affiche l'image à tous les joueurs dans Foundry (nécessite un client MJ Foundry ouvert)";
  btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    btn.disabled = true;
    btn.textContent = '📡 Envoi…';
    try {
      await showToPlayers(toFoundrySrc(src), title);
      btn.textContent = '✅ Envoyée aux joueurs';
    } catch (err) {
      btn.textContent = '⚠️ ' + String(err.message || 'échec').slice(0, 60);
    }
    setTimeout(() => { btn.disabled = false; btn.textContent = '📡 Montrer aux joueurs'; }, 2500);
  });
  overlay.appendChild(btn);
}
