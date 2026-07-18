// ui-shared.js — helpers PURS (sans DOM ni fetch) partagés par le front et les
// tests node (server/test importe ce module directement).

// « Dernier » élément par tri NATUREL sur le nom (« Acte 2 » < « Acte 10 ») :
// choix le plus robuste pour désigner le dernier acte joué — les actes sont
// préfixés « Acte N » et un tri numérique par nom est stable, contrairement à
// la date de modif (une retouche d'un vieil acte le ferait remonter).
export function latestByName(items, getName = (x) => x?.name) {
  let best = null;
  for (const it of items || []) {
    if (it == null) continue;
    if (!best || String(getName(it) ?? '').localeCompare(String(getName(best) ?? ''), 'fr', { numeric: true, sensitivity: 'base' }) > 0) {
      best = it;
    }
  }
  return best;
}
