/** SWFFG Holocron — widgets Campaign Codex embarqués (addon fondu dans le module).
 *  - Resource Bar : jauges segmentées génériques (posables sur toute fiche CC).
 *  - Quest Graph : graphe des quêtes (unlocks/dépendances) pour le MJ.
 *  - Ressources du vaisseau : Resource Bar LIÉE à flags.holocron.ship — le widget
 *    est l'UI Foundry de l'état vaisseau, la SEULE source de vérité reste le flag
 *    (lu/écrit aussi par l'app web et les voyages astronav). Remplace
 *    fvtt-party-resources. */
import { t, readShip, writeShip } from "../util.mjs";
import { createResourceBarWidget } from "./resource-bar.mjs";
import { createQuestGraphWidget } from "./quest-graph.mjs";

export function registerHolocronWidgets() {
  const ccApi = game.modules.get("campaign-codex")?.api;
  if (!ccApi?.widgetManager || !ccApi?.CampaignCodexWidget) {
    console.warn("swffg-holocron | API Campaign Codex absente — widgets non enregistrés");
    return;
  }
  const { CampaignCodexWidget, widgetManager } = ccApi;
  const ResourceBarWidget = createResourceBarWidget(CampaignCodexWidget);
  const QuestGraphWidget = createQuestGraphWidget(CampaignCodexWidget);

  /** Jauges du vaisseau : getData/saveData mappés sur flags.holocron.ship. */
  class ShipResourceBarWidget extends ResourceBarWidget {
    async getData() {
      const s = readShip(this.document);
      return {
        title: s.name || t("deck.title"),
        bars: [
          { name: t("ship.provisions"), max: s.vivresMax, current: s.vivres },
          { name: t("ship.fuel"), max: s.fuelMax, current: s.fuel },
          { name: t("ship.wearPct"), max: 100, current: s.usure },
        ],
      };
    }
    async saveData(data) {
      const s = readShip(this.document);
      const [v, f, u] = Array.isArray(data?.bars) ? data.bars : [];
      await writeShip(this.document, {
        ...s,
        ...(v ? { vivres: v.current, vivresMax: v.max } : {}),
        ...(f ? { fuel: f.current, fuelMax: f.max } : {}),
        ...(u ? { usure: u.current } : {}), // l'usure reste bornée 0-100 (clampShip)
      });
    }
  }

  widgetManager.registerWidget("Resource Bar", ResourceBarWidget);
  widgetManager.registerWidget("Quest Graph", QuestGraphWidget);
  widgetManager.registerWidget("Ressources du vaisseau", ShipResourceBarWidget);
  console.log("swffg-holocron | widgets Campaign Codex enregistrés (Resource Bar, Quest Graph, Ressources du vaisseau)");
}
