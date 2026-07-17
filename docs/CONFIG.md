# Configuration de campagne — journal « ⚙️ Holocron Config »

Toute la spécificité de VOTRE campagne vit dans un journal Foundry (nom par défaut :
`⚙️ Holocron Config`, changeable via `CONFIG_JOURNAL_NAME`), sous
`flags.holocron.config`. `POST /api/gm/bootstrap` en crée un squelette.

```jsonc
{
  "v": 1,
  "meta": { "title": "Ma campagne", "description": "<p>HTML du bandeau d'accueil</p>", "system": "starwarsffg" },

  // Catégories joueurs = dossiers Foundry de journaux, référencés par NOM, _id ou
  // uuid « Folder.<id> ». kind pilote l'affichage : rules | story | org | pc | notes |
  // timeline | misc. editable → l'éditeur web écrit dedans.
  // kind "timeline" : la frise #/timeline lit d'abord les NOTES du calendrier
  // Mini Calendar (journal « Calendar Events - Mini Calendar », voir `calendar`
  // ci-dessous) ; le dossier de la catégorie porte les éventuelles fiches
  // événements héritées, mêlées à la frise.
  "categories": [
    { "folder": "🎬 Campagne — Actes", "kind": "story", "editable": true },
    { "folder": "🏛️ Organisations", "kind": "org" },
    { "folder": "🎭 Personnages rencontrés", "kind": "pc" },
    { "folder": "📓 Notes des joueurs", "kind": "notes", "editable": true },
    { "folder": "Folder.vdYoDbNca37GaYxK", "kind": "timeline", "label": "Événements" }
  ],

  // Espace MJ : dossier racine de la bible (ses SOUS-dossiers = rubriques).
  "gmBibleFolder": "🎲 MJ — Bible de campagne",

  // Acteurs : dossier des PJ (fiches affichées aux joueurs) et des PNJ custom.
  "pcFolder": "👥 Personnages joueurs",
  "npcsWorldFolder": "🎭 PNJ de campagne",

  // Compendiums : règles (JournalEntry) et bestiaire (Actor).
  "packs": {
    "rules": "world.regles-and-references-fr",
    "rulesNamePrefix": "^\\d+ · ",          // préfixe de tri retiré à l'affichage
    "adversaries": "world.star-wars-adversaries",
    "translations": []
  },

  // Journaux nommés utilisés par le vaisseau/dash/POI/HoloNet et les notes MJ.
  // shipNotes = page « notes d'équipage » de la vue #/vaisseau, au format
  // "<journalId>:<pageId>" (le journal peut vivre hors des dossiers synchronisés :
  // pull ciblé à chaque tick ; éditable si l'ownership Foundry le permet).
  "journals": {
    "ship": "🚀 Vaisseau du groupe",
    "codex": "🖥️ Codex du groupe",
    "poi": "🌍 Mondes d'intérêt",
    "holonet": "📡 HoloNet — Actualités",
    "gmNotes": "🗒️ Notes MJ (Holocron)",
    "dossiers": "🗂️ Dossiers MJ (Holocron)",
    "shipNotes": "7y1NXkJxRJVlXwH8:pPQ2rX0hAZfvG0QP"
  },

  // Registre des personnages (mentions cliquables dans les textes MJ).
  "registry": [
    { "kind": "pc", "id": "<idActor>", "forms": ["Nom", "Surnom", "Faute d'orthographe"] }
  ],

  // Liens vers les fiches d'adversaires depuis les blocs ```combat.
  "advLinks": {
    "externalUrl": "https://…/swadversaries",   // outil externe (secours)
    "map": [ { "pattern": "jerserra", "flags": "i", "id": "<idAdversaire>" } ]
  },

  // Calendrier galactique (Mini Calendar « Grande ReSynchronisation ») :
  // année calendrier N = (N − epochBBY) → BBY si négatif, ABY sinon.
  "calendar": { "epochBBY": 35 },

  // Index compact des mondes FAVORIS (écrit par le module / l'app web au toggle ;
  // la vérité reste le tag « Favori » sur la fiche planète Campaign Codex).
  "favorites": [ { "id": "<idJournal>", "name": "Tatooine" } ],

  // Planètes épinglées dans l'Astronav (+ marqueurs carte).
  "campaignPlanets": ["Ilum", "Tatooine"],

  // Configs internes de l'espace MJ (écran, séance, fronts) — gérées par l'UI.
  "cfg": {}
}
```

## Flags utilisés sur les documents Foundry

| Flag | Sur | Rôle |
|---|---|---|
| `flags.holocron.config` | journal ⚙️ | la config ci-dessus |
| `flags.holocron.gmChapter` | journal | id stable d'un chapitre bible (édition web) |
| `flags.holocron.rev` | journal | `{updatedAt, updatedBy}` — concurrence 409 |
| `flags.holocron.legacyId` | journal | ancre historique (`#/journal/<id>`) |
| `flags.holocron.kind/statut/mort` | journal | catégorie + pastille PNJ |
| `flags.holocron.attrs` | journal fiche CC | attributs libres (carte d'identité web) |
| `flags.holocron.ship` | journal vaisseau | état partagé du vaisseau |
| `flags.holocron.poi` | journal POI | mondes d'intérêt Astronav — `[{name, note, act, vis}]`, `vis: "gm"` = repérage privé MJ (filtré pour les joueurs), `"all"`/absent = épinglé pour tous |
| `flags.holocron.codex` | journal codex | allégeance/équipage/PNJ (navicomputer) |
| `flags.holocron.note` | page notes MJ | métadonnées d'une note |
| `flags.holocron.dossiers` | journal 🗂️ | dossiers MJ narratifs — `{entityId: {name, role, statut, veut, levier, indices, attitude, replique, advId}}` ; affichés sur les fiches (résolution par id puis par nom), servis par `GET /api/gm/dossiers`. Les backrefs « Mentionné dans » sont CALCULÉES depuis les chapitres + `registry` (`GET /api/gm/backrefs`) |

## Campaign Codex (types de fiches)

Les fiches typées sont des journaux **Campaign Codex** (`flags.campaign-codex` :
`type`, `data`, `image`) — reconnues automatiquement, aucune config à ajouter.

- **Types** : `npc` (PNJ), `group` (organisation / faction), `location` (lieu,
  planète), `region` (région galactique), `shop` (boutique), `quest` (quête),
  `tag`. L'app affiche une **carte d'identité** au-dessus du texte : type,
  description, tags (`data.tags` — utilisés aussi pour les caractéristiques
  planétaires *Terrain* / *Climat* et le favori « Favori »), et **relations
  cliquables** (liens par uuid : `associates`, `linkedNPCs`, `linkedLocations`,
  `parentRegion`…). Les liens `hidden` ne sortent que pour le MJ.
- **Surcouches Holocron** sur la même fiche : `flags.holocron.statut`
  (allié/ennemi/mentor/neutre/contact → pastille), `flags.holocron.mort` (†),
  `flags.holocron.attrs` (attributs libres affichés en carte d'identité).
- **Quêtes** : `data.quests[0]` (unlocks / dependencies / relatedUuids) alimente
  le graphe `#/mj/quetes` ; positions du widget `questgraph` reprises si présentes.

> **Héritage MEJ** : les fiches Monk's Enhanced Journal restantes sont encore
> lues (repli `mejView`) le temps de la transition — la conversion automatique
> du module (`api.convertMej()`) les transforme en fiches CC et archive les
> originaux dans « 🗄️ Archive MEJ ». Objectif : MEJ désactivé.

## Mini Calendar (frise chronologique)

Les événements datés vivent dans le journal **« Calendar Events - Mini Calendar »**
(module `wgtgm-mini-calendar`) : une page par date, nommée `<année>-MM-JJ`
(année NON paddée, négatifs admis, ex. `-1-05-24`), notes dans
`page.flags["wgtgm-mini-calendar"].notes` (`{title, icon, content, playerVisible…}`).
La frise convertit l'année calendrier en BBY/ABY via `calendar.epochBBY` (35 : an 0
= 35 BBY) ; les notes à icône `fas fa-jedi` sont classées **Canon**, les autres
**Campagne** ; `playerVisible: false` = MJ seulement. Le module installe les
20 dates canon (`data/canon-events.json`) à l'installation.

## Bibliothèque de rencontres (créateur de combats)

Le journal `⚔️ Bibliothèque de rencontres` porte `flags.holocron.encounters` :

```jsonc
[{
  "id": "enc-xxxx", "title": "Embuscade", "map": "worlds/…/battlemap.webp",
  "note": "contexte",
  "groups": [{ "name": "Vague 1", "rows": [
    { "name": "Nightbrother", "count": 3, "w": 9, "s": 0, "soak": "3",
      "attack": "Lance — Dég 6 · Crit 3", "key": "chargent au contact" }
  ]}],
  "updatedAt": 0, "updatedBy": "MJ"
}]
```

Éditée par la page **#/rencontres** du Holocron (autocomplétion sur le pack
d'adversaires, stats auto-remplies, tracker intégré, bouton 🎬 scène Foundry).
**Un assistant IA connecté à Foundry (MCP) peut écrire ce flag directement**
pour générer des rencontres — le MJ les retrouve aussitôt dans le créateur.
