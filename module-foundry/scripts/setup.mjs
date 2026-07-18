/** SWFFG Holocron — installation automatique dans le monde (MJ, idempotent) :
 *  1. structure de dossiers clés (journaux + acteurs),
 *  2. import des compendiums Règles et Événements canon dans le monde,
 *  3. rangement des journaux techniques (vaisseau, codex, HoloNet, config, notes
 *     MJ, rencontres, dossiers, dice_helper) dans le dossier SYSTÈME.
 *  Ne recrée jamais l'existant (repérage par nom) — relançable sans risque. */
import { MOD, t, boundJournal, shipJournal, codexJournal, migratePartyResources } from "./util.mjs";
import { convertMejToCC } from "./convert-mej.mjs";

// Dossiers clés de la campagne — chaque réglage accepte un NOM ou un uuid
// « Folder.<id> » ; le nom par défaut sert à la création si rien n'existe.
export const KEY_FOLDERS = {
  folderActes: { type: "JournalEntry", def: "🎬 Campagne — Actes", kind: "story", editable: true },
  folderOrgs: { type: "JournalEntry", def: "🏛️ Organisations", kind: "org" },
  folderPnj: { type: "JournalEntry", def: "🎭 Personnages rencontrés", kind: "pc" },
  folderNotes: { type: "JournalEntry", def: "📓 Notes des joueurs", kind: "notes", editable: true },
  folderRules: { type: "JournalEntry", def: "📖 Règles & Références (FR)" },
  folderEvents: { type: "JournalEntry", def: "📅 Événements" },
  folderQuests: { type: "JournalEntry", def: "🎯 Quêtes" }, // fiches CC quest (graphe MJ)
  gmBibleFolder: { type: "JournalEntry", def: "🎲 MJ — Bible de campagne" },
  folderPcs: { type: "Actor", def: "👥 Personnages joueurs" },
  folderNpcs: { type: "Actor", def: "🎭 PNJ de campagne" },
};

/** Dossier par nom, id ou uuid « Folder.<id> ». */
const findFolder = (type, ref) => (ref ? game.folders.find((f) =>
  f.type === type && (f.name === ref || f.id === ref || `Folder.${f.id}` === ref)) : null) || null;

async function ensureFolder(type, ref, defName = null) {
  const f = findFolder(type, ref);
  if (f) return f;
  // uuid non résolvable → on crée sous le nom par défaut ; sinon sous le nom donné
  const name = /^Folder\./.test(String(ref)) ? (defName || ref) : (ref || defName);
  return Folder.create({ name, type });
}

/** Résout (ou crée) un dossier clé depuis son réglage. */
async function keyFolder(key) {
  const spec = KEY_FOLDERS[key];
  const ref = game.settings.get(MOD, key) || spec.def;
  return ensureFolder(spec.type, ref, spec.def);
}

/** Journal de config de l'app web : parmi TOUS les porteurs du flag holocron.config
 * (ou homonymes du réglage, comparaison insensible aux variantes d'emoji/espaces),
 * le plus RICHE gagne — un doublon quasi vide ne masque jamais la vraie config. */
const normJName = (s) => String(s || "").normalize("NFKD").replace(/️/g, "").replace(/\s+/g, " ").trim();
function configJournals() {
  const name = normJName(game.settings.get(MOD, "configJournal") || "⚙️ Holocron Config");
  const list = game.journal.filter((j) => j.flags?.holocron?.config || normJName(j.name) === name);
  return list.sort((a, b) => JSON.stringify(b.flags?.holocron?.config || {}).length - JSON.stringify(a.flags?.holocron?.config || {}).length);
}
const configJournal = () => configJournals()[0] || null;

/** Journaux techniques (état/sync Holocron) à ranger dans le dossier système. */
function utilityJournals() {
  const names = [
    game.settings.get(MOD, "shipJournal"),
    game.settings.get(MOD, "codexJournal"),
    game.settings.get(MOD, "holonetJournal"),
    "🗒️ Notes MJ (Holocron)",
    "⚔️ Bibliothèque de rencontres",
    "🗂️ Dossiers MJ (Holocron)",
    "dice_helper",
  ].filter(Boolean);
  const docs = names.map((n) => game.journal.getName(n)).filter(Boolean);
  const cfg = configJournal();
  if (cfg && !docs.includes(cfg)) docs.push(cfg);
  return docs;
}

