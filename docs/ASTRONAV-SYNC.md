# ASTRONAV-SYNC — contrat d'intégration

> ## ⚡ CONTRAT v2 (2026-07-16) — MASTER SWITCH Campaign Codex
>
> Monk's Enhanced Journal est REMPLACÉ par la suite wgtnGM. Versions publiées :
> **holocron 2.0.0**, **astronav 2.0.0**. Tout ce qui suit cette section décrit
> l'ancien contrat MEJ (conservé pour l'historique) — les formats normatifs sont :
>
> - **Atlas** : compendium `swffg-astronavigation.planetes` = 6 849 fiches
>   **Campaign Codex `location`** + 10 fiches **`region`** (une par région
>   galactique). Format : `flags.campaign-codex = { type, data: { description,
>   region, secteur, coord, parentRegion: "JournalEntry.<idRegion>", tags },
>   image }` + `flags.swffg-astronavigation` (region/sector/coord/grid/xy,
>   inchangé, source canonique). **Ids des planètes stables** (jamais régénérés).
> - **Favoris** : tag **« Favori »** sur la fiche (`campaign-codex.data.tags`,
>   sinon `asset-librarian.filterTag`) + **index compact**
>   `flags.holocron.config.favorites = [{id, name}]` maintenu en write-through
>   par l'app web et l'★ étoile MJ de l'astronav. `api.favorites()` lit
>   index + tags (repli marque-pages MEJ legacy) ; `api.toggleFavorite(name)`.
> - **Événements/frise** : journal « Calendar Events - Mini Calendar »
>   (`wgtgm-mini-calendar`), pages `YYYY-MM-DD`, notes dans
>   `flags["wgtgm-mini-calendar"].notes` ; année calendrier = epochBBY (réglage
>   holocron, défaut 300) + valeur BBY/ABY ; icône `fas fa-jedi` = Canon.
> - **Fiches de campagne** : Campaign Codex (npc/group/location/shop/quest) ;
>   l'app web lit CC ET MEJ (legacy) via `sheetView`. Statut/mort des PNJ :
>   `flags.holocron.statut/mort`.
> - **Dépendances** : holocron requiert campaign-codex + wgtgm-mini-calendar ;
>   astronav requiert campaign-codex. **MEJ n'est plus requis nulle part** et
>   peut être désactivé (conflit de sheets CC/MEJ documenté).
> - Le POI vaisseau est un journal holocron pur (page statut ancrée par
>   `flags.swffg-holocron.bound:"status"`).


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
6. **« Vous êtes ici » (position du vaisseau)** — ✅ **livré côté astronav (v1.6.0)** :
   `api.setCurrentWorld(nom)` pose un marqueur « position courante » sur la carte (réglage monde
   `currentWorld`). **Côté Holocron : appeler `api.setCurrentWorld(mondeDuVaisseau)`** quand le
   vaisseau bouge (le vaisseau = POI MEJ, monde courant en relationship).
