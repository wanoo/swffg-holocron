// astro.mjs — routes d'astrogation (moteur partagé public/js/astro-core.js).
// Données génériques embarquées (planets/lanes) ; POI lus depuis Foundry.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as Astro from '../../public/js/astro-core.js';
import { mcpCall } from './mcp.mjs';
import { sheetView } from './transform/journals.mjs';

// Est-ce la fiche d'une planète de l'astronav ? (CC location, MEJ Place legacy,
// ou flag astronav posé à l'import de l'atlas.)
const isPlanetPlace = (d) => {
  const cc = d?.flags?.['campaign-codex']?.type;
  const jf = d?.flags?.['monks-enhanced-journal'];
  const pagePlace = (d?.pages || []).some((p) => p.flags?.['monks-enhanced-journal']?.type === 'place');
  return cc === 'location' || cc === 'region' || jf?.pagetype === 'place' || pagePlace || !!d?.flags?.['swffg-astronavigation'];
};

export function createAstroService({ publicDir, config, store, logger = console }) {
  let data = null;
  async function astroData() {
    if (data) return data;
    const [pRaw, lRaw] = await Promise.all([
      readFile(join(publicDir, 'data', 'planets.json'), 'utf8'),
      readFile(join(publicDir, 'data', 'lanes.json'), 'utf8'),
    ]);
    const pj = JSON.parse(pRaw);
    const planets = Array.isArray(pj) ? pj : (pj.planets || pj.systems || Object.values(pj)[0]);
    const lanes = JSON.parse(lRaw);
    const byName = {};
    for (const p of planets) byName[p.name] = p;
    const graph = Astro.buildGraph(byName, lanes);
    const names = planets.map((p) => p.name).sort((a, b) => a.localeCompare(b, 'fr'));
    data = { byName, graph, names };
    return data;
  }

  async function route(q) {
    const { byName, graph } = await astroData();
    const o = byName[q.get('from') || ''], dst = byName[q.get('to') || ''];
    if (!o) return { code: 404, body: { error: `origine inconnue : ${q.get('from') || ''}` } };
    if (!dst) return { code: 404, body: { error: `destination inconnue : ${q.get('to') || ''}` } };
    if (!o.xy || !dst.xy) return { code: 422, body: { error: 'coordonnées inconnues pour un des deux mondes' } };
    if (o.name === dst.name) return { code: 422, body: { error: 'origine et destination identiques' } };
    const hyper = Math.max(0.5, Math.min(4, Number(q.get('hyper')) || 1));
    const avoid = q.get('avoid') === '1' || q.get('avoid') === 'true';
    const hostile = new Set((q.get('hostile') || Astro.HOSTILE_DEFAULT.join(',')).split(',').map((s) => s.trim()).filter(Boolean));
    const r = Astro.computeRoute(graph, o, dst, hyper, { avoid, hostile });
    if (!r) return { code: 422, body: { error: 'aucun itinéraire trouvé' } };
    const ship = { usure: Math.max(0, Math.min(100, Number(q.get('usure')) || 0)) };
    const chk = Astro.astroCheck(o, dst, r, ship);
    const cost = Astro.tripCost(r, hyper);
    return { code: 200, body: {
      from: o.name, to: dst.name, hyper, avoid,
      days: r.days, daysLabel: Astro.fmtDays(r.days),
      cases: { total: +r.cases.total.toFixed(1), major: +r.cases.major.toFixed(1), minor: +r.cases.minor.toFixed(1), off: +r.cases.off.toFixed(1) },
      hostile: r.hostile, regions: r.regions,
      diff: chk.diff, diffName: Astro.DIFF_NAMES[chk.diff], boost: chk.boost, setback: chk.setback, upgrades: chk.upgrades, calc: chk.calc,
      parts: chk.parts, cost,
    } };
  }

  /* ------------------------------------------------------ MEJ : fiche + favoris */
  // Caches mémoire (la file MCP est lente/séquentielle ; les fiches/favoris changent peu).
  const ficheCache = new Map();     // name → { t, view }
  const uuidByName = new Map();      // name → 'JournalEntry.<id>' | null
  const nameByUuid = new Map();      // uuid → name | null
  const favCache = new Map();        // userId → { t, names }
  const FRESH = 30_000;

  async function getJournals(where, fields) {
    const res = await mcpCall('get_journals', { where, requested_fields: fields });
    return Array.isArray(res) ? res : (res?.journals || res?.results || res?.documents || []);
  }

  // La fiche MEJ « Place » du monde pour un nom de planète (ou null si non importée).
  async function placeDoc(name) {
    if (!name) return null;
    const list = await getJournals({ name }, ['_id', 'name', 'img', 'flags', 'folder', 'ownership', 'pages']);
    const doc = list.find(isPlanetPlace) || null;
    const uuid = doc ? `JournalEntry.${doc._id}` : null;
    uuidByName.set(name, uuid);
    if (uuid) nameByUuid.set(uuid, name);
    return doc;
  }

  function buildFiche(doc, gm) {
    const mv = sheetView(doc, gm) || {}; // CC location d'abord, MEJ Place en legacy
    const page = (doc.pages || []).find((p) => p.flags?.['monks-enhanced-journal']) || (doc.pages || [])[0] || {};
    return {
      name: doc.name,
      uuid: `JournalEntry.${doc._id}`,
      img: page.src || doc.img || doc.flags?.['campaign-codex']?.image || doc.flags?.['monks-enhanced-journal']?.img || null,
      html: page.text?.content || '',
      region: mv.placetype || mv.attributes?.region || '',       // MEJ : placetype ; CC : data/attrs.region
      sector: mv.location || mv.attributes?.secteur || mv.attributes?.rattachement || '',
      coord: mv.attributes?.districts || mv.attributes?.coordonnées || mv.attributes?.coord || '',
      attributes: mv.attributes || {},
      relationships: mv.relationships || [],
      type: mv.type || 'place',
      source: mv.source === 'cc' ? 'cc' : 'mej',
    };
  }

  async function fiche(name, gm = false) {
    if (!name) return null;
    const c = ficheCache.get(name);
    if (c && Date.now() - c.t < FRESH && c.gm === gm) return c.view;
    let view = null;
    try { const doc = await placeDoc(name); view = doc ? buildFiche(doc, gm) : null; }
    catch (e) { logger.warn?.('[astro] fiche', name, String(e.message || e)); view = null; }
    ficheCache.set(name, { t: Date.now(), gm, view });
    return view;
  }

  async function planetUuid(name) {
    if (uuidByName.has(name)) return uuidByName.get(name);
    await placeDoc(name);
    return uuidByName.get(name) ?? null;
  }

  async function nameFromUuid(uuid) {
    if (nameByUuid.has(uuid)) return nameByUuid.get(uuid);
    const m = /^JournalEntry\.([A-Za-z0-9]+)/.exec(String(uuid || ''));
    let name = null;
    if (m) { try { const list = await getJournals({ _id: m[1] }, ['_id', 'name']); name = list[0]?.name || null; } catch { name = null; } }
    nameByUuid.set(uuid, name);
    return name;
  }

  async function userDoc(userId) {
    const res = await mcpCall('get_users', { requested_fields: ['_id', 'name', 'flags'] });
    const list = Array.isArray(res) ? res : (res?.users || res?.results || res?.documents || []);
    return list.find((u) => u._id === userId) || null;
  }
  const readBookmarks = (u) => {
    const bm = u?.flags?.['monks-enhanced-journal']?.bookmarks;
    return Array.isArray(bm) ? bm : [];
  };

  /* --- Favoris (master switch) : tag « Favori » posé SUR la fiche planète -------
   * (flags.campaign-codex.data.tags pour une fiche CC, sinon
   * flags.asset-librarian.filterTag — les deux indexés par Asset Librarian).
   * Index compact `flags.holocron.config.favorites = [{id, name}]` maintenu en
   * write-through : le web et l'astronav le lisent sans scanner l'atlas. */
  const FAV_TAG = 'Favori';
  const configEntry = () => (store.get('journalsIndex') || [])
    .find((j) => j.name === (process.env.CONFIG_JOURNAL_NAME || '⚙️ Holocron Config'));
  const favIndex = () => {
    const cfg = store.get('config') || {};
    return Array.isArray(cfg.favorites) ? cfg.favorites : null;
  };
  const normTags = (raw) => (Array.isArray(raw) ? raw : String(raw || '').split(','))
    .map((s) => String(s).trim()).filter(Boolean);

  // Pose/retire le tag « Favori » sur la fiche (par id de JournalEntry).
  async function tagFavorite(id, on) {
    const list = await getJournals({ _id: id }, ['_id', 'name', 'flags']);
    const doc = list.find((d) => d && d._id === id);
    if (!doc) return false;
    const isCC = Boolean(doc.flags?.['campaign-codex']?.type);
    const path = isCC ? 'flags.campaign-codex.data.tags' : 'flags.asset-librarian.filterTag';
    const tags = normTags(isCC ? doc.flags?.['campaign-codex']?.data?.tags : doc.flags?.['asset-librarian']?.filterTag);
    const has = tags.some((t) => t.toLowerCase() === FAV_TAG.toLowerCase());
    const next = on && !has ? [...tags, FAV_TAG]
      : (!on && has ? tags.filter((t) => t.toLowerCase() !== FAV_TAG.toLowerCase()) : null);
    if (next) await mcpCall('modify_document', { type: 'JournalEntry', _id: id, updates: [{ [path]: next }] });
    return true;
  }

  async function writeFavIndex(favs) {
    const entry = configEntry();
    if (!entry) return false;
    await mcpCall('modify_document', { type: 'JournalEntry', _id: entry._id, updates: [{ 'flags.holocron.config.favorites': favs }] });
    store.patch('config', (cfg) => { cfg.favorites = favs; });
    return true;
  }

  // Migration one-shot : marque-pages MEJ (tous utilisateurs) → tags + index config.
  let favMigrating = false;
  async function migrateBookmarks() {
    if (favIndex() || !configEntry()) return;
    const res = await mcpCall('get_users', { requested_fields: ['_id', 'name', 'flags'] });
    const users = Array.isArray(res) ? res : (res?.users || res?.results || res?.documents || []);
    const map = new Map();
    for (const u of users) for (const b of readBookmarks(u)) {
      const m = /^JournalEntry\.([A-Za-z0-9]+)/.exec(String(b?.entityId || b?.uuid || ''));
      if (m && !map.has(m[1])) map.set(m[1], b?.text || null);
    }
    const favs = [];
    for (const [id, text] of map) {
      const nm = text || await nameFromUuid(`JournalEntry.${id}`);
      if (nm) favs.push({ id, name: nm });
    }
    await writeFavIndex(favs);
    for (const f of favs) { try { await tagFavorite(f.id, true); } catch { /* fiche absente : l'index fait foi */ } }
    logger.log?.(`[astro] favoris migrés depuis les marque-pages MEJ : ${favs.length}`);
  }

  // Favoris partagés de la table → noms de planètes (index config, legacy en repli).
  async function favorites(userId) {
    const idx = favIndex();
    if (idx) return [...new Set(idx.map((f) => f?.name).filter(Boolean))];
    // pré-migration : marque-pages MEJ de l'utilisateur + migration en tâche de fond
    if (!favMigrating) {
      favMigrating = true;
      migrateBookmarks().catch((e) => logger.warn?.('[astro] migration favoris:', String(e.message || e)))
        .finally(() => { favMigrating = false; });
    }
    if (!userId) return [];
    const c = favCache.get(userId);
    if (c && Date.now() - c.t < FRESH) return c.names;
    const u = await userDoc(userId);
    const names = [];
    for (const b of readBookmarks(u)) {
      const nm = await nameFromUuid(b?.entityId || b?.uuid || null);
      if (nm) names.push(nm);
    }
    const uniq = [...new Set(names)];
    favCache.set(userId, { t: Date.now(), names: uniq });
    return uniq;
  }

  // Bascule un favori : tag sur la fiche + index config (write-through).
  async function toggleFavorite(name, on) {
    if (!name) throw Object.assign(new Error('nom de monde requis'), { code: 400 });
    const uuid = await planetUuid(name);
    if (!uuid) throw Object.assign(new Error(`fiche absente pour « ${name} » — importe l'atlas dans Foundry`), { code: 404 });
    const id = uuid.split('.')[1];
    await tagFavorite(id, !!on);
    const cur = favIndex() || [];
    const next = on
      ? (cur.some((f) => f?.id === id) ? cur : [...cur, { id, name }])
      : cur.filter((f) => f?.id !== id);
    const wrote = await writeFavIndex(next);
    if (!wrote) throw Object.assign(new Error('⚙️ Holocron Config introuvable (index des favoris)'), { code: 500 });
    return { ok: true, name, on: !!on };
  }

  return { astroData, route, fiche, favorites, toggleFavorite, planetUuid };
}
