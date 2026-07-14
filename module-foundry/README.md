# SWFFG Holocron — Poste de commande de campagne

Module [Foundry VTT](https://foundryvtt.com/) pour le système **Star Wars FFG** (`starwarsffg`) :
le **poste de commande** de votre campagne (vaisseau, tableau de bord holographique, boîte à
outils MJ, pont vers l'astronav) **plus** une **structure de campagne prête à l'emploi**
(dossiers, règles FR, macros, échantillon de test) et un **compagnon web optionnel**
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
> Ajoute le connecteur + l'app (partie 6).

---

## 2. Installation du module (pour tout le monde)

Dans Foundry : **Add-on Modules → Install Module**, colle l'URL du manifeste :

```
https://github.com/wanoo/swffg-holocron/releases/latest/download/module.json
```

**Dépendances requises** — Foundry propose de les installer automatiquement :

- [swffg-astronavigation](https://github.com/wanoo/swffg-astronavigation) (≥ 1.6.0) — astrogation, carte galactique, atlas MEJ des planètes, marqueur « vous êtes ici ».
- [fvtt-party-resources](https://foundryvtt.com/packages/fvtt-party-resources) — pool partagé du groupe (vivres / carburant / usure).
- [Monk's Enhanced Journal](https://foundryvtt.com/packages/monks-enhanced-journal) — fiches PNJ / organisations / lieux typées.
- Système **Star Wars FFG** (`starwarsffg`).

Active le module dans ton monde. Deux boutons apparaissent dans les contrôles de scène
(groupe *jetons*) : **📡 Holocron** (tout le monde) et **🧰 Boîte à outils** (MJ).

### Ressources du vaisseau — 100 % automatique
Au **premier lancement par le MJ**, le module **crée tout seul** les trois ressources dans
Party Resources d'après l'état du vaisseau : **🥫 Vivres** (jours), **⛽ Carburant** (points),
**🔧 Usure** (%). Rien à configurer. Pour (ré)installer à la main :
*Configurer les réglages → Réglages du module → « Installer dans Party Resources »*.
Les identifiants sont réglables (`resFoodId` / `resFuelId` / `resWearId`). Sans Party Resources,
le journal du vaisseau prend le relais (dégradation gracieuse).

---

## 3. Ce que le module apporte à votre monde (compendiums)

> Bundlés dans le module, à **importer dans le monde** au besoin (glisser depuis les
> compendiums, ou via les macros d'installation).

- **📖 Règles & Références (FR)** — l'aide de jeu traduite : mécanique de base, compétences,
  combat, Force & Moralité, équipement, vaisseaux, fabrication, plus les fiches d'aide
  (dés & symboles, dépense d'avantages/menaces, etc.).
- **⚙️ Structure & Config** — le journal **📁 Structure de campagne** qui décrit
  l'arborescence de dossiers à recréer (voir §4). Le journal **⚙️ Holocron Config** est
  créé par l'app web (`POST /api/gm/bootstrap`), pas par ce pack.
- **🎲 Macros MJ** — voir §5.
- **🧪 Échantillon de test** — deux fiches MEJ d'exemple (une *organisation*, un *contact*)
  pour vérifier l'installation d'un coup d'œil.
- **📅 Événements canon** — 20 dates clés de la galaxie (232 BBY → 9 ABY) en fiches MEJ
  *event* datées en BBY/ABY (attribut `date`). Alimente la frise chronologique de
  l'Archive Holocron (`packs.events` dans ⚙️ Holocron Config) ; importables dans le
  monde comme modèles pour vos propres événements de campagne.

---

## 4. Structure de campagne (dossiers)

Le module et l'app web s'appuient sur une **convention de dossiers** (renommables via les
réglages / le journal de config). Recréer cette arborescence suffit à tout faire fonctionner.

**Dossiers de JOURNAUX**
- `🎬 Campagne — Actes` — la trame jouée (un journal par Acte).
- `🏛️ Organisations` — fiches **MEJ *organization*** (factions, corporations).
- `🎭 Personnages rencontrés` — fiches **MEJ *person*** (PNJ ; le *rôle* MEJ pilote la
  pastille Allié / Ennemi / Mentor / Neutre / Contact, l'attribut *Vie* = « mort » → †).
- `📓 Notes des joueurs` — notes libres par joueur.
- `🎲 MJ — Bible de campagne` — le **contenu MJ** (voir §6), non exposé aux joueurs.
- Journaux **nommés** (réglables) : `🚀 Vaisseau du groupe`, `🖥️ Codex du groupe`,
  `📡 HoloNet — Actualités`, `🌍 Mondes d'intérêt`.

**Dossiers d'ACTEURS**
- `👥 Personnages joueurs` — les PJ (assignés aux comptes joueurs).
- `🎭 PNJ de campagne` — les PNJ à statistiques (bestiaire du MJ).
- `⚔️ Rencontres` — acteurs/tokens montés par la boîte à outils pour les combats.

Chaque fiche **MEJ** (person/organization/place) est la **source de vérité** : type, rôle,
attributs, **relations** (personne ↔ organisation, etc.) sont lus tels quels par l'app web.

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
  (règles/adversaires), `journals` (ship/codex/holonet/poi), `npcsWorldFolder`, `registry`
  (nom → acteur), `campaignPlanets`. Édite-le pour adapter les noms de dossiers.
- **🎲 MJ — Bible de campagne** — les chapitres MJ (vérités, PNJ & fronts, suivi XP, visions,
  cockpit de table…). Réservé au MJ (ownership), non exposé aux joueurs.
- **Dossiers narratifs** (`flags.holocron.dossiers`) — couche MJ « par fiche » (rôle, ce qu'il
  veut, attitude, réplique) superposée aux PNJ, éditable depuis l'app web.
- **Statut / allégeance des PNJ** — porté par la fiche **MEJ** (rôle + attribut Vie) ; repli
  `flags.holocron.statut` / `.mort` (écrit par la macro « 🎭 Statut PNJ »).
- **Vaisseau / Codex / HoloNet** — vivent dans des `flags` de module sur leurs journaux liés ;
  le pool de ressources vit dans **fvtt-party-resources** quand présent, sinon dans le flag.

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
await api.ship();                            // état courant du vaisseau
await api.favorites();                       // favoris MEJ (noms de mondes)
api.importAtlas();                           // importe le compendium des planètes dans le monde
api.setupPartyResources({ force: true });    // (ré)installe les ressources du groupe
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
