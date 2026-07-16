/** SWFFG Holocron — entry point: settings, API, scene buttons, astronav ↔ ship bridge. */
import { MOD, t, applyTrip, shipJournal, readShip, setShipWorld, astronavApi, favoriteWorlds, ensurePartyResources } from "./util.mjs";
import { installHolocron, pushSettingsToConfig } from "./setup.mjs";
import { convertMejToCC } from "./convert-mej.mjs";
import { HolocronApp } from "./deck.mjs";
import { openToolbox, TOOLS } from "./gm-tools.mjs";

/** Menu de réglage : (ré)installe les ressources party-resources du groupe. */
class PartyResSetupMenu extends foundry.applications.api.ApplicationV2 {
  async render() { await ensurePartyResources({ force: true }); return this; }
}
/** Menu de réglage : (ré)installe la structure Holocron (dossiers, règles, rangement). */
class InstallMenu extends foundry.applications.api.ApplicationV2 {
  async render() { await installHolocron(); return this; }
}
/** Menu de réglage : convertit les fiches MEJ du monde en fiches Campaign Codex. */
class ConvertMenu extends foundry.applications.api.ApplicationV2 {
  async render() { await convertMejToCC(); return this; }
}

/** Dernier coût d'astrogation calculé par l'astronav (hook swffgAstronav.cost). */
let LAST_COST = null;
/** Seul le MJ « actif » applique un voyage (évite la double déduction à plusieurs MJ). */
const isTripApplier = () => {
  if (!game.user.isGM) return false;
  const gm = game.users.activeGM ?? game.users.find((u) => u.isGM && u.active);
  return !gm || gm.id === game.user.id;
};

Hooks.once("init", () => {
  const S = (key, def, extra = {}) => game.settings.register(MOD, key, {
    name: `SWH.settings.${key}.name`, hint: `SWH.settings.${key}.hint`,
    scope: "world", config: true, type: String, default: def, ...extra,
  });
  S("shipJournal", "🚀 Vaisseau du groupe");
  S("codexJournal", "🖥️ Codex du groupe");
  S("holonetJournal", "📡 HoloNet — Actualités");
  // journal de configuration de l'app web (flags.holocron.config) — doit
  // correspondre à CONFIG_JOURNAL_NAME côté Archive Holocron.
  S("configJournal", "⚙️ Holocron Config");
  S("critTableCharacter", "🩸 Blessures critiques (d100)");
  S("critTableVehicle", "🔥 Avaries critiques — véhicules (d100)");
  S("shopPacks", "world.oggdudeweapons, world.oggdudearmor, world.oggdudegear");
  // fvtt-party-resources : id des ressources partagées mappées aux trois jauges du vaisseau.
  S("resFoodId", "vivres");
  S("resFuelId", "carburant");
  S("resWearId", "usure");
  // dossier SYSTÈME (journaux techniques rangés là) : nom OU uuid « Folder.<id> ».
  S("systemFolder", "🛠️ Holocron — Système");
  // Champs de la config web PILOTÉS par les options du module (appliqués à la
  // volée + à chaque installation) : compendiums, bible MJ, notes du vaisseau.
  const SC = (key, def) => S(key, def, { onChange: () => { if (game.user.isGM) pushSettingsToConfig().catch((e) => console.warn("swffg-holocron | config", e)); } });
  SC("rulesPack", "");                             // vide : auto-détection (pack « règles »)
  SC("adversariesPack", "world.star-wars-adversaries");
  SC("gmBibleFolder", "🎲 MJ — Bible de campagne");
  SC("shipNotesPage", "");                         // "<jid>:<pid>" OU uuid JournalEntry.….JournalEntryPage.…
  // Calendrier galactique Mini Calendar (« Grande ReSynchronisation », an 0 = 35 BBY) :
  // année calendrier N = (N − epochBBY) → BBY si négatif, ABY sinon.
  SC("calendarEpochBBY", "35");
  // Répertoires clés de la campagne (nom OU uuid « Folder.<id> ») — créés/adoptés
  // à l'installation (menu « Installer / réinstaller » ou mise à jour du module).
  S("folderActes", "🎬 Campagne — Actes");
  S("folderOrgs", "🏛️ Organisations");
  S("folderPnj", "🎭 Personnages rencontrés");
  S("folderNotes", "📓 Notes des joueurs");
  S("folderRules", "📖 Règles & Références (FR)");
  S("folderEvents", "📅 Événements");
  SC("folderPcs", "👥 Personnages joueurs");
  SC("folderNpcs", "🎭 PNJ de campagne");
  // marqueurs d'installation auto : party-resources (une fois) ; structure Holocron
  // (une fois PAR VERSION du module — l'install est idempotente, chaque mise à jour
  // rejoue donc les compléments de structure/config sans rien écraser).
  game.settings.register(MOD, "partyResSetup", { scope: "world", config: false, type: Boolean, default: false });
  game.settings.register(MOD, "installedVersion", { scope: "world", config: false, type: String, default: "" });
  game.settings.registerMenu(MOD, "partyResMenu", {
    name: "SWH.settings.partyResMenu.name", label: "SWH.settings.partyResMenu.label",
    hint: "SWH.settings.partyResMenu.hint", icon: "fa-solid fa-gauge-high", type: PartyResSetupMenu, restricted: true,
  });
  game.settings.registerMenu(MOD, "installMenu", {
    name: "SWH.settings.installMenu.name", label: "SWH.settings.installMenu.label",
    hint: "SWH.settings.installMenu.hint", icon: "fa-solid fa-boxes-packing", type: InstallMenu, restricted: true,
  });
  game.settings.registerMenu(MOD, "convertMenu", {
    name: "SWH.settings.convertMenu.name", label: "SWH.settings.convertMenu.label",
    hint: "SWH.settings.convertMenu.hint", icon: "fa-solid fa-arrows-rotate", type: ConvertMenu, restricted: true,
  });

  game.modules.get(MOD).api = {
    open: () => new HolocronApp().render(true),
    toolbox: openToolbox,
    tools: TOOLS,
    applyTrip,
    setShipWorld,
    ship: async () => readShip(await shipJournal()),
    favorites: favoriteWorlds,
    importAtlas: () => astronavApi()?.importToWorld?.({ confirm: true }),
    setupPartyResources: ensurePartyResources,
    install: installHolocron,
    convertMej: convertMejToCC,
    lastCost: () => LAST_COST,
    HolocronApp,
  };
});