/** Dossier système : réglage (nom ou uuid) → adoption (dossier d'un journal
 * technique déjà rangé) → création avec le nom du réglage. */
export async function systemFolder() {
  const ref = game.settings.get(MOD, "systemFolder") || "🛠️ Holocron — Système";
  const bySetting = findFolder("JournalEntry", ref);
  if (bySetting) return bySetting;
  for (const j of utilityJournals()) if (j.folder) return j.folder;
  return ensureFolder("JournalEntry", /^Folder\./.test(ref) ? "🛠️ Holocron — Système" : ref);
}

/** Dossier des événements de la frise : catégorie kind:"timeline" de la config
 * si résolvable → réglage folderEvents → adoption du dossier qui contient déjà
 * des fiches MEJ « event » → création. */
async function eventsFolder() {
  const cfg = configJournal()?.flags?.holocron?.config;
  const ref = (cfg?.categories || []).find((c) => c?.kind === "timeline" && c.folder)?.folder;
  const byCfg = findFolder("JournalEntry", ref);
  if (byCfg) return byCfg;
  const bySetting = findFolder("JournalEntry", game.settings.get(MOD, "folderEvents"));
  if (bySetting) return bySetting;
  const withEvent = game.journal.find((j) => j.folder && j.flags?.["monks-enhanced-journal"]?.pagetype === "event");
  if (withEvent) return withEvent.folder;
  return keyFolder("folderEvents");
}

/** Complète ⚙️ Holocron Config : crée le journal s'il manque, AJOUTE les catégories
 * et champs absents (dont la catégorie timeline, pointée par uuid — stable au
 * renommage). Ne touche JAMAIS à ce qui est déjà déclaré. */
async function ensureConfig(eventsF) {
  // Répare les doublons créés par les installeurs 1.5.1→1.5.4 : on garde le plus
  // riche, on supprime les coquilles quasi vides homonymes (config < 600 caractères,
  // sans packs ni registre) — jamais autre chose.
  const all = configJournals();
  for (const dup of all.slice(1)) {
    const cfgDup = dup.flags?.holocron?.config || {};
    const empty = JSON.stringify(cfgDup).length < 600 && !cfgDup.packs?.rules && !(cfgDup.registry || []).length;
    if (empty) {
      await dup.delete();
      ui.notifications.warn(t("setup.dupRemoved", { name: dup.name }));
    }
  }
  // Auto-guérison : si la vraie config (repérée par son flag) a été renommée,
  // on la ramène au nom attendu — c'est par NOM que l'app web la synchronise.
  const wantedName = game.settings.get(MOD, "configJournal") || "⚙️ Holocron Config";
  let j = configJournal();
  if (j && j.flags?.holocron?.config && j.name !== wantedName) {
    await j.update({ name: wantedName });
    ui.notifications.info(t("setup.cfgRenamed", { name: wantedName }));
  }
  if (!j) {
    j = await JournalEntry.create({
      name: wantedName,
      ownership: { default: 0 },
      flags: { holocron: { config: { v: 1, meta: { title: game.world?.title || "Ma campagne SWFFG", description: "", system: "starwarsffg" } } } },
      pages: [{ name: "Config", type: "text", text: { content: "<p>Configuration du Holocron (flags.holocron.config).</p>", format: 1 } }],
    });
  }
  const cfg = j.flags?.holocron?.config || {};
  const cats = Array.isArray(cfg.categories) ? foundry.utils.deepClone(cfg.categories) : [];
  const resolvedIds = new Set(cats.map((c) => findFolder("JournalEntry", c?.folder)?.id).filter(Boolean));
  let added = 0;
  // catégories joueurs dérivées des RÉGLAGES de dossiers clés (kind déclaré dans KEY_FOLDERS)
  for (const [key, spec] of Object.entries(KEY_FOLDERS)) {
    if (!spec.kind) continue;
    const ref = game.settings.get(MOD, key) || spec.def;
    const f = findFolder("JournalEntry", ref);
    if (!f || resolvedIds.has(f.id)) continue;
    cats.push({ folder: ref, kind: spec.kind, ...(spec.editable ? { editable: true } : {}) });
    resolvedIds.add(f.id);
    added++;
  }
  if (eventsF && !cats.some((c) => c?.kind === "timeline") && !resolvedIds.has(eventsF.id)) {
    cats.push({ folder: `Folder.${eventsF.id}`, kind: "timeline", label: "Événements" });
    added++;
  }
  // règles : l'app web lit le DOSSIER des règles importées (uuid stable), pas un pack
  const rulesF = findFolder("JournalEntry", game.settings.get(MOD, "folderRules") || KEY_FOLDERS.folderRules.def);
  if (rulesF && !cats.some((c) => c?.kind === "rules") && !resolvedIds.has(rulesF.id)) {
    cats.push({ folder: `Folder.${rulesF.id}`, kind: "rules", label: "Règles du jeu" });
    added++;
  }
  const updates = {};
  if (added) updates["flags.holocron.config.categories"] = cats;
  if (Object.keys(updates).length) await j.update(updates);
  return added;
}

