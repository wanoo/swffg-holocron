# Changelog

## 1.5.0 — Installation automatique dans le monde

- **Au premier lancement (client MJ), le module installe tout** (`scripts/setup.mjs`,
  idempotent — ne recrée jamais l'existant, relançable via le menu de réglage
  *« Installer / réinstaller »* ou `api.install()`) :
  1. **Structure de dossiers clés** : 🎬 Campagne — Actes, 🏛️ Organisations,
     🎭 Personnages rencontrés, 📓 Notes des joueurs, 🎲 MJ — Bible de campagne,
     📅 Événements (+ dossiers d'acteurs 👥 Personnages joueurs, 🎭 PNJ de campagne).
  2. **Import des compendiums dans le monde** : 📖 Règles & Références (FR) au complet,
     et les 📅 Événements canon dans le dossier d'événements (celui de la catégorie
     `kind:"timeline"` de ⚙️ Holocron Config s'il existe).
  3. **Rangement des journaux techniques** (vaisseau, codex, HoloNet, ⚙️ Holocron
     Config, notes MJ, rencontres, dossiers, dice_helper) dans le **dossier système** —
     nouveau réglage `systemFolder` (nom ou uuid `Folder.<id>`) ; si les journaux sont
     déjà rangés quelque part, ce dossier est adopté tel quel.
- Les journaux créés par le module (`boundJournal`) naissent directement dans le
  dossier système.
- ⚠️ App web : nécessite l'Archive Holocron déployée après le 2026-07-14 (la sync
  suit désormais les journaux techniques par NOM, où qu'ils soient rangés).

## 1.4.1 — Événements canon : attribut `position` + import dans le monde

- Les 20 fiches du compendium « 📅 Événements canon » portent désormais l'attribut
  MEJ **`position: Canon`** (en plus de `date`). La frise de l'Archive Holocron lit
  maintenant TOUT depuis **un seul dossier monde d'événements** (catégorie
  `kind:"timeline"`, référencée par nom ou uuid `Folder.<id>`) : le compendium ne
  sert plus de source live — **importez ses fiches dans ce dossier** et mêlez-les à
  vos événements de campagne (`position: Campagne`, ou vide).

## 1.4.0 — Événements canon (timeline) + envoi d'images aux joueurs

- **Nouveau compendium « 📅 Événements canon »** : 20 dates clés de la galaxie
  (232 BBY → 9 ABY) en fiches MEJ de type *event*, datées par l'attribut `date`
  (format BBY/ABY). Elles alimentent la **frise chronologique** de l'Archive
  Holocron (`#/timeline`, config `packs.events: "swffg-holocron.evenements"`),
  mêlées aux événements de campagne du monde. Sources : `packs/_src_evenements/`
  (régénérables via `node gen_events.mjs`, ids stables).
- **Pont d'images web → joueurs** : le module écoute les ChatMessages flaggés
  `holocron.showImage` postés par l'app web (bouton « 📡 Montrer aux joueurs » /
  Pont Foundry) et ouvre un **ImagePopout partagé** chez tous les clients
  (`shareImage`). Garde « MJ actif unique » anti-doublon, requête supprimée après
  envoi, compatible Foundry v12 (global) et v13 (ApplicationV2).

## 1.3.0 — Compendiums embarqués + flag d'état unifié avec l'app web

- **4 compendiums bundlés** (LevelDB, sources JSON dans `packs/_src_*`) : **📖 Règles &
  Références (FR)** (17 journaux d'aide de jeu), **🎲 Macros — Holocron** (25 macros : outils MJ,
  pont de jets Holocron, délégations écosystème), **⚙️ Structure & Config** (journal décrivant
  l'arborescence de campagne), **🧪 Échantillon** (2 fiches MEJ d'exemple). Build :
  `node build_pack.mjs` puis `python build.py --zip`.
- **Flag d'état unifié** : les états vaisseau/codex s'écrivent désormais sous
  **`flags.holocron.*`** — le même espace que l'app web Archive Holocron — au lieu de
  `flags.swffg-holocron.*`. Fini la divergence quand les deux côtés écrivaient chacun leur
  flag. Migration douce : les anciens flags (`swffg-holocron`, `swffg-command-deck`) sont
  repris en lecture et nettoyés à la première écriture.
- **Auto-setup party-resources sur tout client MJ navigateur** : le connecteur MCP headless
  peut être l'`activeGM` sans jamais exécuter le module ; le setup (idempotent) se fait
  maintenant sur n'importe quel MJ qui ouvre le monde dans un navigateur.
