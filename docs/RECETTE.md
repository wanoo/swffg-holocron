# RECETTE — valider un monde « 100 % Campaign Codex »

Checklist de validation d'un monde Foundry équipé du module `swffg-holocron` (≥ 2.1.1),
à dérouler après installation / mise à jour, et avant de désactiver les anciens modules.
Prérequis actifs : `starwarsffg`, `swffg-astronavigation`, `campaign-codex`,
`wgtgm-mini-calendar` (+ recommandé : `asset-librarian`).

## 1. Installation automatique

Charger le monde avec un compte **MJ dans un navigateur** (l'installation ne tourne pas
sur le bot MCP headless). À la première connexion après mise à jour :

- [ ] Notification « Holocron installé : … » (ou aucune erreur console `swffg-holocron |`).
- [ ] Dossiers clés présents : 🎬 Actes, 🏛️ Organisations, 🎭 Personnages rencontrés,
      📓 Notes des joueurs, 📖 Règles & Références (FR), 📅 Événements, 🎯 Quêtes,
      🎲 MJ — Bible de campagne, 👥 Personnages joueurs, 🎭 PNJ de campagne.
- [ ] Journaux techniques rangés dans 🛠️ Holocron — Système ; **⚙️ Holocron Config**
      unique (pas de doublon quasi vide).
- [ ] Règles importées (📖) + tables critiques (🩸 / 🔥) présentes.
- [ ] Si Campaign Codex était inactif, une **notification d'avertissement** l'a signalé
      (la conversion ne tourne pas sans lui).

## 2. Fiches Campaign Codex (conversion MEJ)

- [ ] **Aucune fiche MEJ hors du dossier 🗄️ Archive MEJ** (les originaux convertis y sont).
- [ ] Les PNJ / organisations sont des fiches CC (`npc` / `group`) : la sheet CC s'ouvre,
      nom + image + texte repris.
- [ ] Statuts conservés : pastille Allié/Ennemi/… et † (via `flags.holocron.statut/mort`).
- [ ] Relations (personne ↔ organisation) cliquables sur les fiches CC.
- [ ] Relance possible à tout moment : réglages du module → « Convertir les fiches MEJ »
      (idempotent).

## 3. Calendrier & frise

- [ ] Journal « Calendar Events - Mini Calendar » : pages `<année>-MM-JJ` (année non
      paddée, négatifs admis), 20 dates canon présentes (icône `fas fa-jedi`).
- [ ] Plus de fiches événements actives dans 📅 Événements (converties → archivées).
- [ ] Réglage « epochBBY » = 35 (an 0 du calendrier = 35 BBY).

## 4. Vaisseau

- [ ] La fiche 🚀 Vaisseau du groupe est une fiche CC `location` portant le widget
      **« Ressources du vaisseau »** (vivres / carburant / usure).
- [ ] Modifier une jauge dans le widget → visible dans le deck 📡 Holocron et
      inversement (source unique : `flags.holocron.ship`).
- [ ] Un jet d'**Astrogation réussi** (via l'astronav) déduit vivres/carburant/usure et
      déplace le marqueur « vous êtes ici ».

## 5. Favoris (mondes)

- [ ] ★ sur une fiche planète de l'atlas astronav (MJ) → tag « Favori » posé sur la fiche.
- [ ] Le favori apparaît dans `#/astronav` de l'app web (et réciproquement au toggle web).

## 6. Désactivation des anciens modules

Quand les points 1–5 passent : désactiver **Monk's Enhanced Journal** et
**fvtt-party-resources** dans le monde, recharger, puis vérifier :

- [ ] Aucune erreur console au chargement liée à MEJ / party-resources.
- [ ] Les fiches CC s'ouvrent et s'éditent normalement.
- [ ] Deck 📡, boîte à outils 🧰, jauges vaisseau, frise : tous fonctionnels.

## 7. App web (si déployée)

- [ ] `#/vaisseau` : jauges + position + fiche véhicule + notes d'équipage.
- [ ] `#/timeline` : frise complète (canon + campagne).
- [ ] Fiches PNJ/orgs : carte d'identité (type, statut, attributs, relations cliquables).
- [ ] MJ : `#/mj/quetes` (graphe des quêtes), « Montrer aux joueurs » sur une image.
- [ ] Aucune erreur dans `GET /api/sync/status` (santé de la synchro).
