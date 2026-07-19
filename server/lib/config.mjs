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

// --- Bloc `ui` : personnalisation CENTRALISÉE de l'app web (thème, emblème,
// titre, dashboard, visibilité des parties) — écrite par le MJ depuis l'app
// (PUT /api/gm/config/ui), lue par tous via /api/content/config. Sans ce bloc
// (mondes pas encore configurés), le front retombe sur le localStorage.
export const UI_THEMES = ['force-jedi', 'force-sith', 'age-of-rebellion', 'edge-of-the-empire'];
export const UI_DEFAULTS = {
  theme: '',            // '' = pas de thème de monde (choix libre par navigateur)
  themeLocked: false,   // true = thème imposé aux joueurs (le MJ garde la main)
  emblem: '',           // id d'emblème (public/img/emblems) pour tout le monde
  title: '',            // nom du monde affiché (sidebar/hero) ; '' = meta.title
  dashboard: {
    order: [],            // ordre des widgets de la home (vide = défaut)
    hidden: [],           // widgets masqués
    resumeJournalId: '',  // journal « Où en est-on ? » ('' = dernier acte auto)
    headerImage: '',      // bannière du héro (URL ou chemin d'asset Foundry)
    background: '',       // fond de page ('' = décor du thème)
    widgets: {},          // options PAR widget : { <widgetId>: { …options plates } }
  },
  partsHidden: [],      // parties de la sidebar masquées aux joueurs
};

const uiStr = (v, max) => (typeof v === 'string' ? v.slice(0, max) : undefined);
const uiStrList = (v, max = 60, n = 64) => (Array.isArray(v)
  ? v.filter((x) => typeof x === 'string' && x).map((x) => x.slice(0, max)).slice(0, n)
  : undefined);

// --- Options PAR widget (ui.dashboard.widgets) --------------------------------
// Objet plat borné par widget : { journals: { cats: [...], max: 6 }, … }.
// Le serveur ne connaît pas la sémantique de chaque widget (elle vit dans le
// registre du front) : il garantit seulement la FORME (clés propres, scalaires
// ou listes de chaînes, tailles bornées) — un monde reste sain quoi qu'envoie
// un client. Sémantique de patch : les options d'un widget présent dans le
// patch sont REMPLACÉES en entier (le panneau ⚙ envoie toujours tout son
// formulaire) ; `null` supprime l'entrée (retour aux défauts du widget).
const uiKey = (k) => String(k).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
const uiOptValue = (v) => {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return Math.max(0, Math.min(999, Math.trunc(v)));
  if (typeof v === 'string') return v.slice(0, 120);
  if (Array.isArray(v)) return uiStrList(v);
  return undefined; // objets imbriqués & co : ignorés
};
function uiWidgetOpts(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const out = {};
  for (const [k, val] of Object.entries(v).slice(0, 16)) {
    const key = uiKey(k);
    const clean = uiOptValue(val);
    if (key && clean !== undefined) out[key] = clean;
  }
  return out;
}
function uiWidgets(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  const out = {};
  for (const [id, opts] of Object.entries(v).slice(0, 24)) {
    const wid = uiKey(id);
    const clean = uiWidgetOpts(opts);
    if (wid && clean) out[wid] = clean;
  }
  return out;
}

