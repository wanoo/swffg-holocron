/** Shared helpers — SWFFG Holocron. */
export const MOD = "swffg-holocron";

// Espace de flags canonique des états vaisseau/codex : `flags.holocron.*`, PARTAGÉ avec
// l'app web Archive Holocron (server/lib/ship.mjs lit/écrit les mêmes clés). Ne pas écrire
// ces états sous `flags.swffg-holocron` — lu seulement en migration douce.
export const FLAG_SCOPE = "holocron";

/** i18n under the SWH.* prefix. */
export const t = (k, data) => (data ? game.i18n.format(`SWH.${k}`, data) : game.i18n.localize(`SWH.${k}`));

export const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
export const gp = (d, p) => foundry.utils.getProperty(d, p);

/* ------------------------------------------------ pont vers l'astronav ------ */
export const astronavActive = () => game.modules.get("swffg-astronavigation")?.active ?? false;
export const astronavApi = () => (astronavActive() ? game.modules.get("swffg-astronavigation")?.api : null) ?? null;

/* -------------------------------------------- pont fvtt-party-resources ------ */
// Le pool de ressources partagé (vivres/carburant/usure) vit dans fvtt-party-resources
// quand il est présent ; sinon le flag du journal fait foi (dégradation gracieuse).
export const PR_MOD = "fvtt-party-resources";
export const prActive = () => game.modules.get(PR_MOD)?.active ?? false;
const _pr = () => globalThis.pr || (typeof window !== "undefined" ? window.pr : null) || null;
// ids party-resources mappés à nos trois jauges (configurables via réglages du module)
export const resId = (kind) => game.settings.get(MOD, { vivres: "resFoodId", fuel: "resFuelId", usure: "resWearId" }[kind]) || kind;
export function prGet(kind) {
  if (!prActive()) return null;
  try { const v = _pr()?.api?.get?.(resId(kind)); return v == null ? null : Number(v); } catch { return null; }
}
export function prSet(kind, value, notify = false) {
  if (!prActive()) return false;
  try { _pr()?.api?.set?.(resId(kind), Math.round(value), { notify }); _pr()?.status_bar?.render?.(); return true; } catch { return false; }
}

/** FFG dice glyphs (inline, chat-safe). */
const DIE = { di: ["◆", "#8850c8"], ch: ["◆", "#d6595a"], bo: ["■", "#8fd4ff"], se: ["■", "#666"] };
export const dice = (pool) => ["di", "ch", "bo", "se"]
  .map((k) => `<b style="color:${DIE[k][1]}">` + DIE[k][0].repeat(pool?.[k] || 0) + "</b>").join("");

/** Post an FFG check invitation to chat (pool embedded for .ffg-pool-to-player). */
export async function postCheck({ title, body = "", pool = {}, skillName = "" }) {
  const hasFFG = game.system.id === "starwarsffg";
  return ChatMessage.create({
    content: `<h4>${title}</h4>${body}` + (hasFFG ? `<button class="ffg-pool-to-player">🎲 ${t("common.rollBtn")}</button>` : ""),
    flags: hasFFG ? { starwarsffg: { dicePool: pool, description: skillName || title, roll: { data: {}, skillName: skillName || title, item: {}, flavor: "", sound: null } } } : {},
  });
}

/* ------------------------------------------------- journaux liés du module -- */
/** Find (or create, GM only) the module-bound journal named by a setting. */
export async function boundJournal(settingKey, defaultPages, extraFlags = null) {
  const name = game.settings.get(MOD, settingKey);
  let j = game.journal.getName(name);
  if (!j && game.user.isGM) {
    j = await JournalEntry.create({
      name,
      ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER },
      flags: { [MOD]: { bound: settingKey }, ...(extraFlags || {}) },
      pages: defaultPages || [{ name, type: "text", text: { content: "", format: 1 } }],
    });
  }
  return j ?? null;
}

/* ------------------------------------------------------------ vaisseau ------ */
export const SHIP_DEFAULTS = { name: "", vivres: 60, vivresMax: 60, fuel: 30, fuelMax: 30, usure: 0, hyper: 1, lastFrom: "", lastTo: "" };

