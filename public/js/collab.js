// collab.js — client de l'API de collaboration (édition partagée des notes/actes).
// Dégrade proprement en lecture seule si l'API est absente (mode statique/hors-ligne).

const API = (window.HOLOCRON && window.HOLOCRON.api) || '/api';
let availability = null; // null = inconnu, true/false = testé

export function apiBase() {
  return API;
}

// Teste (une fois) la disponibilité de l'API.
export async function isAvailable() {
  if (availability !== null) return availability;
  try {
    const res = await fetch(`${API}/health`, { cache: 'no-store' });
    availability = res.ok;
  } catch {
    availability = false;
  }
  return availability;
}

export async function getDoc(id) {
  const res = await fetch(`${API}/docs/${encodeURIComponent(id)}`, { cache: 'no-store' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GET ${id} → ${res.status}`);
  return res.json();
}

export async function listDocs() {
  try {
    const res = await fetch(`${API}/docs`, { cache: 'no-store' });
    if (!res.ok) return {};
    return (await res.json()).docs || {};
  } catch {
    return {};
  }
}

// Enregistre. Renvoie { ok, updatedAt } ou { conflict, current } (HTTP 409).
export async function saveDoc(id, html, baseUpdatedAt, updatedBy) {
  const res = await fetch(`${API}/docs/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ html, baseUpdatedAt, updatedBy }),
  });
  if (res.status === 409) return { conflict: true, current: (await res.json()).current };
  if (!res.ok) throw new Error(`PUT ${id} → ${res.status}`);
  return res.json();
}

// --- Section MJ (protégée par clé) ---------------------------------------
// La clé vit en sessionStorage (fetch → en-tête x-gm-key) ET, en miroir, dans un
// cookie de session : les <img> des illustrations MJ ne peuvent pas poser d'en-tête,
// mais envoient le cookie, ce qui permet de servir les images derrière la clé.
let gmKey = sessionStorage.getItem('holocron-gm-key') || '';
function syncGMCookie() {
  document.cookie = gmKey
    ? `gmkey=${encodeURIComponent(gmKey)}; path=/; SameSite=Strict`
    : 'gmkey=; path=/; Max-Age=0; SameSite=Strict';
}
syncGMCookie();
export function setGMKey(k) { gmKey = k || ''; sessionStorage.setItem('holocron-gm-key', gmKey); syncGMCookie(); }
export function getGMKey() { return gmKey; }
export function clearGMKey() { gmKey = ''; sessionStorage.removeItem('holocron-gm-key'); syncGMCookie(); }

function gmHeaders(extra) { return { ...(gmKey ? { 'x-gm-key': gmKey } : {}), ...(extra || {}) }; }

// Liste des chapitres MJ. Renvoie null si la clé est refusée (401).
export async function gmList() {
  const res = await fetch(`${API}/gm/docs`, { headers: gmHeaders(), cache: 'no-store' });
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`GM list → ${res.status}`);
  return (await res.json()).docs || [];
}
export async function gmGet(id) {
  const res = await fetch(`${API}/gm/docs/${encodeURIComponent(id)}`, { headers: gmHeaders(), cache: 'no-store' });
  if (res.status === 401) return null;
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GM get → ${res.status}`);
  return res.json();
}
export async function gmSave(id, html, baseUpdatedAt, updatedBy) {
  const res = await fetch(`${API}/gm/docs/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: gmHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ html, baseUpdatedAt, updatedBy }),
  });
  if (res.status === 409) return { conflict: true, current: (await res.json()).current };
  if (!res.ok) throw new Error(`GM save → ${res.status}`);
  return res.json();
}

// Back-links « Mentionné dans… » (gated) : entityId -> [{id,name}] chapitres MJ.
export async function gmGetBackrefs() {
  const res = await fetch(`${API}/gm/backrefs`, { headers: gmHeaders(), cache: 'no-store' });
  if (!res.ok) return {};
  return (await res.json()).backrefs || {};
}
// Dossiers MJ narratifs (gated) : entityId -> { role, statut, veut, attitude, replique, … }.
export async function gmGetDossiers() {
  const res = await fetch(`${API}/gm/dossiers`, { headers: gmHeaders(), cache: 'no-store' });
  if (!res.ok) return {};
  return (await res.json()).dossiers || {};
}

// --- Notes MJ (privées, gated) -------------------------------------------
export async function gmNotesList() {
  const res = await fetch(`${API}/gm/notes`, { headers: gmHeaders(), cache: 'no-store' });
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`Notes list → ${res.status}`);
  return (await res.json()).notes || [];
}
export async function gmNoteSave(id, note) {
  const res = await fetch(`${API}/gm/notes/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: gmHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(note),
  });
  if (!res.ok) throw new Error(`Note save → ${res.status}`);
  return res.json();
}
export async function gmNoteDelete(id) {
  const res = await fetch(`${API}/gm/notes/${encodeURIComponent(id)}`, { method: 'DELETE', headers: gmHeaders() });
  if (!res.ok) throw new Error(`Note delete → ${res.status}`);
  return res.json();
}

// Nom de l'auteur (pour la traçabilité), demandé une fois puis mémorisé.
export function getAuthor() {
  let name = localStorage.getItem('holocron-author');
  if (!name) {
    name = (window.prompt('Votre nom (pour les notes partagées) :', '') || 'anonyme').trim() || 'anonyme';
    localStorage.setItem('holocron-author', name);
  }
  return name;
}
