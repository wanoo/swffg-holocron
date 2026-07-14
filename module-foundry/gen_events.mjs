// gen_events.mjs — génère les sources JSON du pack « 📅 Événements canon »
// (packs/_src_evenements) : ~20 fiches MEJ « event » datées en BBY/ABY.
// Usage : node gen_events.mjs — idempotent (ids stables dérivés du nom).
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(root, "packs", "_src_evenements");

// id Foundry (16 alphanum) STABLE, dérivé d'une graine — regénérer ne casse pas les refs.
const ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
function fid(seed) {
  const h = createHash("sha256").update(seed).digest();
  let s = "";
  for (let i = 0; i < 16; i++) s += ALPHA[h[i] % ALPHA.length];
  return s;
}

// 20 dates clés du canon (ères République & Empire — cf. Wookieepedia, Years in
// the Republic/Imperial Era). Résumés volontairement neutres et sans spoiler fin.
const EVENTS = [
  ["232 BBY", "La Grande Catastrophe hyperspatiale", "Bordure Extérieure",
    "Un désastre en hyperespace disloque le vaisseau <em>Legacy Run</em> ; les débris frappent plusieurs systèmes. L'apogée de la Haute République est ébranlée et les Jedi mobilisés à grande échelle."],
  ["200 BBY", "Naissance de Chewbacca", "Kashyyyk",
    "Le Wookiee Chewbacca naît sur Kashyyyk. Deux siècles plus tard, il deviendra l'un des contrebandiers puis héros de l'Alliance les plus célèbres de la galaxie."],
  ["57 BBY", "Naissance d'Obi-Wan Kenobi", "Stewjon",
    "Naissance du futur Chevalier puis Maître Jedi Obi-Wan Kenobi, général de la Guerre des Clones et mentor des Skywalker."],
  ["41 BBY", "Naissance d'Anakin Skywalker", "Tatooine",
    "Naissance d'Anakin Skywalker, esclave sur Tatooine — l'« Élu » de la prophétie Jedi, futur Dark Vador."],
  ["32 BBY", "Bataille de Naboo", "Naboo",
    "La Fédération du Commerce envahit Naboo. La reine Amidala reprend Theed avec l'aide des Gungans ; Qui-Gon Jinn tombe face à Dark Maul. Palpatine devient Chancelier Suprême."],
  ["24 BBY", "Discours de Raxus — la crise séparatiste", "Raxus",
    "Le comte Dooku proclame la Confédération des Systèmes Indépendants : des milliers de systèmes font sécession. La République vacille, le réarmement commence."],
  ["22 BBY", "Bataille de Géonosis — début de la Guerre des Clones", "Géonosis",
    "Première bataille de la Guerre des Clones : l'armée de clones de la République affronte les droïdes séparatistes. Le conflit embrase la galaxie pour trois ans."],
  ["19 BBY", "Ordre 66 — proclamation de l'Empire", "Coruscant",
    "L'Ordre 66 anéantit l'Ordre Jedi ; Palpatine se proclame Empereur galactique. Anakin Skywalker devient Dark Vador. Naissance cachée de Luke et Leia."],
  ["13 BBY", "Han Solo quitte Corellia", "Corellia",
    "Le jeune Han fuit les gangs de Corellia et s'engage dans la Marine impériale — début d'un parcours qui fera de lui le contrebandier le plus connu de la Bordure."],
  ["10 BBY", "Raid de Kessel", "Kessel",
    "Le casse des mines d'épice de Kessel : premier exploit du <em>Faucon Millenium</em>, qui boucle le « Kessel Run » en moins de douze parsecs sous Lando puis Han Solo."],
  ["9 BBY", "Obi-Wan sort de l'ombre", "Tatooine / Jabiim",
    "Traqué par l'Inquisitorius, Obi-Wan Kenobi quitte son exil pour sauver la jeune Leia Organa et affronte de nouveau Dark Vador."],
  ["5 BBY", "Casse d'Aldhani — l'étincelle rebelle", "Aldhani",
    "Le vol de la paie impériale d'Aldhani révèle qu'on peut frapper l'Empire. Les cellules dispersées commencent à se coordonner ; la répression impériale se durcit."],
  ["4 BBY", "Les Spectres rejoignent la rébellion", "Lothal",
    "L'équipage du <em>Ghost</em>, qui harcelait l'Empire depuis Lothal, intègre le réseau rebelle naissant coordonné par Fulcrum."],
  ["2 BBY", "Massacre de Ghorman & Déclaration de l'Alliance", "Ghorman / Yavin 4",
    "L'Empire massacre les manifestants de Ghorman. Mon Mothma dénonce l'Empereur au Sénat et entre en clandestinité : l'Alliance pour la Restauration de la République est proclamée."],
  ["1 BBY", "Libération de Lothal", "Lothal",
    "Les Spectres et la résistance locale chassent l'Empire de Lothal. Ezra Bridger disparaît dans l'hyperespace avec le Grand Amiral Thrawn."],
  ["0 BBY", "Scarif & Yavin — l'Étoile Noire détruite", "Scarif / Yavin",
    "Les rebelles de Rogue One volent les plans de l'Étoile Noire à Scarif. Quelques jours plus tard, Luke Skywalker détruit la station lors de la bataille de Yavin — l'an 0 du calendrier galactique."],
  ["3 ABY", "Bataille de Hoth", "Hoth / Bespin",
    "L'Empire écrase la base Echo sur Hoth ; l'Alliance se disperse. À Bespin, Vador révèle à Luke qu'il est son père."],
  ["4 ABY", "Bataille d'Endor — chute de l'Empereur", "Endor",
    "L'Alliance détruit la seconde Étoile Noire au-dessus d'Endor. L'Empereur Palpatine périt, trahi par Vador qui meurt en Anakin Skywalker. L'Empire se fracture."],
  ["5 ABY", "Bataille de Jakku — Concordance Galactique", "Jakku / Chandrila",
    "La flotte impériale est anéantie au-dessus de Jakku. L'Empire capitule et signe la Concordance Galactique : la Nouvelle République s'installe."],
  ["9 ABY", "L'ère de la Nouvelle République", "Bordure Extérieure",
    "Cinq ans après Endor, la Nouvelle République peine à pacifier la Bordure : seigneurs de guerre impériaux, guildes de chasseurs de primes et vestiges de l'Empire s'y disputent le vide laissé."],
];

await mkdir(OUT, { recursive: true });
for (const [date, name, location, body] of EVENTS) {
  const jid = fid(`swh-event:${name}`);
  const pid = fid(`swh-event-page:${name}`);
  const doc = {
    _id: jid,
    name: `${date} — ${name}`,
    pages: [{
      _id: pid,
      name,
      type: "text",
      title: { show: true, level: 1 },
      image: {},
      text: { format: 1, content: `<p>${body}</p>`, markdown: "" },
      video: { controls: true, volume: 0.5 },
      src: null,
      system: {},
      sort: 0,
      ownership: { default: -1 },
      flags: {
        "monks-enhanced-journal": {
          type: "event",
          role: "",
          location,
          attributes: { date, position: "Canon" },
          relationships: {},
          items: {},
        },
      },
      _stats: {},
    }],
    folder: null,
    sort: 0,
    ownership: { default: 0 },
    flags: { "monks-enhanced-journal": { pagetype: "event" } },
    _stats: {},
    _key: `!journalentry!${jid}`,
  };
  await writeFile(path.join(OUT, `${jid}.json`), JSON.stringify(doc, null, 2) + "\n");
  console.log(`${jid}  ${doc.name}`);
}
console.log(`\n${EVENTS.length} événements → ${OUT}`);
