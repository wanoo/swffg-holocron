/** GM toolbox — table tools ported from battle-tested world macros (FR-first content). */
import { MOD, t, esc, postCheck } from "./util.mjs";

const D2 = () => foundry.applications.api.DialogV2;
const FDX = (b) => new (foundry.applications.ux?.FormDataExtended ?? FormDataExtended)(b.form).object;
const DIFF_OPTS = (sel = 2) => [1, 2, 3, 4, 5].map((d) => `<option value="${d}" ${d === sel ? "selected" : ""}>${t("diff." + d)} (${d})</option>`).join("");

/* ---------------------------------------------------------------- Peur ----- */
async function fear() {
  const fd = await D2().wait({
    window: { title: t("tools.fear.title") },
    content: `<div class="form-group"><label>${t("tools.diff")}</label><select name="diff">${DIFF_OPTS(2)}</select></div>
      <div class="form-group"><label>${t("tools.fear.upgrades")}</label><input type="number" name="upg" value="0" min="0" max="5"/></div>
      <div class="form-group"><label>${t("tools.fear.source")}</label><input type="text" name="src" value="${t("tools.fear.sourceDefault")}"/></div>`,
    buttons: [{ action: "ok", label: t("common.send"), default: true, callback: (e, b) => FDX(b) }, { action: "cancel", label: t("common.cancel") }],
  });
  if (!fd || fd === "cancel") return;
  const diff = Number(fd.diff), upg = Math.min(Number(fd.upg), diff);
  await postCheck({
    title: `😱 ${t("tools.fear.title")}`,
    body: `<p><em>${esc(fd.src)}</em></p><p>${t("tools.fear.rules")}</p>`,
    pool: { difficulty: diff - upg, challenge: upg }, skillName: t("tools.fear.skill"),
  });
}

/* ------------------------------------------------------ Dégâts de groupe --- */
async function groupDamage() {
  const tokens = canvas.tokens.controlled.filter((tk) => tk.actor);
  if (!tokens.length) return ui.notifications.warn(t("tools.damage.noTokens"));
  const fd = await D2().wait({
    window: { title: t("tools.damage.title") + ` — ${tokens.length}` },
    content: `<div class="form-group"><label>${t("tools.damage.mode")}</label>
        <select name="mode"><option value="wounds">${t("tools.damage.wounds")}</option><option value="strain">${t("tools.damage.strain")}</option>
        <option value="healW">${t("tools.damage.healW")}</option><option value="healS">${t("tools.damage.healS")}</option></select></div>
      <div class="form-group"><label>${t("tools.damage.amount")}</label><input type="number" name="amount" value="5" min="1"/></div>
      <div class="form-group"><label><input type="checkbox" name="soak" checked/> ${t("tools.damage.soak")}</label></div>`,
    buttons: [{ action: "ok", label: t("common.apply"), default: true, callback: (e, b) => FDX(b) }, { action: "cancel", label: t("common.cancel") }],
  });
  if (!fd || fd === "cancel") return;
  const amount = Number(fd.amount), lines = [];
  for (const tk of tokens) {
    const a = tk.actor, st = a.system?.stats ?? {};
    const soak = fd.soak && fd.mode === "wounds" ? Number(st.soak?.value ?? 0) : 0;
    const heal = fd.mode.startsWith("heal");
    const key = (fd.mode === "wounds" || fd.mode === "healW") ? "wounds" : "strain";
    const cur = Number(st[key]?.value ?? 0);
    const next = Math.max(0, cur + (heal ? -amount : Math.max(0, amount - soak)));
    await a.update({ [`system.stats.${key}.value`]: next });
    const max = Number(st[key]?.max ?? 0);
    lines.push(`${esc(tk.name)} : ${cur} → ${next}${max ? `/${max}` : ""}${max && next >= max ? ` ⚠️ <strong>${t("tools.damage.over")}</strong>` : ""}`);
  }
  await ChatMessage.create({ content: `<h4>🩹 ${t("tools.damage.title")}</h4><p>${lines.join("<br>")}</p>`,
    whisper: ChatMessage.getWhisperRecipients("GM").map((u) => u.id) });
}

/* ---------------------------------------------------- Blessure critique ---- */
async function critical() {
  const fd = await D2().wait({
    window: { title: t("tools.crit.title") },
    content: `<div class="form-group"><label>${t("tools.crit.table")}</label>
        <select name="table"><option value="perso">${t("tools.crit.character")}</option><option value="veh">${t("tools.crit.vehicle")}</option></select></div>
      <div class="form-group"><label>${t("tools.crit.prev")}</label><input type="number" name="prev" value="0" min="0"/></div>
      <div class="form-group"><label>${t("tools.crit.bonus")}</label><input type="number" name="bonus" value="0"/></div>`,
    buttons: [{ action: "ok", label: t("tools.crit.draw"), default: true, callback: (e, b) => FDX(b) }, { action: "cancel", label: t("common.cancel") }],
  });
  if (!fd || fd === "cancel") return;
  const name = fd.table === "veh" ? game.settings.get(MOD, "critTableVehicle") : game.settings.get(MOD, "critTableCharacter");
  const table = game.tables.getName(name);
  if (!table) return ui.notifications.error(t("tools.crit.noTable", { name }));
  await table.draw({ roll: new Roll(`1d100 + ${Number(fd.prev) * 10 + Number(fd.bonus)}`) });
}

