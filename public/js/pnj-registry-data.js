// pnj-registry-data.js — registre des personnages de campagne, servi par la
// config Foundry (⚙️ Holocron Config → registry). Plus aucune donnée en dur :
// ce module n'expose que la mécanique de routage et un getter dynamique.
import { Data } from './data.js';

export const ROUTE = { pc: '#/pc/', npc: '#/npc/', adv: '#/adv/' };

// getter dynamique : la config est chargée par loadData() avant tout rendu.
export const REGISTRY = new Proxy([], {
  get(target, prop) {
    const src = Data.config?.registry || [];
    if (prop === 'length') return src.length;
    if (prop === Symbol.iterator) return src[Symbol.iterator].bind(src);
    return typeof src[prop] === 'function' ? src[prop].bind(src) : src[prop];
  },
});
