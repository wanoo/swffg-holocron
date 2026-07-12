// astro.mjs — routes d'astrogation (moteur partagé public/js/astro-core.js).
// Données génériques embarquées (planets/lanes) ; POI lus depuis Foundry.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as Astro from '../../public/js/astro-core.js';
import { mcpCall } from './mcp.mjs';

export function createAstroService({ publicDir, config, logger = console }) {
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

  return { astroData, route };
}
