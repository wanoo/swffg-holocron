/** SWFFG Holocron — « 100 % Campaign Codex » : les NOTES DES JOUEURS et les
 * PERSONNAGES JOUEURS deviennent des fiches Campaign Codex de plein droit.
 *
 * Deux conversions, même patron que convert-mej.mjs — IDEMPOTENTES et NON
 * DESTRUCTIVES :
 *
 *  1. convertNotesToCC() — les journaux du dossier « Notes des joueurs » sont
 *     PROMUS EN PLACE en fiches CC de type `tag` (la fiche générique de Campaign
 *     Codex : `tagMode`, libellé relabellable). On ne duplique RIEN : la note
 *     reste le journal que les joueurs éditent depuis l'app web, on lui ajoute
 *     seulement les flags CC. Pages, ownership, dossier et `legacyId` intacts.
 *
 *  2. mirrorPcsToCC() — chaque acteur PJ reçoit une fiche CC `npc` MIROIR, liée
 *     à l'acteur par la relation NATIVE `linkedActor`, et liée à ses notes.
 *
 * Règles communes (exigences projet) :
 *  • tout reste manipulable depuis Foundry : sheet CC posée (`flags.core.sheetClass`),
 *    tags visibles ET éditables dans la sheet CC comme dans Asset Librarian ;
 *  • relations NATIVES Campaign Codex (`linkedActor`, `associates`) — jamais de
 *    flag maison pour exprimer un lien ;
 *  • non destructif : les tags existants sont FUSIONNÉS, jamais remplacés ; on
 *    n'écrase jamais une valeur posée à la main par le MJ ;
 *  • si Campaign Codex déporte une fiche dans ses propres dossiers à la création,
 *    on la remet où elle doit être (patron repairCCFolders).
 */
import { MOD, t } from "./util.mjs";
import { CC_SHEET } from "./convert-mej.mjs";

const CC = "campaign-codex";
const AL = "asset-librarian";

/** Tag qui marque une note de joueur (repris par l'app web et par Asset Librarian). */
export const NOTE_TAG = "mj:note-joueur";
/** Tag qui marque la fiche miroir d'un personnage joueur. */
export const PC_TAG = "mj:pj";
/** Libellé affiché par la sheet CC générique pour une note de joueur. */
const NOTE_LABEL = "Note de joueur";

/* ------------------------------------------------------------------ tags --- */
// Normalisation partagée avec l'app web (server/lib/transform/tags.mjs) : la
// comparaison est insensible à la casse et aux accents.
const norm = (s) => String(s || "").toLowerCase().normalize("NFD")
  .replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();

const asList = (raw) => (Array.isArray(raw) ? raw : String(raw || "").split(","))
  .map((s) => String(s).trim()).filter(Boolean);

/** Tags actuels d'un document, DES DEUX CÔTÉS (Campaign Codex + Asset Librarian). */
export function currentTags(doc) {
  const f = doc?.flags || {};
  return [
    ...asList(f[CC]?.data?.tags),
    ...asList(f[AL]?.filterTag),
  ];
}

/**
 * FUSION de tags : les tags voulus sont ajoutés à ceux déjà présents, sans
 * doublon (comparaison normalisée) et SANS JAMAIS retirer ce que le MJ a posé
 * à la main. Retourne null si rien à ajouter — l'appelant n'écrit alors pas.
 */
export function mergeTags(doc, wanted) {
  const existing = currentTags(doc);
  const seen = new Set(existing.map(norm));
  const merged = [...existing];
  for (const w of wanted) {
    if (!w || seen.has(norm(w))) continue;
    merged.push(w);
    seen.add(norm(w));
  }
  return merged.length === existing.length ? null : merged;
}

/** Écrit les tags des DEUX côtés (miroir CC ↔ Asset Librarian). */
const tagUpdates = (tags) => ({
  [`flags.${CC}.data.tags`]: tags,
  [`flags.${AL}.filterTag`]: tags.join(", "),
});

/* -------------------------------------------------------------- dossiers --- */
const findFolder = (type, ref) => (ref ? game.folders.find((f) =>
  f.type === type && (f.name === ref || f.id === ref || `Folder.${f.id}` === ref)) : null) || null;

const setting = (key) => { try { return game.settings.get(MOD, key); } catch { return ""; } };

/** Campaign Codex reclasse toute nouvelle fiche dans SES dossiers via son hook de
 * création : on remet la fiche dans le dossier attendu. (Bug déjà vécu, cf.
 * repairCCFolders de convert-mej.mjs.) */
async function keepInFolder(doc, wantedFolderId) {
  const wanted = wantedFolderId ?? null;
  if ((doc.folder?.id ?? null) !== wanted) await doc.update({ folder: wanted });
}

/** Garde commune : Campaign Codex actif ET utilisateur MJ. */
function ccReady() {
  if (!game.user.isGM) return false;
  if (!game.modules.get(CC)?.active) {
    console.warn("swffg-holocron | Campaign Codex absent — conversion CC ignorée");
    ui.notifications.warn(t("setup.ccMissing"));
    return false;
  }
  return true;
}

