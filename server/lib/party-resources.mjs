// party-resources.mjs — le web SUIT le pool partagé fvtt-party-resources (vivres/
// carburant/usure) en lisant les *world settings* de Foundry via get_world.
// Les valeurs vivent dans des Setting docs (clé `fvtt-party-resources.<id>` ...),
// non listées comme collection lisible → seule voie : get_world (lourd → caché).
import { mcpCall } from './mcp.mjs';

// On exclut les grosses collections : on ne veut que `settings` (+ modules/world).
const HEAVY = ['actors', 'items', 'journal', 'scenes', 'macros', 'playlists',
  'tables', 'cards', 'messages', 'combats', 'drawings', 'lights', 'sounds', 'walls', 'notes', 'packs'];
const PR = 'fvtt-party-resources';
const num = (v) => (v == null || v === '' ? null : Number(v));

export function createPartyResources({ config, logger = console } = {}) {
  let cache = null; // { t, map }

  // Aplatit les settings du monde en map { key: value } (valeurs JSON-décodées).
  async function settingsMap() {
    if (cache && Date.now() - cache.t < 30_000) return cache.map;
    const map = {};
    let worldKeys = [];
    try {
      const w = await mcpCall('get_world', { excludeCollections: HEAVY });
      worldKeys = w && typeof w === 'object' ? Object.keys(w) : [];
      const raw = w?.settings ?? w?.world?.settings ?? [];
      const arr = Array.isArray(raw) ? raw : Object.values(raw || {});
      for (const s of arr) {
        const key = s?.key ?? s?.name;
        if (key == null) continue;
        let v = s.value;
        if (typeof v === 'string') { try { v = JSON.parse(v); } catch { /* garde la string */ } }
        map[key] = v;
      }
    } catch (e) { logger.warn?.('[party-resources] get_world', String(e.message || e)); }
    cache = { t: Date.now(), map, worldKeys };
    return map;
  }

  // Liste brute des ressources party-resources (id, nom, valeur, max, min).
  async function list() {
    const m = await settingsMap();
    const ids = m[`${PR}.resource_list`];
    const arr = Array.isArray(ids) ? ids : [];
    return arr.map((id) => ({
      id,
      name: m[`${PR}.${id}_name`] ?? id,
      value: num(m[`${PR}.${id}`]),
      max: num(m[`${PR}.${id}_max`]),
      min: num(m[`${PR}.${id}_min`]),
      visible: m[`${PR}.${id}_visible`] !== false,
    }));
  }

  // Valeurs mappées au vaisseau (ids = réglages du module Holocron, défauts
  // vivres/carburant/usure). Renvoie null si party-resources n'est pas configuré.
  async function shipPool() {
    const m = await settingsMap();
    const ids = m[`${PR}.resource_list`];
    if (!Array.isArray(ids) || !ids.length) return null;
    const has = (id) => ids.includes(id);
    const cfgId = (k, def) => m[`swffg-holocron.${k}`] || def;
    const foodId = cfgId('resFoodId', 'vivres'), fuelId = cfgId('resFuelId', 'carburant'), wearId = cfgId('resWearId', 'usure');
    const out = {};
    if (has(foodId)) { const v = num(m[`${PR}.${foodId}`]); if (v != null) { out.vivres = v; const mx = num(m[`${PR}.${foodId}_max`]); if (mx != null) out.vivresMax = mx; } }
    if (has(fuelId)) { const v = num(m[`${PR}.${fuelId}`]); if (v != null) { out.fuel = v; const mx = num(m[`${PR}.${fuelId}_max`]); if (mx != null) out.fuelMax = mx; } }
    if (has(wearId)) { const v = num(m[`${PR}.${wearId}`]); if (v != null) out.usure = v; }
    return Object.keys(out).length ? out : null;
  }

  // Fusionne le pool live party-resources sur un objet vaisseau (le pool prime).
  async function overlayShip(ship) {
    try { const p = await shipPool(); return p ? { ...ship, ...p } : ship; }
    catch { return ship; }
  }

  const debug = async () => { await settingsMap(); return { worldKeys: cache?.worldKeys || [], settingKeys: Object.keys(cache?.map || {}).filter((k) => k.startsWith(PR) || k.startsWith('swffg-holocron')).slice(0, 40) }; };

  return { list, shipPool, overlayShip, invalidate: () => { cache = null; }, debug };
}
