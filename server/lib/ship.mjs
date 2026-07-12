// ship.mjs — vaisseau du groupe (état canonique dans un journal Foundry,
// flags.holocron.ship) + tableau de bord agrégé. Porté de l'Archive Holocron ;
// noms de journaux fournis par la config de campagne (génériques par défaut).
import { mcpCall, mcpAuthorId, mcpQueue } from './mcp.mjs';

export const SHIP_DEFAULTS = { name: 'Vaisseau du groupe', vivres: 60, vivresMax: 60, fuel: 30, fuelMax: 30, usure: 0, hyper: 1 };

export function clampShip(s) {
  const n = (v, d) => (Number.isFinite(+v) ? +v : d);
  const o = { ...SHIP_DEFAULTS, ...s };
  o.vivresMax = Math.max(1, n(o.vivresMax, 60)); o.fuelMax = Math.max(1, n(o.fuelMax, 30));
  o.vivres = Math.max(0, Math.min(o.vivresMax, n(o.vivres, o.vivresMax)));
  o.fuel = Math.max(0, Math.min(o.fuelMax, n(o.fuel, o.fuelMax)));
  o.usure = Math.max(0, Math.min(100, n(o.usure, 0)));
  o.hyper = n(o.hyper, 1); o.name = String(o.name || SHIP_DEFAULTS.name).slice(0, 60);
  return o;
}

function shipPageHTML(s) {
  const bar = (v, m) => Math.round((v / m) * 100);
  return `<h2>🚀 ${s.name}</h2><ul>`
    + `<li>🥫 Vivres : <strong>${s.vivres} / ${s.vivresMax}</strong> jours (${bar(s.vivres, s.vivresMax)}%)</li>`
    + `<li>⛽ Carburant : <strong>${s.fuel} / ${s.fuelMax}</strong> unités (${bar(s.fuel, s.fuelMax)}%)</li>`
    + `<li>🔧 Usure : <strong>${s.usure}%</strong>${s.usure > 80 ? ' — ⚠️ [se][se] + test Mécanique avant chaque saut' : s.usure > 50 ? ' — [se] aux tests de Pilotage/Mécanique' : ''}</li>`
    + `<li>Hyperdrive : ×${s.hyper}</li></ul>`
    + `<p><em>État géré par le Holocron.</em></p>`;
}

export function createShipService({ journalName, logger = console }) {
  async function shipJournal() {
    const list = await mcpCall('get_journals', { where: { name: journalName } });
    let doc = (Array.isArray(list) ? list : []).find((j) => j.name === journalName);
    if (!doc) {
      const ship = clampShip({});
      await mcpCall('create_document', { type: 'JournalEntry', data: [{
        name: journalName,
        flags: { holocron: { ship } },
        pages: [{ name: 'État', type: 'text', text: { content: shipPageHTML(ship), format: 1 } }],
      }] });
      const l2 = await mcpCall('get_journals', { where: { name: journalName } });
      doc = (Array.isArray(l2) ? l2 : []).find((j) => j.name === journalName);
      if (!doc) throw new Error('création du journal vaisseau échouée');
    }
    const pageId = Array.isArray(doc.pages) && doc.pages[0] ? doc.pages[0]._id : null;
    return { jid: doc._id, pageId, ship: clampShip(doc.flags?.holocron?.ship || {}) };
  }

  // Les mutations passent déjà par mcpQueue (dans mcpCall) ; ce verrou évite en
  // plus l'entrelacement lecture-modif-écriture de DEUX actions concurrentes.
  let lock = Promise.resolve();
  const withLock = (fn) => { const run = lock.then(fn, fn); lock = run.catch(() => {}); return run; };

  // action : 'get' | 'apply' | 'refuel' | 'fuel' | 'repair' | 'set'
  async function applyShip(action, payload = {}, who = 'Équipage') {
    return withLock(async () => {
      const { jid, pageId, ship } = await shipJournal();
      if (action === 'get') return ship;
      let next = { ...ship }, log = '';
      if (action === 'apply') {
        const t = payload.trip || {};
        const days = Math.max(0, Math.round(+t.days || 0)), fuel = Math.max(0, Math.round(+t.fuel || 0)), usure = Math.max(0, Math.round(+t.usure || 0));
        next.vivres = Math.max(0, ship.vivres - days);
        next.fuel = Math.max(0, ship.fuel - fuel);
        next.usure = Math.min(100, ship.usure + usure);
        const dest = String(payload.label || 'voyage').slice(0, 120);
        log = `<h4>🚀 Voyage — ${dest}</h4><p>🥫 vivres −${days} → <strong>${next.vivres}</strong> · ⛽ carburant −${fuel} → <strong>${next.fuel}</strong> · 🔧 usure +${usure}% → <strong>${next.usure}%</strong></p>`
          + (next.usure > 80 ? '<p>⚠️ Usure critique : [se][se] + test de Mécanique avant chaque saut.</p>' : next.usure > 50 ? '<p>Usure élevée : [se] aux tests de Pilotage/Mécanique.</p>' : '');
      } else if (action === 'refuel') { next.vivres = ship.vivresMax; log = `<h4>🥫 Ravitaillement — ${who}</h4><p>Vivres au maximum (${ship.vivresMax} jours).</p>`; }
      else if (action === 'fuel') { next.fuel = ship.fuelMax; log = `<h4>⛽ Plein de carburant — ${who}</h4><p>Réservoir plein (${ship.fuelMax} unités).</p>`; }
      else if (action === 'repair') { next.usure = 0; log = `<h4>🔧 Révision — ${who}</h4><p>Usure remise à 0%.</p>`; }
      else if (action === 'set') { next = clampShip({ ...ship, ...(payload.ship || {}) }); log = `<h4>🚀 Vaisseau mis à jour — ${who}</h4>`; }
      else throw new Error('action vaisseau inconnue');
      next = clampShip(next);
      await mcpCall('modify_document', { type: 'JournalEntry', _id: jid, updates: [{ 'flags.holocron.ship': next }] });
      if (pageId) { try { await mcpCall('modify_document', { type: 'JournalEntryPage', _id: pageId, parent_uuid: `JournalEntry.${jid}`, updates: [{ 'text.content': shipPageHTML(next) }] }); } catch { /* best-effort */ } }
      if (log) { try { await mcpCall('create_document', { type: 'ChatMessage', data: [{ author: await mcpAuthorId(), speaker: { alias: who }, content: log }] }); } catch { /* best-effort */ } }
      return next;
    });
  }

  return { applyShip, shipJournal };
}

// Tableau de bord agrégé (codex / holonet / vaisseau / POI), cache 30 s.
export function createDashService({ journals }) {
  let cache = null;
  return async function dashPayload() {
    const now = Date.now();
    if (cache && now - cache.t < 30_000) return cache.data;
    const one = async (name) => {
      const l = await mcpCall('get_journals', { where: { name } });
      return (Array.isArray(l) ? l : []).find((j) => j && j.name === name) || null;
    };
    const codexJ = await one(journals.codex);
    const holoJ = await one(journals.holonet);
    const shipJ = await one(journals.ship);
    const pageHTML = (j) => (j && Array.isArray(j.pages) && j.pages[0] && j.pages[0].text ? j.pages[0].text.content || '' : '');
    const data = {
      codex: codexJ?.flags?.holocron?.codex || null,
      holonet: pageHTML(holoJ),
      ship: clampShip(shipJ?.flags?.holocron?.ship || {}),
    };
    cache = { t: now, data };
    return data;
  };
}
