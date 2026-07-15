// gen_tables.mjs — génère les sources JSON du pack « 🎲 Tables critiques (FR) »
// (packs/_src_tables) : les 2 RollTables d100 attendues par l'outil MJ « critical »
// (réglages critTableCharacter / critTableVehicle). Plages et libellés FR extraits
// des pages « Blessures Critiques » / « Dégâts Critique » du pack règles ; effet
// court (aide-mémoire paraphrasé) par entrée. Usage : node gen_tables.mjs — ids stables.
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(root, "packs", "_src_tables");

const ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
function fid(seed) {
  const h = createHash("sha256").update(seed).digest();
  let s = "";
  for (let i = 0; i < 16; i++) s += ALPHA[h[i] % ALPHA.length];
  return s;
}

// Effets condensés (aide-mémoire, paraphrase FR) — clé = libellé de la table des règles.
const CHAR_EFFECTS = {
  "Petite entaille": "Subit 1 stress.",
  "Ralentissement": "Agit en dernier au prochain round.",
  "Choc": "Lâche l'objet qu'il tenait en main.",
  "Distraction": "Pas de manœuvre gratuite à son prochain tour.",
  "Déséquilibré": "Ajoute ■ (contrainte) à son prochain test.",
  "Blessure accablante": "Retourne un point de Destin (clair → obscur).",
  "Etourdissement": "Chancelant jusqu'à la fin de son prochain tour.",
  "Piqûre": "La difficulté de son prochain test augmente de 1.",
  "Renversement": "À terre, et subit 1 stress.",
  "Mal au crâne": "+1 difficulté aux tests d'Intelligence et de Ruse jusqu'à la fin de la rencontre.",
  "Blessure effroyable": "+1 difficulté aux tests de Présence et de Volonté jusqu'à la fin de la rencontre.",
  "Blessure lancinante": "+1 difficulté aux tests de Vigueur et d'Agilité jusqu'à la fin de la rencontre.",
  "Hébétement": "Désorienté jusqu'à la fin de la rencontre.",
  "Confusion": "Perd tous ses dés de Fortune ☐ jusqu'à la fin de la rencontre.",
  "Paralysé": "Perd sa manœuvre gratuite jusqu'à la fin de la rencontre.",
  "Aux abois": "Baisse sa garde : les attaques contre lui gagnent ☐ jusqu'à la fin de la rencontre.",
  "Hors d’haleine": "Ne peut plus subir volontairement de stress (ni y convertir) jusqu'à la fin de la rencontre.",
  "A mal": "+1 difficulté à TOUS ses tests jusqu'à la fin de la rencontre.",
  "Exténuation": "Subit 1 stress après chaque action tant que la blessure n'est pas soignée.",
  "Infirmité": "Un membre est estropié : +1 difficulté aux tests l'utilisant jusqu'à guérison.",
  "Mutilation": "Un membre est définitivement perdu (hors prothèse).",
  "Blessure épouvantable": "Réduit de 1 une caractéristique (aléatoire, 1d10) jusqu'à guérison.",
  "Invalidité": "Une seule manœuvre par tour jusqu'à guérison.",
  "Aveuglé": "Ne voit plus : +3 difficulté à la vision, +1 aux autres tests, jusqu'à guérison.",
  "Perte de connaissance": "Inconscient jusqu'à ce qu'on le ranime (soins ou fin de rencontre).",
  "Blessure de cauchemar": "Réduit DÉFINITIVEMENT de 1 une caractéristique (aléatoire, 1d10).",
  "Hémorragie": "Subit 1 blessure et 1 stress par round tant qu'il n'est pas soigné ; chaque tranche de 5 = +1 critique.",
  "La fin est proche": "Meurt à la fin de son prochain tour, sauf soins immédiats.",
  "Mort": "Décès immédiat.",
};
const VEH_EFFECTS = {
  "Stress mécanique": "Le véhicule subit 1 tension système.",
  "Bousculé": "Secousse : chaque membre d'équipage subit 1 stress et est désorienté 1 round.",
  "Perte d’alimentation des boucliers": "Défense réduite de 1 sur toutes les zones jusqu'à réparation.",
  "Dévié": "Le pilote ne peut pas exécuter de manœuvre au prochain round.",
  "Culbuté": "Vrille : ■ à tous les tests à bord, l'équipage s'accroche au prochain round.",
  "Composant touché": "Un composant (au choix du MJ) est désactivé jusqu'à réparation.",
  "Panne des boucliers": "Boucliers en chute : défense -1 (cumulatif) par round jusqu'à 0.",
  "Panne du navordinateur / unité R2": "Plus de saut hyperspace tant que ce n'est pas réparé.",
  "Fluctuations énergétiques": "Coupures aléatoires : le pilote ne peut plus infliger volontairement de tension système.",
  "Boucliers désactivés": "Défense 0 ; chaque coup encaissé inflige +1 tension système, jusqu'à réparation.",
  "Moteur endommagé": "Vitesse maximale réduite de 1 (minimum 1) jusqu'à réparation.",
  "Boucliers surchargés": "Boucliers hors service (défense 0, non réparable en vol) ; 2 tensions système.",
  "Arrêt moteur": "Vitesse 0 : le véhicule dérive, plus de manœuvres, jusqu'à réparation.",
  "Panne système majeure": "Un composant (au choix du MJ) est DÉTRUIT.",
  "Brèche majeure dans la coque": "Décompression : la coque cède, sections exposées au vide.",
  "Déstabilisé": "Seuils de coque et de tension réduits de moitié jusqu'à réparation.",
  "Au feu !": "Incendie à bord : dégâts et stress chaque round tant qu'il n'est pas éteint.",
  "Dislocation": "Le véhicule se disloque : détruit à la fin du prochain round. Évacuation !",
  "Désintégré": "Destruction totale et immédiate, équipage compris.",
};