/* Scene controls: Holocron for everyone, GM toolbox for the GM. */
Hooks.on("getSceneControlButtons", (controls) => {
  const tools = controls.tokens?.tools ?? controls.find?.((c) => c.name === "token")?.tools;
  if (!tools) return;
  const add = (name, title, icon, fn, order) => {
    const btn = { name, title, icon, button: true, visible: true, onChange: fn, onClick: fn };
    Array.isArray(tools) ? tools.push(btn) : (tools[name] = { ...btn, order });
  };
  add("holocron", "SWH.deck.title", "fa-solid fa-satellite-dish", () => new HolocronApp().render(true), 97);
  if (game.user.isGM) add("holotoolbox", "SWH.toolbox.title", "fa-solid fa-toolbox", () => openToolbox(), 98);
});

/* Astronav → Holocron : mémorise le dernier coût calculé (« appliquer le trajet » du deck). */
Hooks.on("swffgAstronav.cost", (cost) => {
  LAST_COST = cost || null;
  foundry.applications.instances.get("swffg-holocron-app")?.render();
});

/* Réception d'un voyage : un jet d'Astrogation RÉUSSI applique le coût au vaisseau et déplace le POI.
   (L'astronav bouge déjà son marqueur ; ici on déduit le pool party-resources + met à jour le journal.) */
