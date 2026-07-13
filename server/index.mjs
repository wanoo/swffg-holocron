// swffg-holocron — service compagnon de campagne SWFFG. FoundryVTT est la
// SEULE source de vérité : ce serveur synchronise (SyncStore), affiche
// (/api/content/*), pilote (/api/gm/foundry/*) et écrit (éditeur → journaux).
// Zéro dépendance runtime (le connecteur embarqué est une dépendance optionnelle).
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

import { envConfig, campaignConfig, publicConfig } from './lib/config.mjs';
import { configureMcp, mcpCall, mcpQueue } from './lib/mcp.mjs';
import { createStore } from './lib/sync-store.mjs';
import {
  configureAuth, authEnabled, sessionFrom, setSessionCookie, clearSessionCookie,
  validateFoundryLogin, isGM, canSee, canEdit,
} from './lib/auth.mjs';
import { setCorsOrigin, cors, sendJSON, sendVersioned, readBody, rateLimited, makeStatic, MIME } from './lib/http.mjs';
import { createContentService } from './lib/content.mjs';
import { createWriteService, createEncounterService } from './lib/write.mjs';
import { createShipService, createDashService } from './lib/ship.mjs';
import { createAstroService } from './lib/astro.mjs';
import * as tools from './lib/session-tools.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV = envConfig();
const PUBLIC_DIR = process.env.HOLOCRON_PUBLIC_DIR || join(__dirname, '..', 'public');

setCorsOrigin(ENV.corsOrigin);
configureAuth({ sessionSecret: ENV.sessionSecret, foundryBaseUrl: ENV.foundryBaseUrl });

// --- connecteur Foundry (embarqué stdio par défaut, gateway HTTP en option) ---
const childEntry = ['node', join(__dirname, '..', 'node_modules', 'foundry-mcp-server', 'build', 'server.js')];
const mode = configureMcp({
  foundryMcpUrl: ENV.foundryMcpUrl,
  credentialsJson: ENV.foundryCredentialsJson,
  childEntry: existsSync(childEntry[1]) ? childEntry : null,
  dataDir: ENV.dataDir,
  logger: console,
});
console.log(`[holocron] connecteur Foundry : mode ${mode}`);

// --- store + services -----------------------------------------------------------
const store = createStore({ dataDir: ENV.dataDir, logger: console });
const cc = () => campaignConfig(store);
const content = createContentService({ store, config: cc });
const writer = createWriteService({ store, config: cc, logger: console });
const encounters = createEncounterService({ store, config: cc });
const dashPayload = createDashService({ journals: campaignConfig(store).journals });
const shipSvc = () => createShipService({ journalName: cc().journals.ship });
const astro = createAstroService({ publicDir: PUBLIC_DIR, config: cc });
const serveStatic = makeStatic(PUBLIC_DIR);

// --- auth helpers ------------------------------------------------------------------
const gmOK = (req, session) => isGM(session) || (ENV.gmKey && (req.headers['x-gm-key'] || '') === ENV.gmKey);
const playerOK = (req, session) => Boolean(session) || (ENV.playerKey && (req.headers['x-player-key'] || '') === ENV.playerKey);
const who = (session, body) => session?.name || String(body?.player || 'Joueur').slice(0, 40);