export function clampShip(s) {
  const n = { ...SHIP_DEFAULTS, ...(s || {}) };
  n.vivresMax = Math.max(1, Math.round(+n.vivresMax || 60));
  n.fuelMax = Math.max(1, Math.round(+n.fuelMax || 30));
  n.vivres = Math.max(0, Math.min(n.vivresMax, Math.round(+n.vivres || 0)));
  n.fuel = Math.max(0, Math.min(n.fuelMax, Math.round(+n.fuel || 0)));
  n.usure = Math.max(0, Math.min(100, Math.round(+n.usure || 0)));
  n.hyper = [0.5, 1, 2, 3, 4].includes(+n.hyper) ? +n.hyper : 1;
  return n;
}

export async function shipJournal() {
  // Le vaisseau est un POI Monk's Enhanced Journal (« person ») : il apparaît comme entité
  // et sa position sur la carte est portée par l'astronav (setCurrentWorld).
  return boundJournal("shipJournal",
    [{ name: t("ship.pageName"), type: "text", text: { content: "", format: 1 },
       flags: { "monks-enhanced-journal": { type: "person" } } }],
    { "monks-enhanced-journal": { pagetype: "person" } });
}

export function readShip(j) {
  // migration douce : reprend l'ancien flag module (≤1.2.x) ou l'ex command-deck
  const own = j ? gp(j, `flags.${FLAG_SCOPE}.ship`) : null;
  const legacy = j ? (gp(j, `flags.${MOD}.ship`) || gp(j, "flags.swffg-command-deck.ship")) : null;
  const s = clampShip(own || legacy || {});
  if (!s.name) s.name = game.settings.get(MOD, "shipJournal");
  // party-resources = pool live partagé : sa valeur courante prime sur le flag (bornée par les max du vaisseau)
  const pv = prGet("vivres"), pf = prGet("fuel"), pu = prGet("usure");
  if (pv != null) s.vivres = Math.max(0, Math.min(s.vivresMax, Math.round(pv)));
  if (pf != null) s.fuel = Math.max(0, Math.min(s.fuelMax, Math.round(pf)));
  if (pu != null) s.usure = Math.max(0, Math.min(100, Math.round(pu)));
  return s;
}

export async function writeShip(j, ship, logHTML = null) {
  const s = clampShip(ship);
  await j.update({ [`flags.${FLAG_SCOPE}.ship`]: s, [`flags.${MOD}.-=ship`]: null });
  // miroir du pool vers party-resources (si présent) — la barre de statut se rafraîchit d'elle-même
  prSet("vivres", s.vivres); prSet("fuel", s.fuel); prSet("usure", s.usure);
  // l'usure accumulée pilote la difficulté d'astrogation de l'astronav (>50 % : +1 ; >80 % : +2)
  if (game.user.isGM) {
    try {
      const api = astronavApi();
      if (api?.setUsure) await api.setUsure(s.usure);                                   // contrat propre (astronav ≥1.7.2)
      else if (astronavActive()) await game.settings.set("swffg-astronavigation", "usure", s.usure); // repli
    } catch (e) { console.warn("swffg-holocron | sync usure→astronav", e); }
  }
  const pct = (v, m) => Math.round((v / m) * 100);
  const pg = j.pages.contents[0];
  if (pg) await pg.update({ "text.content":
    `<h2>🚀 ${esc(s.name)}</h2><ul>` +
    `<li>🥫 ${t("ship.provisions")} : <strong>${s.vivres} / ${s.vivresMax}</strong> (${pct(s.vivres, s.vivresMax)}%)</li>` +
    `<li>⛽ ${t("ship.fuel")} : <strong>${s.fuel} / ${s.fuelMax}</strong> (${pct(s.fuel, s.fuelMax)}%)</li>` +
    `<li>🔧 ${t("ship.wear")} : <strong>${s.usure}%</strong></li><li>${t("ship.hyperdrive")} : ×${s.hyper}</li></ul>` +
    (s.lastTo ? `<p><em>${t("ship.lastTrip", { from: esc(s.lastFrom || "?"), to: esc(s.lastTo) })}</em></p>` : "") });
  if (logHTML) await ChatMessage.create({ content: `<h4>🚀 ${esc(s.name)}</h4><p>${logHTML}</p>` });
  Hooks.callAll("swffgHolocron.shipUpdated", s);
  return s;
}

