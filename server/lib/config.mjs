// config.mjs — configuration du service : environnement + journal Foundry
// « ⚙️ Holocron Config » (SSOT de la config de campagne, collection `config`
// du SyncStore). Une instance SANS journal de config fonctionne avec des
// défauts vides (contenu = dossiers Foundry visibles joueurs).

export function envConfig(env = process.env) {
  return {
    port: Number(env.PORT) || 8080,
    dataDir: env.HOLOCRON_DATA_DIR || './data',
    sessionSecret: env.SESSION_SECRET || '',
    foundryBaseUrl: (env.FOUNDRY_BASE_URL || '').replace(/\/$/, ''),
    foundryWorld: env.FOUNDRY_WORLD || 'star-wars', // dossier worlds/<world>/ pour résoudre les assets relatifs
    foundryMcpUrl: env.FOUNDRY_MCP_URL || '',
    foundryCredentialsJson: env.FOUNDRY_CREDENTIALS_JSON || '',
    gmKey: env.GM_KEY || '',
    playerKey: env.PLAYER_KEY || '',
    syncIntervalS: Number(env.SYNC_INTERVAL_S) || 300,
    configJournalName: env.CONFIG_JOURNAL_NAME || '⚙️ Holocron Config',
    corsOrigin: env.CORS_ORIGIN || '*',
    publicUrl: env.PUBLIC_URL || '',
  };
}

// Défauts de la config de campagne (fusionnés sous le flag Foundry).
export const CAMPAIGN_DEFAULTS = {
  v: 1,
  meta: { title: 'Holocron', description: '', system: 'starwarsffg' },
  categories: [],
  gmBibleFolder: '',
  pcFolder: '👥 Personnages joueurs',
  npcsWorldFolder: '',
  packs: { adversaries: '', npcsExtra: null, rules: '', rulesNamePrefix: '^\\d+\\s*·\\s*', translations: [] },
  journals: {
    ship: '🚀 Vaisseau du groupe', codex: '🖥️ Codex du groupe',
    holonet: '📡 HoloNet — Actualités',
    gmNotes: '🗒️ Notes MJ (Holocron)', encounters: '⚔️ Bibliothèque de rencontres',
    dossiers: '🗂️ Dossiers MJ (Holocron)',
    shipNotes: '', // page « notes du vaisseau » : "<journalId>:<pageId>" (vue #/vaisseau)
  },
  registry: [],
  advLinks: { externalUrl: '', map: [] },
  campaignPlanets: [],
  cfg: {},
};

export function campaignConfig(store) {
  const raw = store.get('config') || {};
  const cc = {
    ...CAMPAIGN_DEFAULTS,
    ...raw,
    packs: { ...CAMPAIGN_DEFAULTS.packs, ...(raw.packs || {}) },
    journals: { ...CAMPAIGN_DEFAULTS.journals, ...(raw.journals || {}) },
    meta: { ...CAMPAIGN_DEFAULTS.meta, ...(raw.meta || {}) },
  };
  // shipNotes : uuid Foundry copié tel quel (« JournalEntry.X.JournalEntryPage.Y ») → « X:Y »
  const m = /JournalEntry\.([A-Za-z0-9]{16})\.JournalEntryPage\.([A-Za-z0-9]{16})/.exec(cc.journals.shipNotes || '');
  if (m) cc.journals.shipNotes = `${m[1]}:${m[2]}`;
  return cc;
}

// Sous-ensemble PUBLIC-SAFE exposé au front (jamais la bible ni les cfg MJ).
export function publicConfig(cc, foundryBaseUrl = '') {
  return {
    foundryBaseUrl,
    meta: cc.meta,
    registry: cc.registry,
    advLinks: cc.advLinks,
    campaignPlanets: cc.campaignPlanets,
    editableKinds: (cc.categories || []).filter((c) => c.editable).map((c) => c.kind),
  };
}
