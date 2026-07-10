// adversary-links.js — résout un nom de combattant vers sa fiche de stats.
// Priorité à la fiche INTERNE (#/adv/<id>) ; lien externe en secours.
// Les correspondances et l'URL externe viennent de la config de campagne
// (⚙️ Holocron Config → advLinks), plus aucun id de campagne en dur.
import { Data } from './data.js';

export function swadvUrl() { return Data.config?.advLinks?.externalUrl || ''; }
// compat : certains modules importent la constante — getter dynamique
export const SWADV_URL = new Proxy({}, { get: () => swadvUrl() });

const norm = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

let compiled = null;
function advMap() {
  const src = Data.config?.advLinks?.map || [];
  if (!compiled || compiled.src !== src) {
    compiled = { src, list: src.map((m) => { try { return [new RegExp(m.pattern, m.flags || ''), m.id]; } catch { return null; } }).filter(Boolean) };
  }
  return compiled.list;
}

// Renvoie l'id d'adversaire interne (ou null) pour un nom de combattant.
export function resolveAdversary(name) {
  if (!name) return null;
  for (const [re, id] of advMap()) {
    if (re.test(name) && Data.advById?.has(id)) return id;
  }
  const n = norm(name);
  const hit = (Data.adversaries || []).find((a) => norm(a.name) === n);
  return hit ? hit.id : null;
}

export function internalAdvRoute(id) { return '#/adv/' + id; }