/* ---------------------------------------------------- Fin de rencontre ----- */
async function encounterEnd() {
  await postCheck({ title: `🔄 ${t("tools.end.title")}`, body: `<p>${t("tools.end.rules")}</p>`, pool: {}, skillName: t("tools.end.skill") });
}

/* -------------------------------------------------- Initiative de groupe --- */
async function groupInitiative() {
  const tokens = canvas.tokens.controlled;
  if (!tokens.length) return ui.notifications.warn(t("tools.init.noTokens"));
  let combat = game.combat;
  if (!combat) combat = await Combat.create({ scene: canvas.scene.id, active: true });
  for (const tk of tokens) if (!tk.inCombat) await tk.document.toggleCombatant();
  const ids = combat.combatants.filter((c) => c.initiative === null).map((c) => c.id);
  if (ids.length) await combat.rollInitiative(ids);
}

/* ------------------------------------------------------ Points de Destin --- */
async function destiny() {
  if (game.system.id !== "starwarsffg") return ui.notifications.warn(t("tools.ffgOnly"));
  const light = game.settings.get("starwarsffg", "dPoolLight"), dark = game.settings.get("starwarsffg", "dPoolDark");
  const fd = await D2().wait({
    window: { title: t("tools.destiny.title") },
    content: `<p>${t("tools.destiny.current", { light, dark })}</p>
      <div class="form-group"><label>${t("tools.destiny.n")}</label><input type="number" name="n" value="${game.users.filter((u) => !u.isGM).length || 3}" min="0" max="10"/></div>
      <div class="form-group"><label><input type="checkbox" name="remind" checked/> ${t("tools.destiny.remind")}</label></div>`,
    buttons: [{ action: "ok", label: t("tools.destiny.roll"), default: true, callback: (e, b) => FDX(b) }, { action: "cancel", label: t("common.cancel") }],
  });
  if (!fd || fd === "cancel") return;
  let msg = "";
  if (Number(fd.n) > 0) {
    const RollFFG = CONFIG.Dice.rolls.find((r) => r.name === "RollFFG") ?? game.ffg?.RollFFG;
    const roll = new RollFFG(`${Number(fd.n)}df`);
    await roll.evaluate();
    let l = 0, d = 0;
    for (const die of roll.dice) for (const r of die.results) { l += r.ffg?.light ?? 0; d += r.ffg?.dark ?? 0; }
    if (!l && !d && roll.ffg) { l = roll.ffg.light ?? 0; d = roll.ffg.dark ?? 0; }
    await game.settings.set("starwarsffg", "dPoolLight", l);
    await game.settings.set("starwarsffg", "dPoolDark", d);
    await roll.toMessage({ flavor: t("tools.destiny.flavor") });
    msg = `<p>${t("tools.destiny.new", { light: l, dark: d })}</p>`;
  }
  if (fd.remind) await ChatMessage.create({ content: `<h3>⭐ ${t("tools.destiny.title")}</h3>${msg}<p>${t("tools.destiny.rules")}</p>` });
}