Hooks.on("ffgDiceMessage", async (roll) => {
  if (!isTripApplier()) return;
  try {
    const trip = roll?.data?.astronavTrip;
    const txt = [roll?.flavorText, roll?.data?.description, roll?.data?.skillName].filter(Boolean).join(" | ");
    if (!trip && !/astrogation/i.test(txt)) return;            // pas un jet d'astrogation
    const net = (roll?.ffg?.success || 0) - (roll?.ffg?.failure || 0);
    if (net <= 0) return;                                       // échec : ni coût ni déplacement
    const to = trip?.to || LAST_COST?.to;
    if (!to) return;
    const from = trip?.from || LAST_COST?.from || "";
    // coût calculé pour CE trajet s'il correspond, sinon simple déplacement (déduction nulle)
    const c = (LAST_COST && LAST_COST.to === to) ? LAST_COST : { days: 0, fuel: 0, usure: 0 };
    await applyTrip({ days: c.days || 0, fuel: c.fuel || 0, usure: c.usure || 0, from, to });
  } catch (e) { console.warn("swffg-holocron | application du voyage", e); }
});

/* Pont web → joueurs : l'app Holocron poste un ChatMessage flaggé holocron.showImage
   (POST /api/gm/foundry/show-image). Le MJ « actif » ouvre un ImagePopout PARTAGÉ à
   tous les clients (shareImage) puis supprime la requête — même pont que les jets. */
Hooks.on("createChatMessage", async (msg) => {
  const req = msg.flags?.holocron?.showImage;
  if (!req?.src || !isTripApplier()) return;
  try {
    const IPv13 = foundry.applications?.apps?.ImagePopout;             // v13 : ApplicationV2 ({src,…})
    const popout = IPv13
      ? new IPv13({ src: req.src, window: { title: req.title || "Holocron" }, shareable: true })
      : new ImagePopout(req.src, { title: req.title || "Holocron", shareable: true }); // v12 : (src, options)
    await popout.render(true);
    await popout.shareImage();
  } catch (e) { console.warn("swffg-holocron | show-image", e); }
  finally { await msg.delete().catch(() => {}); }
});

/* Au chargement : setup auto des ressources party-resources + cale le POI « vous êtes ici ». */
Hooks.once("ready", async () => {
  // Setup/install automatique du pool du groupe : sur TOUT client MJ (idempotent).
  // NE dépend PAS de « MJ actif » — le connecteur MCP headless peut être l'activeGM
  // et ne lance jamais le code du module, donc les ressources ne se créaient jamais.
  if (game.user.isGM) {
    try {
      if (!game.settings.get(MOD, "partyResSetup")) {
        const ok = await ensurePartyResources({ silent: false });
        if (ok) await game.settings.set(MOD, "partyResSetup", true);
      } else {
        await ensurePartyResources({ silent: true });   // idempotent : recrée seulement si supprimées
      }
    } catch (e) { console.warn("swffg-holocron | setup party-resources", e); }
  }
  // Installation auto de la structure Holocron (dossiers clés, import des règles
  // et événements canon, config complétée, rangement des journaux techniques).
  // Un seul MJ « actif » l'exécute, une fois par version du module (idempotent,
  // relançable à tout moment via le menu de réglage).
  const version = game.modules.get(MOD)?.version || "";
  if (game.user.isGM && isTripApplier() && game.settings.get(MOD, "installedVersion") !== version) {
    try {
      await installHolocron();
      await game.settings.set(MOD, "installedVersion", version);
    } catch (e) { console.warn("swffg-holocron | installation auto", e); }
  }
  // Marqueur « vous êtes ici » (un seul applicateur pour éviter les races).
  if (!isTripApplier()) return;
  try {
    if (!astronavApi()) return;
    const s = readShip(await shipJournal());
    if (s?.lastTo && !astronavApi()?.currentWorld?.()) await astronavApi()?.setCurrentWorld?.(s.lastTo);
  } catch (e) { console.warn("swffg-holocron | seed POI", e); }
});

/* Keep the Holocron fresh when the ship, codex, or position change (any client). */
for (const h of ["swffgHolocron.shipUpdated", "swffgHolocron.codexUpdated", "swffgHolocron.shipMoved"]) {
  Hooks.on(h, () => foundry.applications.instances.get("swffg-holocron-app")?.render());
}
Hooks.on("updateJournalEntry", (doc) => {
  const bound = [game.settings.get(MOD, "shipJournal"), game.settings.get(MOD, "codexJournal"), game.settings.get(MOD, "holonetJournal")];
  if (bound.includes(doc.name)) foundry.applications.instances.get("swffg-holocron-app")?.render();
});
