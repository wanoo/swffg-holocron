// astro-core.js — moteur d'astrogation FFG partagé (navigateur + serveur Node).
// Aucune dépendance DOM : import à la fois par public/js/astronav.js (UI) et par
// server/index.mjs (route /api/astro/route appelée depuis Foundry). Source unique
// des règles « Astrogation Difficulty v1.2 » et du routage A* sur les hyperroutes.

export const UNITS_PER_CASE = 99.7;
export const DAYS_PER_CASE = { major: 0.4, minor: 0.7, off: 1.2 };
export const OFF_MAX_JOIN = 900;       // unités max pour rejoindre le réseau hors-route
export const HOSTILE_PENALTY = 4;      // coût A* ×4 pour franchir une zone hostile (mode discret)
export const HOSTILE_DEFAULT = ['Empire', 'Premier Ordre'];

export const REGION_ORDER = ['Noyau profond', 'Noyau', 'Colonies', 'Bordure Intérieure', "Région d'expansion",
  'Bordure Médiane', 'Espace Hutt', 'Bordure Extérieure', 'Espace sauvage', 'Régions Inconnues'];
export function regionRank(r) { const i = REGION_ORDER.indexOf(r); return i < 0 ? REGION_ORDER.length - 1 : i; }

export const DIFF_NAMES = { 1: 'Facile', 2: 'Moyen', 3: 'Difficile', 4: 'Intimidant', 5: 'Exceptionnel' };
export const CLASS_PENALTY = { 5: 0, 4: 0, 3: 1, 2: 2, 1: 2, 0: 3 };
export const CLASS_LABEL = { 5: 'spatioport de classe A–B', 4: 'spatioport standard (C)', 3: 'services limités (D)', 2: "terrain d'atterrissage (E)", 1: 'terrain sommaire (E)', 0: 'sans spatioport (X)' };
export const CALC_TIME = { 1: '2 rounds', 2: '5 rounds', 3: '10 minutes', 4: '1 heure', 5: '4 heures' };
export const CALC_TIME_UP = '4 heures (Redoutable+)';

// Construit le graphe des hyperroutes : nœuds {name, xy, aff}, arêtes pondérées par classe.
export function buildGraph(byName, lanes) {
  const idx = new Map(); const nodes = []; const adj = new Map();
  const nodeOf = (name) => {
    if (idx.has(name)) return idx.get(name);
    const p = byName[name];
    if (!p || !p.xy) return -1;
    idx.set(name, nodes.length); adj.set(nodes.length, []);
    nodes.push({ name, xy: p.xy, aff: (p.f && p.f.aff) || [] });
    return nodes.length - 1;
  };
  for (const l of lanes || []) {
    const cls = l.major ? 'major' : 'minor';
    let prev = -1;
    for (const nm of l.planets) {
      const i = nodeOf(nm);
      if (i < 0) continue;
      if (prev >= 0 && prev !== i) {
        const du = Math.hypot(nodes[prev].xy[0] - nodes[i].xy[0], nodes[prev].xy[1] - nodes[i].xy[1]);
        if (du > 1) { adj.get(prev).push({ to: i, du, cls }); adj.get(i).push({ to: prev, du, cls }); }
      }
      prev = i;
    }
  }
  return { nodes, adj };
}

// Meilleur itinéraire o→dst : A* sur le réseau + raccords hors-route.
// opts : { avoid:bool, hostile:Set<string> }. Renvoie { segs, cases, days, hostile, regions, avoid }.
export function computeRoute(graph, o, dst, hyper = 1, opts = {}) {
  const { nodes, adj } = graph;
  const N = nodes.length;
  const cost = (du, cls) => (du / UNITS_PER_CASE) * DAYS_PER_CASE[cls];
  const hostile = opts.hostile instanceof Set ? opts.hostile : new Set();
  const hostileNode = new Array(N);
  for (let i = 0; i < N; i++) hostileNode[i] = nodes[i].aff.some((a) => hostile.has(a));
  const impMul = (to) => (opts.avoid && to < N && hostileNode[to] ? HOSTILE_PENALTY : 1);
  const vAdj = new Map();
  const link = (vi, xy) => {
    const near = [];
    for (let i = 0; i < N; i++) {
      const du = Math.hypot(nodes[i].xy[0] - xy[0], nodes[i].xy[1] - xy[1]);
      if (du < OFF_MAX_JOIN) near.push({ to: i, du, cls: 'off' });
    }
    near.sort((a, b) => a.du - b.du);
    vAdj.set(vi, near.slice(0, 8));
  };
  link(N, o.xy); link(N + 1, dst.xy);
  const direct = Math.hypot(o.xy[0] - dst.xy[0], o.xy[1] - dst.xy[1]);
  vAdj.get(N).push({ to: N + 1, du: direct, cls: 'off' });
  const edgesOf = (i) => {
    const base = i < N ? adj.get(i) : vAdj.get(i) || [];
    if (i < N) {
      const du = Math.hypot(nodes[i].xy[0] - dst.xy[0], nodes[i].xy[1] - dst.xy[1]);
      return du < OFF_MAX_JOIN ? base.concat([{ to: N + 1, du, cls: 'off' }]) : base;
    }
    return base;
  };
  const H = new Array(N + 2);
  const heur = (i) => {
    if (H[i] === undefined) {
      const xy = i === N ? o.xy : i === N + 1 ? dst.xy : nodes[i].xy;
      H[i] = (Math.hypot(xy[0] - dst.xy[0], xy[1] - dst.xy[1]) / UNITS_PER_CASE) * DAYS_PER_CASE.major;
    }
    return H[i];
  };
  const D = new Array(N + 2).fill(Infinity), P = new Array(N + 2).fill(-1), PC = new Array(N + 2).fill(null), done = new Array(N + 2).fill(false);
  D[N] = 0;
  for (;;) {
    let u = -1, best = Infinity;
    for (let i = 0; i <= N + 1; i++) if (!done[i] && D[i] < Infinity && D[i] + heur(i) < best) { best = D[i] + heur(i); u = i; }
    if (u < 0 || u === N + 1) break;
    done[u] = true;
    for (const e of edgesOf(u)) {
      const nd = D[u] + cost(e.du, e.cls) * impMul(e.to);
      if (nd < D[e.to]) { D[e.to] = nd; P[e.to] = u; PC[e.to] = e.cls; }
    }
  }
  if (!isFinite(D[N + 1])) return null;
  const xyOf = (i) => (i === N ? o.xy : i === N + 1 ? dst.xy : nodes[i].xy);
  const segs = [];
  const cases = { major: 0, minor: 0, off: 0, total: 0 };
  const onPath = new Set();
  for (let v = N + 1; P[v] >= 0 || P[v] === N; v = P[v]) {
    const u = P[v];
    const du = Math.hypot(xyOf(u)[0] - xyOf(v)[0], xyOf(u)[1] - xyOf(v)[1]);
    const cls = PC[v] || 'off';
    segs.unshift({ a: xyOf(u), b: xyOf(v), cls, du });
    cases[cls] += du / UNITS_PER_CASE; cases.total += du / UNITS_PER_CASE;
    if (u < N) onPath.add(u);
    if (v < N) onPath.add(v);
    if (u === N) break;
  }
  let hostileCount = 0;
  for (const i of onPath) if (hostileNode[i]) hostileCount++;
  const regions = Math.abs(regionRank(o.region) - regionRank(dst.region));
  return { segs, cases, days: D[N + 1] * hyper, hostile: hostileCount, regions, avoid: !!opts.avoid };
}