/* ============================================================================
 * 1. NOTES DES JOUEURS → fiches CC `tag` (promotion EN PLACE)
 * ========================================================================== */

/** Le dossier des notes : réglage `folderNotes` (nom ou uuid). */
const notesFolder = () => findFolder("JournalEntry", setting("folderNotes") || "📓 Notes des joueurs");

/**
 * Le PJ auquel une note se rattache — MÊME RÈGLE que l'app web
 * (server/lib/transform/notes.mjs) : priorité au tag portant le nom d'un PJ,
 * repli sur l'ownership OWNER d'un joueur.
 * @returns {Actor|null}
 */
export function noteOwnerPc(note, pcs) {
  const byName = new Map(pcs.map((p) => [norm(p.name), p]));
  for (const tag of currentTags(note)) {
    const pc = byName.get(norm(tag));
    if (pc) return pc;
  }
  // repli ownership : joueur (non-MJ) propriétaire OWNER de la note
  const gmIds = new Set(game.users.filter((u) => u.isGM).map((u) => u.id));
  const owners = Object.entries(note.ownership || {})
    .filter(([uid, lvl]) => uid !== "default" && (lvl ?? 0) >= 3 && !gmIds.has(uid))
    .map(([uid]) => uid);
  for (const uid of owners) {
    const user = game.users.get(uid);
    const pc = pcs.find((p) => p.id === user?.character?.id)
      || pcs.find((p) => (p.ownership?.[uid] ?? 0) >= 3);
    if (pc) return pc;
  }
  return null;
}

/**
 * Promeut les notes des joueurs en fiches Campaign Codex de type `tag`.
 * Idempotent : marqueur `flags.holocron.noteCcConverted`, et de toute façon
 * chaque écriture est une FUSION (on ne repose que ce qui manque).
 */
export async function convertNotesToCC({ dryRun = false } = {}) {
  if (!ccReady()) return { converted: 0 };
  const folder = notesFolder();
  if (!folder) {
    console.warn("swffg-holocron | dossier des notes des joueurs introuvable");
    return { converted: 0 };
  }
  const notes = game.journal.filter((j) => j.folder?.id === folder.id);
  if (dryRun) return { converted: notes.length, names: notes.map((j) => j.name) };

  const pcs = pcActors();
  let converted = 0;

  for (const note of notes) {
    const pc = noteOwnerPc(note, pcs);
    const updates = {};

    // --- type CC + sheet : posés seulement s'ils manquent (jamais d'écrasement
    // d'un type que le MJ aurait choisi lui-même pour cette fiche).
    const type = note.flags?.[CC]?.type;
    if (!type) {
      updates[`flags.${CC}.type`] = "tag";
      updates[`flags.${CC}.data.tagMode`] = true;
      // libellé de la sheet générique — modifiable ensuite dans Foundry
      if (!note.flags?.[CC]?.data?.sheetTypeLabelOverride) {
        updates[`flags.${CC}.data.sheetTypeLabelOverride`] = NOTE_LABEL;
      }
    }
    const wantedSheet = CC_SHEET[type || "tag"];
    if (!note.flags?.core?.sheetClass && wantedSheet) updates["flags.core.sheetClass"] = wantedSheet;

    // --- tags : mj:note-joueur + nom du PJ, FUSIONNÉS des deux côtés
    const wanted = [NOTE_TAG, ...(pc ? [pc.name] : [])];
    const merged = mergeTags(note, wanted);
    if (merged) Object.assign(updates, tagUpdates(merged));

    // --- relation NATIVE vers l'acteur du PJ (jamais un flag maison)
    if (pc && !note.flags?.[CC]?.data?.linkedActor) {
      updates[`flags.${CC}.data.linkedActor`] = pc.uuid;
    }

    // --- miroir d'affichage : la sheet CC montre le contenu de la note. La PAGE
    // reste la source de vérité (c'est elle que l'app web édite) ; l'app
    // rafraîchit ce miroir à chaque sauvegarde (server/lib/write.mjs).
    if (!note.flags?.[CC]?.data?.description) {
      const html = note.pages.find((p) => p.text?.content)?.text?.content || "";
      if (html) updates[`flags.${CC}.data.description`] = html;
    }

    if (!note.flags?.[MOD]?.noteCcConverted) updates[`flags.${MOD}.noteCcConverted`] = true;

    if (Object.keys(updates).length) {
      await note.update(updates);
      await keepInFolder(note, folder.id); // CC ne doit pas la déporter
      converted++;
    }
  }
  if (converted) ui.notifications.info(t("setup.notesConverted", { n: converted }));
  return { converted };
}

/* ============================================================================
 * 2. PERSONNAGES JOUEURS → fiches CC `npc` MIROIR
 * ========================================================================== */

/** Acteurs PJ : dossier du réglage `folderPcs`, hors véhicules (le vaisseau a sa fiche). */
export function pcActors() {
  const folder = findFolder("Actor", setting("folderPcs") || "👥 Personnages joueurs");
  const list = folder
    ? game.actors.filter((a) => a.folder?.id === folder.id)
    : game.actors.filter((a) => a.type === "character");
  return list.filter((a) => a.type !== "vehicle");
}