// Fusion + assainissement du bloc ui : `base` (état courant ou défauts) mis à
// jour par `patch` (partiel — seules les clés PRÉSENTES sont touchées). Sert à
// la fois à normaliser la config lue de Foundry et à appliquer un PUT MJ.
export function mergeUiConfig(base, patch) {
  const b = base && typeof base === 'object' ? base : {};
  const cur = {
    ...UI_DEFAULTS,
    ...b,
    dashboard: {
      ...UI_DEFAULTS.dashboard,
      ...(b.dashboard && typeof b.dashboard === 'object' ? b.dashboard : {}),
      widgets: uiWidgets(b.dashboard?.widgets), // base re-normalisée (flag éditable dans Foundry)
    },
    partsHidden: uiStrList(b.partsHidden) ?? [],
  };
  if (!patch || typeof patch !== 'object') return cur;
  const out = { ...cur, dashboard: { ...cur.dashboard } };
  if ('theme' in patch) out.theme = UI_THEMES.includes(patch.theme) ? patch.theme : '';
  if ('themeLocked' in patch) out.themeLocked = Boolean(patch.themeLocked);
  if ('emblem' in patch) out.emblem = (uiStr(patch.emblem, 40) ?? '').replace(/[^a-z0-9-]/g, '');
  if ('title' in patch) out.title = (uiStr(patch.title, 80) ?? '').trim();
  if ('partsHidden' in patch) out.partsHidden = uiStrList(patch.partsHidden) ?? [];
  const d = patch.dashboard;
  if (d && typeof d === 'object') {
    if ('order' in d) out.dashboard.order = uiStrList(d.order, 40) ?? [];
    if ('hidden' in d) out.dashboard.hidden = uiStrList(d.hidden, 40) ?? [];
    if ('resumeJournalId' in d) out.dashboard.resumeJournalId = (uiStr(d.resumeJournalId, 40) ?? '').replace(/[^A-Za-z0-9_-]/g, '');
    if ('headerImage' in d) out.dashboard.headerImage = (uiStr(d.headerImage, 400) ?? '').trim();
    if ('background' in d) out.dashboard.background = (uiStr(d.background, 400) ?? '').trim();
    if ('widgets' in d && d.widgets && typeof d.widgets === 'object' && !Array.isArray(d.widgets)) {
      const w = { ...out.dashboard.widgets };
      for (const [id, opts] of Object.entries(d.widgets).slice(0, 24)) {
        const wid = uiKey(id);
        if (!wid) continue;
        if (opts === null) { delete w[wid]; continue; } // null = retour aux défauts du widget
        const clean = uiWidgetOpts(opts);
        if (clean !== undefined) w[wid] = clean; // remplacement ENTIER des options du widget
      }
      out.dashboard.widgets = Object.fromEntries(Object.entries(w).slice(0, 24));
    }
  }
  return out;
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
    board: '🗺️ Carte de campagne (Holocron)', // éditeur de campagne : flags.holocron.board + sequences
    // DOSSIER (pas un journal) d'accueil des fiches MJ Front/Secret/Prépa —
    // fiches Campaign Codex `tag` privées, déplaçables librement dans Foundry.
    mjSheets: '🔥 Fronts & secrets (MJ)',
    shipNotes: '', // page « notes du vaisseau » : "<journalId>:<pageId>" (vue #/vaisseau)
  },
  registry: [],
  advLinks: { externalUrl: '', map: [] },
  campaignPlanets: [],
  // calendrier galactique Mini Calendar (« Grande ReSynchronisation ») :
  // année calendrier N = (N − epochBBY) → BBY si négatif / ABY sinon. An 0 = 35 BBY.
  calendar: { epochBBY: 35 },
  ui: UI_DEFAULTS,
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
    calendar: { ...CAMPAIGN_DEFAULTS.calendar, ...(raw.calendar || {}) },
    ui: mergeUiConfig(raw.ui, null),
  };
  // shipNotes : uuid Foundry copié tel quel (« JournalEntry.X.JournalEntryPage.Y ») → « X:Y »
  const m = /JournalEntry\.([A-Za-z0-9]{16})\.JournalEntryPage\.([A-Za-z0-9]{16})/.exec(cc.journals.shipNotes || '');
  if (m) cc.journals.shipNotes = `${m[1]}:${m[2]}`;
  return cc;
}

// Sous-ensemble PUBLIC-SAFE exposé au front (jamais la bible ni les cfg MJ).
// `registry` (le registre des personnages) n'est servi qu'au MJ : il n'est lu
// que par les vues MJ (mentions cliquables des chapitres, écran de MJ) et,
// régénéré automatiquement, il listerait sinon TOUS les PNJ de la campagne —
// noms et ids compris — à n'importe quel visiteur anonyme.
export function publicConfig(cc, foundryBaseUrl = '', gm = false) {
  return {
    foundryBaseUrl,
    meta: cc.meta,
    ui: cc.ui, // personnalisation de monde (thème, emblème, titre, dashboard, parties)
    registry: gm ? cc.registry : [],
    advLinks: cc.advLinks,
    campaignPlanets: cc.campaignPlanets,
    editableKinds: (cc.categories || []).filter((c) => c.editable).map((c) => c.kind),
  };
}
