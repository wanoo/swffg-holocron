// transform/act-check.mjs — CHECKLIST « PRÊT-À-JOUER », DÉRIVÉE.
//
// Remplace la checklist MANUELLE de `gm:cfg:session` : au lieu de cocher des
// cases écrites à la main, on DÉDUIT les manques de l'état réel du storyboard,
// de la bibliothèque de rencontres et des fiches MJ. Une ligne = un manque
// concret, avec le geste qui le répare.
//
// PURE et sans I/O : la route `GET /api/gm/act-check/<actId>` se contente de
// rassembler les entrées et de rendre le résultat.

const KIND_LABEL = { scene: '🎭 scène', combat: '⚔️ combat', note: '🗒️ note', handout: '🖼️ handout' };

const SEVERITY_ORDER = { error: 0, warn: 1, info: 2 };

const idOf = (uuid) => {
  const s = String(uuid || '');
  const m = /([A-Za-z]{1,32})\.([A-Za-z0-9]{16})/.exec(s);
  return m ? m[2] : (/^[A-Za-z0-9]{16}$/.test(s) ? s : '');
};
const typeOf = (uuid) => {
  const m = /^([A-Za-z]{1,32})\./.exec(String(uuid || ''));
  return m ? m[1] : 'JournalEntry';
};

const label = (beat, i) => beat.title || `${KIND_LABEL[beat.kind] || 'beat'} sans titre (n°${i + 1})`;

/**
 * @param {object} p
 * @param {{id, name, storyboard?, actSummary?}} p.act        l'acte examiné (nœud du catalogue)
 * @param {Array<{id, title}>} p.encounters                   bibliothèque de rencontres
 * @param {Array<{id, name}>} p.sequences                     séquences de handouts
 * @param {Iterable<string>} p.knownIds                       ids d'entités existant encore dans Foundry
 * @param {Map<string,string>|object} p.names                 id → nom (messages lisibles)
 * @param {Array<{id, title, state}>} p.secrets               fiches MJ « mj:secret »
 * @param {Iterable<string>} p.referencedIds                  ids référencés par les beats de TOUS les actes
 * @returns {Array<{severity, code, beatId?, ref?, message, fix}>}
 */
export function checkAct({
  act, encounters = [], sequences = [], knownIds = [],
  names = {}, secrets = [], referencedIds = [],
} = {}) {
  const issues = [];
  if (!act || !act.id) return issues;

  const known = knownIds instanceof Set ? knownIds : new Set(knownIds || []);
  const referenced = referencedIds instanceof Set ? referencedIds : new Set(referencedIds || []);
  const nameOf = (id) => (names instanceof Map ? names.get(id) : names?.[id]) || id;
  const encIds = new Set((encounters || []).map((e) => String(e.id)));
  const seqIds = new Set((sequences || []).map((s) => String(s.id)));
  const beats = act.storyboard?.beats || [];

  const add = (severity, code, message, fix, extra = {}) =>
    issues.push({ severity, code, message, fix, ...extra });

  if (!beats.length) {
    add('warn', 'act-empty',
      `L’acte « ${act.name || act.id} » n’a aucun beat.`,
      'Ouvre le storyboard et ajoute au moins une scène — ou colle ton scénario (saisie rapide).');
    return issues;
  }

  let handouts = 0;
  beats.forEach((b, i) => {
    const beatId = b.id;
    const who = label(b, i);

    // 1. beat sans lieu ni PNJ attaché : rien à ouvrir en séance
    if (!b.uuids?.length && (b.kind === 'scene' || b.kind === 'combat')) {
      add('warn', 'beat-no-entity',
        `« ${who} » n’a ni lieu ni PNJ attaché.`,
        'Rattache la fiche du lieu et celles des PNJ présents — c’est ce que « ▶ Jouer ce beat » ouvrira.',
        { beatId });
    }

    // 2. beat ⚔️ sans rencontre (ou pointant une rencontre disparue)
    if (b.kind === 'combat') {
      if (!b.encounterId) {
        add('error', 'combat-no-encounter',
          `Le combat « ${who} » n’a aucune rencontre liée.`,
          'Crée la rencontre (⚔️ Rencontres) ou importe-la depuis la bible, puis lie-la au beat.',
          { beatId });
      } else if (!encIds.has(String(b.encounterId))) {
        add('error', 'combat-encounter-missing',
          `Le combat « ${who} » pointe une rencontre absente de la bibliothèque (${b.encounterId}).`,
          'Rouvre le beat et choisis une rencontre existante.',
          { beatId, ref: b.encounterId });
      }
    }

    // 3. beat 🖼️ sans rien à montrer
    if (b.kind === 'handout') {
      if (b.handout || b.sequenceId) handouts++;
      else {
        add('warn', 'handout-empty',
          `Le handout « ${who} » ne contient ni image, ni texte, ni séquence.`,
          'Ajoute l’image ou le texte à projeter, ou rattache une séquence.',
          { beatId });
      }
    } else if (b.handout || b.sequenceId) handouts++;

    // 4. séquence disparue
    if (b.sequenceId && !seqIds.has(String(b.sequenceId))) {
      add('error', 'sequence-missing',
        `« ${who} » pointe une séquence supprimée (${b.sequenceId}).`,
        'Rouvre le beat et choisis une séquence existante, ou détache-la.',
        { beatId, ref: b.sequenceId });
    }

    // 5. référence morte : fiche/journal effacé depuis Foundry
    for (const uuid of (b.uuids || [])) {
      const id = idOf(uuid);
      if (!id || known.has(id)) continue;
      add('error', 'dead-ref',
        `« ${who} » référence une entité supprimée (${typeOf(uuid)}.${id}).`,
        'Retire la référence du beat, ou recrée la fiche dans Foundry.',
        { beatId, ref: id });
    }
  });

  // 6. acte sans aucun handout : rien à montrer aux joueurs de toute la séance
  if (!handouts) {
    add('info', 'act-no-handout',
      `Aucun handout dans l’acte « ${act.name || act.id} ».`,
      'Prépare au moins une image ou un encart à projeter (📡) — c’est ce qui ancre une scène.');
  }

  // 7. secrets semés nulle part : la matière du « ne pas oublier »
  for (const s of (secrets || [])) {
    if (!s?.id || s.state === 'seme') continue;
    if (referenced.has(s.id)) continue;
    add('warn', 'secret-unsown',
      `Le secret « ${s.title || nameOf(s.id)} » n’est semé dans aucun beat.`,
      'Rattache-le au beat qui en pose l’indice, ou marque-le semé une fois révélé.',
      { ref: s.id });
  }

  issues.sort((a, b) => (SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
    || String(a.code).localeCompare(b.code));
  return issues;
}
