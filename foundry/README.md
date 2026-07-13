# SWFFG Holocron — Poste de commande de campagne

Module [Foundry VTT](https://foundryvtt.com/) pour le système **Star Wars FFG** (`starwarsffg`).
Le poste de commande de votre campagne, en une fenêtre :

- **🚀 Vaisseau du groupe** — vivres, carburant, usure adossés au **pool partagé
  [fvtt-party-resources](https://foundryvtt.com/packages/fvtt-party-resources)** ; ravitaillement,
  plein, révision et application de voyages en un clic. C'est un **POI Monk's Enhanced Journal**
  dont la position pilote le marqueur « vous êtes ici » de l'astronav.
- **🖥️ Tableau de bord holographique** — allégeance du groupe (éditable), position actuelle
  (avec l'image de la planète si [swffg-astronavigation](https://github.com/wanoo/swffg-astronavigation) est
  actif), équipage (les personnages assignés aux joueurs), **alignement des PNJ**
  (alliés / neutres / ennemis, édité en jeu), panneau **HoloNet** (un journal au choix) et
  **mondes d'intérêt = favoris Monk's Enhanced Journal** (clic → fiche, 🧭 → destination astronav).
- **🧰 Boîte à outils MJ** — test de Peur, points de Destin (jet de début de séance), dégâts /
  stress de groupe, blessures critiques (RollTables configurables), fin de rencontre,
  initiative de groupe, **générateur de boutiques** (compendiums configurables).
- **🪐 Pont Astronav** — un **jet d'Astrogation réussi** applique automatiquement le coût du
  voyage au vaisseau (déduction du pool party-resources) **et déplace le POI** vers la destination.
  Bouton **« Appliquer le trajet calculé »** pour appliquer sans jet. Le calculateur lit l'usure
  réelle du vaisseau pour la difficulté du test.

## Installation

Dans Foundry : **Add-on Modules → Install Module**, puis colle l'URL du manifeste :

```
https://github.com/wanoo/swffg-holocron/releases/latest/download/module.json
```

**Dépendances requises** (Foundry propose de les installer) :
[swffg-astronavigation](https://github.com/wanoo/swffg-astronavigation) ·
[fvtt-party-resources](https://foundryvtt.com/packages/fvtt-party-resources) ·
[Monk's Enhanced Journal](https://foundryvtt.com/packages/monks-enhanced-journal).

Active le module dans ton monde. Deux boutons apparaissent dans les contrôles de scène
(groupe jetons) : **📡 Holocron** (tout le monde) et **🧰 Boîte à outils** (MJ).

**Setup party-resources — automatique** : au 1er lancement (MJ), le module **crée tout seul** les
trois ressources (Vivres, Carburant, Usure) dans Party Resources d'après l'état du vaisseau.
Pour (ré)installer à la main : *Réglages du module → « Installer dans Party Resources »*.
Les ids sont configurables (`resFoodId` / `resFuelId` / `resWearId`, défauts `vivres` / `carburant`
/ `usure`). Sans Party Resources, le journal du vaisseau fait foi (dégradation gracieuse).

## API

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
api.lastCost();                              // dernier coût d'astrogation reçu
```

Hooks émis : `swffgHolocron.shipUpdated(ship)` · `swffgHolocron.codexUpdated(codex)` ·
`swffgHolocron.shipMoved({from, to})`.
Hooks écoutés (astronav) : `swffgAstronav.cost({from, to, days, fuel, usure})` (mémorisé) et
`ffgDiceMessage` (jet d'Astrogation réussi → application du voyage + déplacement du POI).

## Données & compatibilité

Le **pool de ressources** (vivres/carburant/usure) vit dans **fvtt-party-resources** quand il est
présent ; sinon dans un **flag de module** du journal vaisseau. Codex et HoloNet vivent dans des
flags de module sur des journaux liés (noms configurables). Les mondes issus de l'ancien
`swffg-command-deck` (ou des macros « holocron » historiques) sont **migrés automatiquement**.

## Règle maison — ressources du vaisseau

Vivres 1/jour de voyage · carburant 1/case (+50 % hors réseau) · l'usure monte avec la durée
et le hors-piste ; > 50 % : +1 difficulté d'Astrogation, > 80 % : +2 (appliqué par swffg-astronavigation).

## Licence

Contenu de module sous licence MIT. Star Wars et les marques associées appartiennent à leurs
ayants droit ; ce module est un outil de fans, non affilié.
