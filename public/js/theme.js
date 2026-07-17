// theme.js — système de thèmes : métadonnées, application (persistée) et
// sélecteur accessible dans la topbar. Le thème est posé sur <html data-theme>
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

export function applyTheme(id) {
  if (!THEMES.some((x) => x.id === id)) id = DEFAULT_THEME;
  document.documentElement.dataset.theme = id;
  try { localStorage.setItem(STORE_KEY, id); } catch { /* stockage indisponible */ }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = META_COLOR[id] || META_COLOR[DEFAULT_THEME];
  document.dispatchEvent(new CustomEvent('holocron:theme', { detail: { theme: id } }));
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
    // ancre le menu sous le bouton, aligné à droite
    const r = button.getBoundingClientRect();
    menu.style.top = `${r.bottom + 6}px`;
    menu.style.right = `${Math.max(8, window.innerWidth - r.right)}px`;
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