// Difficulté d'astrogation « Astrogation Difficulty v1.2 » → { diff, boost, setback, upgrades, parts, calc }.
export function astroCheck(o, dst, route, ship) {
  const parts = [];
  let raw = 1;
  parts.push({ label: 'Base', tag: 'Facile' });
  const worst = Math.min(o.charted, dst.charted);
  const cp = CLASS_PENALTY[worst] || 0;
  if (cp) { raw += cp; parts.push({ label: CLASS_LABEL[worst], tag: `+${cp}` }); }
  if (route.regions > 0) { raw += route.regions; parts.push({ label: `${route.regions} région${route.regions > 1 ? 's' : ''} franchie${route.regions > 1 ? 's' : ''}`, tag: `+${route.regions}` }); }
  if (ship && ship.usure > 80) { raw += 2; parts.push({ label: 'Vaisseau lourdement usé (>80%)', tag: '+2' }); }
  else if (ship && ship.usure > 50) { raw += 1; parts.push({ label: 'Vaisseau usé (>50%)', tag: '+1' }); }
  let boost = 0, setback = 0;
  const t = route.cases.total || 1;
  const majFrac = route.cases.major / t, minFrac = route.cases.minor / t, offFrac = route.cases.off / t;
  if (majFrac > 0.6) { boost += 2; parts.push({ label: 'Grande hyperroute (Type 1–2)', tag: '+2 bo' }); }
  else if (majFrac + minFrac > 0.5) { boost += 1; parts.push({ label: 'Route secondaire documentée (Type 3)', tag: '+1 bo' }); }
  if (offFrac > 0.4) { setback += 2; parts.push({ label: 'Trajet non cartographié (Type 5)', tag: '+2 se' }); }
  if (route.hostile > 0) {
    const s = Math.min(route.hostile, 3);
    setback += s;
    parts.push({ label: `${route.hostile} monde${route.hostile > 1 ? 's' : ''} hostile${route.hostile > 1 ? 's' : ''} sur la route${route.avoid ? ' (résiduels)' : ''}`, tag: `+${s} se` });
  } else if (route.avoid) {
    parts.push({ label: 'Itinéraire discret — aucune zone hostile traversée', tag: '✓' });
  }
  let upgrades = 0, diff = raw;
  if (raw > 5) { upgrades = raw - 5; diff = 5; parts.push({ label: `Au-delà de Redoutable → ${upgrades} amélioration${upgrades > 1 ? 's' : ''}`, tag: `↑${upgrades}` }); }
  diff = Math.max(1, Math.min(5, diff));
  return { diff, boost, setback, upgrades, parts, calc: upgrades ? CALC_TIME_UP : CALC_TIME[diff] };
}

// Consommation d'un itinéraire (règle maison) : vivres (j), carburant (1/case, +50% hors-route), usure (%).
export function tripCost(route, hyper) {
  const days = Math.ceil(route.days);
  const fuel = Math.ceil(route.cases.total + route.cases.off * 0.5);
  const usure = Math.max(1, Math.ceil(route.days * 0.4 + route.cases.off * 0.6));
  return { days, fuel, usure };
}

export function fmtDays(days) {
  if (days < 0.75) return '< 1 jour';
  if (days < 10) { const n = Math.max(1, Math.round(days)); return `≈ ${n} jour${n > 1 ? 's' : ''}`; }
  const w = Math.max(1, Math.round(days / 7));
  return `≈ ${w} semaine${w > 1 ? 's' : ''}`;
}
