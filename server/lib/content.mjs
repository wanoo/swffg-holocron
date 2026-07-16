// content.mjs — vues de contenu servies depuis le SyncStore (jamais de MCP dans
// le chemin de requête). Formes = celles des anciens JSON statiques du front.
import { transformCharacter, transformAdversary, transformVehicle } from './transform/actors.mjs';
import { buildJournalsView, buildTimelineView } from './transform/journals.mjs';
import { canSee, isGM } from './auth.mjs';

// Version de SCHÉMA : à incrémenter dès que la FORME des vues change (transform), pour
// invalider les ETag/caches clients même si les données Foundry n'ont pas bougé.
const SCHEMA_VERSION = 10;

export function createContentService({ store, config }) {
  const actorFolderId = (name) => {
    if (!name) return null;
    const folders = store.get('folders') || [];
    return folders.find((f) => f.type === 'Actor' && f.name === name)?._id || null;
  };

  function manifest() {
    const cc = config();
    const journals = store.get('journalsIndex') || [];
    const pcs = pcsRaw();
    // comptes PNJ/bestiaire — calculés sans transform, pour la sidebar (le contenu
    // lui-même reste lazy et gaté MJ). Évite les compteurs à 0 avant le lazy-load.
    const actors = store.get('actors') || [];
    const npcFid = actorFolderId(cc.npcsWorldFolder);
    const npcCount = npcFid ? actors.filter((a) => a.folder === npcFid).length : 0;
    const advCount = (store.get(`pack:${cc.packs.adversaries}`) || []).length;
    return {
      title: cc.meta.title,
      description: cc.meta.description,
      system: cc.meta.system,
      counts: { journals: journals.length, pcs: pcs.length, npcs: npcCount, adversaries: advCount },
      pcs: pcs.map((p) => ({ id: p._id, name: p.name })),
    };
  }

  function pcsRaw() {
    const cc = config();
    const fid = actorFolderId(cc.pcFolder);
    const actors = store.get('actors') || [];
    // le vaisseau du groupe vit dans le dossier PJ mais a sa propre vue (vehicle)
    const list = fid ? actors.filter((a) => a.folder === fid) : actors.filter((a) => a.type === 'character');
    return list.filter((a) => a.type !== 'vehicle');
  }

  // Le vaisseau du groupe : premier actor « vehicle » du dossier PJ (repli : du monde).
  function vehicleView() {
    const cc = config();
    const fid = actorFolderId(cc.pcFolder);
    const actors = store.get('actors') || [];
    const v = actors.find((a) => a.type === 'vehicle' && (!fid || a.folder === fid))
      || actors.find((a) => a.type === 'vehicle');
    return v ? transformVehicle(v) : null;
  }

  function journalsView(session) {
    const cc = config();
    const rulesPackId = cc.packs.rules;
    return buildJournalsView({
      config: cc,
      folders: store.get('folders'),
      journalsIndex: store.get('journalsIndex'),
      getJournal: (id) => store.get(`journal:${id}`),
      rulesPack: rulesPackId ? store.get(`pack:${rulesPackId}`) : null,
      visibleFilter: (entry) => canSee(session, entry),
      gm: isGM(session),
    });
  }

  const pcsView = () => pcsRaw().map(transformCharacter);

  // Frise chronologique : fiches MEJ « event » des dossiers de catégories kind
  // « timeline » — datées en BBY/ABY (attribut `date`), classées canon/campagne
  // par l'attribut `position`.
  function timelineView(session) {
    return buildTimelineView({
      config: config(),
      folders: store.get('folders'),
      journalsIndex: store.get('journalsIndex'),
      getJournal: (id) => store.get(`journal:${id}`),
      calendarEvents: store.get('calendarEvents'),
      visibleFilter: (entry) => canSee(session, entry),
      gm: isGM(session),
    });
  }

  // Aide de dépense FFG (avantages/menaces/triomphes/désespoirs/succès par
  // compétence) : collection dédiée « diceHelper » du SyncStore (journal Foundry
  // dice_helper, pullé par requête ciblée + déjà parsé/re-clé). Indépendant du
  // gros journalsIndex (qui peut être tronqué et faire sauter ce journal).
  const diceHelper = () => store.get('diceHelper') || {};
  const diceHelperVersion = () => store.version('diceHelper');

  function npcsView() {
    const cc = config();
    const fid = actorFolderId(cc.npcsWorldFolder);
    const actors = store.get('actors') || [];
    return (fid ? actors.filter((a) => a.folder === fid) : []).map(transformCharacter);
  }

  function adversariesView() {
    const cc = config();
    const packId = cc.packs.adversaries;
    if (!packId) return [];
    return (store.get(`pack:${packId}`) || []).map((d) => transformAdversary(d, packId));
  }

  // Graphe des quêtes (MJ) : fiches CC « quest » des dossiers synchronisés +
  // liens unlocks/dépendances (refs « <uuid>::<questId> » du Quest Graph) +
  // layout du widget questgraph s'il est posé quelque part.
  function questsView() {
    const refId = (v) => {
      const s = String(v || '').split('::')[0];
      const m = /JournalEntry\.([A-Za-z0-9]{16})/.exec(s);
      return m ? m[1] : (/^[A-Za-z0-9]{16}$/.test(s) ? s : null);
    };
    const quests = [];
    let layout = null;
    for (const entry of (store.get('journalsIndex') || [])) {
      const ccf = entry.flags?.['campaign-codex'];
      if (ccf?.type === 'quest') {
        const doc = store.get(`journal:${entry._id}`) || entry;
        const q = (doc.flags?.['campaign-codex']?.data?.quests || [])[0] || {};
        quests.push({
          id: entry._id,
          name: entry.name,
          status: q.failed ? 'failed' : q.completed ? 'completed' : q.inactive ? 'inactive' : 'active',
          pinned: Boolean(q.pinned),
          unlocks: (Array.isArray(q.unlocks) ? q.unlocks : []).map(refId).filter(Boolean),
          dependencies: (Array.isArray(q.dependencies) ? q.dependencies : []).map(refId).filter(Boolean),
        });
      }
      const wg = ccf?.data?.widgets?.questgraph;
      if (wg && !layout) layout = Object.values(wg)[0] || null;
    }
    return { quests, layout };
  }

  function versions() {
    const cc = config();
    const S = SCHEMA_VERSION * 1000; // décale toutes les versions quand le schéma change
    return {
      manifest: S + store.version('config') * 31 + store.version('actors') + store.version('journalsIndex') + store.version(`pack:${cc.packs.adversaries}`),
      journals: S + store.version('journalsIndex') * 31 + store.version('folders') + store.version('config'),
      pcs: S + store.version('actors') * 31 + store.version('folders'),
      vehicle: S + store.version('actors') * 31 + store.version('folders') + 3,
      npcs: S + store.version('actors') * 31 + store.version('folders') + 7,
      adversaries: S + store.version(`pack:${cc.packs.adversaries}`),
      timeline: S + store.version('journalsIndex') * 31 + store.version('calendarEvents') * 7 + store.version('folders') + store.version('config'),
      diceHelper: S + diceHelperVersion(),
    };
  }

  return { manifest, journalsView, pcsView, vehicleView, npcsView, adversariesView, timelineView, questsView, diceHelper, versions };
}
