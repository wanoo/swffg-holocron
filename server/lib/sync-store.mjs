// sync-store.mjs — cache mémoire + disque des données Foundry, resynchronisé en
// tâche de fond. AUCUN appel MCP dans le chemin d'une requête entrante : on sert
// l'état courant (éventuellement stale) instantanément.
//
// Collections :
//   config         journal « ⚙️ Holocron Config » (flags.holocron.config)
//   users          get_users (login + rôles)
//   folders        get_folders
//   journalsIndex  index léger (requested_fields, sans pages) — pattern anti-dump
//   journal:<id>   document complet, pullé seulement si l'index a bougé
//   pcs            acteurs du dossier PJ (fiches complètes)
//   pack:<id>      compendium paginé par chunks d'ids (_id__in)
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { mcpCall } from './mcp.mjs';

const CHUNK = 40; // taille des lots _id__in pour les packs

export function createStore({ dataDir, logger = console }) {
  const cacheDir = join(dataDir, 'cache');
  const mem = new Map();      // collection → { version, syncedAt, items }
  let versionCounter = 1;
  const status = new Map();   // collection → { syncedAt, lastError, size }
  let loop = null;

  const safe = (name) => name.replace(/[^a-zA-Z0-9_.:-]/g, '_');

  async function persist(name) {
    const entry = mem.get(name);
    if (!entry) return;
    await mkdir(cacheDir, { recursive: true });
    const tmp = join(cacheDir, safe(name) + '.tmp');
    await writeFile(tmp, JSON.stringify(entry));
    await rename(tmp, join(cacheDir, safe(name) + '.json'));
  }

  async function restore(name) {
    try {
      const raw = await readFile(join(cacheDir, safe(name) + '.json'), 'utf8');
      const entry = JSON.parse(raw);
      mem.set(name, entry);
      versionCounter = Math.max(versionCounter, (entry.version || 0) + 1);
      return true;
    } catch { return false; }
  }

  function set(name, items) {
    mem.set(name, { version: versionCounter++, syncedAt: Date.now(), items });
    status.set(name, { syncedAt: Date.now(), lastError: null, size: JSON.stringify(items).length });
    persist(name).catch((e) => logger.error(`[store] persist ${name}: ${e.message}`));
  }

  const get = (name) => mem.get(name)?.items ?? null;
  const version = (name) => mem.get(name)?.version ?? 0;

  // write-through après une écriture Foundry réussie : le cache reflète NOTRE
  // écriture sans re-pull (le client stranjer ne voit pas ses propres writes).
  function patch(name, mutate) {
    const entry = mem.get(name);
    if (!entry) return;
    mutate(entry.items);
    entry.version = versionCounter++;
    entry.syncedAt = Date.now();
    persist(name).catch(() => {});
  }

  /* ------------------------------------------------------------- syncers -- */
  const INDEX_FIELDS = ['_id', 'name', 'folder', 'sort', 'ownership', 'flags'];

  async function syncConfig(configJournalName) {
    const list = await mcpCall('get_journals', { where: { name: configJournalName } });
    const j = (Array.isArray(list) ? list : []).find((x) => x && x.name === configJournalName);
    set('config', j?.flags?.holocron?.config || {});
  }

  async function syncUsers() {
    const users = await mcpCall('get_users', {});
    set('users', (Array.isArray(users) ? users : []).filter((u) => u && u._id)
      .map((u) => ({ _id: u._id, name: u.name, role: u.role, character: u.character || null, color: u.color || null })));
  }

  async function syncFolders() {
    const folders = await mcpCall('get_folders', {});
    set('folders', (Array.isArray(folders) ? folders : []).filter((f) => f && f._id));
  }

  async function syncJournalsIndex() {
    const idx = await mcpCall('get_journals', { requested_fields: INDEX_FIELDS });
    set('journalsIndex', (Array.isArray(idx) ? idx : []).filter((j) => j && j._id));
  }

  // Pull d'un journal complet — appelé par la boucle quand l'index a bougé,
  // ou explicitement après une écriture ciblée.
  async function syncJournal(id, name) {
    // where:{_id} vérifié au POC ; name en secours (documents renommés)
    let list = await mcpCall('get_journals', { where: { _id: id } });
    let j = (Array.isArray(list) ? list : []).find((x) => x && x._id === id);
    if (!j && name) {
      list = await mcpCall('get_journals', { where: { name } });
      j = (Array.isArray(list) ? list : []).find((x) => x && x.name === name);
    }
    if (j) set(`journal:${id}`, j);
    return j || null;
  }

  // Tous les acteurs MONDE (PJ + PNJ custom) — les vues filtrent par dossier.
  async function syncActors() {
    const actors = await mcpCall('get_actors', {});
    set('actors', (Array.isArray(actors) ? actors : []).filter((a) => a && a._id));
  }

  // Compendium complet par chunks (index léger puis _id__in) — jamais de dump.
  async function syncPack(packId, type) {
    const idx = await mcpCall('get_pack_documents', { type, pack: packId, requested_fields: ['_id', 'name'] });
    const ids = (Array.isArray(idx) ? idx : []).map((d) => d._id).filter(Boolean);
    const docs = [];
    for (let i = 0; i < ids.length; i += CHUNK) {
      const chunk = await mcpCall('get_pack_documents', { type, pack: packId, query: { _id__in: ids.slice(i, i + CHUNK) } });
      if (Array.isArray(chunk)) docs.push(...chunk);
    }
    set(`pack:${packId}`, docs);
  }

  /* ------------------------------------------------------- boucle de fond -- */
  async function tick(opts) {
    const { configJournalName } = opts;
    const jobs = [
      ['config', () => syncConfig(configJournalName)],
      ['users', () => syncUsers()],
      ['folders', () => syncFolders()],
      ['journalsIndex', () => syncJournalsIndex()],
      ['actors', () => syncActors()],
    ];
    for (const [name, job] of jobs) {
      try { await job(); }
      catch (e) {
        status.set(name, { ...(status.get(name) || {}), lastError: String(e.message).slice(0, 200) });
        logger.error(`[store] sync ${name}: ${e.message}`);
      }
    }
    // journaux dont l'index a changé depuis le cache (flags.holocron.rev ou sort)
    const idx = get('journalsIndex') || [];
    for (const entry of idx) {
      const cached = mem.get(`journal:${entry._id}`)?.items;
      const rev = entry.flags?.holocron?.rev?.updatedAt || null;
      const cachedRev = cached?.flags?.holocron?.rev?.updatedAt || null;
      if (!cached || (rev && rev !== cachedRev)) {
        try { await syncJournal(entry._id, entry.name); }
        catch (e) { logger.error(`[store] journal ${entry.name}: ${e.message}`); }
      }
    }
  }

  function startLoop(opts, intervalS = 300) {
    const run = () => tick(opts).catch((e) => logger.error(`[store] tick: ${e.message}`));
    run();
    loop = setInterval(run, intervalS * 1000);
    loop.unref?.();
  }

  async function boot() {
    // restaure TOUT le cache disque (collections cœur, journaux, packs)
    let restored = 0;
    try {
      const { readdir } = await import('node:fs/promises');
      for (const f of await readdir(cacheDir)) {
        if (!f.endsWith('.json')) continue;
        if (await restore(f.slice(0, -5))) restored++;
      }
    } catch { /* premier démarrage : pas de cache */ }
    return restored;
  }

  return {
    get, set, version, patch, boot, startLoop, status,
    sync: { config: syncConfig, users: syncUsers, folders: syncFolders, journalsIndex: syncJournalsIndex, journal: syncJournal, actors: syncActors, pack: syncPack, tick },
  };
}
