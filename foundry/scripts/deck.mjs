/** Holocron — Navi-Computer : holographic campaign dashboard (ApplicationV2). */
import { MOD, t, esc, gp, shipJournal, readShip, writeShip, applyTrip, codexJournal, readCodex, writeCodex,
  planetInfo, planetJournal, astronavActive, astronavApi, favoriteWorlds } from "./util.mjs";

const CSS = `
  .cd-root { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; padding: 10px; color: #d8ecf7; font-size: 13px;
    height: 100%; overflow: auto; background: radial-gradient(1200px 500px at 30% -10%, #10283a55, transparent), #0a121b; }
  .cd-col { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
  .cd-p { border: 1px solid #2b5b73; border-radius: 10px; padding: 8px 10px; background: linear-gradient(180deg, #12263699, #08101899); }
  .cd-eb { margin: 0 0 6px; font-size: 10px; font-weight: 700; letter-spacing: .09em; text-transform: uppercase; color: #7fdfff; display: flex; gap: 6px; align-items: center; }
  .cd-eb .cd-act { margin-left: auto; opacity: .65; cursor: pointer; text-transform: none; letter-spacing: 0; }
  .cd-eb .cd-act:hover { opacity: 1; }
  .cd-alleg { grid-column: 1 / -1; display: flex; gap: 10px; align-items: center; }
  .cd-alleg .cd-emb { width: 44px; height: 44px; border: 2px solid #7fdfff; border-radius: 50%; display: grid; place-items: center; color: #7fdfff; font-size: 20px; flex: none; box-shadow: 0 0 14px #5abeff45; }
  .cd-alleg h2 { margin: 0; font-size: 17px; color: #eaf6ff; line-height: 1.15; border: 0; }
  .cd-stat { margin-bottom: 5px; }
  .cd-sh { display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 2px; }
  .cd-track { height: 8px; border-radius: 99px; background: #0a1520; border: 1px solid #ffffff14; overflow: hidden; }
  .cd-fill { height: 100%; }
  .cd-btn { background: transparent; border: 1px solid #7fdfff; color: #7fdfff; border-radius: 999px; padding: 3px 10px; cursor: pointer; font-weight: 700; font-size: 12px; }
  .cd-btn:hover { background: #7fdfff; color: #06121c; }
  .cd-btn.gold { border-color: #d9b45b; color: #d9b45b; }
  .cd-btn.gold:hover { background: #d9b45b; color: #06121c; }
  .cd-acts { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 6px; }
  .cd-loc { text-align: center; }
  .cd-planet { width: 72px; height: 72px; border-radius: 50%; margin: 2px auto; background: #0a1520 center/cover; border: 2px solid #2b5b73; display: grid; place-items: center; font-size: 24px; }
  .cd-loc h3 { margin: 3px 0 0; font-size: 14px; color: #eaf6ff; border: 0; }
  .cd-crews { display: flex; flex-wrap: wrap; gap: 8px; }
  .cd-crew { width: 76px; display: flex; flex-direction: column; align-items: center; text-align: center; cursor: pointer; }
  .cd-ava { width: 46px; height: 46px; border-radius: 50%; border: 2px solid #7fdfff77; background: #0a1520 center/cover; }
  .cd-crew span { font-size: 11px; font-weight: 700; margin-top: 2px; }
  .cd-axis { height: 3px; border-radius: 2px; background: linear-gradient(90deg, #8ad17a, #8b9bc0, #e5544b); margin-bottom: 6px; }
  .cd-camps { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px; }
  .cd-ct { font-size: 10px; font-weight: 700; margin-bottom: 3px; color: #9db8c8; }
  .cd-npc { font-size: 11px; border-left: 3px solid var(--sc); padding: 1px 5px; margin-bottom: 2px; background: #ffffff0a; border-radius: 2px; display: flex; gap: 4px; }
  .cd-npc.dead { opacity: .5; }
  .cd-npc .cd-x { margin-left: auto; cursor: pointer; opacity: .4; }
  .cd-npc .cd-x:hover { opacity: 1; color: #e5544b; }
  .cd-holo { max-height: 150px; overflow: auto; font-size: 12px; }
  .cd-holo :is(h1,h2,h3) { font-size: 13px; margin: 2px 0; color: #eaf6ff; border: 0; }
  .cd-poi { font-size: 12px; }
  .cd-poi li { display: flex; gap: 6px; }
  .cd-poi .cd-x { margin-left: auto; cursor: pointer; opacity: .4; }
  .cd-poi .cd-x:hover { opacity: 1; color: #e5544b; }
  .cd-form { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 6px; }
  .cd-root input, .cd-root select { background: #0a1520; border: 1px solid #2b5b73; color: #d8ecf7; border-radius: 6px; padding: 3px 6px; font-size: 12px; }
`;

