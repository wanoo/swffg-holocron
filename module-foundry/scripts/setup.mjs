/** SWFFG Holocron — installation automatique dans le monde (MJ, idempotent) :
 *  1. structure de dossiers clés (journaux + acteurs),
 *  2. import des compendiums Règles et Événements canon dans le monde,
 *  3. rangement des journaux techniques (vaisseau, codex, HoloNet, config, notes
 *     MJ, rencontres, dossiers, dice_helper) dans le dossier SYSTÈME.
 *  Ne recrée jamais l'existant (repérage par nom) — relançable sans risque. */
import { MOD, t, boundJournal, shipJournal, codexJournal } from "./util.mjs";

// Dossiers clés de la campagne — chaque réglage accepte un NOM ou un uuid
// « Folder.<id> » ; le nom par défaut sert à la création si rien n'existe.
export const KEY_FOLDERS = {
  folderActes: { type: "JournalEntry", def: "🎬 Campagne — Actes", kind: "story", editable: true },
  folderOrgs: { type: "JournalEntry", def: "🏛️ Organisations", kind: "org" },
  folderPnj: { type: "JournalEntry", def: "🎭 Personnages rencontrés", kind: "pc" },
  folderNotes: { type: "JournalEntry", def: "📓 Notes des joueurs", kind: "notes", editable: true },
  folderRules: { type: "JournalEntry", def: "📖 Règles & Références (FR)" },
  folderEvents: { type: "JournalEntry", def: "📅 Événements" },
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
  const updates = {};
  if (added) updates["flags.holocron.config.categories"] = cats;
  if (Object.keys(updates).length) await j.update(updates);
  return added;
}

/** Compendium de règles à importer : celui déclaré par la config web
 * (packs.rules, ex. world.regles-and-references-fr) s'il existe dans le monde,
 * sinon le pack embarqué du module. */
function rulesPackId() {
  const ref = configJournal()?.flags?.holocron?.config?.packs?.rules;
  return (ref && game.packs.get(ref)) ? ref : `${MOD}.regles`;
}

// Nom normalisé pour la déduplication : préfixe de tri « NN · » ignoré, casse pliée.
const normName = (n) => String(n || "").toLowerCase().replace(/^\d+\s*[·.\-–—]?\s*/, "").trim();

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
  rulesPack: "", adversariesPack: "",
  gmBibleFolder: "🎲 MJ — Bible de campagne", shipNotesPage: "",
  folderPcs: "👥 Personnages joueurs", folderNpcs: "🎭 PNJ de campagne",
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

// Auto-détection du compendium de règles : un pack JournalEntry dont le titre
// évoque les règles (priorité aux packs monde), sinon celui embarqué au module.
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
  if (!cfg.packs?.rules && !updates["flags.holocron.config.packs.rules"]) {
    updates["flags.holocron.config.packs.rules"] = detectRulesPack(); // zéro-config
  }
  if (Object.keys(updates).length) await j.update(updates);
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
  const eventsF = await eventsFolder();

  // 2. la config de campagne se complète toute seule : catégories/timeline (ensureConfig)
  // puis champs pilotés par les OPTIONS du module (packs, bible, notes du vaisseau…)
  await ensureConfig(eventsF);
  await pushSettingsToConfig();

  // 3. fiches liées du poste de commande : POI vaisseau (fiche MEJ), codex, HoloNet
  // (créées dans le dossier système — no-op si déjà présentes)
  try { await shipJournal(); await codexJournal(); await boundJournal("holonetJournal"); }
  catch (e) { console.warn("swffg-holocron | journaux liés", e); }

  // 4. règles : copiées depuis le compendium déclaré par la config (packs.rules,
  // ex. world.regles-and-references-fr) — repli sur le pack embarqué du module
  const rulesF = await keyFolder("folderRules");
  const rules = await importPack(rulesPackId(), rulesF.id);
  const events = await importPack(`${MOD}.evenements`, eventsF.id);

  const sys = await systemFolder();
  let moved = 0;
  for (const j of utilityJournals()) {
    if (j.folder?.id !== sys.id) { await j.update({ folder: sys.id }); moved++; }
  }

  if (!silent && (folders || rules || events || moved)) {
    ui.notifications.info(t("setup.done", { folders, rules, events, moved, sys: sys.name }));
  }
  return true;
}