// --- proxy assets MJ (spoilers derrière auth, cache disque) -------------------------
const assetCacheDir = join(ENV.dataDir, 'cache', 'assets');
async function proxyAsset(req, res, rel, session) {
  const key = (new URL(req.url, 'http://x')).searchParams.get('k');
  const cookieKey = (/(?:^|;\s*)gmkey=([^;]+)/.exec(req.headers.cookie || '') || [])[1];
  const allowed = gmOK(req, session) || (ENV.gmKey && (key === ENV.gmKey || (cookieKey && decodeURIComponent(cookieKey) === ENV.gmKey)));
  if (!allowed) return sendJSON(res, 401, { error: 'réservé MJ' });
  const clean = normalize(rel).replace(/^([./\\])+/, '');
  if (!/^worlds\//.test(clean)) return sendJSON(res, 400, { error: 'chemin invalide' });
  const cachePath = join(assetCacheDir, clean.replace(/[^a-zA-Z0-9._-]/g, '_'));
  try {
    const buf = await readFile(cachePath);
    res.writeHead(200, { 'Content-Type': MIME['.' + clean.split('.').pop()] || 'application/octet-stream', 'Cache-Control': 'private, max-age=86400' });
    return res.end(buf);
  } catch { /* pas en cache */ }
  const upstream = await fetch(`${ENV.foundryBaseUrl}/${clean}`);
  if (!upstream.ok) return sendJSON(res, upstream.status, { error: 'asset introuvable' });
  const buf = Buffer.from(await upstream.arrayBuffer());
  await mkdir(assetCacheDir, { recursive: true });
  writeFile(cachePath, buf).catch(() => {});
  res.writeHead(200, { 'Content-Type': upstream.headers.get('content-type') || 'application/octet-stream', 'Cache-Control': 'private, max-age=86400' });
  res.end(buf);
}

// --- proxy assets PUBLIC (portraits PJ/PNJ/orga, images de module) ------------------
// Résout les chemins relatifs monde (`assets/PJ/x.png` → `worlds/<world>/assets/PJ/x.png`),
// sert depuis Foundry avec cache disque. Réservé aux images ; bloque les visuels MJ (gm-*)
// pour ne pas faire du proxy une passerelle à spoilers (ceux-là passent par /api/gm/asset).
const IMG_EXT = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'avif']);
async function proxyPublicAsset(req, res, rel) {
  const clean = normalize(decodeURIComponent(rel)).replace(/^([./\\])+/, '').replace(/\\/g, '/');
  if (clean.includes('..')) return sendJSON(res, 400, { error: 'chemin invalide' });
  // Les chemins d'assets Foundry (assets/…, worlds/…, modules/…, systems/…) sont
  // servis TELS QUELS sous FOUNDRY_BASE_URL (la base pointe déjà sur la racine du monde).
  const ext = clean.split('.').pop().toLowerCase();
  if (!IMG_EXT.has(ext)) return sendJSON(res, 400, { error: 'type non servi' });
  if (/(^|\/)gm-/.test(clean)) return sendJSON(res, 403, { error: 'visuel réservé MJ' });
  const cachePath = join(assetCacheDir, 'pub_' + clean.replace(/[^a-zA-Z0-9._-]/g, '_'));
  try {
    const buf = await readFile(cachePath);
    res.writeHead(200, { 'Content-Type': MIME['.' + ext] || 'application/octet-stream', 'Cache-Control': 'public, max-age=86400' });
    return res.end(buf);
  } catch { /* pas en cache */ }
  let upstream;
  try { upstream = await fetch(`${ENV.foundryBaseUrl}/${clean}`); }
  catch { return sendJSON(res, 502, { error: 'Foundry injoignable' }); }
  if (!upstream.ok) return sendJSON(res, upstream.status === 404 ? 404 : 502, { error: 'asset introuvable' });
  const buf = Buffer.from(await upstream.arrayBuffer());
  await mkdir(assetCacheDir, { recursive: true });
  writeFile(cachePath, buf).catch(() => {});
  res.writeHead(200, { 'Content-Type': upstream.headers.get('content-type') || MIME['.' + ext] || 'application/octet-stream', 'Cache-Control': 'public, max-age=86400' });
  res.end(buf);
}