// Gravité (soins) des blessures critiques selon la plage de départ.
const severity = (a) => (a <= 40 ? "Facile (◆)" : a <= 90 ? "Moyenne (◆◆)" : a <= 125 ? "Difficile (◆◆◆)" : "Redoutable (◆◆◆◆)");

// Extrait les plages « a - b » + libellés {…} d'une page du pack règles.
async function extractRows(file, pageName) {
  const doc = JSON.parse(await readFile(path.join(root, "packs", "_src_regles", file), "utf8"));
  const page = doc.pages.find((p) => p.name.toLowerCase().includes(pageName.toLowerCase()));
  const rows = [];
  for (const tr of page.text.content.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) || []) {
    const range = /<td[^>]*>\s*(\d+)\s*-\s*(\d+)\s*<\/td>/.exec(tr);
    const label = /\{([^}]+)\}/.exec(tr);
    if (range && label) rows.push({ from: +range[1], to: +range[2], label: label[1].trim() });
  }
  return rows;
}

function table({ name, img, description, rows, effects, withSeverity }) {
  const tid = fid(`swh-table:${name}`);
  return {
    _id: tid,
    _key: `!tables!${tid}`,
    name,
    img,
    description,
    formula: "1d100",
    replacement: true,
    displayRoll: true,
    results: rows.map((r) => {
      const rid = fid(`swh-result:${name}:${r.from}`);
      const effect = effects[r.label] || "Voir la page de règles correspondante.";
      return {
        _id: rid,
        _key: `!tables.results!${tid}.${rid}`,
        type: 0, // TEXT (numérique : migré automatiquement en « text » par Foundry v13)
        text: `<b>${r.label}</b> — ${effect}${withSeverity ? ` <i>(Gravité : ${severity(r.from)})</i>` : ""}`,
        img: "icons/svg/d20-black.svg",
        weight: 1,
        range: [r.from, r.to],
        drawn: false,
      };
    }),
    ownership: { default: 0 },
    flags: {},
    sort: 0,
    _stats: {},
  };
}

const charRows = await extractRows("2YLjq8hVKvjCVnfk.json", "Blessures Critiques");
const vehRows = await extractRows("gsT2yICS0fVVLmJn.json", "Dégâts Critique");
if (charRows.length < 20 || vehRows.length < 15) throw new Error(`extraction suspecte : ${charRows.length} blessures / ${vehRows.length} avaries`);

await mkdir(OUT, { recursive: true });
const tables = [
  table({
    name: "🩸 Blessures critiques (d100)",
    img: "icons/svg/blood.svg",
    description: "<p>Blessures critiques (personnages) — 1d100 + 10 par blessure critique déjà subie. Soin : test de Médecine de la gravité indiquée.</p>",
    rows: charRows, effects: CHAR_EFFECTS, withSeverity: true,
  }),
  table({
    name: "🔥 Avaries critiques — véhicules (d100)",
    img: "icons/svg/fire.svg",
    description: "<p>Avaries critiques (véhicules & vaisseaux) — 1d100 + 10 par avarie critique déjà subie. Réparation : test de Mécanique.</p>",
    rows: vehRows, effects: VEH_EFFECTS, withSeverity: false,
  }),
];
for (const tb of tables) {
  await writeFile(path.join(OUT, `${tb._id}.json`), JSON.stringify(tb, null, 2) + "\n");
  console.log(`${tb._id}  ${tb.name} — ${tb.results.length} résultats`);
}
console.log(`\n${tables.length} tables → ${OUT}`);
