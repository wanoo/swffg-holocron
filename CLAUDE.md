# swffg-holocron — contexte projet (Claude Code)

Compagnon de campagne **Star Wars FFG** sur Foundry VTT — Foundry = source de vérité (SSOT).

## Lis d'abord

- **[docs/ASTRONAV-SYNC.md](docs/ASTRONAV-SYNC.md)** — **contrat d'intégration avec le module
  `swffg-astronavigation`** (astrogation) et **décisions d'architecture verrouillées**. À respecter
  pour avancer en synchro avec l'autre projet (`~/Documents/Dev/star-wars JDR/swffg-astronavigation`).
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) et [docs/CONFIG.md](docs/CONFIG.md).

## À retenir (résumé du contrat)

- `swffg-astronavigation` = brique astrogation **réutilisable** (module Foundry, GitHub, requis MEJ).
  Ce projet en a une **dépendance obligatoire** ; il ne ré-implémente **pas** la carte ni le calcul.
- **Favoris = marque-pages Monk's Enhanced Journal** partout. Compendium MEJ prioritaire.
- **Ressources = `fvtt-party-resources`** (dépendance côté Holocron) ; brancher le hook
  `swffgAstronav.cost` (émis par le module) pour déduire le pool.
- Le Holocron **absorbe** l'ancien `swffg-command-deck` (dashboard + macros MJ + structure) —
  qui cesse d'être un module autonome.

Détails, API, formats de données : voir `docs/ASTRONAV-SYNC.md`.