/** Apply a trip cost {days, fuel, usure} (+labels) to the party ship. */
export async function applyTrip({ days = 0, fuel = 0, usure = 0, from = "", to = "" } = {}) {
  const j = await shipJournal();
  if (!j) return ui.notifications.warn(t("ship.noJournal"));
  const s = readShip(j);
  const next = { ...s, vivres: Math.max(0, s.vivres - Math.round(days)), fuel: Math.max(0, s.fuel - Math.round(fuel)),
    usure: Math.min(100, s.usure + Math.round(usure)), lastFrom: from || s.lastFrom, lastTo: to || s.lastTo };
  const res = await writeShip(j, next, t("ship.tripLog", { days: Math.round(days), fuel: Math.round(fuel), usure: Math.round(usure),
    v: next.vivres, vm: next.vivresMax, f: next.fuel, fm: next.fuelMax, u: next.usure }) + (to ? ` (${esc(from)} → ${esc(to)})` : ""));
  // déplace le POI vaisseau (« vous êtes ici ») vers la destination
  if (to) { try { await astronavApi()?.setCurrentWorld?.(to); } catch (e) { console.warn("swffg-holocron | setCurrentWorld", e); } }
  Hooks.callAll("swffgHolocron.shipMoved", { from: next.lastFrom, to: next.lastTo });
  return res;
}

/* ------------------------------------------------------------ codex --------- */
export const CODEX_DEFAULTS = { allegiance: "", npcs: [], poi: [] };

export async function codexJournal() {
  return boundJournal("codexJournal", [{ name: t("codex.pageName"), type: "text", text: { content: "", format: 1 } }]);
}

export function readCodex(j) {
  const own = j ? (gp(j, `flags.${FLAG_SCOPE}.codex`) || gp(j, `flags.${MOD}.codex`)) : null;
  if (own) return { ...CODEX_DEFAULTS, ...own };
  // migration douce depuis les journaux « holocron » historiques
  const legacyCodex = gp(game.journal.getName("🖥️ Codex du groupe") || {}, "flags.holocron.codex");
  const legacyPoi = gp(game.journal.getName("🌍 Mondes d'intérêt") || {}, "flags.holocron.poi");
  return {
    ...CODEX_DEFAULTS,
    allegiance: legacyCodex?.allegiance || "",
    npcs: legacyCodex?.npcs || [],
    poi: legacyPoi || [],
  };
}

export async function writeCodex(j, codex) {
  await j.update({ [`flags.${FLAG_SCOPE}.codex`]: codex, [`flags.${MOD}.-=codex`]: null });
  const pg = j.pages.contents[0];
  if (pg) {
    const SC = { allie: "🟢", mentor: "🟡", neutre: "⚪", ennemi: "🔴" };
    await pg.update({ "text.content":
      `<h2>${t("codex.pageName")}</h2><p><b>${t("deck.allegiance")} :</b> ${esc(codex.allegiance || "—")}</p>` +
      `<h3>${t("deck.alignment")}</h3><ul>` + (codex.npcs || []).map((n) => `<li>${SC[n.statut] || "⚪"} ${esc(n.name)}${n.mort ? " †" : ""}</li>`).join("") + "</ul>" +
      `<h3>${t("deck.poi")}</h3><ul>` + (codex.poi || []).map((p) => `<li>⭐ ${esc(p.name)}${p.note ? " — " + esc(p.note) : ""}</li>`).join("") + "</ul>" });
  }
  Hooks.callAll("swffgHolocron.codexUpdated", codex);
  return codex;
}

/* --------------------------------------------------- données planètes ------- */
let _planets = null;
/** Planet lookup (image/region) through the swffg-astronavigation module data, if present. */
export async function planetInfo(name) {
  if (!name || !astronavActive()) return null;
  if (!_planets) {
    try {
      const pj = await (await fetch("modules/swffg-astronavigation/data/planets.json")).json();
      const arr = Array.isArray(pj) ? pj : (pj.planets || Object.values(pj)[0]);
      _planets = {}; for (const p of arr) _planets[p.name] = p;
    } catch { _planets = {}; }
  }
  return _planets[name] || null;
}

