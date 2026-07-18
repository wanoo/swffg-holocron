// ui-config.js — personnalisation de MONDE (bloc `ui` de la config de campagne,
// SSOT = flags.holocron.config.ui du journal ⚙️ Holocron Config).
// Lecture : /api/content/config (Data.config.ui). Écriture : MJ uniquement via
// PUT /api/gm/config/ui (patch partiel fusionné côté serveur). Après un save
// réussi, Data.config.ui est remplacé par l'état fusionné renvoyé et
// l'événement `holocron:ui` prévient les composants (sidebar, titre, décor).
import { Data } from './data.js';
import { apiBase, getGMKey } from './collab.js';

// Bloc ui courant — toujours un objet (rétrocompat : mondes sans bloc ui).
export const uiConfig = () => (Data.config && Data.config.ui) || {};

// MJ actif côté front (session Foundry MJ ou clé de table) — l'UI d'édition ne
// se monte que pour lui ; la sécurité réelle reste côté serveur (routes /api/gm).
export const isGMActive = () => Boolean(getGMKey() || Data.gm);

// Titre affiché du monde : ui.title (choix MJ) → meta.title → libellé par défaut.
export function worldTitle() {
  return String(uiConfig().title || Data.meta?.title || '').trim() || 'Archive Holocron';
}

// Enregistre un patch PARTIEL du bloc ui (MJ). Résout avec l'état fusionné.
export async function saveUiConfig(patch) {
  const key = getGMKey();
  const res = await fetch(`${apiBase()}/gm/config/ui`, {
    method: 'PUT',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(key ? { 'x-gm-key': key } : {}) },
    body: JSON.stringify(patch || {}),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `enregistrement refusé (${res.status})`);
  if (Data.config) Data.config.ui = body.ui;
  document.dispatchEvent(new CustomEvent('holocron:ui', { detail: { ui: body.ui } }));
  return body.ui;
}