7. **MEJ + import** — ✅ **livré côté astronav (v1.6.0)** : au 1er lancement (MJ) l'Astronav propose
   d'importer le compendium dans les journaux (`api.importToWorld()`, dossier « Planètes — Astronav »),
   en droits **OBSERVER**. Les fiches « Place » ne s'enrichissent et ne se favorisent que sur ces
   entrées **du monde**. **Côté Holocron : s'assurer que l'import a eu lieu** (ou l'appeler) avant
   d'exploiter les fiches.
8. **Suivre l'état des favoris + les droits de vue (Fav state & view rights)** — à faire côté Holocron :
   - **Favoris** = flag par-utilisateur MEJ `game.user.getFlag("monks-enhanced-journal","bookmarks")`
     (UUID). `api.favorites()` les résout en noms de mondes. Le Holocron doit **suivre/synchroniser
     cet état** (par joueur) pour que joueurs **et** MJ s'en servent.
   - **Droits de vue** : les journaux importés sont **OBSERVER par défaut** → joueurs peuvent voir +
     favoriser. Le Holocron doit **respecter/maintenir ces droits** (ne pas les restreindre) pour que
     tout le monde utilise l'atlas.

## 8. Réglages / comportements récents du module (v1.6.0)

- Réglage MJ **« Difficulté des voyages »** (Très facile ↔ Très difficile, milieu = règles FFG).
- Factions hostiles = **menu à cases à cocher** (allégeances connues), plus un CSV.
- Hyperdrive = **classe** (basse = rapide) ; la vitesse joue sur la durée (et les vivres), pas le carburant.
- API ajoutée : `api.setCurrentWorld(nom)`, `api.currentWorld()`, `api.importToWorld()`, `api.favorites()`.
- Compendium en droits **OBSERVER** (joueurs voient/favorisent).

> 🛰️ **Travail parallèle** — l'état du **frontend/carte de l'Astronav** (toggles, tracé, POI, usure)
> et les **zones à ne pas se marcher dessus** sont notés dans
> `swffg-astronavigation/docs/STATUS-FRONTEND.md` (repo astronav). Résumé : `scripts/astronav.mjs`
> est « possédé » par le Claude frontend ; les **fonctions MJ** (gm-tools/deck) sont libres, à éditer
> **ici** (`module-foundry/`, source canonique — ex-`foundry/`, renommé le 2026-07-13 ; l'ancienne
> copie `star-wars JDR/swffg-holocron/` n'existe plus, le dépôt vit sous `modules/swffg-holocron/`).
> Versions publiées : astronav **1.7.5**, holocron **1.3.0**.

## 9. Astronav **web** ↔ MEJ — fiche + favoris (livré 2026-07-13)

L'astronav de **l'app web** (`public/js/astronav.js`, statique `planets.json`) est désormais reliée
aux données MEJ du monde, **sans** synchroniser le dossier planètes (toujours hors allowlist de
`sync-store.mjs`) : tout passe par des **appels MCP ciblés**.

- **Fiche MEJ live** — `GET /api/astro/fiche?name=…` (`server/lib/astro.mjs` `fiche()`) : `get_journals
  { where:{name}, requested_fields }` → filtre la fiche « Place » → `mejView` (exporté depuis
  `transform/journals.mjs`). Le front l'affiche **en plus** de `planets.json` (repli si absente).
- **Favoris MEJ = marque-pages par-utilisateur** (`flags['monks-enhanced-journal'].bookmarks`).
  Lecture `GET /api/gm/astro/favorites` + bascule `POST` (`{name,on}`), **MJ uniquement** (`gmOK` +
  `session.userId`). Écriture via **`modify_document { type:'User', … }`** (le connecteur l'autorise) ;
  bookmark écrit **à la forme exacte de MEJ** : `{ id:<16 alnum>, entityId:'JournalEntry.<id>',
  text:<nom>, icon:'fa-place-of-worship' }` (cf. MEJ `apps/enhanced-journal.js addBookmark`). Côté
  front : section « ★ Favoris (MEJ) », marqueurs carte, toggle dans la fiche (visible si `Data.gm`).
- **Le module Foundry lit le même flag** (`favoriteWorlds()` / deck) → favoris synchronisés web ↔ Foundry.
- ⚠️ Écriture réservée MJ (choix produit) ; les joueurs voient la fiche (OBSERVER) mais pas le toggle.
- **Ne pas** ajouter le dossier « Planètes — Astronav » à l'allowlist du sync (garde anti-dump).

## 7. État au 2026-07-13 — module Foundry **`swffg-holocron`** livré (v1.2.0)

Le module Foundry Holocron **existe désormais** : `~/Documents/Dev/star-wars JDR/swffg-holocron`
(rename de `swffg-command-deck`, qui fond ici comme décidé). Le contrat §5 est **rempli** :

- ✅ **Dépendances** déclarées : `swffg-astronavigation` (≥1.7.2 depuis holocron 1.3.0),
  `fvtt-party-resources` (≥1.8.0), `monks-enhanced-journal`.
- ✅ **Vaisseau ↔ party-resources** : pool live via `window.pr.api.get/set` (ids `resFoodId`/
  `resFuelId`/`resWearId`). La valeur PR prime sur le flag ; `writeShip` met PR à jour. Repli journal
  si PR absent. → **plus besoin de brancher `swffgAstronav.cost` côté web** pour la déduction : c'est
  fait dans le module.
- ✅ **POI vaisseau** : journal vaisseau = POI MEJ ; `setShipWorld(nom)` écrit `lastTo` **et** appelle
  `astronav.setCurrentWorld(nom)` (marqueur « vous êtes ici »). Seed au `ready` depuis `ship.lastTo`.
- ✅ **Réception des voyages** : le pont mort `swffgAstronav.route` est remplacé par
  `swffgAstronav.cost` (mémorisé) + `ffgDiceMessage` (jet réussi ⇒ `applyTrip` + déplacement POI).
  Garde « MJ actif unique » anti-doublon. Bouton deck « Appliquer le trajet calculé ».
- ✅ **Favoris MEJ** : panneau « Mondes d'intérêt » alimenté par `api.favorites()` (marque-pages MEJ),
  clic → fiche / 🧭 → destination. Bouton « Importer l'atlas » (`api.importToWorld`).

**Reste côté web (`swffg-holocron` app)** : rien d'obligatoire pour l'intégration Foundry. Optionnel :
si le SSOT web veut refléter la position/ressources du vaisseau, lire les mêmes sources (flag du
journal vaisseau `flags.swffg-holocron.ship` + pool party-resources). Le module Foundry est autonome.

## 6. Références

- Module : https://github.com/wanoo/swffg-astronavigation (v1.5.2) — install : manifeste `releases/latest`.
- Source module : `~/Documents/Dev/star-wars JDR/swffg-astronavigation` (repo git indépendant).
- Ancien command-deck (à absorber) : `~/Documents/Dev/star-wars JDR/swffg-command-deck`.
- Ce projet : `swffg-holocron` (app web SSOT, staging/preprod orga Clever « Erwan Testing »).
