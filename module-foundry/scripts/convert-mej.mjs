/** SWFFG Holocron — conversion des fiches MEJ du monde vers Campaign Codex
 * (master switch). Idempotente : chaque fiche convertie est MARQUÉE puis archivée
 * dans « 🗄️ Archive MEJ » (jamais supprimée). La fiche CC reprend nom, image,
 * pages texte et droits ; rôle MEJ → flags.holocron.statut ; attribut vie →
 * flags.holocron.mort ; attributs libres → flags.holocron.attrs (affichés par
 * l'app web) ; relations MEJ → liens CC (associates). Les fiches de l'atlas
 * astronav sont EXCLUES (chantier astronav 2.0). */
import { MOD, t } from "./util.mjs";

const CC = "campaign-codex";
const MEJ = "monks-enhanced-journal";
const TYPE_MAP = { person: "npc", organization: "group", place: "location", shop: "shop", quest: "quest", poi: "location", loot: "shop" };
const ROLE_STATUT = {
  ally: "allie", allie: "allie", "allié": "allie", ami: "allie", amie: "allie", friend: "allie",
  enemy: "ennemi", ennemi: "ennemi", ennemie: "ennemi", rival: "ennemi", hostile: "ennemi",
  mentor: "mentor", maitre: "mentor", "maître": "mentor",
  neutral: "neutre", neutre: "neutre", contact: "contact", informateur: "contact",
};
const ID16 = /^[a-zA-Z0-9]{16}$/;

const mejMeta = (j) => j.pages.find((p) => p.flags?.[MEJ])?.flags?.[MEJ] || null;

export async function convertMejToCC({ dryRun = false } = {}) {
  if (!game.user.isGM) return { converted: 0 };
  if (!game.modules.get(CC)?.active) {
    console.warn("swffg-holocron | Campaign Codex absent — conversion MEJ ignorée");
    return { converted: 0 };
  }
  const candidates = game.journal.filter((j) => {
    if (j.flags?.[MOD]?.ccConverted || j.flags?.[CC]?.type) return false;
    if (j.flags?.["swffg-astronavigation"]) return false; // atlas : hors périmètre ici
    const mf = mejMeta(j);
    const type = mf?.type || j.flags?.[MEJ]?.pagetype;
    return Boolean(TYPE_MAP[type]) && type !== "event"; // events : gérés par ensureCalendarEvents
  });
  if (dryRun) return { converted: candidates.length, names: candidates.map((j) => j.name) };

  const mapping = new Map(); // ancien id → uuid CC (résolution des relations en 2e passe)
  const made = [];
  for (const j of candidates) {
    const page = j.pages.find((p) => p.flags?.[MEJ]);
    const mf = page?.flags?.[MEJ] || {};
    const type = TYPE_MAP[mf.type || j.flags?.[MEJ]?.pagetype];
    const attrs = {};
    for (const [k, v] of Object.entries(mf.attributes || {})) {
      const val = (v && typeof v === "object") ? v.value : v;
      if (typeof val === "string" && val.trim() && !ID16.test(k)) attrs[k] = val.trim();
    }
    if (mf.location) attrs.rattachement = attrs.rattachement || String(mf.location);
    if (mf.placetype) attrs.region = attrs.region || String(mf.placetype);
    const statut = ROLE_STATUT[String(mf.role || "").toLowerCase()] || "";
    const mort = /mort|décéd|décès|deceased|dead/i.test(String(attrs.life || attrs.vie || ""));
    const cc = await JournalEntry.create({
      name: j.name,
      img: j.img,
      folder: j.folder?.id ?? null,
      ownership: foundry.utils.deepClone(j.ownership || { default: 0 }),
      // les pages texte sont conservées : l'app web (et la recherche) lisent le contenu là
      pages: j.pages.filter((p) => p.type === "text").map((p) => ({
        name: p.name, type: "text", text: { content: p.text?.content || "", format: 1 },
      })),
      flags: {
        [CC]: {
          type,
          data: { description: page?.text?.content || j.pages.find((p) => p.text?.content)?.text?.content || "" },
          ...(j.flags?.[MEJ]?.img || page?.src ? { image: j.flags?.[MEJ]?.img || page?.src } : {}),
        },
        holocron: {
          legacyId: j.id, // les ancres web #/journal/<ancien id> restent valides
          ...(statut ? { statut } : {}),
          ...(mort ? { mort: true } : {}),
          ...(Object.keys(attrs).length ? { attrs } : {}),
        },
      },
    });
    mapping.set(j.id, cc.uuid);
    made.push({ from: j, to: cc, rels: Object.values(mf.relationships || {}) });
  }

  // 2e passe : relations MEJ → liens CC (cibles converties, ou déjà des fiches CC)
  const arch = game.folders.find((f) => f.type === "JournalEntry" && f.name === "🗄️ Archive MEJ")
    || await Folder.create({ name: "🗄️ Archive MEJ", type: "JournalEntry" });
  for (const m of made) {
    const links = (m.rels || [])
      .map((r) => mapping.get(r?.id) || (game.journal.get(r?.id)?.flags?.[CC]?.type ? `JournalEntry.${r.id}` : null))
      .filter(Boolean);
    if (links.length) await m.to.update({ [`flags.${CC}.data.associates`]: links });
    await m.from.update({ folder: arch.id, [`flags.${MOD}.ccConverted`]: true });
  }
  if (made.length) ui.notifications.info(t("setup.ccConverted", { n: made.length }));
  return { converted: made.length };
}
