/** SWFFG Holocron — installation automatique dans le monde (MJ, idempotent) :
 *  1. structure de dossiers clés (journaux + acteurs),
 *  2. import des compendiums Règles et Événements canon dans le monde,
 *  3. rangement des journaux techniques (vaisseau, codex, HoloNet, config, notes
 *     MJ, rencontres, dossiers, dice_helper) dans le dossier SYSTÈME.
 *  Ne recrée jamais l'existant (repérage par nom) — relançable sans risque. */
import { MOD, t } from "./util.mjs";

// Dossiers clés de la campagne (créés s'ils manquent) — cf. README §4.
const JOURNAL_FOLDERS = [
  "🎬 Campagne — Actes",
  "🏛️ Organisations",
  "🎭 Personnages rencontrés",
  "📓 Notes des joueurs",
  "🎲 MJ — Bible de campagne",
];
const ACTOR_FOLDERS = ["👥 Personnages joueurs", "🎭 PNJ de campagne"];
const RULES_FOLDER = "📖 Règles & Références (FR)";
const EVENTS_FOLDER = "📅 Événements";

/** Dossier par nom, id ou uuid « Folder.<id> ». */
const findFolder = (type, ref) => (ref ? game.folders.find((f) =>
  f.type === type && (f.name === ref || f.id === ref || `Folder.${f.id}` === ref)) : null) || null;

async function ensureFolder(type, name) {
  return findFolder(type, name) || Folder.create({ name, type });
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
 * si résolvable → adoption du dossier qui contient déjà des fiches MEJ « event »
 * → dossier par défaut (créé au besoin). */
async function eventsFolder() {
  const cfg = configJournal()?.flags?.holocron?.config;
  const ref = (cfg?.categories || []).find((c) => c?.kind === "timeline" && c.folder)?.folder;
  const byCfg = findFolder("JournalEntry", ref);
  if (byCfg) return byCfg;
  const withEvent = game.journal.find((j) => j.folder && j.flags?.["monks-enhanced-journal"]?.pagetype === "event");
  if (withEvent) return withEvent.folder;
  return ensureFolder("JournalEntry", EVENTS_FOLDER);
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
  const wanted = [
    { folder: "🎬 Campagne — Actes", kind: "story", editable: true },
    { folder: "🏛️ Organisations", kind: "org" },
    { folder: "🎭 Personnages rencontrés", kind: "pc" },
    { folder: "📓 Notes des joueurs", kind: "notes", editable: true },
  ];
  let added = 0;
  for (const w of wanted) {
    const f = findFolder("JournalEntry", w.folder);
    if (!f || resolvedIds.has(f.id)) continue;
    cats.push({ ...w });
    added++;
  }
  if (eventsF && !cats.some((c) => c?.kind === "timeline") && !resolvedIds.has(eventsF.id)) {
    cats.push({ folder: `Folder.${eventsF.id}`, kind: "timeline", label: "Événements" });
    added++;
  }
  const updates = {};
  if (added) updates["flags.holocron.config.categories"] = cats;
  if (!cfg.gmBibleFolder) updates["flags.holocron.config.gmBibleFolder"] = "🎲 MJ — Bible de campagne";
  if (!cfg.pcFolder) updates["flags.holocron.config.pcFolder"] = "👥 Personnages joueurs";
  if (!cfg.npcsWorldFolder) updates["flags.holocron.config.npcsWorldFolder"] = "🎭 PNJ de campagne";
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

export async function installHolocron({ silent = false } = {}) {
  if (!game.user.isGM) return false;
  let folders = 0;
  for (const n of JOURNAL_FOLDERS) if (!findFolder("JournalEntry", n)) { await ensureFolder("JournalEntry", n); folders++; }
  for (const n of ACTOR_FOLDERS) if (!findFolder("Actor", n)) { await ensureFolder("Actor", n); folders++; }

  // règles : copiées depuis le compendium déclaré par la config (packs.rules,
  // ex. world.regles-and-references-fr) — repli sur le pack embarqué du module
  const rulesF = await ensureFolder("JournalEntry", RULES_FOLDER);
  const rules = await importPack(rulesPackId(), rulesF.id);
  const eventsF = await eventsFolder();
  const events = await importPack(`${MOD}.evenements`, eventsF.id);

  // la config de campagne se complète toute seule (catégories, timeline, dossiers)
  await ensureConfig(eventsF);

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
