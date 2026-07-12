// content.mjs — vues de contenu servies depuis le SyncStore (jamais de MCP dans
// le chemin de requête). Formes = celles des anciens JSON statiques du front.
import { transformCharacter, transformAdversary } from './transform/actors.mjs';
import { buildJournalsView } from './transform/journals.mjs';
import { canSee, isGM } from './auth.mjs';

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
    return {
      title: cc.meta.title,
      description: cc.meta.description,
      system: cc.meta.system,
      counts: { journals: journals.length, pcs: pcs.length },
      pcs: pcs.map((p) => ({ id: p._id, name: p.name })),
    };
  }

  function pcsRaw() {
    const cc = config();
    const fid = actorFolderId(cc.pcFolder);
    const actors = store.get('actors') || [];
    return fid ? actors.filter((a) => a.folder === fid) : actors.filter((a) => a.type === 'character');
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

  function versions() {
    const cc = config();
    return {
      manifest: store.version('config') * 31 + store.version('actors') + store.version('journalsIndex'),
      journals: store.version('journalsIndex') * 31 + store.version('folders') + store.version('config'),
      pcs: store.version('actors') * 31 + store.version('folders'),
      npcs: store.version('actors') * 31 + store.version('folders') + 7,
      adversaries: store.version(`pack:${cc.packs.adversaries}`),
    };
  }

  return { manifest, journalsView, pcsView, npcsView, adversariesView, versions };
}
