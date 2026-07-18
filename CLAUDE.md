# swffg-holocron — contexte projet (Claude Code)

Compagnon de campagne **Star Wars FFG** sur Foundry VTT — Foundry = source de vérité (SSOT).

## Lis d'abord

- **[docs/ASTRONAV-SYNC.md](docs/ASTRONAV-SYNC.md)** — **contrat d'intégration avec le module
  `swffg-astronavigation`** (astrogation) et **décisions d'architecture verrouillées**. À respecter
  pour avancer en synchro avec l'autre projet (`../swffg-astronavigation`, dépôt voisin dans `modules/`).
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) et [docs/CONFIG.md](docs/CONFIG.md).

## À retenir (résumé du contrat — v2 « 100 % Campaign Codex »)

- `swffg-astronavigation` = brique astrogation **réutilisable** (module Foundry, GitHub,
  requis Campaign Codex). Ce projet en a une **dépendance obligatoire** ; il ne
  ré-implémente **pas** la carte ni le calcul.
- **Fiches = Campaign Codex** (`flags.campaign-codex`) : npc / group / location / region /
  shop / quest — MEJ et fvtt-party-resources **ne sont plus des dépendances** (conversion
  auto par le module, lecture MEJ en repli le temps de la transition).
- **Favoris = tag « Favori »** sur la fiche planète CC (`data.tags`, indexé Asset Librarian)
  + index compact `config.favorites`.
- **Ressources du vaisseau = `flags.holocron.ship`** (seule source de vérité — widget CC
  « Ressources du vaisseau », app web, deck) ; le hook `swffgAstronav.cost` déduit ce flag.
- **Événements datés = Mini Calendar** (`wgtgm-mini-calendar`, epoch an 0 = 35 BBY).
- Le Holocron **absorbe** l'ancien `swffg-command-deck` (dashboard + macros MJ + structure) —
  qui cesse d'être un module autonome.

Détails, API, formats de données : voir `docs/ASTRONAV-SYNC.md` (bloc CONTRAT v2 en tête).

## Suivi, build & déploiement (Claude)

Ce dépôt = l'app web **« Archive Holocron »** + le module Foundry dans **`module-foundry/`**
(anciennement `foundry/`). Il vit désormais sous `star-wars JDR/modules/swffg-holocron/`.

- **GitHub** : **wanoo/swffg-holocron** — branche locale `main-release` → remote `main`
  (`git push origin main-release:main`). Connecteur MCP : **wanoo/foundry-mcp-gateway** (Rust, 126 outils ; l'ancien fork TS wanoo/foundry-vtt-mcp est archivé).
- **Issues / PR** : `gh issue list -R wanoo/swffg-holocron` · `gh pr list -R wanoo/swffg-holocron`.
- **Module Foundry (v2.x)** : packs LevelDB `node module-foundry/build_pack.mjs` ;
  zip `cd module-foundry && python build.py --zip` → `dist/swffg-holocron.zip` + `dist/module.json` ;
  release `gh release create vX.Y.Z -R wanoo/swffg-holocron module-foundry/dist/swffg-holocron.zip module-foundry/dist/module.json`.
- **Déploiement app web (Clever)** : `clever deploy -a preprod|prod|staging-org` — `prod`
  = public **sw-wanoo-holocron** (historique divergent → souvent `--force`). Infra/env : [[swffg-holocron-service]].

