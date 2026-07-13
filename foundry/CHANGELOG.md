# Changelog

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