/* ------------------------------------------------------------- Boutique ---- */
const SHOP_TYPES = {
  armurier:    { rMax: 6, mult: 1.0 },
  bazar:       { rMax: 5, mult: 1.0 },
  noir:        { rMin: 5, rMax: 10, mult: 2.0 },
  droides:     { rMax: 7, mult: 1.1, kw: ["droid", "comlink", "datapad", "tool", "scanner", "slicer", "computer", "cybernetic"] },
  apothicaire: { rMax: 7, mult: 1.2, kw: ["stim", "medpac", "bacta", "medical", "antidote", "syringe", "emergency", "kolto"] },
};
async function shop() {
  const packIds = String(game.settings.get(MOD, "shopPacks") || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!packIds.length) return ui.notifications.warn(t("tools.shop.noPacks"));
  const fd = await D2().wait({
    window: { title: t("tools.shop.title") },
    content: `<div class="form-group"><label>${t("tools.shop.type")}</label><select name="type">
        ${Object.keys(SHOP_TYPES).map((k) => `<option value="${k}">${t("tools.shop.t." + k)}</option>`).join("")}</select></div>
      <div class="form-group"><label>${t("tools.shop.place")}</label><select name="lieu">
        ${[-2, -1, 0, 1, 2, 3, 4].map((v) => `<option value="${v}" ${v === 0 ? "selected" : ""}>${t("tools.shop.p" + String(v).replace("-", "m"))} (${v >= 0 ? "+" : ""}${v})</option>`).join("")}</select></div>
      <div class="form-group"><label>${t("tools.shop.count")}</label><input type="number" name="n" value="8" min="3" max="20"/></div>
      <div class="form-group"><label><input type="checkbox" name="show"/> ${t("tools.shop.show")}</label></div>`,
    buttons: [{ action: "ok", label: t("tools.shop.generate"), default: true, callback: (e, b) => FDX(b) }, { action: "cancel", label: t("common.cancel") }],
  });
  if (!fd || fd === "cancel") return;
  const cfg = SHOP_TYPES[fd.type], lieu = Number(fd.lieu);
  let index = [];
  for (const pid of packIds) {
    const pack = game.packs.get(pid); if (!pack) continue;
    const idx = await pack.getIndex({ fields: ["system.rarity", "system.price", "type"] });
    for (const e of idx) index.push({ ...e, pack: pid });
  }
  if (!index.length) return ui.notifications.error(t("tools.shop.noPacks"));
  const rMin = cfg.rMin ?? 0, rMax = cfg.rMax ?? 10;
  let pool = index.filter((e) => {
    const r = Number(e.system?.rarity?.value ?? e.system?.rarity ?? 0);
    if (r < rMin || r > rMax) return false;
    if (cfg.kw && !cfg.kw.some((m) => e.name.toLowerCase().includes(m))) return false;
    return Number(e.system?.price?.value ?? e.system?.price ?? 0) > 0;
  });
  if (pool.length < 3) pool = index.filter((e) => Number(e.system?.price?.value ?? e.system?.price ?? 0) > 0);
  const stock = [];
  const copy = [...pool];
  for (let i = 0; i < Math.min(Number(fd.n), copy.length); i++) stock.push(copy.splice(Math.floor(Math.random() * copy.length), 1)[0]);
  const nm = t(`tools.shop.names.${fd.type}${Math.floor(Math.random() * 4)}`);
  const rows = stock.map((e) => {
    const r = Number(e.system?.rarity?.value ?? e.system?.rarity ?? 0);
    const base = Number(e.system?.price?.value ?? e.system?.price ?? 0);
    const prix = Math.round(base * cfg.mult * (1 + 0.15 * Math.max(0, lieu + Math.floor(r / 3))) / 5) * 5;
    return `<tr><td>@UUID[Compendium.${e.pack}.Item.${e._id}]{${esc(e.name)}}</td><td style="text-align:right">${prix.toLocaleString()} cr</td><td style="text-align:center">${r}</td></tr>`;
  }).join("");
  let folder = game.folders.find((f) => f.name === t("tools.shop.folder") && f.type === "JournalEntry");
  if (!folder) folder = await Folder.create({ name: t("tools.shop.folder"), type: "JournalEntry" });
  const journal = await JournalEntry.create({
    name: `🛒 ${nm}`, folder: folder.id,
    ownership: { default: fd.show ? CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER : CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE },
    pages: [{ name: nm, type: "text", title: { show: false }, text: { format: 1, content:
      `<h2>🛒 ${esc(nm)}</h2><p><em>${t("tools.shop.t." + fd.type)} — ${t("tools.shop.rarityMod")} ${lieu >= 0 ? "+" + lieu : lieu}.</em></p>
       <table><thead><tr><th>${t("tools.shop.item")}</th><th>${t("tools.shop.price")}</th><th>${t("tools.shop.rarity")}</th></tr></thead><tbody>${rows}</tbody></table>` } }],
  });
  journal.sheet.render(true);
  if (fd.show) journal.show();
}

/* --------------------------------------------------------------- toolbox --- */
export const TOOLS = { fear, groupDamage, critical, encounterEnd, groupInitiative, destiny, shop };

export async function openToolbox() {
  if (!game.user.isGM) return;
  const items = [
    ["fear", "😱"], ["destiny", "⭐"], ["groupDamage", "🩹"], ["critical", "☠️"],
    ["encounterEnd", "🔄"], ["groupInitiative", "⚡"], ["shop", "🛒"],
  ];
  const content = `<style>.holo-tb { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
    .holo-tb button { text-align: left; padding: 8px 10px; }</style>
    <div class="holo-tb">${items.map(([k, icon]) => `<button type="button" data-tool="${k}">${icon} ${t("toolbox." + k)}</button>`).join("")}</div>`;
  const dlg = await new Promise((resolve) => {
    const d = new foundry.applications.api.DialogV2({
      window: { title: t("toolbox.title") },
      content,
      buttons: [{ action: "close", label: t("common.close"), default: true }],
      actions: {},
    });
    d.addEventListener("render", () => {
      d.element.querySelectorAll("[data-tool]").forEach((el) => el.addEventListener("click", () => { d.close(); TOOLS[el.dataset.tool]?.(); }));
    });
    d.render(true);
    resolve(d);
  });
  return dlg;
}
