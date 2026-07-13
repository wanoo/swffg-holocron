// astro.mjs — routes d'astrogation (moteur partagé public/js/astro-core.js).
// Données génériques embarquées (planets/lanes) ; POI lus depuis Foundry.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as Astro from '../../public/js/astro-core.js';
import { mcpCall } from './mcp.mjs';
import { mejView } from './transform/journals.mjs';

// id à la Foundry/MEJ (makeid) : 16 caractères alphanumériques.
const AL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const makeId16 = () => { let s = ''; for (let i = 0; i < 16; i++) s += AL[Math.floor(Math.random() * AL.length)]; return s; };
// Est-ce la fiche MEJ « Place » d'une planète de l'astronav ?
const isPlanetPlace = (d) => {
  const jf = d?.flags?.['monks-enhanced-journal'];
  const pagePlace = (d?.pages || []).some((p) => p.flags?.['monks-enhanced-journal']?.type === 'place');
  return jf?.pagetype === 'place' || pagePlace || !!d?.flags?.['swffg-astronavigation'];
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
    const mv = mejView(doc, gm) || {};
    const page = (doc.pages || []).find((p) => p.flags?.['monks-enhanced-journal']) || (doc.pages || [])[0] || {};
    return {
      name: doc.name,
      uuid: `JournalEntry.${doc._id}`,
      img: page.src || doc.img || doc.flags?.['monks-enhanced-journal']?.img || null,
      html: page.text?.content || '',
      region: mv.placetype || '',                       // MEJ Place : placetype = région
      sector: mv.location || '',                        // location = secteur
      coord: mv.attributes?.districts || mv.attributes?.coordonnées || '',
      attributes: mv.attributes || {},
      relationships: mv.relationships || [],
      type: mv.type || 'place',
      source: 'mej',
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

  // Favoris MEJ d'un utilisateur → noms de planètes (résout chaque bookmark entityId).
  async function favorites(userId) {
    if (!userId) return [];
    const c = favCache.get(userId);
    if (c && Date.now() - c.t < FRESH) return c.names;
    const u = await userDoc(userId);
    const bm = readBookmarks(u);
    const names = [];
    for (const b of bm) {
      const uuid = b?.entityId || b?.uuid || null;
      if (!uuid) continue;
      const nm = await nameFromUuid(uuid);
      if (nm) names.push(nm);
    }
    const uniq = [...new Set(names)];
    favCache.set(userId, { t: Date.now(), names: uniq });
    return uniq;
  }

  async function allUsers() {
    const res = await mcpCall('get_users', { requested_fields: ['_id', 'name', 'flags'] });
    return Array.isArray(res) ? res : (res?.users || res?.results || res?.documents || []);
  }

  // Ajoute/retire un favori MEJ (marque-page) — PARTAGÉ : écrit le flag bookmarks de
  // TOUS les utilisateurs (joueurs + MJ). Forme du bookmark identique à MEJ (addBookmark).
  async function toggleFavorite(name, on) {
    if (!name) throw Object.assign(new Error('nom de monde requis'), { code: 400 });
    const uuid = await planetUuid(name);
    if (!uuid) throw Object.assign(new Error(`fiche MEJ absente pour « ${name} » — importe l'atlas dans Foundry`), { code: 404 });
    const users = await allUsers();
    let changed = 0;
    for (const u of users) {
      const bm = readBookmarks(u);
      const present = bm.some((b) => b?.entityId === uuid);
      let next = null;
      if (on && !present) next = [...bm, { id: makeId16(), entityId: uuid, text: name, icon: 'fa-place-of-worship' }];
      else if (!on && present) next = bm.filter((b) => b?.entityId !== uuid);
      if (!next) continue;
      await mcpCall('modify_document', { type: 'User', _id: u._id, updates: [{ 'flags.monks-enhanced-journal.bookmarks': next }] });
      favCache.delete(u._id);
      changed++;
    }
    return { ok: true, name, on: !!on, changed, users: users.length };
  }

  return { astroData, route, fiche, favorites, toggleFavorite, planetUuid };
}
