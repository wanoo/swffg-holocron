// transform/scenario.mjs — SAISIE RAPIDE D'UN SCÉNARIO.
//
// Le MJ colle le texte d'un scénario (livre, notes, export) ; on lui propose un
// découpage en BEATS de storyboard qu'il retouche. Objectif : 5 minutes au lieu
// de 30 — donc on se trompe volontiers, mais on ne perd JAMAIS de texte (tout
// paragraphe atterrit dans un beat).
//
// PURE et sans I/O : `parseScenarioToBeats(texte)` → { beats: [{ kind, title,
// note }] }, prêt à être passé à `sanitizeStoryboard` (board.mjs) qui posera les
// ids et les bornes définitives.
//
// Découpage : un TITRE ouvre un beat (titre markdown `#`, ligne en MAJUSCULES,
// ligne « Scène 3 : … », ligne soulignée `===`/`---`) ; les paragraphes qui
// suivent forment sa note. Un paragraphe sans titre au-dessus devient un beat à
// part entière, titré par sa première phrase.

import { BEAT_KINDS } from '../board.mjs';

const MAX_BEATS = 60;
const TITLE_MAX = 120;
const NOTE_MAX = 2000;

// Deviné à partir du TITRE d'abord, de la note ensuite : le titre est ce que le
// MJ a écrit exprès, la note n'est qu'un indice.
const KIND_HINTS = [
  ['combat', /\b(combat|combats|embuscade|embuscades|attaque|attaques|assaut|affrontement|bagarre|fusillade|duel|poursuite arm|bataille|escarmouche|abordage)\b/i],
  ['handout', /\b(lis[ez]?\s+(?:ceci\s+)?[àa]\s+voix\s+haute|[àa]\s+lire\s+[àa]\s+voix\s+haute|voix\s+haute|handout|aide\s+de\s+jeu|document|documents|image|illustration|plan\s+du|photo|projeter|projection|montre[rz]?\s+(?:aux?\s+)?joueurs?|encart)\b/i],
  ['note', /\b(note\s+(?:du\s+)?mj|notes?\s+mj|rappel|rappels|aide-m[ée]moire|m[ée]mo|pense-b[êe]te|conseil\s+au\s+mj|si\s+les\s+joueurs)\b/i],
];

/** Type de beat deviné pour un couple titre/note. Repli : 🎭 scène. */
export function guessKind(title, note = '') {
  for (const [kind, re] of KIND_HINTS) if (re.test(title)) return kind;
  for (const [kind, re] of KIND_HINTS) if (re.test(note)) return kind;
  return 'scene';
}

// Une ligne est-elle un TITRE ? (renvoie le titre nettoyé, sinon null)
const MD_TITLE = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/;
const NUM_TITLE = /^\s*(?:sc[èe]ne|acte|chapitre|partie|s[ée]quence|[ée]tape|beat)\s*\d*\s*[:.)–—-]?\s*(.*)$/i;
const BULLET = /^\s*(?:[-*•>]|\d+[.)])\s+/;

function titleOf(line) {
  const md = MD_TITLE.exec(line);
  if (md) return md[2].trim() || null;
  const raw = line.trim();
  if (!raw || raw.length > TITLE_MAX) return null;
  if (BULLET.test(line)) return null; // une puce est du contenu, pas un titre
  // ligne « tout en majuscules » (au moins deux lettres capitales, aucune minuscule)
  const letters = raw.replace(/[^\p{L}]/gu, '');
  if (letters.length >= 2 && letters === letters.toUpperCase() && /\p{L}/u.test(letters)) {
    return raw.replace(/\s*[:：]\s*$/, '').trim() || null;
  }
  // « Scène 3 : L'entrepôt » / « Acte II — Le piège »
  const num = NUM_TITLE.exec(raw);
  if (num && raw.length <= 90 && !/[.!?]\s*$/.test(raw)) {
    return (num[1] ? raw : raw).replace(/\s*[:：]\s*$/, '').trim() || null;
  }
  return null;
}

// Titre de repli d'un paragraphe orphelin : sa première phrase, bornée.
function titleFromText(text) {
  const flat = text.replace(/\s+/g, ' ').trim();
  const stop = flat.search(/[.!?…]\s/);
  const head = (stop > 0 ? flat.slice(0, stop) : flat).trim();
  return (head.length > 80 ? head.slice(0, 79).replace(/\s+\S*$/, '') + '…' : head) || 'Scène';
}

const clean = (s, n) => String(s == null ? '' : s).replace(/\s+$/gm, '').trim().slice(0, n);

/**
 * Découpe un texte collé en beats PROPOSÉS.
 * @param {string} text
 * @returns {{ beats: Array<{ kind: string, title: string, note: string }> }}
 */
export function parseScenarioToBeats(text) {
  const src = String(text == null ? '' : text).replace(/\r\n?/g, '\n');
  if (!src.trim()) return { beats: [] };

  const lines = src.split('\n');
  // Ligne soulignée (« Titre » puis « ==== ») : on la promeut en titre markdown.
  for (let i = 0; i < lines.length - 1; i++) {
    if (lines[i].trim() && /^\s*(={3,}|-{3,})\s*$/.test(lines[i + 1]) && lines[i].trim().length <= TITLE_MAX) {
      lines[i] = '# ' + lines[i].trim();
      lines[i + 1] = '';
    }
  }

  const blocks = []; // { title, lines: [] }
  let cur = null;
  for (const line of lines) {
    const t = titleOf(line);
    if (t) {
      cur = { title: t, lines: [] };
      blocks.push(cur);
      continue;
    }
    if (!line.trim()) {
      // ligne vide : ferme un bloc SANS titre (paragraphe autonome), garde les autres
      if (cur && !cur.title) cur = null;
      else if (cur) cur.lines.push('');
      continue;
    }
    if (!cur) { cur = { title: '', lines: [] }; blocks.push(cur); }
    cur.lines.push(line);
  }

  const beats = [];
  for (const b of blocks) {
    const note = clean(b.lines.join('\n'), NOTE_MAX);
    const title = clean(b.title || titleFromText(note), TITLE_MAX);
    if (!title && !note) continue;
    const kind = guessKind(title, note);
    beats.push({ kind: BEAT_KINDS.includes(kind) ? kind : 'scene', title: title || 'Scène', note });
    if (beats.length >= MAX_BEATS) break;
  }
  return { beats };
}
