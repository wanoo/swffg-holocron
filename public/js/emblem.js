// emblem.js — emblème du site (tête de sidebar), rendu en MASQUE CSS
// (--user-emblem) donc teinté automatiquement par le thème actif.
// Depuis la config ui de monde : l'emblème est CENTRALISÉ (ui.emblem, choisi
// par le MJ, appliqué à tous). Le picker n'est actif que pour le MJ et ÉCRIT
// via PUT /api/gm/config/ui ; le localStorage ne sert plus que de repli
// (rétrocompat mondes sans bloc ui + secours MJ si la route échoue).
// L'emblème choisi prime sur l'emblème de gamme du thème (--sidebar-emblem).
import { uiConfig, isGMActive, saveUiConfig } from './ui-config.js';

export const EMBLEMS = [
  { id: 'rebel-alliance', label: 'Alliance Rebelle' },
  { id: 'galactic-empire', label: 'Empire Galactique' },
  { id: 'jedi-order', label: 'Ordre Jedi' },
  { id: 'jedi', label: 'Jedi' },
  { id: 'new-jedi-order', label: 'Nouvel Ordre Jedi' },
  { id: 'sith', label: 'Sith' },
  { id: 'sith-empire', label: 'Empire Sith' },
  { id: 'galactic-republic', label: 'République Galactique' },
  { id: 'old-republic', label: 'Ancienne République' },
  { id: 'new-republic', label: 'Nouvelle République' },
  { id: 'galactic-senate', label: 'Sénat Galactique' },
  { id: 'separatists', label: 'Séparatistes' },
  { id: 'first-order', label: 'Premier Ordre' },
  { id: 'phoenix-squadron', label: 'Escadron Phénix' },
  { id: 'mandalorian', label: 'Mandalorien' },
  { id: 'nite-owls', label: 'Chouettes de la Nuit' },
  { id: 'black-sun', label: 'Soleil Noir' },
  { id: 'crimson-dawn', label: 'Aube Écarlate' },
  { id: 'pyke-syndicate', label: 'Syndicat Pyke' },
  { id: 'hutt-clan', label: 'Clan Hutt' },
  { id: 'credits', label: 'Crédits' },
];
export const DEFAULT_EMBLEM = 'rebel-alliance';
const STORE_KEY = 'holocron-emblem'; // miroir : liste dupliquée dans le script inline de index.html
const COLS = 5; // colonnes de la grille du picker (navigation clavier ↑/↓)

const valid = (id) => EMBLEMS.some((e) => e.id === id);
const emblemUrl = (id) => `url('/img/emblems/${id}.svg')`;

// Emblème effectif : celui du MONDE (ui.emblem) s'il est posé, sinon le choix
// local historique (localStorage), sinon le défaut.
export function currentEmblem() {
  const world = uiConfig().emblem;
  if (valid(world)) return world;
  let v = null;
  try { v = localStorage.getItem(STORE_KEY); } catch { /* stockage indisponible */ }
  return valid(v) ? v : DEFAULT_EMBLEM;
}

export function applyEmblem(id, { persist = false } = {}) {
  if (!valid(id)) id = DEFAULT_EMBLEM;
  document.documentElement.style.setProperty('--user-emblem', emblemUrl(id));
  if (persist) { try { localStorage.setItem(STORE_KEY, id); } catch { /* stockage indisponible */ } }
  document.dispatchEvent(new CustomEvent('holocron:emblem', { detail: { emblem: id } }));
}

// Ré-applique l'emblème effectif + l'affordance MJ du picker (appelé quand la
// config ou la session change — au boot par app.js, puis via holocron:ui/session).
const gateHooks = [];
export function syncEmblem() {
  applyEmblem(currentEmblem());
  for (const f of gateHooks) f();
}

// Monte le picker (grille d'aperçus teintés au thème) sur le bouton-emblème.
// MJ uniquement : pour les joueurs le bouton devient un simple insigne inerte.
export function mountEmblemPicker(button) {
  if (!button) return;
  syncEmblem(); // normalise l'affichage au boot (config pas forcément chargée)

  const menu = document.createElement('div');
  menu.className = 'emblem-menu';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', 'Emblème du monde');
  menu.hidden = true;
  const grid = document.createElement('div');
  grid.className = 'emblem-grid';
  for (const e of EMBLEMS) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'emblem-item';
    item.setAttribute('role', 'menuitemradio');
    item.setAttribute('aria-label', e.label);
    item.title = e.label;
    item.dataset.emblemId = e.id;
    const sw = document.createElement('span');
    sw.className = 'emblem-swatch';
    sw.setAttribute('aria-hidden', 'true');
    sw.style.setProperty('--em', emblemUrl(e.id));
    item.appendChild(sw);
    item.addEventListener('click', () => { pick(e.id); close(); button.focus(); });
    grid.appendChild(item);
  }
  menu.appendChild(grid);
  document.body.appendChild(menu);

  // Choix MJ : application immédiate + écriture de MONDE. Le localStorage sert
  // de repli local (MJ seulement) si la route échoue (hors-ligne, clé expirée).
  function pick(id) {
    applyEmblem(id, { persist: true });
    saveUiConfig({ emblem: id }).catch(() => {
      console.warn('[holocron] emblème : écriture serveur refusée — gardé localement seulement');
    });
  }

  const items = () => [...menu.querySelectorAll('.emblem-item')];
  function sync() {
    const cur = currentEmblem();
    for (const it of items()) it.setAttribute('aria-checked', String(it.dataset.emblemId === cur));
  }

  // Gating MJ : le bouton n'est un CONTRÔLE que pour le MJ (la sécurité réelle
  // est côté serveur — ceci n'est que de l'affordance).
  function syncGate() {
    const gm = isGMActive();
    button.disabled = !gm;
    button.title = gm ? 'Emblème du monde' : 'Emblème du monde (choisi par le MJ)';
    button.setAttribute('aria-label', gm ? "Choisir l'emblème du monde" : 'Emblème du monde');
    if (!gm && !menu.hidden) close();
  }

  function open() {
    if (!isGMActive()) return;
    sync();
    menu.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    // ancre le menu sous le bouton, aligné à gauche, sans sortir de l'écran
    const r = button.getBoundingClientRect();
    menu.style.top = `${r.bottom + 6}px`;
    menu.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - menu.offsetWidth - 8))}px`;
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
  // Navigation clavier en grille : ←/→ d'un emblème, ↑/↓ d'une rangée.
  menu.addEventListener('keydown', (e) => {
    const list = items();
    const idx = list.indexOf(document.activeElement);
    const go = (i) => { e.preventDefault(); list[(i + list.length) % list.length].focus(); };
    if (e.key === 'ArrowRight') go(idx + 1);
    else if (e.key === 'ArrowLeft') go(idx - 1);
    else if (e.key === 'ArrowDown') go(idx + COLS);
    else if (e.key === 'ArrowUp') go(idx - COLS);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(list.length - 1);
    else if (e.key === 'Escape') { close(); button.focus(); }
    else if (e.key === 'Tab') close();
  });

  document.addEventListener('holocron:emblem', sync);
  document.addEventListener('holocron:session', syncGate);
  gateHooks.push(syncGate);
  syncGate();
  sync();
}