/** Compendium de règles à importer : réglage rulesPack s'il résout, sinon celui
 * déclaré par la config web (packs.rules), sinon auto-détection. */
function rulesPackId() {
  const bySetting = game.settings.get(MOD, "rulesPack");
  if (bySetting && game.packs.get(bySetting)) return bySetting;
  const ref = configJournal()?.flags?.holocron?.config?.packs?.rules;
  return (ref && game.packs.get(ref)) ? ref : detectRulesPack();
}

// Nom normalisé pour la déduplication : préfixe de tri « NN · » ignoré, casse pliée.
const normName = (n) => String(n || "").toLowerCase().replace(/^\d+\s*[·.\-–—]?\s*/, "").trim();

/** Fiche vaisseau = fiche Campaign Codex « location » portant le widget
 * « Ressources du vaisseau » (jauges liées à flags.holocron.ship). */
async function ensureShipWidget() {
  if (!game.modules.get("campaign-codex")?.active) return;
  const j = await shipJournal();
  if (!j) return;
  if (!j.flags?.["campaign-codex"]?.type) {
    await j.update({ "flags.campaign-codex": { type: "location", data: { description: `<p>${t("ship.pageName")}</p>`, tags: [] } } });
  }
  if (!j.flags?.core?.sheetClass) {
    await j.update({ "flags.core.sheetClass": "campaign-codex.LocationSheet" });
  }
  const wid = stableId("swh-widget:ship-resources");
  if (!j.flags?.["campaign-codex"]?.data?.widgets?.shipresourcebar?.[wid]) {
    await j.update({ [`flags.campaign-codex.data.widgets.shipresourcebar.${wid}`]: { title: "" } });
  }
}

/* ------------------------------------------ événements → Mini Calendar ------- */
const CAL_MOD = "wgtgm-mini-calendar";
const CAL_JOURNAL = "Calendar Events - Mini Calendar";
export const CANON_ICON = "fas fa-jedi";     // icône = classement Canon (frise web)
const CAMPAIGN_ICON = "fas fa-book";

// « 232 BBY » / « 9 ABY » → valeur signée (BBY négatif). null si illisible.
const parseBBY = (s) => {
  const m = /^(-?\d+(?:[.,]\d+)?)\s*(BBY|ABY)?/i.exec(String(s || "").trim());
  if (!m) return null;
  const n = Number(m[1].replace(",", "."));
  return Number.isFinite(n) ? (/bby/i.test(m[2] || "") ? -n : n) : null;
};

// id STABLE (16 alphanum) dérivé d'une graine — idempotence des installations.
const stableId = (seed) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let s = "", x = h;
  for (let i = 0; i < 16; i++) { x = Math.imul(x ^ (x >>> 15), 0x2c1b3c6d) >>> 0; s += A[x % A.length]; }
  return s;
};

/** Installe les événements dans Mini Calendar : 20 dates canon embarquées
 * (data/canon-events.json) + conversion des fiches MEJ « event » du dossier
 * d'événements (archivées ensuite dans 🗄️ Archive MEJ). Idempotent (ids stables
 * + marqueur calendarConverted). Année calendrier = epochBBY + valeur signée. */
