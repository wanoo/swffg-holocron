// data.js — chargement des données depuis l'API du service (SSOT = Foundry).
// Remplace les JSON statiques : /api/content/* + cache localStorage {etag, body}
// pour un boot instantané avec revalidation en arrière-plan (304).
// Les collections lourdes réservées au MJ (PNJ, adversaires) sont LAZY.

export const Data = {
  meta: null,
  config: { registry: [], advLinks: { externalUrl: '', map: [] }, campaignPlanets: [], editableKinds: [] },
  categories: [],
  journals: [],
  compendium: {},
  pcs: [],
  worldNpcs: [],
  adversaries: [],
  spendHelp: {},
  me: null,        // session Foundry { userId, name, role, character } | null
  authEnabled: false,
  gm: false,
  // index
  journalById: new Map(),
  pageById: new Map(),
  pcById: new Map(),
  npcById: new Map(),
  advById: new Map(),
};

const API = (window.HOLOCRON && window.HOLOCRON.api) || '/api';

// GET avec cache localStorage + revalidation ETag (304 → cache).
async function getCached(path, { gated = false } = {}) {
  const key = 'holocron-cache:' + path;
  let cached = null;
  try { cached = JSON.parse(localStorage.getItem(key) || 'null'); } catch { /* cache corrompu */ }
  const headers = {};
  if (cached?.etag) headers['If-None-Match'] = cached.etag;
  let res;
  try {
    res = await fetch(API + path, { headers, credentials: 'same-origin' });
  } catch (e) {
    if (cached) return cached.body; // hors-ligne : sert le cache
    throw e;
  }
  if (res.status === 304 && cached) return cached.body;
  if (res.status === 401 && gated) return null;
  if (!res.ok) {
    if (cached) return cached.body;
    throw new Error(`Échec de chargement ${path} (${res.status})`);
  }
  const body = await res.json();
  const etag = res.headers.get('etag');
  try { if (etag) localStorage.setItem(key, JSON.stringify({ etag, body })); } catch { /* quota */ }
  return body;
}

function indexJournals() {
  Data.journalById.clear(); Data.pageById.clear();
  for (const j of Data.journals) {
    Data.journalById.set(j.id, j);
    if (j.foundryId) Data.journalById.set(j.foundryId, j);
    for (const p of j.pages) Data.pageById.set(p.id, { journal: j, page: p });
  }
}

export async function loadData() {
  // session d'abord (pilote ce que le serveur laissera voir)
  try {
    const me = await (await fetch(API + '/me', { credentials: 'same-origin' })).json();
    Data.me = me.me; Data.authEnabled = me.authEnabled; Data.gm = me.gm;
  } catch { Data.me = null; }

  const [manifest, journals, pcs, config] = await Promise.all([
    getCached('/content/manifest'),
    getCached('/content/journals'),
    getCached('/content/pcs'),
    getCached('/content/config'),
  ]);
  // spend-help : overlay optionnel déposé par l'instance (textes non libres)
  try { Data.spendHelp = await (await fetch('overlay/spend-help.json')).json(); } catch { Data.spendHelp = {}; }

  Data.meta = { title: manifest.title, description: manifest.description, counts: manifest.counts, pcs: manifest.pcs };
  Data.categories = journals.categories;
  Data.journals = journals.journals;
  Data.config = config;
  Data.pcs = pcs;

  indexJournals();
  Data.pcById.clear();
  for (const p of Data.pcs) Data.pcById.set(p.id, p);
  return Data;
}

// Recharge les journaux (après édition / login) sans recharger la page.
export async function reloadJournals() {
  const journals = await getCached('/content/journals');
  Data.categories = journals.categories;
  Data.journals = journals.journals;
  indexJournals();
}

// --- collections MJ lazy -----------------------------------------------------
let npcsLoaded = false, advLoaded = false;
export async function ensureNpcs() {
  if (npcsLoaded) return Data.worldNpcs;
  const body = await getCached('/content/npcs', { gated: true });
  if (body) { Data.worldNpcs = body; Data.npcById.clear(); for (const n of body) Data.npcById.set(n.id, n); npcsLoaded = true; }
  return Data.worldNpcs;
}
export async function ensureAdversaries() {
  if (advLoaded) return Data.adversaries;
  const body = await getCached('/content/adversaries', { gated: true });
  if (body) { Data.adversaries = body; Data.advById.clear(); for (const a of body) Data.advById.set(a.id, a); advLoaded = true; }
  return Data.adversaries;
}

// Compendium (qualités/attachements traduits) : overlay optionnel de l'instance.
let compLoaded = false;
export async function ensureCompendium() {
  if (compLoaded) return Data.compendium;
  try { Data.compendium = await (await fetch('overlay/compendium.json')).json(); } catch { Data.compendium = {}; }
  compLoaded = true;
  return Data.compendium;
}

// Résout un chemin de fichier Foundry (worlds/…) vers une URL affichable.
export function foundryAsset(path) {
  if (!path) return path;
  if (/^(https?:|data:|\/)/.test(path)) return path;
  const base = Data.config?.foundryBaseUrl || '';
  return base ? `${base}/${path}` : path;
}

export function compendiumEntry(ref) {
  return Data.compendium[ref] || null;
}

// --- session -------------------------------------------------------------------
export async function login(userid, password) {
  const res = await fetch(API + '/login', {
    method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userid, password }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || 'connexion refusée');
  Data.me = body.me;
  Data.gm = (body.me?.role ?? 0) >= 3; // ASSISTANT+ = MJ, comme côté serveur
  return body.me;
}
export async function logout() {
  await fetch(API + '/logout', { method: 'POST', credentials: 'same-origin' });
  Data.me = null;
  Data.gm = false;
}
export async function listUsers() {
  const body = await (await fetch(API + '/users')).json();
  return body.users || [];
}
