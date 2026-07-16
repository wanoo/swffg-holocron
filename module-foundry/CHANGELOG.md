# Changelog

## 2.0.1 — Alignement sur le calendrier « Grande ReSynchronisation »

- **Époque par défaut : 35 BBY** (an 0 du calendrier de la République/Empire) au
  lieu de 300 — colle au calendrier Mini Calendar réel de la campagne (10 mois
  × 35 jours, notes preset fusionnées dans le journal).
- **Nommage des pages aligné sur Mini Calendar** : année NON paddée et années
  NÉGATIVES acceptées (ex. « -197-01-01 » pour 232 BBY) — les événements canon
  installés sont désormais visibles dans le calendrier lui-même.
- App web : la frise trie **au jour près** (mois/jour du calendrier), lit les
  pages d'années négatives, et affiche les **tags CC** (Terrain/Climat/Favori)
  sur les cartes de fiches.

## 2.0.0 — MASTER SWITCH : Campaign Codex + Mini Calendar remplacent MEJ

**Rupture assumée** : le module ne dépend plus de Monk's Enhanced Journal.
Nouvelles dépendances : **Campaign Codex** (fiches typées liées) et
**Mini Calendar** (calendrier & événements) ; Asset Librarian recommandé.
(L'astronavigation garde MEJ jusqu'à sa propre 2.0 — les deux coexistent.)

- **Conversion automatique des fiches MEJ** (installation + menu « Convertir les
  fiches MEJ ») : person→npc, organization→group, place→location, shop→shop,
  quest→quest ; rôle → statut holocron, attribut vie → pastille †, attributs
  libres conservés (flags.holocron.attrs), relations → liens CC, pages texte et
  droits repris, `legacyId` pour les ancres web. **Originaux archivés dans
  🗄️ Archive MEJ, jamais supprimés.** Idempotent.
- **Événements → Mini Calendar** : les fiches MEJ « event » et les 20 dates
  canon deviennent des événements du journal « Calendar Events - Mini Calendar »
  (année calendrier = époque BBY + valeur ; réglage « Époque du calendrier
  galactique », défaut 300 BBY ; icône jedi = Canon). Le pack JournalEntry
  `evenements` est supprimé au profit de `data/canon-events.json`. La frise web
  lit le calendrier (notes MJ masquées aux joueurs) + les fiches MEJ legacy.
- **Vaisseau 100 % holocron** : la page de statut est ancrée par
  `flags.swffg-holocron.bound:"status"` (plus de pagetype MEJ) ; legacy lu.
- **App web** : `sheetView` lit les fiches Campaign Codex ET MEJ (legacy) —
  carte d'identité, statut, relations cliquables identiques quelle que soit la
  source. Packs d'exemple au format CC.

## 1.8.0 — Règles lues depuis le monde, tables critiques embarquées, install sans détour

- **L'app web lit les règles depuis le DOSSIER importé** (catégorie `kind:"rules"`
  déclarée automatiquement par uuid vers « 📖 Règles importées ») — plus de
  compendium à configurer côté web ; préfixes « NN · » retirés à l'affichage, pack
  ignoré si le dossier est déclaré (pas de doublon). Le réglage « Compendium des
  règles » ne pilote plus que la SOURCE de l'import.
- **Nouveau pack « 🎲 Tables critiques (FR) »** : les deux RollTables d100 de la
  boîte à outils MJ (🩸 Blessures critiques — 29 résultats avec gravité de soin,
  🔥 Avaries critiques véhicules — 19 résultats), plages/libellés dérivés des pages
  de règles, effets condensés. **Importées automatiquement** : l'outil « Blessure
  critique » fonctionne d'office.
- **Installation sans détour** : le dossier 🛠️ système est créé AVANT les fiches
  liées — plus de journaux déposés à la racine puis déplacés.
- **Notes du vaisseau par défaut** : la page 📓 Notes d'équipage du journal POI
  vaisseau (page existante adoptée, sinon créée) — plus d'uuid à coller ;
  `writeShip` cible la page de statut par flag MEJ (la page notes est intouchable).
- **Compendium adversaires** : défaut `world.star-wars-adversaries` (import via
  l'outil SW Adversaries du système).

## 1.7.1 — Convention des fiches événement alignée sur MEJ + POI vaisseau

- **Fiches événement canon corrigées** : la date BBY/ABY est désormais dans le
  champ **natif « Date »** de la fiche event MEJ, et **« Position » (location) =
  Canon / Campagne** — la convention des fiches faites à la main. Le lieu réel
  devient l'attribut `lieu`. Fiches canon visibles des joueurs (OBSERVER).
- **La fiche 🚀 vaisseau est un POI MEJ** (type `poi`, plus `person`) — comme la
  fiche de référence du monde.
- App web : lecture tolérante des deux conventions (champs natifs + anciens
  attributs, valeurs `{value}` dépliées) et **frise redessinée** — compacte,
  groupée par ère (avant/après Yavin), or = Canon / bleu holo = Campagne.

## 1.7.0 — Bootstrap complet d'une installation fraîche + répertoires clés en options

- **Installation fraîche = monde prêt à jouer** : répertoires clés, fiches liées
  du poste de commande créées d'emblée (**🚀 POI vaisseau** — fiche MEJ,
  🖥️ Codex, 📡 HoloNet), **toutes les règles importées** (compendium du monde ou
  du module), **20 dates canon** dans le dossier d'événements, config web
  complétée et journaux techniques rangés.
