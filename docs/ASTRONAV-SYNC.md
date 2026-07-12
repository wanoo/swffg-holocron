# Astronav ↔ Holocron — Contrat d'intégration & décisions (sync)

> Mémo de synchronisation entre **ce projet (`swffg-holocron`)** et le module Foundry
> **`swffg-astronavigation`** (`~/Documents/Dev/star-wars JDR/swffg-astronavigation`, publié sur
> https://github.com/wanoo/swffg-astronavigation — actuellement **v1.5.2**).
> Décisions verrouillées le 2026-07-12. But : que les deux projets avancent alignés.

## 1. Architecture décidée

- **`swffg-astronavigation`** = LA brique **astrogation réutilisable** (module Foundry autonome,
  distribué par **releases GitHub**, manifeste `releases/latest/download/module.json`).
  Il contient : calculateur d'astrogation FFG + **carte galactique interactive** (canvas,
  pan/zoom, tracé de route A* coloré, marqueurs, overlay hyperroutes) + **compendium MEJ
  « Planètes »** (6849 fiches *Place*) + compendium **macros** (« 🧭 Astronav — ce monde »).
  Dépend de **Monk's Enhanced Journal** (requis).
- **`swffg-holocron`** = le **poste de commande de campagne** (ce projet). Il a une
  **dépendance OBLIGATOIRE** à `swffg-astronavigation` (à déclarer `relationships.requires` le jour
  où le module Foundry Holocron existera). Il **absorbe l'ancien `swffg-command-deck`**
  (dashboard vaisseau/codex/HoloNet + boîte à outils MJ + structure journaux/scène) —
  command-deck **ne reste pas** un module autonome, il fond ici.

## 2. Delta « web astronav → module » (décisions actées)

| Sujet | Décision |
|---|---|
| Bibliothèque de mondes + filtres + modale détail (web) | **Le compendium MEJ prime.** Pas de panneau bibliothèque dans l'astronav ; l'exploration passe par le compendium. |
| Favoris | **= marque-pages MEJ**, partout. « Monde épinglé » = favori MEJ. Le Holocron utilise **aussi** ce système. Plus de POI serveur `/api/astro/poi`. |
| Ressources (vivres/carburant/pièce) | **= `fvtt-party-resources`** (dépendance forte **côté Holocron**). L'astronav n'a **pas** de pool ; il **expose seulement le coût**. |
| Overlay hyperroutes | **Ajouté au module** (v1.5.2) : bascules Grandes/Mineures. |
| Recherche | Via le système / datalist (delta accepté). |

## 3. Contrat d'API du module `swffg-astronavigation` (ce que Holocron consomme)

`const api = game.modules.get("swffg-astronavigation").api;`

- `api.open()` — ouvre la fenêtre Astronav (carte + calculateur).
- `api.setLeg(nom, "from" | "to")` — définit un monde comme origine/destination (remplit la
  fenêtre ouverte, sinon l'ouvre).
- `api.showWorld(nom)` — ouvre l'Astronav centré sur ce monde.
- `api.chooser(nom?)` — petit menu Voir / Départ / Arrivée (nom résolu, sinon demandé).
- `api.data()` → `{ byName, graph, list }` (données planètes + graphe d'hyperroutes).
- `api.favorites()` → `string[]` des mondes en favori MEJ de l'utilisateur courant.
- `api.lastCost` → dernier coût calculé `{ from, to, days, fuel, usure, labels:{food,fuel,repair} }`.
- **Hook `swffgAstronav.cost`** — émis à chaque calcul avec le même objet `lastCost`.
  👉 **Le Holocron y branche `fvtt-party-resources`** pour déduire le pool (vivres −days,
  carburant −fuel, usure/pièce selon la maison).

Réglages du module (Foundry settings, monde) : `resFoodLabel`, `resFuelLabel`,
`resRepairLabel` (étiquettes), `usure` (%), `hostile` (factions du mode discret).

## 4. Données & formats (source de vérité côté module)

- `modules/swffg-astronavigation/data/planets.json` — ~6800 systèmes. `img` = **chemins locaux**
  `modules/swffg-astronavigation/img/planets/…` (plus de hotlink Wookieepedia).
- `modules/swffg-astronavigation/data/lanes.json` — 63 hyperroutes (`planets[]` ordonnés + `pts[]`).
- `modules/swffg-astronavigation/img/galaxy-map.jpg` — fond GFFA 5400². Calibration :
  `CAL = {cx:2699.5, cy:2490, k:2.155, size:5400}`, `posOf(p)=[cx+xy0*k, cy-xy1*k]`.
- Packs : `swffg-astronavigation.planetes` (JournalEntry MEJ *Place*) + `swffg-astronavigation.macros` (Macro).
- **Format MEJ Place** (par fiche) : entrée `flags["monks-enhanced-journal"]={pagetype:"place", img}` ;
  page unique `type:"text"`, `src`=image, `text.content`=corps HTML,
  `flags["monks-enhanced-journal"]={type:"place", placetype:<région>, location:<secteur>,
  attributes.districts:<coord>, relationships:{}, items:{}, style:{…}}`. Contrainte MEJ : `pages.size===1`.

## 5. À faire côté Holocron (todo de ce projet)

1. Quand le module Foundry Holocron sera créé : `relationships.requires` = `swffg-astronavigation`
   **et** `fvtt-party-resources` (MEJ vient transitivement d'astronav).
2. **Porter ici** le dashboard + les macros MJ + la structure (journaux 🚀/📡/🖥️, scène poste de
   commande) de l'ancien `swffg-command-deck` (`~/Documents/Dev/star-wars JDR/swffg-command-deck`,
   scripts `main/deck/gm-tools/util.mjs`).
3. Brancher `Hooks.on("swffgAstronav.cost", …)` → **`fvtt-party-resources`** (déduction du pool).
4. Utiliser les **favoris MEJ** (pas de POI serveur). Ouvrir l'astronav via `api.open()` ;
   envoyer un monde via `api.setLeg` / `api.chooser`.
5. Ne PAS ré-implémenter la carte / le calcul : tout vient de `swffg-astronavigation`.

## 6. Références

- Module : https://github.com/wanoo/swffg-astronavigation (v1.5.2) — install : manifeste `releases/latest`.
- Source module : `~/Documents/Dev/star-wars JDR/swffg-astronavigation` (repo git indépendant).
- Ancien command-deck (à absorber) : `~/Documents/Dev/star-wars JDR/swffg-command-deck`.
- Ce projet : `swffg-holocron` (app web SSOT, staging/preprod orga Clever « Erwan Testing »).