export async function ensureCalendarEvents() {
  if (!game.modules.get(CAL_MOD)?.active) {
    console.warn("swffg-holocron | Mini Calendar absent — événements de frise non installés");
    return 0;
  }
  let journal = game.journal.getName(CAL_JOURNAL);
  if (!journal) journal = await JournalEntry.create({ name: CAL_JOURNAL, ownership: { default: 2 } });
  // nettoyage 2.0.0 : les pages à année PADDÉE (« 0068-01-01 ») étaient créées par
  // l'installeur seul et sont invisibles pour Mini Calendar — on les supprime.
  const padded = journal.pages.filter((p) => /^0\d{3}-\d{2}-\d{2}$/.test(p.name)).map((p) => p.id);
  if (padded.length) await journal.deleteEmbeddedDocuments("JournalEntryPage", padded);
  const epoch = Number(game.settings.get(MOD, "calendarEpochBBY")) || 35;

  const sources = [];
  try {
    const canon = await (await fetch(`modules/${MOD}/data/canon-events.json`)).json();
    for (const c of canon) sources.push({ ...c, value: parseBBY(c.date), icon: CANON_ICON, playerVisible: true });
  } catch (e) { console.warn("swffg-holocron | canon-events.json illisible", e); }

  // fiches MEJ « event » legacy du dossier d'événements → converties puis archivées
  const eventsF = await eventsFolder();
  for (const j of game.journal.filter((x) => x.folder?.id === eventsF?.id)) {
    if (j.flags?.[MOD]?.calendarConverted) continue;
    const mf = j.pages.find((p) => p.flags?.["monks-enhanced-journal"])?.flags?.["monks-enhanced-journal"];
    if (mf?.type !== "event") continue;
    const value = parseBBY(mf.date || mf.attributes?.date);
    if (value == null) continue;
    sources.push({
      value,
      title: j.name.replace(/^\s*[\d.,]+\s*(BBY|ABY)\s*[—–-]\s*/i, ""),
      content: j.pages.find((p) => p.text?.content)?.text?.content || "",
      icon: /^canon/i.test(String(mf.location || mf.attributes?.position || "")) ? CANON_ICON : CAMPAIGN_ICON,
      playerVisible: (j.ownership?.default ?? 0) >= 2,
      legacy: j,
    });
  }

  let added = 0;
  for (const ev of sources) {
    if (ev.value == null) continue;
    // nommage Mini Calendar : année NON paddée, négative acceptée (ex. "-197-01-01")
    const year = epoch + Math.trunc(ev.value);
    const pageName = `${year}-01-01`;
    let page = journal.pages.getName(pageName);
    if (!page) [page] = await journal.createEmbeddedDocuments("JournalEntryPage", [{ name: pageName, type: "text", text: { content: "", format: 1 } }]);
    const nid = stableId(`swh-cal:${ev.title}:${ev.value}`);
    const notes = foundry.utils.deepClone(page.getFlag(CAL_MOD, "notes") || []);
    if (!notes.some((n) => n?.id === nid)) {
      notes.push({
        id: nid, title: ev.title, icon: ev.icon, content: ev.content || "",
        playerVisible: ev.playerVisible !== false, hour: null, minute: null,
        repeatUnit: "none", repeatInterval: 1, repeatCount: 0,
        advancedRule: "none", advParams: {}, autoExecuteMacros: false, playerTimeDisplay: "exact",
      });
      await page.setFlag(CAL_MOD, "notes", notes);
      added++;
    }
    if (ev.legacy) {
      const arch = await ensureFolder("JournalEntry", "🗄️ Archive MEJ");
      await ev.legacy.update({ folder: arch.id, [`flags.${MOD}.calendarConverted`]: true });
    }
  }
  return added;
}

/** Importe les RollTables du pack tables absentes du monde (les réglages
 * critTableCharacter/critTableVehicle pointent ces noms par défaut). */
async function importTables() {
  const pack = game.packs.get(`${MOD}.tables`);
  if (!pack) return 0;
  const docs = await pack.getDocuments();
  const missing = docs.filter((d) => !game.tables.getName(d.name));
  if (!missing.length) return 0;
  await RollTable.createDocuments(missing.map((d) => d.toObject()), { keepId: true });
  return missing.length;
}

