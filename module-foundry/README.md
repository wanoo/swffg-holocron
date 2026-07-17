# SWFFG Holocron — Poste de commande de campagne

Module [Foundry VTT](https://foundryvtt.com/) pour le système **Star Wars FFG** (`starwarsffg`) :
le **poste de commande** de votre campagne (vaisseau, tableau de bord holographique, boîte à
outils MJ, pont vers l'astronav) **plus** une **structure de campagne prête à l'emploi**
(dossiers, règles FR, macros, tables critiques, dates canon) et un **compagnon web optionnel**
(l'« Archive Holocron ») qui affiche vos fiches/journaux hors de Foundry.

---

## 1. Vue d'ensemble (l'architecture, en clair)

Trois briques, dont **une seule est obligatoire** :

| Brique | Rôle | Obligatoire ? |
|---|---|---|
| **Module Foundry `swffg-holocron`** | Ce dépôt. Poste de commande + structure de campagne. | ✅ Oui |
| **App web « Archive Holocron »** | Site compagnon (lecture des fiches/journaux/PNJ hors Foundry, jets, guide de dépense). | ⬜ Optionnel |
| **Connecteur MCP (`foundry-mcp`)** | Le tuyau entre Foundry et l'app web. | ⬜ Seulement si l'app web |

> **Tu veux juste jouer dans Foundry ?** Installe le module (partie 2) — c'est tout.
> **Tu veux aussi l'app web (fiches consultables au téléphone, écran MJ, jets guidés) ?**
> Ajoute le connecteur + l'app (partie 7).

---

## 2. Installation du module (pour tout le monde)

Dans Foundry : **Add-on Modules → Install Module**, colle l'URL du manifeste :

```
https://github.com/wanoo/swffg-holocron/releases/latest/download/module.json
```

**Dépendances requises** — Foundry propose de les installer automatiquement :

- [swffg-astronavigation](https://github.com/wanoo/swffg-astronavigation) (≥ 1.7.2) — astrogation, carte galactique, atlas des mondes (fiches Campaign Codex), marqueur « vous êtes ici ».
- [Campaign Codex](https://campaigncodex.wgtngm.com/) (`campaign-codex`) — fiches typées liées : PNJ, lieux, organisations, boutiques, quêtes.
- [Mini Calendar](https://campaigncodex.wgtngm.com/minicalendar/) (`wgtgm-mini-calendar`) — calendrier galactique et événements datés (frise BBY/ABY de l'Archive Holocron).
- Système **Star Wars FFG** (`starwarsffg`).

**Recommandés** : [Asset Librarian](https://campaigncodex.wgtngm.com/asset-librarian/) (navigation
et tags des fiches — les **favoris** de l'atlas s'appuient dessus), `swffg-sabacc`,
`swffg-workshops` (écosystème de campagne).

> ℹ️ **Plus besoin de** Monk's Enhanced Journal ni de fvtt-party-resources : les fiches sont
> des fiches **Campaign Codex** et les ressources du vaisseau vivent dans le module
> (`flags.holocron.ship`). À la première mise à jour, le module **convertit automatiquement**
> les anciennes fiches MEJ (originaux archivés dans « 🗄️ Archive MEJ ») et **migre** l'ancien
> pool party-resources — les deux modules peuvent ensuite être désactivés.

Active le module dans ton monde. Deux boutons apparaissent dans les contrôles de scène
(groupe *jetons*) : **📡 Holocron** (tout le monde) et **🧰 Boîte à outils** (MJ).

### Installation automatique — zéro config
Au **premier chargement par un MJ** (à chaque mise à jour du module), l'installation auto :
crée les dossiers clés, importe les règles FR et les tables critiques, installe les **20 dates
canon** dans le calendrier Mini Calendar, pose la fiche **Campaign Codex du vaisseau** avec son
widget **« Ressources du vaisseau »** (vivres / carburant / usure), complète le journal
**⚙️ Holocron Config** et range les journaux techniques. Relançable à tout moment :
*Configurer les réglages → swffg-holocron → « Installer / réinstaller »*.

---

## 3. Ce que le module apporte à votre monde (compendiums)

> Bundlés dans le module, **importés automatiquement** par l'installation (ou à la main
> depuis les compendiums).

- **📖 Règles & Références (FR)** — l'aide de jeu traduite : mécanique de base, compétences,
  combat, Force & Moralité, équipement, vaisseaux, fabrication, plus les fiches d'aide
  (dés & symboles, dépense d'avantages/menaces, etc.).
- **🎲 Tables critiques (FR)** — les deux RollTables d100 utilisées par la boîte à
  outils MJ (🩸 Blessures critiques, 🔥 Avaries critiques véhicules), avec plages,
  libellés FR et effets condensés.
- **🎲 Macros MJ** — voir §5.
- **⚙️ Structure & Config** — le journal **📁 Structure de campagne** qui décrit
  l'arborescence de dossiers (voir §4).
- **🧪 Échantillon de test** — fiches d'exemple pour vérifier l'installation d'un coup d'œil.

Les **20 dates canon** de la galaxie (232 BBY → 9 ABY) ne sont plus un compendium : elles sont
installées directement comme **notes du calendrier Mini Calendar** (source :
`data/canon-events.json`), mêlées à vos événements de campagne dans la frise de l'Archive.

> 💡 **Bestiaire** : le compendium d'adversaires attendu par l'app web
> (`world.star-wars-adversaries`, réglage « Compendium des adversaires ») s'importe
> avec l'outil **SW Adversaries** du système starwarsffg (importeur de données).

---

## 4. Structure de campagne (dossiers)

Le module et l'app web s'appuient sur une **convention de dossiers** (renommables via les
réglages — nom ou uuid `Folder.<id>`). L'installation auto crée l'arborescence, importe
règles et dates canon, et range les journaux techniques dans le dossier système
(réglage `systemFolder`).

**Dossiers de JOURNAUX**
- `🎬 Campagne — Actes` — la trame jouée (un journal par Acte).
- `🏛️ Organisations` — fiches **Campaign Codex *group*** (factions, corporations).
- `🎭 Personnages rencontrés` — fiches **CC *npc*** (PNJ ; `flags.holocron.statut` pilote la
  pastille Allié / Ennemi / Mentor / Neutre / Contact, `flags.holocron.mort` → †).
- `📅 Événements` — fiches événements héritées (les nouvelles dates vont dans Mini Calendar).
- `🎯 Quêtes` — fiches **CC *quest*** (graphe des quêtes du cockpit MJ web).
- `📓 Notes des joueurs` — notes libres par joueur.
- `🎲 MJ — Bible de campagne` — le **contenu MJ** (voir §6), non exposé aux joueurs.
- Journaux **nommés** (réglables) : `🚀 Vaisseau du groupe`, `🖥️ Codex du groupe`,
  `📡 HoloNet — Actualités`, `🌍 Mondes d'intérêt`.

**Dossiers d'ACTEURS**
- `👥 Personnages joueurs` — les PJ (assignés aux comptes joueurs).
- `🎭 PNJ de campagne` — les PNJ à statistiques (bestiaire du MJ).
- `⚔️ Rencontres` — acteurs/tokens montés par la boîte à outils pour les combats.

Chaque fiche **Campaign Codex** (npc/group/location/shop/quest) est la **source de vérité** :
type, description, image, tags (`data.tags`) et **relations** (liens par uuid : associates,
linkedNPCs, parentRegion…) sont lus tels quels par l'app web ; les surcouches Holocron
(statut, mort, attributs libres) vivent dans `flags.holocron.*` sur la même fiche.

---

## 5. Macros MJ (compendium)

Bundlées et rangées par thème :

- **⚔️ Combat & Table** — 🎲 Pool rapide, 😱 Test de Peur, 🩹 Dégâts-Stress de groupe,
  ☠️ Blessure critique, 🔄 Fin de rencontre, ⚡ Initiative de groupe, ⭐ Points de Destin.
- **🎲📡 Pont de jets Holocron** — à lancer une fois par séance (poste MJ) : évalue avec le
  vrai moteur FFG les jets envoyés depuis l'app web et renvoie le résultat.
- **🧭 Astronav** — Vaisseau / Itinéraire (via l'API `swffg-astronavigation`).
- **🛒 Boutique**, **⚒️ Artisanat**, **🎴/🎲 Sabacc** (si les modules correspondants sont là).

La plupart sont aussi accessibles sans macro via la **🧰 Boîte à outils** (bouton de scène MJ).

---

## 6. Structures clés du mode MJ

- **⚙️ Holocron Config** (journal, `flags.holocron.config`) — LE centre de configuration lu par
  l'app web : `categories` (dossiers → catégories affichées), `gmBibleFolder`, `packs`
  (règles/adversaires), `journals` (ship/codex/holonet/poi/shipNotes), `calendar`
  (`epochBBY`, 35 par défaut : an 0 du calendrier = 35 BBY), `favorites` (index des mondes
  favoris), `npcsWorldFolder`, `registry` (nom → acteur), `campaignPlanets`. **Piloté par les
  options du module** (appliquées à l'installation et à chaque changement de réglage).
- **🎲 MJ — Bible de campagne** — les chapitres MJ (vérités, PNJ & fronts, suivi XP, visions,
  cockpit de table…). Réservé au MJ (ownership), non exposé aux joueurs.
- **Dossiers narratifs** (`flags.holocron.dossiers`) — couche MJ « par fiche » (rôle, ce qu'il
  veut, attitude, réplique) superposée aux PNJ, éditable depuis l'app web.
- **Statut / allégeance des PNJ** — `flags.holocron.statut` / `.mort` sur la fiche CC
  (posés par la conversion MEJ ou la macro « 🎭 Statut PNJ »).
- **Vaisseau** — l'état (vivres, carburant, usure, position) vit dans
  **`flags.holocron.ship`** sur le journal du vaisseau : c'est la **seule source de vérité**,
  affichée par le widget CC « Ressources du vaisseau », l'app web (`#/vaisseau`) et le deck,
  et débitée par les voyages astronav.
- **Favoris (mondes)** — tag **« Favori »** sur la fiche planète (CC `data.tags`, indexé par
  Asset Librarian) + index compact `config.favorites` pour l'app web.

---

## 7. (Optionnel) App web « Archive Holocron » + connecteur MCP

Le compagnon web laisse joueurs et MJ consulter fiches, journaux, bestiaire, lancer des jets
guidés, etc., **sans ouvrir Foundry**. Il **ne modifie jamais** vos données : Foundry reste la
seule source de vérité, l'app **synchronise** via le connecteur.

**En clair, pour un non-technicien :**
1. **Le connecteur `foundry-mcp`** est un petit programme qui se connecte à ton monde Foundry
   (avec un compte dédié, ex. `MCP_Bot`, de rôle Assistant/MJ) et expose ses données.
2. **L'app Holocron** (un petit serveur Node, déployable sur [Clever Cloud](clever-tools) ou en
   Docker) embarque ce connecteur et sert le site. Tu lui donnes :
   - `FOUNDRY_BASE_URL` — l'adresse de ton Foundry (`https://…/ton-monde`) ;
   - les **identifiants** du compte connecteur (`FOUNDRY_CREDENTIALS`, un JSON) ;
   - `SESSION_SECRET` — une phrase secrète pour signer les sessions ;
   - *(option)* un **FS Bucket** monté sur `HOLOCRON_DATA_DIR` pour garder le cache entre
     déploiements.
3. Les joueurs se connectent au site **avec leur compte Foundry** — ils ne voient que ce que
   leur *ownership* Foundry autorise.

> Détails d'exploitation, sécurité et déploiement : dépôt de l'app web (`swffg-holocron`,
> serveur zéro-dépendance). Le module Foundry, lui, est **autonome** — l'app web est un plus.

---

## 8. API & hooks (intégrateurs)

```js
const api = game.modules.get("swffg-holocron").api;
api.open();                                  // ouvre le Holocron
api.toolbox();                               // ouvre la boîte à outils MJ
api.tools.fear();                            // lance un outil directement
await api.applyTrip({ days: 3, fuel: 5, usure: 2, from: "Coruscant", to: "Tatooine" });
await api.setShipWorld("Tatooine");          // déplace le vaisseau + POI « vous êtes ici »
await api.ship();                            // état courant du vaisseau (flags.holocron.ship)
await api.favorites();                       // mondes favoris (tag « Favori » + index config)
api.importAtlas();                           // importe le compendium des planètes dans le monde
await api.install();                         // (ré)installe la structure Holocron
await api.convertMej();                      // convertit les fiches MEJ restantes en fiches CC
api.lastCost();                              // dernier coût d'astrogation reçu
```

Hooks émis : `swffgHolocron.shipUpdated(ship)` · `swffgHolocron.codexUpdated(codex)` ·
`swffgHolocron.shipMoved({from, to})`.
Hooks écoutés (astronav) : `swffgAstronav.cost({from, to, days, fuel, usure})` (mémorisé) et
`ffgDiceMessage` (jet d'Astrogation réussi → application du voyage + déplacement du POI).

---

## 9. Règle maison — ressources du vaisseau

Vivres 1/jour de voyage · carburant 1/case (+50 % hors réseau) · l'usure monte avec la durée et
le hors-piste ; > 50 % : +1 difficulté d'Astrogation, > 80 % : +2 (appliqué par
swffg-astronavigation).

## 10. Licence

Contenu de module sous licence MIT. Star Wars et les marques associées appartiennent à leurs
ayants droit ; ce module est un outil de fans, non affilié.