/** Dossier d'accueil des fiches miroir : réglage `folderPnj` (les PJ vivent avec
 * les personnages rencontrés — c'est ce que la node map fait graviter). */
const pcSheetFolder = () => findFolder("JournalEntry", setting("folderPnj") || "🎭 Personnages rencontrés");

/**
 * Fiche CC miroir existante d'un acteur : repérée par la relation NATIVE
 * `linkedActor` d'abord (le MJ a pu la créer lui-même depuis Campaign Codex),
 * puis par notre marqueur. Jamais par le nom seul.
 */
export function findPcSheet(actor) {
  return game.journal.find((j) => j.flags?.[CC]?.type && j.flags?.[CC]?.data?.linkedActor === actor.uuid)
    || game.journal.find((j) => j.flags?.holocron?.pcMirror === actor.id)
    || null;
}

/**
 * Crée/complète la fiche CC `npc` miroir de chaque PJ, liée à l'acteur et à ses
 * notes. Idempotent : jamais de doublon, jamais d'écrasement.
 */
export async function mirrorPcsToCC({ dryRun = false } = {}) {
  if (!ccReady()) return { created: 0, linked: 0 };
  const pcs = pcActors();
  if (dryRun) {
    const missing = pcs.filter((a) => !findPcSheet(a));
    return { created: missing.length, names: missing.map((a) => a.name) };
  }
  const folder = pcSheetFolder();
  const notesF = notesFolder();
  const notes = notesF ? game.journal.filter((j) => j.folder?.id === notesF.id) : [];
  let created = 0;
  let linked = 0;

  for (const actor of pcs) {
    let sheet = findPcSheet(actor);

    if (!sheet) {
      // Forme EXACTE d'une fiche npc Campaign Codex (campaign-manager.js#createNPCJournal)
      sheet = await JournalEntry.create({
        name: actor.name,
        folder: folder?.id ?? null,
        ownership: foundry.utils.deepClone(actor.ownership || { default: 0 }),
        flags: {
          core: { sheetClass: CC_SHEET.npc },
          [CC]: {
            type: "npc",
            image: actor.img || null,
            data: {
              linkedActor: actor.uuid,          // relation NATIVE vers l'acteur
              description: "",
              linkedLocations: [], linkedShops: [], associates: [],
              notes: "", tagMode: false,
              tags: [PC_TAG],
            },
          },
          [AL]: { filterTag: PC_TAG },
          holocron: { pcMirror: actor.id },     // marqueur d'idempotence (pas un lien)
        },
        pages: [],
      });
      await keepInFolder(sheet, folder?.id ?? null); // CC déporte les nouvelles fiches
      created++;
    } else {
      // fiche préexistante (la nôtre ou celle du MJ) : on ne fait que COMPLÉTER
      const updates = {};
      if (!sheet.flags?.[CC]?.data?.linkedActor) updates[`flags.${CC}.data.linkedActor`] = actor.uuid;
      if (!sheet.flags?.core?.sheetClass) updates["flags.core.sheetClass"] = CC_SHEET[sheet.flags?.[CC]?.type || "npc"];
      if (!sheet.flags?.[CC]?.image && actor.img) updates[`flags.${CC}.image`] = actor.img;
      if (!sheet.flags?.holocron?.pcMirror) updates["flags.holocron.pcMirror"] = actor.id;
      const merged = mergeTags(sheet, [PC_TAG]);
      if (merged) Object.assign(updates, tagUpdates(merged));
      if (Object.keys(updates).length) await sheet.update(updates);
    }

    // --- liens NATIFS fiche PJ ↔ ses notes (associates), fusionnés sans doublon
    const mine = notes.filter((n) => noteOwnerPc(n, pcs)?.id === actor.id);
    if (mine.length) {
      const cur = sheet.flags?.[CC]?.data?.associates || [];
      const add = mine.map((n) => n.uuid).filter((u) => !cur.includes(u));
      if (add.length) {
        await sheet.update({ [`flags.${CC}.data.associates`]: [...cur, ...add] });
        linked += add.length;
      }
      // réciproque : chaque note pointe la fiche du PJ (relation bidirectionnelle CC)
      for (const n of mine) {
        const nCur = n.flags?.[CC]?.data?.associates || [];
        if (!nCur.includes(sheet.uuid)) {
          await n.update({ [`flags.${CC}.data.associates`]: [...nCur, sheet.uuid] });
        }
      }
    }
  }
  if (created || linked) ui.notifications.info(t("setup.pcsMirrored", { n: created, links: linked }));
  return { created, linked };
}

/** Les deux conversions « CC natif », dans l'ordre (les notes d'abord : la fiche
 * PJ s'y raccroche). Appelée par l'installation et par le menu de réglages. */
export async function convertCcNative(opts = {}) {
  const notes = await convertNotesToCC(opts);
  const pcs = await mirrorPcsToCC(opts);
  return { notes, pcs };
}