/** Importe les documents d'un pack absents du monde (dédup par nom normalisé, ids conservés). */
async function importPack(packId, folderId) {
  const pack = game.packs.get(packId);
  if (!pack) return 0;
  const existing = new Set(game.journal.map((j) => normName(j.name)));
  const docs = await pack.getDocuments();
  const missing = docs.filter((d) => !existing.has(normName(d.name)));
  if (!missing.length) return 0;
  const data = missing.map((d) => ({ ...d.toObject(), folder: folderId }));
  await JournalEntry.createDocuments(data, { keepId: true });
  return missing.length;
}

// Réglages du module qui PILOTENT la config web (flags.holocron.config) : un champ
// de config vide se remplit depuis le réglage ; un réglage modifié par le MJ gagne.
const SETTING_DEFAULTS = {
  rulesPack: "", adversariesPack: "world.star-wars-adversaries",
  gmBibleFolder: "🎲 MJ — Bible de campagne", shipNotesPage: "",
  folderPcs: "👥 Personnages joueurs", folderNpcs: "🎭 PNJ de campagne",
  calendarEpochBBY: "35", // Grande ReSynchronisation : an 0 du calendrier = 35 BBY
};

// Réglage de dossier → valeur écrite en config : le NOM du dossier résolu
// (l'app web filtre les acteurs par nom de dossier).
const folderSettingName = (key) => {
  const spec = KEY_FOLDERS[key];
  const ref = game.settings.get(MOD, key) || spec.def;
  return findFolder(spec.type, ref)?.name || ref;
};

// « JournalEntry.<jid>.JournalEntryPage.<pid> » (uuid copié depuis Foundry) → « <jid>:<pid> ».
const normShipNotes = (v) => {
  const m = /JournalEntry\.([A-Za-z0-9]{16})\.JournalEntryPage\.([A-Za-z0-9]{16})/.exec(String(v || ""));
  return m ? `${m[1]}:${m[2]}` : String(v || "").trim();
};

// Auto-détection du compendium de règles À IMPORTER : un pack JournalEntry dont
// le titre évoque les règles (priorité aux packs monde), sinon celui du module.
// (L'app web, elle, lit le DOSSIER des règles importées — catégorie kind "rules".)
function detectRulesPack() {
  const packs = game.packs.filter((p) => p.documentName === "JournalEntry" && /r[eè]gle/i.test(p.title || p.metadata?.label || ""));
  packs.sort((a, b) => (a.metadata?.packageType === "world" ? -1 : 1) - (b.metadata?.packageType === "world" ? -1 : 1));
  return packs[0]?.collection || `${MOD}.regles`;
}

export async function pushSettingsToConfig() {
  if (!game.user.isGM) return;
  const j = configJournal();
  if (!j) return;
  const cfg = j.flags?.holocron?.config || {};
  const updates = {};
  const apply = (path, current, settingKey, transform = (x) => x) => {
    const raw = game.settings.get(MOD, settingKey);
    const val = transform(raw);
    if (!val) return;
    // champ vide → rempli ; réglage NON-défaut → il gagne ; sinon la config existante prime
    if (!current || (raw !== SETTING_DEFAULTS[settingKey] && current !== val)) updates[path] = val;
  };
  apply("flags.holocron.config.packs.rules", cfg.packs?.rules, "rulesPack");
  apply("flags.holocron.config.packs.adversaries", cfg.packs?.adversaries, "adversariesPack");
  apply("flags.holocron.config.gmBibleFolder", cfg.gmBibleFolder, "gmBibleFolder", () => folderSettingName("gmBibleFolder"));
  apply("flags.holocron.config.journals.shipNotes", cfg.journals?.shipNotes, "shipNotesPage", normShipNotes);
  apply("flags.holocron.config.pcFolder", cfg.pcFolder, "folderPcs", () => folderSettingName("folderPcs"));
  apply("flags.holocron.config.npcsWorldFolder", cfg.npcsWorldFolder, "folderNpcs", () => folderSettingName("folderNpcs"));
  apply("flags.holocron.config.calendar.epochBBY", cfg.calendar?.epochBBY, "calendarEpochBBY", (v) => Number(v) || 300);
  // notes du vaisseau : défaut = la page notes du journal POI vaisseau (créée au besoin)
  if (!cfg.journals?.shipNotes && !updates["flags.holocron.config.journals.shipNotes"]) {
    const ref = await ensureShipNotesPage();
    if (ref) updates["flags.holocron.config.journals.shipNotes"] = ref;
  }
  if (Object.keys(updates).length) await j.update(updates);
}

