// login.js — connexion avec son compte FOUNDRY (mêmes identifiants que le jeu).
// Modale : choix de l'utilisateur (liste du monde) + mot de passe. La session
// (cookie signé) pilote ensuite ce que le serveur laisse voir et éditer :
// MJ = rôle Foundry ≥ Assistant ; joueur = ses notes, ses jets signés.
import { Data, login, logout, listUsers, reloadJournals } from './data.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function mountLoginButton(container) {
  const btn = document.createElement('button');
  btn.className = 'icon-btn';
  btn.id = 'btn-login';
  updateButton(btn);
  btn.addEventListener('click', () => (Data.me ? openAccountMenu(btn) : openLoginModal()));
  // insère avant le bouton MJ (cadenas) de la rangée d'actions de la sidebar
  const gmBtn = container.querySelector('#btn-gm');
  container.insertBefore(btn, gmBtn || null);
  document.addEventListener('holocron:session', () => updateButton(btn));
  return btn;
}

function updateButton(btn) {
  if (Data.me) {
    btn.innerHTML = `<span aria-hidden="true">👤</span>`;
    btn.title = `Connecté : ${Data.me.name}`;
    btn.setAttribute('aria-label', `Compte ${Data.me.name}`);
  } else {
    btn.innerHTML = `<span aria-hidden="true">👤</span>`;
    btn.title = 'Se connecter (compte Foundry)';
    btn.setAttribute('aria-label', 'Se connecter');
    btn.classList.add('login-off');
  }
  btn.classList.toggle('login-on', Boolean(Data.me));
}

function fireSession() { document.dispatchEvent(new CustomEvent('holocron:session')); }

export async function openLoginModal() {
  const overlay = document.createElement('div');
  overlay.className = 'login-overlay';
  overlay.innerHTML = `
    <div class="login-box" role="dialog" aria-label="Connexion">
      <h2>◈ Connexion</h2>
      <p class="muted">Utilise ton compte <b>Foundry</b> — mêmes identifiants que le jeu.</p>
      <form id="login-form">
        <label>Utilisateur
          <select id="login-user" required><option value="">Chargement…</option></select>
        </label>
        <label>Mot de passe
          <input type="password" id="login-pass" autocomplete="current-password" />
        </label>
        <p class="login-msg" id="login-msg" role="alert"></p>
        <div class="login-actions">
          <button type="button" id="login-cancel">Annuler</button>
          <button type="submit" id="login-go">Se connecter</button>
        </div>
      </form>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('#login-cancel').addEventListener('click', close);

  const sel = overlay.querySelector('#login-user');
  try {
    const users = await listUsers();
    sel.innerHTML = users
      .filter((u) => !/bot/i.test(u.name))
      .map((u) => `<option value="${esc(u.id)}">${esc(u.name)}</option>`).join('');
  } catch { sel.innerHTML = '<option value="">indisponible</option>'; }

  overlay.querySelector('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = overlay.querySelector('#login-msg');
    const go = overlay.querySelector('#login-go');
    go.disabled = true; msg.textContent = 'Vérification auprès de Foundry…';
    try {
      await login(sel.value, overlay.querySelector('#login-pass').value);
      msg.textContent = '';
      close();
      fireSession();
      await reloadJournals();          // ses notes apparaissent
      window.dispatchEvent(new HashChangeEvent('hashchange')); // re-rend la vue
    } catch (err) {
      msg.textContent = err.message;
      go.disabled = false;
    }
  });
}

function openAccountMenu(anchor) {
  const menu = document.createElement('div');
  menu.className = 'login-menu';
  menu.innerHTML = `
    <p><b>${esc(Data.me.name)}</b>${Data.me.role >= 3 ? ' · <span class="login-gm">MJ</span>' : ''}</p>
    <button type="button" id="login-out">Se déconnecter</button>`;
  const rect = anchor.getBoundingClientRect();
  document.body.appendChild(menu);
  // ancré sous le bouton, aligné à gauche (le bouton vit dans la sidebar)
  menu.style.top = `${rect.bottom + 6}px`;
  menu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - menu.offsetWidth - 8))}px`;
  const close = (e) => { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('click', close, true); } };
  setTimeout(() => document.addEventListener('click', close, true), 0);
  menu.querySelector('#login-out').addEventListener('click', async () => {
    await logout();
    menu.remove();
    fireSession();
    await reloadJournals();
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
}