/** Résout l'entrée MEJ « Place » importée dans le monde pour ce nom de planète (ou null). */
export function planetJournal(name) {
  if (!name) return null;
  const mej = (j) => gp(j, "flags.monks-enhanced-journal.pagetype") === "place" || gp(j, "flags.swffg-astronavigation");
  return game.journal?.find((j) => j.name === name && mej(j)) || game.journal?.getName?.(name) || null;
}

/** Favoris = marque-pages MEJ de l'utilisateur, résolus en noms de mondes via l'astronav. */
export async function favoriteWorlds() {
  try { return (await astronavApi()?.favorites?.()) || []; } catch { return []; }
}

/**
 * Déplace le vaisseau du groupe vers un monde : met à jour le journal (lastTo) ET pose le
 * marqueur « vous êtes ici » de l'astronav. C'est LE point d'entrée « POI vaisseau bouge ».
 */
export async function setShipWorld(name, from = "") {
  if (!name) return null;
  const j = await shipJournal();
  if (j) {
    const s = readShip(j);
    if (s.lastTo !== name) await writeShip(j, { ...s, lastFrom: from || s.lastTo || s.lastFrom, lastTo: name });
  }
  try { await astronavApi()?.setCurrentWorld?.(name); } catch (e) { console.warn("swffg-holocron | setCurrentWorld", e); }
  Hooks.callAll("swffgHolocron.shipMoved", { from, to: name });
  return name;
}

/* ------------------------------------------ setup automatique party-resources */
/**
 * Crée (si absentes) les trois ressources party-resources adossées au vaisseau — vivres,
 * carburant, usure — avec leurs libellés et bornes. Idempotent (MJ) : ne réécrit pas une
 * ressource déjà présente sauf `force:true`. C'est l'install/setup automatique du pool.
 */
export async function ensurePartyResources({ force = false, silent = false } = {}) {
  if (!prActive()) { if (!silent) ui.notifications?.warn(t("pr.absent")); return false; }
  if (!game.user.isGM) return false;
  const api = _pr()?.api;
  if (!api?.register_resource || !api?.get || !api?.set) { if (!silent) ui.notifications?.warn(t("pr.noApi")); return false; }
  const s = readShip(await shipJournal());
  const specs = [
    { id: resId("vivres"), name: t("ship.provisions"), value: s.vivres, max: s.vivresMax, min: 0 },
    { id: resId("fuel"),   name: t("ship.fuel"),       value: s.fuel,   max: s.fuelMax,   min: 0 },
    // Usure = pourcentage (0 → 100) qui MONTE avec les voyages ; l'augmentation est « mauvaise ».
    { id: resId("usure"),  name: t("ship.wearPct"),    value: s.usure,  max: 100,         min: 0,
      incMsg: t("pr.wearUp"), decMsg: t("pr.wearDown") },
  ];
  const list = [...(api.get("resource_list") || [])];
  let created = 0;
  for (const r of specs) {
    api.register_resource(r.id);                 // enregistre les sous-réglages (idempotent)
    const exists = list.includes(r.id);
    if (!exists) { list.push(r.id); created++; }
    if (!exists || force) {                       // ne personnalise que si nouvelle (ou forcé)
      api.set(r.id + "_name", r.name);
      api.set(r.id + "_max", r.max);
      api.set(r.id + "_min", r.min);
      api.set(r.id + "_visible", true);
      if (r.incMsg) api.set(r.id + "_notify_chat_increment_message", r.incMsg);
      if (r.decMsg) api.set(r.id + "_notify_chat_decrement_message", r.decMsg);
      api.set(r.id, Math.max(r.min, Math.min(r.max, Math.round(r.value))));
    }
  }
  if (created) { api.set("resource_list", list); api.update_positions?.(); }
  try { _pr()?.status_bar?.render?.(); _pr()?.dashboard?.redraw?.(true); } catch { /* UI best-effort */ }
  if (!silent && (force || created)) ui.notifications?.info(t("pr.done", { n: created }));
  return true;
}