/** Page « notes » du journal POI vaisseau : page taguée bound=shipNotes, sinon
 * première page texte hors fiche MEJ (attrape la page notes d'un monde existant),
 * sinon création de « 📓 Notes d'équipage » APRÈS la page de statut. → "<jid>:<pid>". */
export async function ensureShipNotesPage() {
  const j = await shipJournal();
  if (!j) return "";
  let page = j.pages.find((p) => p.flags?.[MOD]?.bound === "shipNotes")
    || j.pages.find((p, i) => i > 0 && p.type === "text"
      && !p.flags?.["monks-enhanced-journal"] && p.flags?.[MOD]?.bound !== "status");
  if (!page && game.user.isGM) {
    const maxSort = Math.max(0, ...j.pages.map((p) => p.sort || 0));
    [page] = await j.createEmbeddedDocuments("JournalEntryPage", [{
      name: t("ship.notesPageName"), type: "text", sort: maxSort + 100000,
      text: { content: "", format: 1 },
      flags: { [MOD]: { bound: "shipNotes" } },
    }]);
  }
  return page ? `${j.id}:${page.id}` : "";
}

export async function installHolocron({ silent = false } = {}) {
  if (!game.user.isGM) return false;
  // 1. répertoires clés (pilotés par les réglages folder*, créés s'ils manquent)
  let folders = 0;
  for (const key of Object.keys(KEY_FOLDERS)) {
    if (key === "folderEvents") continue; // résolu à part (eventsFolder, adoption possible)
    const spec = KEY_FOLDERS[key];
    if (!findFolder(spec.type, game.settings.get(MOD, key) || spec.def)) { await keyFolder(key); folders++; }
  }
  // 2. dossier SYSTÈME résolu/créé AVANT les fiches liées : elles naissent
  // directement dedans (plus de dépôt à la racine puis déplacement).
  const sys = await systemFolder();
  const eventsF = await eventsFolder();

  // 3. fiches liées du poste de commande : vaisseau (fiche CC + widget jauges),
  // codex, HoloNet
  try {
    await shipJournal(); await codexJournal(); await boundJournal("holonetJournal");
    await migratePartyResources();   // one-shot si l'ancien module est encore là
    await ensureShipWidget();        // fiche CC location + widget « Ressources du vaisseau »
  } catch (e) { console.warn("swffg-holocron | journaux liés", e); }

  // 4. la config de campagne se complète toute seule : catégories (règles/timeline)
  // puis champs pilotés par les OPTIONS du module (packs, bible, notes du vaisseau…)
  await ensureConfig(eventsF);
  await pushSettingsToConfig();

  // 5. imports dans le monde : règles (compendium source → dossier règles),
  // événements canon (→ dossier événements), tables critiques (→ RollTables)
  const rulesF = await keyFolder("folderRules");
  const rules = await importPack(rulesPackId(), rulesF.id);
  const events = await ensureCalendarEvents(); // canon + conversion des fiches MEJ event
  await importTables();
  // master switch : les fiches MEJ du monde deviennent des fiches Campaign Codex
  try { await convertMejToCC(); } catch (e) { console.warn("swffg-holocron | conversion MEJ→CC", e); }

  // 6. rangement des journaux techniques préexistants (no-op sur un monde neuf)
  let moved = 0;
  for (const j of utilityJournals()) {
    if (j.folder?.id !== sys.id) { await j.update({ folder: sys.id }); moved++; }
  }

  if (!silent && (folders || rules || events || moved)) {
    ui.notifications.info(t("setup.done", { folders, rules, events, moved, sys: sys.name }));
  }
  return true;
}
