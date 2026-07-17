// theme.js — système de thèmes : métadonnées, application (persistée) et
// sélecteur accessible dans la sidebar. Le thème est posé sur <html data-theme>
// avant le premier rendu par le script inline de index.html (anti-flash).

export const THEMES = [
  { id: 'force-jedi', label: 'Force & Destiny — Jedi', description: 'Holocron bleu et doré' },
  { id: 'force-sith', label: 'Force & Destiny — Sith', description: 'Holocron rouge et obscur' },
  { id: 'age-of-rebellion', label: 'Age of Rebellion', description: 'Archives rebelles imprimées' },
  { id: 'edge-of-the-empire', label: 'Edge of the Empire', description: 'Datapad de la Bordure Extérieure' },
];
export const DEFAULT_THEME = 'force-jedi';
const STORE_KEY = 'holocron-theme';

// Couleur de l'UI navigateur (barre d'onglet mobile) par thème.
const META_COLOR = {
  'force-jedi': '#01070d',
  'force-sith': '#040303',
  'age-of-rebellion': '#cdb7a0',
  'edge-of-the-empire': '#14110c',
};

export function currentTheme() {
  const t = document.documentElement.dataset.theme;
  return THEMES.some((x) => x.id === t) ? t : DEFAULT_THEME;
}

// persist=false : application « de monde » (défaut/verrou MJ) — on ne pollue
// pas le choix personnel du navigateur avec un thème imposé par la config.
export function applyTheme(id, { persist = true } = {}) {
  if (!THEMES.some((x) => x.id === id)) id = DEFAULT_THEME;
  document.documentElement.dataset.theme = id;
  if (persist) { try { localStorage.setItem(STORE_KEY, id); } catch { /* stockage indisponible */ } }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = META_COLOR[id] || META_COLOR[DEFAULT_THEME];
  document.dispatchEvent(new CustomEvent('holocron:theme', { detail: { theme: id } }));
}

// Applique la politique de thème du MONDE (config ui, arrivée APRÈS le script
// anti-flash — qui ne connaît que le localStorage : une correction visible au
// premier chargement est acceptée, et le script inline lit aussi le cache
// localStorage de /content/config pour l'éviter dès la 2e visite).
//  · ui.theme + ui.themeLocked : imposé aux joueurs (le MJ garde son choix) ;
//  · ui.theme seul : défaut pour qui n'a pas de préférence locale ;
//  · sinon : comportement historique (localStorage).
// Le bouton du sélecteur est masqué pour les joueurs quand le thème est verrouillé.
export function applyWorldTheme(ui, gm) {
  const worldTheme = THEMES.some((x) => x.id === ui?.theme) ? ui.theme : '';
  const locked = Boolean(worldTheme && ui?.themeLocked);
  let stored = null;
  try { stored = localStorage.getItem(STORE_KEY); } catch { /* stockage indisponible */ }
  if (locked && !gm) {
    if (currentTheme() !== worldTheme) applyTheme(worldTheme, { persist: false });
  } else if (worldTheme && !THEMES.some((x) => x.id === stored)) {
    if (currentTheme() !== worldTheme) applyTheme(worldTheme, { persist: false });
  }
  const btn = document.getElementById('btn-theme');
  if (btn) btn.hidden = locked && !gm;
}

// Monte le menu du sélecteur sur le bouton #btn-theme (pastille + menu radio,
// navigation clavier complète, choix persisté).
export function mountThemeSwitcher(button) {
  if (!button) return;
  applyTheme(currentTheme()); // normalise le stockage + meta theme-color au boot
  const dot = button.querySelector('.theme-dot');

  const menu = document.createElement('div');
  menu.className = 'theme-menu';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', "Thème d'interface");
  menu.hidden = true;
  for (const t of THEMES) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'theme-menu-item';
    item.setAttribute('role', 'menuitemradio');
    item.dataset.themeId = t.id;
    item.innerHTML =
      `<span class="theme-dot" data-theme-dot="${t.id}" aria-hidden="true"></span>` +
      `<span class="theme-menu-txt"><b>${t.label}</b><small>${t.description}</small></span>` +
      `<span class="theme-menu-check" aria-hidden="true">✓</span>`;
    item.addEventListener('click', () => { applyTheme(t.id); close(); button.focus(); });
    menu.appendChild(item);
  }
  document.body.appendChild(menu);

  const items = () => [...menu.querySelectorAll('.theme-menu-item')];
  function sync() {
    const cur = currentTheme();
    if (dot) dot.setAttribute('data-theme-dot', cur);
    for (const it of items()) it.setAttribute('aria-checked', String(it.dataset.themeId === cur));
  }

  function open() {
    sync();
    menu.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    // ancre le menu sous le bouton, aligné à gauche (le bouton vit dans la sidebar)
    const r = button.getBoundingClientRect();
    menu.style.top = `${r.bottom + 6}px`;
    menu.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - menu.offsetWidth - 8))}px`;
    menu.style.right = 'auto';
    (items().find((i) => i.getAttribute('aria-checked') === 'true') || items()[0])?.focus();
  }
  function close() {
    menu.hidden = true;
    button.setAttribute('aria-expanded', 'false');
  }

  button.addEventListener('click', () => (menu.hidden ? open() : close()));
  document.addEventListener('click', (e) => {
    if (!menu.hidden && !menu.contains(e.target) && e.target !== button && !button.contains(e.target)) close();
  });
  menu.addEventListener('keydown', (e) => {
    const list = items();
    const idx = list.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); list[(idx + 1) % list.length].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); list[(idx - 1 + list.length) % list.length].focus(); }
    else if (e.key === 'Home') { e.preventDefault(); list[0].focus(); }
    else if (e.key === 'End') { e.preventDefault(); list[list.length - 1].focus(); }
    else if (e.key === 'Escape') { close(); button.focus(); }
    else if (e.key === 'Tab') close();
  });

  document.addEventListener('holocron:theme', sync);
  sync();
}
