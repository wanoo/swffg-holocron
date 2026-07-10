// gm-config.js — configs MJ persistées côté serveur (gated), clés `gm:cfg:*`.
// La valeur vit dans le champ `html` du store docs sous forme de JSON versionné
// ({ v: 1, … }) : aucune nouvelle route serveur, concurrence 409 déjà gérée.
// `updatedBy` n'est jamais 'bible' → le seed ne purge pas ces documents.
import { gmGet, gmSave, getAuthor } from './collab.js';

// Charge une config (fusionnée avec ses défauts). Renvoie { cfg, updatedAt }.
export async function loadCfg(name, defaults) {
  try {
    const doc = await gmGet(`cfg:${name}`);
    if (doc && doc.html) {
      const parsed = JSON.parse(doc.html);
      return { cfg: { ...defaults, ...parsed }, updatedAt: doc.updatedAt ?? null };
    }
  } catch { /* absent / offline / JSON cassé → défauts */ }
  return { cfg: { ...defaults }, updatedAt: null };
}

// Enregistre une config. En cas de conflit (édition sur un autre appareil),
// renvoie { conflict: true, current } — l'appelant recharge et refusionne.
export async function saveCfg(name, cfg, baseUpdatedAt) {
  const res = await gmSave(`cfg:${name}`, JSON.stringify(cfg), baseUpdatedAt, getAuthor());
  if (res.conflict) {
    let current = null;
    try { current = JSON.parse(res.current.html); } catch { /* garde null */ }
    return { conflict: true, current, updatedAt: res.current.updatedAt };
  }
  return { ok: true, updatedAt: res.updatedAt };
}