export class HolocronApp extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "swffg-holocron-app",
    window: { title: "SWH.deck.title", icon: "fa-solid fa-satellite-dish", resizable: true },
    position: { width: 900, height: 720 },
  };

  async _renderHTML() {
    const gm = game.user.isGM;
    const jShip = await shipJournal();
    const ship = jShip ? readShip(jShip) : null;
    const jCodex = gm ? await codexJournal() : (game.journal.getName(game.settings.get(MOD, "codexJournal")) || null);
    const codex = readCodex(jCodex);
    const holoName = game.settings.get(MOD, "holonetJournal");
    const jHolo = game.journal.getName(holoName);
    const holoHTML = jHolo ? (gp(jHolo.pages.contents[0] || {}, "text.content") || "") : "";
    const pl = ship ? await planetInfo(ship.lastTo) : null;
    const favs = astronavActive() ? await favoriteWorlds() : [];
    const planned = astronavApi()?.lastCost || null;   // dernier trajet calculé par l'astronav

    const bar = (icon, label, v, m, color, pct) => {
      const w = Math.max(0, Math.min(100, (v / (m || 1)) * 100));
      return `<div class="cd-stat"><div class="cd-sh"><span>${icon} ${label}</span><b>${pct ? Math.round(v) + "%" : v + " / " + m}</b></div>
        <div class="cd-track"><div class="cd-fill" style="width:${w}%;background:${color}"></div></div></div>`;
    };

    // équipage : les personnages assignés aux joueurs (générique, aucune donnée externe)
    const crew = game.users.filter((u) => !u.isGM && u.character).map((u) => {
      const a = u.character;
      return `<div class="cd-crew" data-actor="${a.id}"><span class="cd-ava" style="${a.img ? `background-image:url('${esc(a.img)}')` : ""}"></span><span>${esc(a.name)}</span><small style="font-size:9px;opacity:.6">${esc(u.name)}</small></div>`;
    }).join("");

    const SC = { allie: "#8ad17a", mentor: "#d9b45b", neutre: "#8b9bc0", ennemi: "#e5544b" };
    const chip = (n, i) => `<div class="cd-npc${n.mort ? " dead" : ""}" style="--sc:${SC[n.statut] || "#8b9bc0"}">${esc(n.name)}${n.mort ? " †" : ""}${gm ? `<span class="cd-x" data-npc-del="${i}" title="${t("common.remove")}">✖</span>` : ""}</div>`;
    const camps = { g: [], n: [], e: [] };
    (codex.npcs || []).forEach((n, i) => (n.statut === "ennemi" ? camps.e : n.statut === "neutre" ? camps.n : camps.g).push([n, i]));

    // Mondes d'intérêt = favoris Monk's Enhanced Journal (partout), sinon liste manuelle du codex (repli).
    const favRows = favs.map((n) =>
      `<li>⭐ <b class="cd-fav" data-fav="${esc(n)}" title="${t("deck.favOpen")}" style="cursor:pointer">${esc(n)}</b>` +
      ` <span class="cd-favnav" data-favnav="${esc(n)}" title="${t("deck.favToAstronav")}" style="cursor:pointer;opacity:.55">🧭</span></li>`).join("");
    const poiRows = (codex.poi || []).map((p, i) =>
      `<li>⭐ <b>${esc(p.name)}</b>${p.note ? " — " + esc(p.note) : ""}${gm ? `<span class="cd-x" data-poi-del="${i}" title="${t("common.remove")}">✖</span>` : ""}</li>`).join("");

    return `<style>${CSS}</style>
    <div class="cd-root">
      <div class="cd-p cd-alleg"><div class="cd-emb">◈</div><div style="flex:1">
        <p class="cd-eb">${t("deck.allegiance")} ${gm ? `<a class="cd-act" data-act="alleg">✎ ${t("common.edit")}</a>` : ""}</p>
        <h2>${esc(codex.allegiance || t("deck.allegianceEmpty"))}</h2></div>
        ${astronavActive() ? `<button type="button" class="cd-btn gold" data-act="astronav">🪐 ${t("deck.openAstronav")}</button>` : ""}</div>

      <div class="cd-col">
        <div class="cd-p"><p class="cd-eb">🚀 ${esc(ship?.name || t("ship.pageName"))} ${jShip ? `<a class="cd-act" data-act="ship-journal">↗</a>` : ""}</p>
          ${ship ? bar("🥫", t("ship.provisions"), ship.vivres, ship.vivresMax, "#6fbf8f")
            + bar("⛽", t("ship.fuel"), ship.fuel, ship.fuelMax, "#57c7ff")
            + bar("🔧", t("ship.wear"), ship.usure, 100, ship.usure > 80 ? "#e5544b" : ship.usure > 50 ? "#e0975c" : "#8ad17a", true)
            + `<div style="font-size:10px;opacity:.6">${t("ship.hyperdrive")} ×${ship.hyper}</div>`
            + (gm ? `<div class="cd-acts"><button type="button" class="cd-btn" data-act="refuel" title="${t("ship.refuel")}">🥫</button><button type="button" class="cd-btn" data-act="fuel" title="${t("ship.refill")}">⛽</button><button type="button" class="cd-btn" data-act="repair" title="${t("ship.repair")}">🔧</button><button type="button" class="cd-btn gold" data-act="trip" title="${t("ship.manualTrip")}">🧭</button>`
              + (planned && planned.to ? `<button type="button" class="cd-btn gold" data-act="applyplanned" title="${t("ship.applyPlanned", { from: esc(planned.from || "?"), to: esc(planned.to), days: planned.days, fuel: planned.fuel, usure: planned.usure })}">🚀 ${esc(planned.to)}</button>` : "")
              + `</div>` : "")
            : `<p style="opacity:.6">${t("ship.noJournal")}</p>`}</div>
        <div class="cd-p cd-loc"><p class="cd-eb">📍 ${t("deck.position")}</p>
          <div class="cd-planet" style="${pl && pl.img ? `background-image:url('${esc(pl.img)}')` : ""}">${pl && pl.img ? "" : "🪐"}</div>
          <h3>${esc(ship?.lastTo || t("deck.positionUnknown"))}</h3>
          <small style="opacity:.6">${pl ? esc(pl.region || "") : ""}</small></div>
        <div class="cd-p"><p class="cd-eb">👤 ${t("deck.crew")}</p>
          <div class="cd-crews">${crew || `<small style="opacity:.5">${t("deck.crewEmpty")}</small>`}</div></div>
      </div>

      <div class="cd-col">
        <div class="cd-p"><p class="cd-eb">🕸️ ${t("deck.alignment")} ${gm ? `<a class="cd-act" data-act="npc-add">＋ ${t("common.add")}</a>` : ""}</p>
          <div class="cd-axis"></div>
          <div class="cd-camps">
            <div><div class="cd-ct">🟢 ${t("deck.allies")} (${camps.g.length})</div>${camps.g.map(([n, i]) => chip(n, i)).join("")}</div>
            <div><div class="cd-ct">⚪ ${t("deck.neutrals")} (${camps.n.length})</div>${camps.n.map(([n, i]) => chip(n, i)).join("")}</div>
            <div><div class="cd-ct">🔴 ${t("deck.enemies")} (${camps.e.length})</div>${camps.e.map(([n, i]) => chip(n, i)).join("")}</div>
          </div></div>
        <div class="cd-p"><p class="cd-eb">📡 ${t("deck.holonet")} ${jHolo ? `<a class="cd-act" data-act="holo">↗ ${t("common.open")}</a>` : ""}</p>
          <div class="cd-holo">${holoHTML || `<small style="opacity:.5">${t("deck.holonetEmpty", { name: esc(holoName) })}</small>`}</div></div>
        ${astronavActive()
          ? `<div class="cd-p"><p class="cd-eb">⭐ ${t("deck.favorites")}
              ${gm ? `<a class="cd-act" data-act="import" title="${t("deck.importHint")}">⭳ ${t("deck.import")}</a>` : ""}</p>
              <ul class="cd-poi" style="margin:0;padding-left:2px;list-style:none">${favRows || `<li style="opacity:.5">${t("deck.favEmpty")}</li>`}</ul></div>`
          : `<div class="cd-p"><p class="cd-eb">⭐ ${t("deck.poi")} ${gm ? `<a class="cd-act" data-act="poi-add">＋ ${t("common.add")}</a>` : ""}</p>
              <ul class="cd-poi" style="margin:0;padding-left:2px;list-style:none">${poiRows || `<li style="opacity:.5">${t("deck.poiEmpty")}</li>`}</ul></div>`}
      </div>
    </div>`;
  }

  _replaceHTML(html, content) { content.innerHTML = html; this._wire(content); }

  _wire(root) {
    const app = this;
    root.querySelectorAll(".cd-crew[data-actor]").forEach((el) => el.addEventListener("click", () => game.actors.get(el.dataset.actor)?.sheet.render(true)));
    root.querySelectorAll("[data-npc-del]").forEach((el) => el.addEventListener("click", () => app._npcDel(Number(el.dataset.npcDel))));
    root.querySelectorAll("[data-poi-del]").forEach((el) => el.addEventListener("click", () => app._poiDel(Number(el.dataset.poiDel))));
    root.querySelectorAll("[data-fav]").forEach((el) => el.addEventListener("click", () => app._openFav(el.dataset.fav)));
    root.querySelectorAll("[data-favnav]").forEach((el) => el.addEventListener("click", () => app._favToAstronav(el.dataset.favnav)));
    root.querySelectorAll("[data-act]").forEach((el) => el.addEventListener("click", () => app._action(el.dataset.act)));
  }

  /** Ouvre la fiche MEJ d'un favori (ou recentre l'astronav si non importée). */
  _openFav(name) { const j = planetJournal(name); j ? j.sheet.render(true) : astronavApi()?.showWorld?.(name); }
  /** Envoie un favori vers l'astronav comme destination. */
  _favToAstronav(name) { const api = astronavApi(); if (!api) return; api.setLeg?.(name, "to"); api.open?.(); }

  async _action(act) {
    const gm = game.user.isGM;
    if (act === "astronav") return game.modules.get("swffg-astronavigation")?.api?.open();
    if (act === "holo") return game.journal.getName(game.settings.get(MOD, "holonetJournal"))?.sheet.render(true);
    if (act === "ship-journal") return (await shipJournal())?.sheet.render(true);
    if (!gm) return;
    if (act === "import") return astronavApi()?.importToWorld?.({ confirm: true });
    if (act === "applyplanned") {
      const c = astronavApi()?.lastCost;
      if (!c || !c.to) return ui.notifications.info(t("ship.noPlanned"));
      await applyTrip({ days: c.days || 0, fuel: c.fuel || 0, usure: c.usure || 0, from: c.from || "", to: c.to });
      return this.render();
    }
    if (act === "alleg") {
      const j = await codexJournal(); const c = readCodex(j);
      const v = await promptText(t("deck.allegiance"), c.allegiance);
      if (v === null) return;
      await writeCodex(j, { ...c, allegiance: v.trim() }); return this.render();
    }
    if (["refuel", "fuel", "repair"].includes(act)) {
      const j = await shipJournal(); if (!j) return;
      const s = readShip(j);
      if (act === "refuel") s.vivres = s.vivresMax; else if (act === "fuel") s.fuel = s.fuelMax; else s.usure = 0;
      await writeShip(j, s, t(`ship.log.${act}`)); return this.render();
    }
    if (act === "trip") {
      const fd = await foundry.applications.api.DialogV2.wait({
        window: { title: t("ship.manualTrip") },
        content: ["days", "tripFuel", "tripWear"].map((k, i) =>
          `<div class="form-group"><label>${t("ship.form." + k)}</label><input type="number" name="f${i}" value="0" min="0"/></div>`).join(""),
        buttons: [{ action: "ok", label: t("common.apply"), default: true,
          callback: (e, b) => new (foundry.applications.ux?.FormDataExtended ?? FormDataExtended)(b.form).object }, { action: "cancel", label: t("common.cancel") }],
      });
      if (!fd || fd === "cancel") return;
      await applyTrip({ days: +fd.f0 || 0, fuel: +fd.f1 || 0, usure: +fd.f2 || 0 });
      return this.render();
    }
    if (act === "npc-add") {
      const fd = await foundry.applications.api.DialogV2.wait({
        window: { title: t("deck.npcAdd") },
        content: `<div class="form-group"><label>${t("common.name")}</label><input name="name"/></div>
          <div class="form-group"><label>${t("deck.npcStatus")}</label><select name="statut">
            <option value="allie">🟢 ${t("deck.allies")}</option><option value="mentor">🟡 Mentor</option>
            <option value="neutre" selected>⚪ ${t("deck.neutrals")}</option><option value="ennemi">🔴 ${t("deck.enemies")}</option></select></div>
          <div class="form-group"><label><input type="checkbox" name="mort"/> †</label></div>`,
        buttons: [{ action: "ok", label: t("common.add"), default: true,
          callback: (e, b) => new (foundry.applications.ux?.FormDataExtended ?? FormDataExtended)(b.form).object }, { action: "cancel", label: t("common.cancel") }],
      });
      if (!fd || fd === "cancel" || !(fd.name || "").trim()) return;
      const j = await codexJournal(); const c = readCodex(j);
      c.npcs = (c.npcs || []).filter((n) => n.name !== fd.name.trim());
      c.npcs.push({ name: fd.name.trim(), statut: fd.statut, mort: !!fd.mort });
      await writeCodex(j, c); return this.render();
    }
    if (act === "poi-add") {
      const fd = await foundry.applications.api.DialogV2.wait({
        window: { title: t("deck.poiAdd") },
        content: `<div class="form-group"><label>${t("common.name")}</label><input name="name"/></div>
          <div class="form-group"><label>${t("deck.poiNote")}</label><input name="note"/></div>`,
        buttons: [{ action: "ok", label: t("common.add"), default: true,
          callback: (e, b) => new (foundry.applications.ux?.FormDataExtended ?? FormDataExtended)(b.form).object }, { action: "cancel", label: t("common.cancel") }],
      });
      if (!fd || fd === "cancel" || !(fd.name || "").trim()) return;
      const j = await codexJournal(); const c = readCodex(j);
      c.poi = (c.poi || []).filter((p) => p.name !== fd.name.trim());
      c.poi.push({ name: fd.name.trim(), note: (fd.note || "").trim() });
      await writeCodex(j, c); return this.render();
    }
  }

  async _npcDel(i) {
    const j = await codexJournal(); const c = readCodex(j);
    c.npcs.splice(i, 1); await writeCodex(j, c); this.render();
  }
  async _poiDel(i) {
    const j = await codexJournal(); const c = readCodex(j);
    c.poi.splice(i, 1); await writeCodex(j, c); this.render();
  }
}

async function promptText(title, initial) {
  const fd = await foundry.applications.api.DialogV2.wait({
    window: { title },
    content: `<div class="form-group"><input name="v" value="${esc(initial || "")}" style="width:100%"/></div>`,
    buttons: [{ action: "ok", label: t("common.save"), default: true,
      callback: (e, b) => new (foundry.applications.ux?.FormDataExtended ?? FormDataExtended)(b.form).object }, { action: "cancel", label: t("common.cancel") }],
  });
  return (!fd || fd === "cancel") ? null : String(fd.v ?? "");
}