- **Favoris MEJ partagés** : les marque-pages sont propagés à tous les utilisateurs
  (mondes d'intérêt identiques pour tout le groupe) ; retrait du legacy « campagne ».
- **Écosystème recommandé** : `swffg-sabacc` et `swffg-workshops` déclarés en modules
  recommandés (leurs règles sont aussi lisibles dans l'Archive Holocron).
- **Dépendances resserrées** : `swffg-astronavigation` ≥ **1.7.2** (contrat `setUsure`),
  `fvtt-party-resources` ≥ **1.8.0** (contrat §7 ASTRONAV-SYNC).

## 1.2.2 — Usure via le contrat propre de l'astronav

- L'usure du vaisseau est poussée à l'astronav via la nouvelle API **`api.setUsure(pct)`**
  (astronav ≥ 1.7.2) au lieu d'écrire le réglage brut ; la difficulté d'astrogation se
  **recalcule en direct**. Repli sur le réglage si une ancienne astronav est installée.

## 1.2.1 — Usure = pourcentage qui monte, relié à la difficulté

- **Usure du vaisseau = ressource % dans Party Resources** : créée en `Usure du vaisseau (%)`
  (0 → 100), elle **augmente** avec les voyages (messages de notif « usure en hausse / réparée »).
- **L'usure pilote la difficulté d'astrogation** : `ship.usure` est synchronisée vers le réglage
  `usure` de l'astronav (> 50 % : +1 au test ; > 80 % : +2). L'usure accumulée a enfin un effet.

## 1.2.0 — Renommage en **SWFFG Holocron** + intégration Astronav complète

- **Renommage** `swffg-command-deck` → **`swffg-holocron`** (le « Navi-Computer » devient le module
  Holocron). Migration douce : les états vaisseau/codex des flags `swffg-command-deck` et `holocron`
  historiques sont automatiquement repris.
- **Vaisseau ↔ `fvtt-party-resources`** (nouvelle dépendance) : les jauges Vivres / Carburant / Usure
  sont adossées au **pool partagé** du groupe. La valeur live de party-resources prime sur le flag ;
  chaque écriture du vaisseau met le pool à jour. Réglages `resFoodId` / `resFuelId` / `resWearId`
  pour mapper vos ressources. Dégradation gracieuse si le module est absent (le journal fait foi).
- **POI vaisseau** : le journal du vaisseau est un POI **Monk's Enhanced Journal** et sa position
  pilote le marqueur « **vous êtes ici** » de l'astronav (`setCurrentWorld`).
- **Réception des voyages (pont corrigé)** : un **jet d'Astrogation réussi** applique automatiquement
  le coût calculé au vaisseau (déduction du pool) **et déplace le POI** vers la destination.
  L'ancien pont écoutait un hook inexistant (`swffgAstronav.route`) — remplacé par
  `swffgAstronav.cost` + détection du jet réussi (`ffgDiceMessage`). Bouton **« Appliquer le trajet
  calculé »** dans le deck (pour appliquer sans jet). Un seul MJ « actif » applique (anti-doublon).
- **Mondes d'intérêt = favoris MEJ** : le panneau liste les **marque-pages Monk's Enhanced Journal**
  (clic → fiche, 🧭 → destination dans l'astronav). Bouton **« Importer l'atlas »**
  (`api.importToWorld`). Repli sur la liste manuelle du codex si l'astronav est absent.
- **Install/setup party-resources automatique** : au 1er lancement (MJ), les ressources Vivres /
  Carburant / Usure sont **créées automatiquement** dans Party Resources (via `register_resource` +
  `resource_list`), avec libellés et bornes tirés de l'état du vaisseau. Idempotent (ne réécrit pas
  une ressource existante). Menu de réglage *« Installer dans Party Resources »* pour (ré)installer.
- **Distribution GitHub** : manifeste `github.com/wanoo/swffg-holocron/releases/latest`.
- API : `setShipWorld`, `favorites`, `importAtlas`, `setupPartyResources`, `lastCost()` ;
  hook `swffgHolocron.shipMoved`.

## 1.1.0

- **swffg-astronavigation devient une dépendance requise** (≥ 1.4.0) : l'astrogation du poste de
  commande (itinéraires, application du voyage) s'appuie sur ce module désormais indispensable.
- Ce module est l'unique tableau de bord Navi-Computer : la version qui avait été embarquée
  dans swffg-astronavigation (1.1–1.3) est retirée de là (astronav 1.4.0), plus de doublon.

## 1.0.0 — 2026-07-10

- Première version : vaisseau partagé, Holocron (allégeance, position, équipage,
  alignement PNJ, HoloNet, mondes d'intérêt), boîte à outils MJ (7 outils), pont Astronav.
