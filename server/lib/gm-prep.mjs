// gm-prep.mjs — SERVICE « PRÉPARER » : ce qui alimente le storyboard avant la
// séance. Trois briques, toutes MJ-only et toutes adossées à des fonctions
// PURES testées (`transform/act-check.mjs`, `transform/combat-scan.mjs`,
// `transform/registry.mjs`) :
//
//   1. checklist prêt-à-jouer d'un acte, DÉRIVÉE de l'état réel ;
//   2. import des combats en TEXTE de la bible vers la bibliothèque de
//      rencontres — en deux temps : APERÇU (aucune écriture) puis import de la
//      seule sélection du MJ ;
//   3. régénération du registre des personnages (`config.registry`), sans quoi
//      les backrefs « Mentionné dans » restent muettes.
import { buildCatalog } from './board.mjs';
import { checkAct } from './transform/act-check.mjs';
import { scanChapters } from './transform/combat-scan.mjs';
import { buildRegistry } from './transform/registry.mjs';
import { ccType } from './transform/tags.mjs';

export function createPrepService({ store, config, writer, encounters, gmSheets }) {
  const idx = () => store.get('journalsIndex') || [];

  const catalog = () => buildCatalog({
    config: config(),
    folders: store.get('folders'),
    journalsIndex: idx(),
    getJournal: (id) => store.get(`journal:${id}`),
  });

  /* ------------------------------------------------- 1. checklist d'acte --- */
  /**
   * @param {string} actId id Foundry du journal d'acte
   * @returns {Promise<{ act, issues }>} 404 si l'acte n'existe pas
   */
  async function actCheck(actId) {
    const cat = catalog();
    const act = cat.nodes.find((n) => n.id === actId && n.type === 'acte');
    if (!act) throw Object.assign(new Error('acte inexistant'), { code: 404 });

    // séquences + rencontres : ce que les beats peuvent légitimement pointer
    const boardEntry = idx().find((j) => j.name === config().journals.board);
    const sequences = boardEntry?.flags?.holocron?.sequences || [];
    const lib = await encounters.list();

    // tout ce que Foundry connaît encore (détection des références mortes)
    const knownIds = new Set(idx().map((j) => j._id));

    // secrets + tout ce que les beats de TOUS les actes référencent (un secret
    // peut être semé dans un acte antérieur : le chercher acte par acte mentirait)
    const secrets = (gmSheets?.list('secret') || []).map((s) => ({ id: s.id, title: s.title, state: s.state }));
    const referencedIds = new Set();
    for (const n of cat.nodes) {
      for (const b of (n.storyboard?.beats || [])) {
        for (const u of (b.uuids || [])) {
          const m = /([A-Za-z0-9]{16})$/.exec(String(u));
          if (m) referencedIds.add(m[1]);
        }
      }
    }

    const names = Object.fromEntries(idx().map((j) => [j._id, j.name]));
    return {
      act: { id: act.id, name: act.name, beats: act.storyboard?.beats?.length || 0 },
      issues: checkAct({ act, encounters: lib, sequences, knownIds, names, secrets, referencedIds }),
    };
  }

  /* ------------------------------------- 2. combats de la bible → rencontres */
  /** APERÇU seul : parcourt les chapitres, ne touche à RIEN. */
  async function scanEncounters() {
    const chapters = writer.gmList().map((c) => {
      const doc = writer.gmGet(c.id);
      return { id: c.id, name: c.name, html: doc?.html || '' };
    });
    const found = scanChapters(chapters, await encounters.list());
    return {
      chapters: chapters.length,
      found,
      news: found.filter((f) => !f.exists).length,
    };
  }

  /**
   * Import de la SÉLECTION du MJ. `ids` = ids de propositions (`encounter.id`)
   * issues d'un scan ; tout ce qui n'est pas coché est ignoré. Ré-importer une
   * proposition déjà en bibliothèque la met à jour (même id) — jamais de doublon.
   */
  async function importEncounters(ids, updatedBy) {
    const wanted = new Set((Array.isArray(ids) ? ids : []).map(String));
    if (!wanted.size) return { imported: [], skipped: 0 };
    const { found } = await scanEncounters();
    const imported = [];
    for (const f of found) {
      if (!wanted.has(f.encounter.id)) continue;
      imported.push(await encounters.save(f.encounter, updatedBy || 'import bible'));
    }
    return { imported, skipped: wanted.size - imported.length };
  }

  /* --------------------------------------------- 3. registre des personnages */
  /**
   * Aperçu ou écriture du registre régénéré (fusion non destructive).
   *
   * DEUX SOURCES pour les PNJ, parce que l'app les sert par deux chemins :
   *   · les ACTEURS du dossier PNJ du monde (`/api/content/npcs`) — ce sont eux
   *     que `linkifyPnj` sait résoudre pour rendre une mention cliquable ;
   *   · les FICHES Campaign Codex `npc` — ce sont elles que porte la couche
   *     narrative (dossiers MJ, backrefs affichées sur la fiche).
   * Les deux cohabitent sans se gêner : une entrée dont la cible n'existe pas
   * dans l'index du front est simplement ignorée par le linkifieur.
   */
  async function rebuildRegistry({ dryRun = false } = {}) {
    const cc = config();
    const actors = store.get('actors') || [];
    const folders = store.get('folders') || [];
    const folderId = (name) => folders.find((f) => f.type === 'Actor' && f.name === name)?._id;
    const pcFolderId = folderId(cc.pcFolder);
    const npcFolderId = folderId(cc.npcsWorldFolder);
    const light = (a) => ({ _id: a._id, name: a.name });

    const pcs = actors
      .filter((a) => (pcFolderId ? a.folder === pcFolderId : a.type === 'character') && a.type !== 'vehicle')
      .map(light);
    const npcActors = npcFolderId ? actors.filter((a) => a.folder === npcFolderId).map(light) : [];
    const ccNpcs = idx()
      .filter((j) => ccType(j) === 'npc' && !j.flags?.['swffg-astronavigation'])
      .map((j) => ({ _id: j.flags?.holocron?.legacyId || j._id, name: j.name }));
    const npcs = [...npcActors, ...ccNpcs];

    const out = buildRegistry({ pcs, npcs, existing: cc.registry });
    if (!dryRun) await writer.registrySave(out.registry);
    return {
      ...out, dryRun: Boolean(dryRun),
      sources: { pcs: pcs.length, npcActors: npcActors.length, ccNpcs: ccNpcs.length },
    };
  }

  return { actCheck, scanEncounters, importEncounters, rebuildRegistry };
}
