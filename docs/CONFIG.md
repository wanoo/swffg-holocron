# Configuration de campagne — journal « ⚙️ Holocron Config »

Toute la spécificité de VOTRE campagne vit dans un journal Foundry (nom par défaut :
`⚙️ Holocron Config`, changeable via `CONFIG_JOURNAL_NAME`), sous
`flags.holocron.config`. `POST /api/gm/bootstrap` en crée un squelette.

```jsonc
{
  "v": 1,
  "meta": { "title": "Ma campagne", "description": "<p>HTML du bandeau d'accueil</p>", "system": "starwarsffg" },

  // Catégories joueurs = dossiers Foundry de journaux. kind pilote l'affichage :
  // rules | story | org | pc | notes | misc. editable → l'éditeur web écrit dedans.
  "categories": [
    { "folder": "🎬 Campagne — Actes", "kind": "story", "editable": true },
    { "folder": "🏛️ Organisations", "kind": "org" },
    { "folder": "🎭 Personnages rencontrés", "kind": "pc" },
    { "folder": "📓 Notes des joueurs", "kind": "notes", "editable": true }
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
  "journals": {
    "ship": "🚀 Vaisseau du groupe",
    "codex": "🖥️ Codex du groupe",
    "poi": "🌍 Mondes d'intérêt",
    "holonet": "📡 HoloNet — Actualités",
    "gmNotes": "🗒️ Notes MJ (Holocron)"
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
| `flags.holocron.ship` | journal vaisseau | état partagé du vaisseau |
| `flags.holocron.poi` | journal POI | mondes d'intérêt Astronav — `[{name, note, act, vis}]`, `vis: "gm"` = repérage privé MJ (filtré pour les joueurs), `"all"`/absent = épinglé pour tous |
| `flags.holocron.codex` | journal codex | allégeance/équipage/PNJ (navicomputer) |
| `flags.holocron.note` | page notes MJ | métadonnées d'une note |

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