/* =============================================================== routeur API == */
async function handleApi(req, res, urlPath) {
  const parts = urlPath.replace(/^\/api\/?/, '').split('?')[0].split('/').filter(Boolean);
  const q = new URL(urlPath, 'http://x').searchParams;
  const session = sessionFrom(req);

  if (req.method === 'OPTIONS') { cors(res); res.writeHead(204); return res.end(); }
  if (parts[0] === 'health') return sendJSON(res, 200, { ok: true, mode, collections: Object.fromEntries(store.status) });

  // proxy d'assets public (portraits) — /api/asset/<chemin>
  if (parts[0] === 'asset' && req.method === 'GET') {
    return proxyPublicAsset(req, res, urlPath.replace(/^\/api\/asset\//, '').split('?')[0]);
  }

  /* ---------------------------------------------------------------- auth ---- */
  if (parts[0] === 'login' && req.method === 'POST') {
    if (!authEnabled()) return sendJSON(res, 503, { error: 'auth non configurée (SESSION_SECRET/FOUNDRY_BASE_URL)' });
    if (rateLimited(req, 5)) return sendJSON(res, 429, { error: 'trop de tentatives' });
    let body; try { body = JSON.parse(await readBody(req, 10_000)); } catch { return sendJSON(res, 400, { error: 'JSON invalide' }); }
    const users = store.get('users') || [];
    const user = users.find((u) => u._id === body.userid || u.name === body.userid);
    if (!user) return sendJSON(res, 401, { error: 'utilisateur inconnu' });
    const ok = await validateFoundryLogin(user._id, String(body.password ?? ''));
    if (!ok) return sendJSON(res, 401, { error: 'mot de passe invalide' });
    const payload = { userId: user._id, name: user.name, role: user.role, character: user.character };
    setSessionCookie(res, payload);
    return sendJSON(res, 200, { ok: true, me: payload });
  }
  if (parts[0] === 'logout' && req.method === 'POST') { clearSessionCookie(res); return sendJSON(res, 200, { ok: true }); }
  if (parts[0] === 'me' && req.method === 'GET') {
    return sendJSON(res, 200, { me: session, authEnabled: authEnabled(), gm: gmOK(req, session) });
  }
  if (parts[0] === 'users' && req.method === 'GET') {
    // liste de login : noms + ids + couleurs, jamais de secret
    const users = (store.get('users') || []).map((u) => ({ id: u._id, name: u.name, color: u.color }));
    return sendJSON(res, 200, { users, authEnabled: authEnabled() });
  }

  /* ------------------------------------------------------------- contenu ---- */
  if (parts[0] === 'content') {
    const v = content.versions();
    const kind = parts[1];
    if (req.method !== 'GET') return sendJSON(res, 405, { error: 'GET uniquement' });
    if (kind === 'manifest') return sendVersioned(req, res, content.manifest(), v.manifest);
    if (kind === 'journals') return sendVersioned(req, res, content.journalsView(session), v.journals * 13 + (session ? 1 : 0) + (isGM(session) ? 7 : 0));
    if (kind === 'pcs') return sendVersioned(req, res, content.pcsView(), v.pcs);
    if (kind === 'dice-helper') return sendVersioned(req, res, content.diceHelper(), v.diceHelper);
    if (kind === 'config') return sendVersioned(req, res, publicConfig(cc(), ENV.foundryBaseUrl), store.version('config'));
    if (kind === 'npcs') {
      if (!gmOK(req, session)) return sendJSON(res, 401, { error: 'réservé MJ' });
      return sendVersioned(req, res, content.npcsView(), v.npcs);
    }
    if (kind === 'adversaries') {
      if (!gmOK(req, session)) return sendJSON(res, 401, { error: 'réservé MJ' });
      return sendVersioned(req, res, content.adversariesView(), v.adversaries || 0);
    }
    return sendJSON(res, 404, { error: 'collection inconnue' });
  }

  /* ------------------------------------------- docs publics (notes, actes) ---- */
  if (parts[0] === 'docs') {
    const id = parts[1] ? decodeURIComponent(parts[1]) : null;
    if (id && /^gm/.test(id)) return sendJSON(res, 403, { error: 'réservé MJ' });
    if (req.method === 'GET' && id) {
      const d = writer.publicGet(id);
      if (!d) return sendJSON(res, 404, { error: 'inexistant' });
      if (!canSee(session, { ownership: d.ownership })) return sendJSON(res, 403, { error: 'non autorisé' });
      const { ownership, ...pub } = d;
      return sendJSON(res, 200, pub);
    }
    if (req.method === 'PUT' && id) {
      const d = writer.publicGet(id);
      if (!d) return sendJSON(res, 404, { error: 'document non éditable' });
      const legacyPlayer = ENV.playerKey && (req.headers['x-player-key'] || '') === ENV.playerKey;
      if (!(canEdit(session, { ownership: d.ownership }) || gmOK(req, session) || legacyPlayer)) {
        return sendJSON(res, 403, { error: 'non autorisé — connecte-toi avec ton compte Foundry' });
      }
      let body; try { body = JSON.parse(await readBody(req)); } catch { return sendJSON(res, 400, { error: 'JSON invalide' }); }
      if (typeof body.html !== 'string') return sendJSON(res, 400, { error: 'html requis' });
      try {
        return sendJSON(res, 200, await writer.publicSave(id, body.html, body.baseUpdatedAt, session?.name || body.updatedBy));
      } catch (e) {
        return sendJSON(res, e.code || 500, { error: e.message, ...(e.current ? { current: e.current } : {}) });
      }
    }
    return sendJSON(res, 405, { error: 'méthode non autorisée' });
  }

  /* --------------------------------------------------- joueurs ↔ Foundry ---- */
  if (parts[0] === 'foundry') {
    const enabled = mode !== 'none';
    if (parts[1] === 'enabled' && req.method === 'GET') return sendJSON(res, 200, { enabled, authEnabled: authEnabled() });
    if (!enabled) return sendJSON(res, 503, { error: 'connecteur Foundry non configuré' });
    if (!playerOK(req, session)) return sendJSON(res, 401, { error: 'connexion requise' });
    if (parts[1] === 'roll' && req.method === 'POST') {
      // jets réservés aux comptes Foundry connectés (pas de clé de table) : le vrai
      // jet est signé du personnage du joueur puis évalué côté Foundry.
      if (!session) return sendJSON(res, 401, { error: 'connecte-toi avec ton compte Foundry pour lancer un jet' });
      if (rateLimited(req)) return sendJSON(res, 429, { error: 'trop de jets d’un coup — souffle un peu' });
      let body; try { body = JSON.parse(await readBody(req, 20_000)); } catch { return sendJSON(res, 400, { error: 'JSON invalide' }); }
      const token = 'h' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      try {
        await tools.requestRoll({ token, player: session.name, characterId: session.character, description: body.description, pool: body.pool, skillName: body.skillName });
        return sendJSON(res, 200, { ok: true, token });
      } catch (e) { return sendJSON(res, 502, { error: `pont Foundry : ${String(e.message || e).slice(0, 200)}` }); }
    }
    if (parts[1] === 'roll-result' && req.method === 'GET') {
      if (!session) return sendJSON(res, 401, { error: 'connexion requise' });
      const token = q.get('token');
      if (!token) return sendJSON(res, 400, { error: 'token requis' });
      try { return sendJSON(res, 200, await tools.readRollResult(token)); }
      catch (e) { return sendJSON(res, 502, { error: `pont Foundry : ${String(e.message || e).slice(0, 200)}` }); }
    }
    if (parts[1] === 'dash' && req.method === 'GET') {
      try { return sendJSON(res, 200, await dashPayload()); }
      catch (e) { return sendJSON(res, 502, { error: String(e.message || e).slice(0, 200) }); }
    }
    if (parts[1] === 'ship') {
      try {
        if (req.method === 'GET') return sendJSON(res, 200, { ship: await shipSvc().applyShip('get') });
        if (req.method === 'POST') {
          if (rateLimited(req)) return sendJSON(res, 429, { error: 'trop d’actions d’un coup' });
          const body = JSON.parse(await readBody(req, 20_000));
          const action = String(body.action || '');
          if (!['apply', 'refuel', 'fuel', 'repair'].includes(action)) return sendJSON(res, 400, { error: 'action non autorisée' });
          const ship = await shipSvc().applyShip(action, { trip: body.trip, label: body.label }, who(session, body));
          return sendJSON(res, 200, { ship });
        }
      } catch (e) { return sendJSON(res, 502, { error: `pont Foundry : ${String(e.message || e).slice(0, 200)}` }); }
    }
    return sendJSON(res, 404, { error: 'action inconnue' });
  }

  /* ------------------------------------------------------------- astro ------ */
  if (parts[0] === 'astro') {
    try {
      if (parts[1] === 'planets' && req.method === 'GET') return sendJSON(res, 200, { planets: (await astro.astroData()).names });
      if (parts[1] === 'route' && req.method === 'GET') {
        if (rateLimited(req, 30)) return sendJSON(res, 429, { error: 'trop de calculs' });
        const r = await astro.route(q);
        return sendJSON(res, r.code, r.body);
      }
    } catch (e) { return sendJSON(res, 500, { error: 'astro : ' + String(e.message || e).slice(0, 200) }); }
    return sendJSON(res, 404, { error: 'action astro inconnue' });
  }

  /* ---------------------------------------------------------------- MJ ------ */
  if (parts[0] === 'gm') {
    if (parts[1] === 'asset') return proxyAsset(req, res, decodeURIComponent(parts.slice(2).join('/')), session);
    if (!gmOK(req, session)) return sendJSON(res, 401, { error: 'réservé MJ — connecte-toi avec un compte MJ Foundry' });
    const id = parts[2] ? decodeURIComponent(parts[2]) : null;

    if (parts[1] === 'docs' && req.method === 'GET' && !id) return sendJSON(res, 200, { docs: writer.gmList() });
    if (parts[1] === 'dossiers' && req.method === 'GET') return sendJSON(res, 200, { dossiers: writer.dossiers() });
    if (parts[1] === 'backrefs' && req.method === 'GET') return sendJSON(res, 200, { backrefs: writer.backrefs() });
    if (parts[1] === 'docs' && req.method === 'GET' && id) {
      // configs séance : gm:cfg:* vit dans le journal ⚙️ (compat client gm-config.js)
      if (id.startsWith('cfg:')) {
        const v = cc().cfg?.[id.slice(4)];
        return sendJSON(res, 200, { id, html: typeof v === 'string' ? v : JSON.stringify(v ?? null), updatedAt: 0 });
      }
      const d = writer.gmGet(id);
      return d ? sendJSON(res, 200, d) : sendJSON(res, 404, { error: 'inexistant' });
    }
    if (parts[1] === 'docs' && req.method === 'PUT' && id) {
      let body; try { body = JSON.parse(await readBody(req)); } catch { return sendJSON(res, 400, { error: 'JSON invalide' }); }
      if (typeof body.html !== 'string') return sendJSON(res, 400, { error: 'html requis' });
      try {
        if (id.startsWith('cfg:')) {
          let val; try { val = JSON.parse(body.html); } catch { val = body.html; }
          return sendJSON(res, 200, await writer.cfgSave(id.slice(4), val));
        }
        return sendJSON(res, 200, await writer.gmSave(id, body.html, body.baseUpdatedAt, session?.name || body.updatedBy));
      } catch (e) {
        return sendJSON(res, e.code || 500, { error: e.message, ...(e.current ? { current: e.current } : {}) });
      }
    }
    if (parts[1] === 'encounters') {
      try {
        if (req.method === 'GET') return sendJSON(res, 200, { encounters: await encounters.list() });
        if (req.method === 'PUT') {
          const body = JSON.parse(await readBody(req, 100_000));
          return sendJSON(res, 200, { encounter: await encounters.save(body, session?.name) });
        }
        if (req.method === 'DELETE' && id) return sendJSON(res, 200, await encounters.remove(id));
      } catch (e) { return sendJSON(res, e.code || 500, { error: String(e.message || e).slice(0, 200) }); }
    }
    if (parts[1] === 'notes') {
      try {
        if (req.method === 'GET') return sendJSON(res, 200, { notes: await writer.notesList() });
        if (req.method === 'PUT' && id) {
          const body = JSON.parse(await readBody(req));
          return sendJSON(res, 200, await writer.noteSave(id, { ...body, updatedBy: session?.name || body.updatedBy }));
        }
        if (req.method === 'DELETE' && id) return sendJSON(res, 200, await writer.noteDelete(id));
      } catch (e) { return sendJSON(res, e.code || 500, { error: String(e.message || e).slice(0, 200) }); }
    }
    if (parts[1] === 'sync') {
      if (req.method === 'GET') return sendJSON(res, 200, { mode, collections: Object.fromEntries(store.status) });
      if (req.method === 'POST') {
        let body = {}; try { body = JSON.parse(await readBody(req, 5000) || '{}'); } catch { /* défauts */ }
        const conf = cc();
        const target = body.collection || 'all';
        const jobs = [];
        if (target === 'all' || target === 'core') jobs.push(() => store.sync.tick({ configJournalName: ENV.configJournalName }));
        if (target === 'all' || target === 'packs') {
          if (conf.packs.rules) jobs.push(() => store.sync.pack(conf.packs.rules, 'JournalEntry'));
          if (conf.packs.adversaries) jobs.push(() => store.sync.pack(conf.packs.adversaries, 'Actor'));
        }
        // fire-and-forget séquencé — la réponse revient tout de suite
        (async () => { for (const j of jobs) { try { await j(); } catch (e) { console.error('[sync]', e.message); } } })();
        return sendJSON(res, 200, { ok: true, queued: jobs.length });
      }
    }
    if (parts[1] === 'bootstrap' && req.method === 'POST') {
      try {
        const existing = (store.get('journalsIndex') || []).find((j) => j.name === ENV.configJournalName);
        if (existing) return sendJSON(res, 200, { ok: true, existed: true });
        const { CAMPAIGN_DEFAULTS } = await import('./lib/config.mjs');
        await mcpCall('create_document', { type: 'JournalEntry', data: [{
          name: ENV.configJournalName, ownership: { default: 0 },
          flags: { holocron: { config: { ...CAMPAIGN_DEFAULTS, meta: { ...CAMPAIGN_DEFAULTS.meta, title: 'Ma campagne SWFFG' } } } },
          pages: [{ name: 'Config', type: 'text', text: { content: '<p>Configuration du Holocron (flags.holocron.config).</p>', format: 1 } }],
        }] });
        await store.sync.journalsIndex(); await store.sync.config(ENV.configJournalName);
        return sendJSON(res, 200, { ok: true });
      } catch (e) { return sendJSON(res, 500, { error: String(e.message || e).slice(0, 200) }); }
    }
    if (parts[1] === 'foundry') {
      const action = id;
      try {
        if (action === 'status' && req.method === 'GET') {
          const w = await mcpCall('get_world', {});
          return sendJSON(res, 200, { enabled: true, world: w?.world?.title || w?.world?.id || 'monde' });
        }
        if (action === 'roll' && req.method === 'POST') {
          const body = JSON.parse(await readBody(req, 20_000));
          await tools.postRoll({ player: session?.name || 'MJ', description: body.description, pool: body.pool, skillName: body.skillName });
          return sendJSON(res, 200, { ok: true });
        }
        if (action === 'handouts' && req.method === 'GET') return sendJSON(res, 200, { journals: await tools.listHandouts() });
        if (action === 'handout' && req.method === 'POST') {
          const body = JSON.parse(await readBody(req));
          await tools.showHandout(body.id, body.name);
          return sendJSON(res, 200, { ok: true });
        }
        if (action === 'playlists' && req.method === 'GET') return sendJSON(res, 200, { playlists: await tools.listPlaylists() });
        if (action === 'ambiance' && req.method === 'POST') {
          const body = JSON.parse(await readBody(req));
          await tools.setAmbiance(body.id, body.action, body.exclusive);
          return sendJSON(res, 200, { ok: true });
        }
        if (action === 'combat' && req.method === 'GET') return sendJSON(res, 200, await tools.combatState());
        if (action === 'combat-scene' && req.method === 'POST') {
          const body = JSON.parse(await readBody(req, 50_000));
          const combatants = (Array.isArray(body.combatants) ? body.combatants : [])
            .map((c) => ({ name: String(c.name || '').slice(0, 80), count: Math.max(1, Math.min(12, +c.count || 1)) }))
            .filter((c) => c.name).slice(0, 20);
          if (!combatants.length) return sendJSON(res, 400, { error: 'aucun combattant' });
          const out = await tools.createCombatScene(
            { title: body.title, map: body.map, combatants }, { store, config: cc });
          return sendJSON(res, 200, out);
        }
        if (action === 'dash' && req.method === 'GET') return sendJSON(res, 200, await dashPayload());
        if (action === 'ship') {
          if (req.method === 'GET') return sendJSON(res, 200, { ship: await shipSvc().applyShip('get') });
          if (req.method === 'POST') {
            const body = JSON.parse(await readBody(req));
            const act = String(body.action || '');
            if (!['apply', 'refuel', 'fuel', 'repair', 'set'].includes(act)) return sendJSON(res, 400, { error: 'action non autorisée' });
            const ship = await shipSvc().applyShip(act, { trip: body.trip, label: body.label, ship: body.ship }, session?.name || 'MJ');
            return sendJSON(res, 200, { ship });
          }
        }
        return sendJSON(res, 404, { error: 'action foundry inconnue' });
      } catch (e) { return sendJSON(res, 502, { error: `pont Foundry : ${String(e.message || e).slice(0, 300)}` }); }
    }
    return sendJSON(res, 404, { error: 'route MJ inconnue' });
  }

  return sendJSON(res, 404, { error: 'route inconnue' });
}

/* ================================================================== serveur == */
const serveOverlay = makeStatic(join(ENV.dataDir, 'overlay'));
const server = createServer(async (req, res) => {
  try {
    const urlPath = req.url || '/';
    if (urlPath.startsWith('/api/')) return await handleApi(req, res, urlPath);
    // overlay : fichiers propres à l'instance (spend-help, compendium traduits…)
    if (urlPath.startsWith('/overlay/')) return await serveOverlay(req, res, urlPath.slice('/overlay'.length));
    return await serveStatic(req, res, urlPath);
  } catch (e) {
    console.error('[holocron]', e);
    try { sendJSON(res, 500, { error: 'erreur interne' }); } catch { /* déjà répondu */ }
  }
});

await mkdir(ENV.dataDir, { recursive: true });
const restored = await store.boot();
console.log(`[holocron] cache disque : ${restored} collections restaurées`);

server.listen(ENV.port, () => {
  console.log(`[holocron] en écoute :${ENV.port} · connecteur=${mode} · auth=${authEnabled() ? 'Foundry' : 'clés seules'}`);
});

if (mode !== 'none') {
  store.startLoop({ configJournalName: ENV.configJournalName }, ENV.syncIntervalS);
  // packs : premier chargement en arrière-plan après le tick initial
  setTimeout(async () => {
    const conf = cc();
    try { if (conf.packs.rules) await store.sync.pack(conf.packs.rules, 'JournalEntry'); } catch (e) { console.error('[sync] rules:', e.message); }
    try { if (conf.packs.adversaries && !store.get(`pack:${conf.packs.adversaries}`)) await store.sync.pack(conf.packs.adversaries, 'Actor'); } catch (e) { console.error('[sync] adversaries:', e.message); }
  }, 15_000).unref?.();
}