- **Chaque répertoire clé a son option** (nom ou uuid `Folder.<id>`) : Actes,
  Organisations, Personnages rencontrés, Notes des joueurs, Règles importées,
  Événements, Bible MJ, dossier d'acteurs PJ, dossier d'acteurs PNJ, dossier
  système. Les catégories de l'app web sont déclarées depuis ces options ;
  changer un dossier = modifier l'option puis « Installer / réinstaller »
  (PJ/PNJ/Bible s'appliquent immédiatement).

## 1.6.0 — La config web pilotée par les OPTIONS du module

- Nouveaux réglages Foundry (appliqués à la volée et à chaque installation) :
  **Compendium des règles** (vide = auto-détection d'un pack « règles », repli sur
  celui du module), **Compendium des adversaires**, **Dossier Bible MJ** et
  **Page de notes du vaisseau** (accepte l'uuid copié depuis Foundry
  `JournalEntry.….JournalEntryPage.…` ou `<journalId>:<pageId>`).
- Règle de fusion : un champ vide de ⚙️ Holocron Config se remplit depuis le
  réglage ; un réglage modifié par le MJ gagne ; sinon la config existante prime.
  Plus AUCUNE édition manuelle du journal ⚙️ n'est nécessaire.

## 1.5.6 — Auto-guérison : config renommée ramenée au nom attendu

- Si la vraie configuration (repérée par son flag `holocron.config`, la plus
  riche) a été **renommée**, l'installation la **renomme automatiquement** vers
  le nom du réglage `configJournal` — c'est par nom que l'app web la synchronise.

## 1.5.5 — FIX : doublon de ⚙️ Holocron Config (règles disparues du web)

- Les installeurs 1.5.1→1.5.4 pouvaient créer un **second** journal
  « ⚙️ Holocron Config » quasi vide ; l'app web pouvait alors synchroniser la
  coquille au lieu de la vraie config (catégories et `packs.rules` perdus →
  plus de règles affichées).
- Le module choisit désormais **la config la plus riche** parmi les journaux
  candidats (flag `holocron.config` ou nom homonyme, comparaison tolérante aux
  variantes d'emoji/espaces), ne crée plus jamais de doublon, et **supprime
  automatiquement** les coquilles homonymes quasi vides (< 600 caractères, sans
  packs ni registre) créées par les versions précédentes.
- Côté app web (déployé) : la sync trie aussi les homonymes par richesse de
  config — double ceinture.

## 1.5.4 — FIX : les compendiums de journaux étaient vides dans Foundry

- **Bug depuis la 1.3.0** : les 4 packs JournalEntry (📖 Règles, ⚙️ Structure,
  🧪 Échantillon, 📅 Événements canon) étaient compilés avec des clés LevelDB
  `!journalentry!<id>` au lieu du format Foundry `!journal!<id>` +
  `!journal.pages!<jid>.<pid>` — Foundry n'y voyait **aucune entrée**. Les
  sources sont corrigées (pages désormais en clés séparées, comme les packs de
  l'astronav) ; le pack 🎲 Macros n'était pas touché (`!macros!` correct).
- Après mise à jour : les compendiums affichent enfin leur contenu, et
  l'installation auto (rejouée à la mise à jour) peut importer règles et
  événements dans le monde.

## 1.5.3 — Les règles s'importent depuis le compendium du monde

- L'import des règles copie désormais depuis le **compendium déclaré par la
  config web** (`packs.rules`, ex. `world.regles-and-references-fr`) quand il
  existe — repli sur le pack embarqué `swffg-holocron.regles` sinon.
- Déduplication par **nom normalisé** (préfixes de tri « NN · » ignorés) : pas
  de doublon entre versions du monde et versions du module.

## 1.5.2 — Le journal de config devient un réglage du module

- Nouveau réglage **« Journal de configuration (app web) »** (`configJournal`,
  défaut `⚙️ Holocron Config`) : l'installeur le cherche/crée sous ce nom, comme
  les autres journaux liés (vaisseau, codex, HoloNet). Doit correspondre à
  `CONFIG_JOURNAL_NAME` côté Archive Holocron. La détection par flag
  (`flags.holocron.config`) reste prioritaire — un journal renommé est retrouvé.

## 1.5.1 — La config de campagne se complète toute seule

- **⚙️ Holocron Config n'a plus besoin d'être éditée à la main** : l'installation
  crée le journal s'il manque et **ajoute les catégories absentes** (Actes/story,
  Organisations/org, Personnages/pc, Notes/notes) + la **catégorie timeline**,
  pointée par uuid `Folder.<id>` (stable au renommage) vers le dossier d'événements.
  Celui-ci est détecté automatiquement : catégorie déjà déclarée → **dossier
  contenant des fiches MEJ « event »** → dossier « 📅 Événements » créé. Les champs
  `gmBibleFolder` / `pcFolder` / `npcsWorldFolder` vides sont aussi remplis.
  **Rien de déjà déclaré n'est jamais écrasé.**
- L'installation auto se rejoue **à chaque mise à jour du module** (marqueur par
  version, opérations idempotentes) — plus besoin du menu pour bénéficier des
  nouveaux compléments.

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
