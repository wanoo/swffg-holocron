// transform/combat-scan.mjs — MOULINETTE « combats en texte → bibliothèque ».
//
// Les combats de la bible MJ vivent en TEXTE, dans des blocs ```combat que le
// front transforme en fiches interactives (`public/js/combat-tracker.js`,
// `.combat-sheet`). La bibliothèque `flags.holocron.encounters`, elle, est vide :
// les beats ⚔️ du storyboard n'ont donc rien à référencer.
//
// Ce module fait le pont, en LECTURE SEULE : il repère les blocs de combat dans
// le HTML des chapitres et en propose des rencontres. C'est une PROPOSITION —
// l'écriture n'a lieu qu'après validation du MJ (route d'import dédiée).
//
// PURE et sans I/O : même grammaire de bloc que le tracker du front, pour que la
// rencontre importée et la fiche affichée disent exactement la même chose.

const MAX_BLOCKS = 200;

/** Décodage des entités HTML rencontrées dans un <pre> Foundry. */
const unescapeHtml = (s) => String(s)
  .replace(/<br\s*\/?>/gi, '\n')
  .replace(/<[^>]+>/g, '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
  .replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&'); // en dernier : sinon &amp;lt; se décode deux fois

/**
 * Blocs de combat BRUTS d'un HTML de chapitre.
 * Reconnaît `<pre class="combat">`, `<pre><code class="language-combat">` et la
 * clôture markdown ```combat restée en texte (chapitres jamais rendus).
 * @returns {string[]} textes des blocs, dans l'ordre du document
 */
export function extractCombatBlocks(html) {
  const src = String(html || '');
  const out = [];
  const push = (raw) => { if (out.length < MAX_BLOCKS && String(raw).trim()) out.push(unescapeHtml(raw).trim()); };

  // <pre …class="… combat …"> … </pre>  (le rendu Foundry/marked du projet)
  const preRe = /<pre\b[^>]*class="[^"]*\bcombat\b[^"]*"[^>]*>([\s\S]*?)<\/pre>/gi;
  for (let m = preRe.exec(src); m; m = preRe.exec(src)) push(m[1]);
  // <pre><code class="language-combat"> … </code></pre>
  const codeRe = /<code\b[^>]*class="[^"]*\b(?:language-)?combat\b[^"]*"[^>]*>([\s\S]*?)<\/code>/gi;
  for (let m = codeRe.exec(src); m; m = codeRe.exec(src)) push(m[1]);
  // ```combat … ``` (texte brut)
  const fenceRe = /```\s*combat\s*\n([\s\S]*?)```/gi;
  for (let m = fenceRe.exec(src); m; m = fenceRe.exec(src)) push(m[1]);
  return out;
}

/**
 * Grammaire d'un bloc ```combat — MIROIR de `parseSpec` (combat-tracker.js) :
 *   id: / title: / map: / note:      → méta
 *   == Nom du groupe ==              → groupe
 *   Nom | ×N | W24 S23 | enc | attaque | note-clé
 * @returns {{id, title, map, note, groups: Array<{name, rows: Array}>}}
 */
export function parseCombatBlock(text) {
  const meta = { id: '', title: '', map: '', note: '', groups: [] };
  let group = null;
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const kv = /^(id|title|map|note)\s*:\s*(.*)$/i.exec(line);
    if (kv) { meta[kv[1].toLowerCase()] = kv[2].trim(); continue; }
    const gh = /^==\s*(.+?)\s*==$/.exec(line);
    if (gh) { group = { name: gh[1], rows: [] }; meta.groups.push(group); continue; }
    const parts = line.split('|').map((s) => s.trim());
    if (parts.length < 2) continue; // pas une ligne de combattant
    if (!group) { group = { name: '', rows: [] }; meta.groups.push(group); }
    const [name, count = '', thr = '', soak = '', attack = '', key = ''] = parts;
    if (!name) continue;
    const w = /W\s*(\d+)/i.exec(thr);
    const s = /S\s*(\d+)/i.exec(thr);
    const n = /(\d+)/.exec(count);
    group.rows.push({
      name: name.slice(0, 80),
      // la bibliothèque stocke un NOMBRE (1..12) là où le bloc texte tolère « ×3 »
      count: Math.max(1, Math.min(12, n ? +n[1] : 1)),
      w: w ? +w[1] : 0,
      s: s ? +s[1] : 0,
      soak: soak.slice(0, 40),
      attack: attack.slice(0, 120),
      key: key.slice(0, 120),
    });
  }
  meta.groups = meta.groups.filter((g) => g.rows.length);
  return meta;
}

// id stable et lisible dérivé du contenu : re-scanner deux fois propose deux
// fois LE MÊME id, donc l'import est idempotent (pas de doublon en bibliothèque).
const slug = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
function djb2(s) {
  let h = 5381;
  for (let i = 0; i < String(s).length; i++) h = ((h << 5) + h + String(s).charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/**
 * PROPOSITIONS de rencontres tirées des chapitres de bible. Aucune écriture :
 * l'appelant affiche l'aperçu, le MJ coche, puis seule la sélection est importée.
 *
 * @param {Array<{id, name, html}>} chapters chapitres de bible (writer.gmList/gmGet)
 * @param {Array<{id, title}>} existing bibliothèque actuelle (marquage des doublons)
 * @returns {Array<{ chapterId, chapterName, index, exists, reason?, encounter }>}
 */
export function scanChapters(chapters, existing = []) {
  const byId = new Map((existing || []).map((e) => [String(e.id), e]));
  const byTitle = new Map((existing || []).map((e) => [slug(e.title || ''), e]));
  const out = [];
  const seen = new Set();
  for (const chap of (chapters || [])) {
    const blocks = extractCombatBlocks(chap?.html);
    blocks.forEach((raw, index) => {
      const spec = parseCombatBlock(raw);
      const total = spec.groups.reduce((t, g) => t + g.rows.length, 0);
      if (!total) return; // bloc sans combattant : rien à importer
      const title = spec.title || `Combat — ${chap.name || 'chapitre'}${blocks.length > 1 ? ` (${index + 1})` : ''}`;
      const id = spec.id ? slug(spec.id) : `enc-${slug(title).slice(0, 24) || 'combat'}-${djb2(raw)}`;
      if (seen.has(id)) return; // le même bloc copié dans deux chapitres (PNJ ×4, combats ×3)
      seen.add(id);
      const hit = byId.get(id) || byTitle.get(slug(title));
      out.push({
        chapterId: chap.id,
        chapterName: chap.name || '',
        index,
        exists: Boolean(hit),
        ...(hit ? { reason: byId.has(id) ? 'même id' : 'même titre' } : {}),
        encounter: {
          id,
          title: title.slice(0, 120),
          map: (spec.map || '').slice(0, 200),
          note: (spec.note || '').slice(0, 500),
          groups: spec.groups.slice(0, 10).map((g) => ({ name: g.name.slice(0, 80), rows: g.rows.slice(0, 20) })),
        },
      });
    });
  }
  return out;
}
