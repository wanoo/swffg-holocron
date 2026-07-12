// transform/actors.mjs — Actor Foundry (starwarsffg, v1 export ou v2 live) →
// formes de fiches consommées par le front (mêmes clés que les anciens
// pcs.json / world-npcs.json / adversaries.json). Transformations TOLÉRANTES :
// chaque champ a un repli, une fiche incomplète rend une fiche partielle.

const num = (v, d = 0) => (Number.isFinite(+v) ? +v : d);
const str = (v, d = '') => (v == null ? d : String(v));
const val = (v, d = 0) => num(v && typeof v === 'object' ? v.value : v, d);

// Noms FR des compétences FFG standard (clé = clé système EN normalisée).
const SKILL_FR = {
  ASTRO: ['Astrogation', 'Astrogation', 'Intellect', 'General'],
  ATHL: ['Athlétisme', 'Athletics', 'Brawn', 'General'],
  BRAWL: ['Pugilat', 'Brawl', 'Brawn', 'Combat'],
  CHARM: ['Charme', 'Charm', 'Presence', 'General'],
  COERC: ['Coercition', 'Coercion', 'Willpower', 'General'],
  COMP: ['Informatique', 'Computers', 'Intellect', 'General'],
  COOL: ['Sang-froid', 'Cool', 'Presence', 'General'],
  COORD: ['Coordination', 'Coordination', 'Agility', 'General'],
  CORE: ['Connaissances (Mondes du Noyau)', 'Core Worlds', 'Intellect', 'Knowledge'],
  DECEP: ['Tromperie', 'Deception', 'Cunning', 'General'],
  DISC: ['Discipline', 'Discipline', 'Willpower', 'General'],
  EDU: ['Connaissances (Éducation)', 'Education', 'Intellect', 'Knowledge'],
  GUNN: ['Artillerie', 'Gunnery', 'Agility', 'Combat'],
  LEAD: ['Commandement', 'Leadership', 'Presence', 'General'],
  LTSABER: ['Sabre laser', 'Lightsaber', 'Brawn', 'Combat'],
  LORE: ['Connaissances (Traditions)', 'Lore', 'Intellect', 'Knowledge'],
  MECH: ['Mécanique', 'Mechanics', 'Intellect', 'General'],
  MED: ['Médecine', 'Medicine', 'Intellect', 'General'],
  MELEE: ['Corps à corps', 'Melee', 'Brawn', 'Combat'],
  NEG: ['Négociation', 'Negotiation', 'Presence', 'General'],
  OUTER: ['Connaissances (Bordure extérieure)', 'Outer Rim', 'Intellect', 'Knowledge'],
  PERC: ['Perception', 'Perception', 'Cunning', 'General'],
  PILOTPL: ['Pilotage (planétaire)', 'Piloting: Planetary', 'Agility', 'General'],
  PILOTSP: ['Pilotage (spatial)', 'Piloting: Space', 'Agility', 'General'],
  RANGHVY: ['Distance (armes lourdes)', 'Ranged: Heavy', 'Agility', 'Combat'],
  RANGLGHT: ['Distance (armes légères)', 'Ranged: Light', 'Agility', 'Combat'],
  RESIL: ['Vigueur', 'Resilience', 'Brawn', 'General'],
  SKUL: ['Skulduggery / Système D', 'Skulduggery', 'Cunning', 'General'],
  STEAL: ['Discrétion', 'Stealth', 'Agility', 'General'],
  STREET: ['Débrouillardise', 'Streetwise', 'Cunning', 'General'],
  SURV: ['Survie', 'Survival', 'Cunning', 'General'],
  SW: ['Connaissances (Monde souterrain)', 'Underworld', 'Intellect', 'Knowledge'],
  UND: ['Connaissances (Monde souterrain)', 'Underworld', 'Intellect', 'Knowledge'],
  VIGIL: ['Vigilance', 'Vigilance', 'Willpower', 'General'],
  WARF: ['Connaissances (Guerre)', 'Warfare', 'Intellect', 'Knowledge'],
  XEN: ['Connaissances (Xénologie)', 'Xenology', 'Intellect', 'Knowledge'],
  ZERO: ['Gravité zéro', 'Zero-G', 'Agility', 'General'],
};
const normKey = (k) => String(k).toUpperCase().replace(/[^A-Z]/g, '');
// index secondaire : nom anglais complet normalisé → entrée (les mondes v2 clés
// les skills par nom complet : « Gunnery », « Knowledge: Core Worlds »…)
const SKILL_BY_EN = {};
for (const entry of Object.values(SKILL_FR)) SKILL_BY_EN[normKey(entry[1])] = entry;
SKILL_BY_EN[normKey('Knowledge: Core Worlds')] = SKILL_FR.CORE;
SKILL_BY_EN[normKey('Knowledge: Education')] = SKILL_FR.EDU;
SKILL_BY_EN[normKey('Knowledge: Lore')] = SKILL_FR.LORE;
SKILL_BY_EN[normKey('Knowledge: Outer Rim')] = SKILL_FR.OUTER;
SKILL_BY_EN[normKey('Knowledge: Underworld')] = SKILL_FR.UND;
SKILL_BY_EN[normKey('Knowledge: Warfare')] = SKILL_FR.WARF;
SKILL_BY_EN[normKey('Knowledge: Xenology')] = SKILL_FR.XEN;
SKILL_BY_EN[normKey('Sang-froid')] = SKILL_FR.COOL;
SKILL_BY_EN[normKey('Corps à corps')] = SKILL_FR.MELEE;

// Rang final = max(rang stocké, rangs octroyés espèce/carrière, cible d'achat XP).
// `skillMods`/`xpTargets` sont indexés par nom EN (« Lightsaber ») ou clé système.
function transformSkills(sysSkills, skillMods = {}, xpTargets = {}) {
  const idx = (map) => { const o = {}; for (const [k, v] of Object.entries(map || {})) o[normKey(k)] = num(v); return o; };
  const mods = idx(skillMods), xps = idx(xpTargets);
  const out = [];
  for (const [key, s] of Object.entries(sysSkills || {})) {
    if (!s || typeof s !== 'object') continue;
    const nk = normKey(s.value || key);
    const fr = SKILL_FR[nk] || SKILL_FR[normKey(key)] || SKILL_BY_EN[nk] || SKILL_BY_EN[normKey(key)] || null;
    const lookups = [fr ? normKey(fr[1]) : null, nk, normKey(key)].filter(Boolean);
    const modRank = Math.max(0, ...lookups.map((k) => mods[k] || 0));
    const xpRank = Math.max(0, ...lookups.map((k) => xps[k] || 0));
    out.push({
      name: fr ? fr[0] : str(s.label || key),
      en: fr ? fr[1] : str(key),
      rank: Math.max(val(s.rank, 0), modRank, xpRank),
      characteristic: str(s.characteristic || (fr ? fr[2] : '')),
      career: Boolean(s.careerskill),
      type: str(s.type || (fr ? fr[3] : 'General')),
      key: nk,
    });
  }
  out.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  return out;
}

const itemsOf = (doc, type) => (doc.items || []).filter((i) => i && i.type === type);
const sysOf = (i) => i.system || i.data || {};
const descOf = (i) => str(sysOf(i).description || '');

// --- Dérivation FFG (starwarsffg 2.0.3) ------------------------------------
// Le MCP renvoie le document SOURCE : caractéristiques, seuils et rangs y valent 0
// (le système les calcule au prepareData, côté navigateur uniquement). On reproduit
// le calcul depuis trois sources fidèles au modèle de fiche swffg :
//   1) mods d'attributs `system.attributes[*] = {mod, modtype, value}` portés par
//      l'espèce, les talents (y compris ceux APPRIS dans les arbres de spécialisation)
//      et les attachements/modificateurs d'objets ;
//   2) le journal d'XP `flags.starwarsffg.xpLog` (achats de caractéristiques et de
//      rangs de compétence — seul endroit où vivent les achats de création) ;
//   3) l'équipement (armures équipées pour l'encaissement/défense).
const CHARS = ['Brawn', 'Agility', 'Intellect', 'Cunning', 'Willpower', 'Presence'];
const learnedTalent = (t) => Boolean(t?.islearned ?? t?.isLearned ?? t?.learned);

// Parcourt tous les porteurs de mods d'attributs ; `src` vaut 'species' pour l'item
// d'espèce (sa contribution est la BASE, à ne pas cumuler avec les achats d'XP).
function eachAttrSource(doc, fn) {
  const sys = doc.system || doc.data || {};
  fn(sys.attributes, 'actor');
  for (const it of doc.items || []) {
    const s = sysOf(it);
    fn(s.attributes, it.type === 'species' ? 'species' : 'item');
    if (it.type === 'specialization') {
      for (const t of Object.values(s.talents || {})) {
        if (t && typeof t === 'object' && learnedTalent(t)) fn(t.attributes, 'item');
      }
    }
    for (const key of ['itemmodifier', 'itemattachment']) {
      for (const mod of Object.values(s[key] || {})) {
        if (mod && typeof mod === 'object') fn(sysOf(mod).attributes || mod.attributes, 'item');
      }
    }
  }
}

// Somme des mods, en séparant la base d'espèce du reste : { species, other }[modtype][mod].
function sumMods(doc) {
  const species = {}, other = {};
  eachAttrSource(doc, (attrs, src) => {
    const bucket = src === 'species' ? species : other;
    for (const v of Object.values(attrs || {})) {
      if (!v || typeof v !== 'object' || !v.modtype || !v.mod) continue;
      const n = Number(v.value);
      if (!Number.isFinite(n) || n === 0) continue;
      (bucket[v.modtype] = bucket[v.modtype] || {});
      bucket[v.modtype][v.mod] = (bucket[v.modtype][v.mod] || 0) + n;
    }
  });
  return { species, other };
}

// Journal d'XP : cibles finales des achats de caractéristiques et de rangs de compétence.
// Format système (EN) : « characteristic Brawn level 2 --> 4 », « skill rank Lightsaber 0 --> 4 ».
export function parseXpLog(doc) {
  const raw = doc.flags?.starwarsffg?.xpLog || [];
  const chars = {}, skills = {};
  for (const e of raw) {
    const desc = String(e?.description || '');
    let m = /characteristic\s+(\w+)\s+level\s+\d+\s*-+>\s*(\d+)/i.exec(desc);
    if (m) chars[m[1]] = Math.max(chars[m[1]] || 0, +m[2]);
    m = /skill rank\s+(.+?)\s+\d+\s*-+>\s*(\d+)/i.exec(desc);
    if (m) { const k = m[1].trim(); skills[k] = Math.max(skills[k] || 0, +m[2]); }
  }
  return { chars, skills, raw };
}

// Valeurs de jeu dérivées (ce que Foundry affiche).
function deriveFFG(doc) {
  const sys = doc.system || doc.data || {};
  const stored = sys.characteristics || {};
  const { species, other } = sumMods(doc);
  const xp = parseXpLog(doc);
  const sCh = species.Characteristic || {}, oCh = other.Characteristic || {};
  const chars = {};
  for (const c of CHARS) {
    // PNJ/droïde/export plat = caractéristique stockée directement (déjà finale, ne
    // pas y ajouter les mods). PJ construit = stockée à 0 → base espèce ou achat d'XP
    // (le plus haut), plus les mods hors-espèce (Dedication, attachements).
    const s = num(stored[c]?.value);
    chars[c] = s > 0 ? s : Math.max(num(sCh[c]), num(xp.chars[c])) + num(oCh[c]);
  }
  // armures ÉQUIPÉES : soak/defence stockés en { value } → val().
  const armour = itemsOf(doc, 'armour').concat(itemsOf(doc, 'armor')).filter((a) => {
    const eq = sysOf(a).equippable;
    return eq == null || (typeof eq === 'object' ? eq.value !== false : eq !== false);
  });
  const armSoak = armour.reduce((s, a) => s + val(sysOf(a).soak), 0);
  const armDef = armour.reduce((s, a) => s + val(sysOf(a).defence ?? sysOf(a).defense), 0);
  const stat = (m) => num(species.Stat?.[m]) + num(other.Stat?.[m]);
  // rangs de compétence octroyés (espèce + carrière/talents), indexés par nom EN / clé
  const skillMods = { ...(species['Skill Rank'] || {}) };
  for (const [k, v] of Object.entries(other['Skill Rank'] || {})) skillMods[k] = (skillMods[k] || 0) + v;
  return {
    chars,
    wounds: stat('Wounds') + chars.Brawn,
    strain: stat('Strain') + chars.Willpower,
    soak: chars.Brawn + stat('Soak') + armSoak,
    defenceRanged: stat('Defence-Ranged') + num(other.Stat?.Defence) + armDef,
    defenceMelee: stat('Defence-Melee') + num(other.Stat?.Defence) + armDef,
    forceRating: stat('ForcePool'),
    encumbrance: 5 + chars.Brawn + stat('Encumbrance'),
    skillMods,          // { NomEN|clé : rangs octroyés }
    xpSkills: xp.skills, // { NomEN : cible d'achat }
    xp,
  };
}

// Vue du journal d'XP pour l'affichage « Progression » (catégorise chaque achat).
function xpLogView(raw) {
  const cat = (desc) => {
    if (/^characteristic/i.test(desc)) return 'characteristic';
    if (/^skill rank/i.test(desc)) return 'skill';
    if (/force ?power|forcepower/i.test(desc)) return 'force';
    if (/specialization|talent|upgrade/i.test(desc)) return 'talent';
    return 'other';
  };
  return (raw || []).map((e) => ({
    action: str(e?.action),
    cost: num(e?.xp?.cost),
    date: str(e?.date),
    desc: str(e?.description),
    category: e?.action === 'adjusted' ? 'adjust' : (e?.action === 'granted' ? 'grant' : cat(str(e?.description))),
  }));
}

// Fiche complète (PJ / PNJ « character ») — même forme que pcs.json.
export function transformCharacter(doc) {
  const sys = doc.system || doc.data || {};
  const st = sys.stats || {};
  const species = itemsOf(doc, 'species')[0];
  const career = itemsOf(doc, 'career')[0];
  const specs = itemsOf(doc, 'specialization');
  const flagsH = doc.flags?.holocron || {};
  // Document SOURCE (live) : les valeurs de jeu sont dérivées des mods d'attributs.
  // Sur un ancien export plat, il n'y a pas de mods → d retombe sur le stocké.
  const d = deriveFFG(doc);
  const bestMax = (a, b) => Math.max(num(a), num(b)); // stocké (export plat) vs dérivé (live)

  return {
    id: doc._id,
    name: doc.name,
    type: doc.type,
    img: str(doc.img || ''),
    species: species ? species.name : str(sys.species?.value ?? sys.species ?? ''),
    career: career ? career.name : str(sys.career?.value ?? sys.career ?? ''),
    specialisations: specs.map((s) => s.name),
    characteristics: {
      Brawn: d.chars.Brawn, Agility: d.chars.Agility, Intellect: d.chars.Intellect,
      Cunning: d.chars.Cunning, Willpower: d.chars.Willpower, Presence: d.chars.Presence,
    },
    stats: {
      wounds: { value: val(st.wounds), max: bestMax(st.wounds?.max, d.wounds) },
      strain: { value: val(st.strain), max: bestMax(st.strain?.max, d.strain) },
      soak: bestMax(val(st.soak), d.soak),
      defence: { melee: bestMax(val(st.defence?.melee ?? st.defence), d.defenceMelee), ranged: bestMax(val(st.defence?.ranged), d.defenceRanged) },
      encumbrance: { value: val(st.encumbrance), max: bestMax(st.encumbrance?.max, d.encumbrance) },
      forcePool: { value: val(st.forcePool), max: bestMax(st.forcePool?.max, d.forceRating) },
      credits: val(st.credits),
    },
    skills: transformSkills(sys.skills, d.skillMods, d.xpSkills),
    experience: {
      total: num(sys.experience?.total ?? st.experience?.total),
      available: num(sys.experience?.available ?? st.experience?.available),
      spent: num(sys.experience?.total ?? st.experience?.total) - num(sys.experience?.available ?? st.experience?.available),
      log: xpLogView(d.xp.raw),
    },
    gauges: {
      morality: num(sys.morality?.value ?? st.morality?.value, 50),
      moralityStrength: str(sys.morality?.strength),
      moralityWeakness: str(sys.morality?.weakness),
      conflict: num(sys.morality?.conflict),
      obligation: num(sys.obligationlist ? Object.values(sys.obligationlist).reduce((s, o) => s + num(o?.magnitude), 0) : st.obligation?.value),
      duty: num(sys.dutylist ? Object.values(sys.dutylist).reduce((s, o) => s + num(o?.magnitude), 0) : st.duty?.value),
      forceRating: val(st.forcePool?.max ?? sys.forceRating),
    },
    motivations: flagsH.motivations || { m1: '', m2: '' },
    general: {
      age: str(sys.general?.age ?? sys.biographydata?.age),
      gender: str(sys.general?.gender ?? sys.biographydata?.gender),
      height: str(sys.general?.height ?? sys.biographydata?.height),
      build: str(sys.general?.build ?? sys.biographydata?.build),
      eyes: str(sys.general?.eyes ?? sys.biographydata?.eyes),
      hair: str(sys.general?.hair ?? sys.biographydata?.hair),
    },
    biography: str(sys.biography || ''),
    weapons: itemsOf(doc, 'weapon').map((w) => {
      const s = sysOf(w);
      return {
        name: w.name,
        skill: str(s.skill?.value || s.skill),
        damage: val(s.damage),
        crit: val(s.crit),
        range: str(s.range?.value || s.range),
        special: str(s.special?.value || s.special),
        description: descOf(w),
      };
    }),
    armour: itemsOf(doc, 'armour').map((a) => {
      const s = sysOf(a);
      return { name: a.name, defence: val(s.defence), soak: val(s.soak), description: descOf(a) };
    }),
    gear: itemsOf(doc, 'gear').map((g) => ({ name: g.name, quantity: val(sysOf(g).quantity, 1), description: descOf(g) })),
    forcepowers: itemsOf(doc, 'forcepower').map((f) => ({
      name: f.name, description: descOf(f),
      upgrades: Object.values(sysOf(f).upgrades || {}).filter((u) => u && (u.islearned ?? u.learned))
        .map((u) => ({ name: str(u.name), description: str(u.description) })),
    })),
    specializations: specs.map((s) => {
      const talents = Object.entries(sysOf(s).talents || {})
        .map(([tk, t], i) => ({
          index: i, row: Math.floor(i / 4), col: i % 4,
          name: str(t?.name || tk), en: str(t?.name || tk),
          description: str(t?.description), explain: '',
          cost: num(t?.cost, (Math.floor(i / 4) + 1) * 5),
          learned: Boolean(t?.islearned ?? t?.learned),
          ranked: Boolean(t?.isRanked ?? t?.ranked), rank: num(t?.rank, 1),
          activation: str(t?.activation?.label || t?.activation),
          linkTop: Boolean(t?.links?.top), linkRight: Boolean(t?.links?.right),
        }));
      return { name: s.name, description: descOf(s), talents };
    }),
  };
}

// Adversaire (pack star-wars-adversaries) — même forme que adversaries.json.
export function transformAdversary(doc, packSource = '') {
  const sys = doc.system || doc.data || {};
  const ch = sys.characteristics || {};
  const st = sys.stats || {};
  const flags = doc.flags || {};
  return {
    id: flags.swa?.id || doc._id,
    name: doc.name,
    type: str(flags.swa?.type || sys.adversarytype || doc.type),
    source: packSource,
    book: str(flags.swa?.book || ''),
    tags: flags.swa?.tags || [],
    characteristics: {
      Brawn: val(ch.Brawn), Agility: val(ch.Agility), Intellect: val(ch.Intellect),
      Cunning: val(ch.Cunning), Willpower: val(ch.Willpower), Presence: val(ch.Presence),
    },
    stats: {
      wounds: { value: val(st.wounds), max: num(st.wounds?.max) },
      strain: { value: val(st.strain), max: num(st.strain?.max) },
      soak: val(st.soak),
      defence: { melee: val(st.defence?.melee ?? st.defence), ranged: val(st.defence?.ranged) },
    },
    skills: transformSkills(sys.skills).filter((s) => s.rank > 0),
    talents: itemsOf(doc, 'talent').map((t) => ({ name: t.name, description: descOf(t) })),
    abilities: itemsOf(doc, 'ability').map((t) => ({ name: t.name, description: descOf(t) })),
    gear: itemsOf(doc, 'gear').map((g) => g.name),
    weapons: itemsOf(doc, 'weapon').map((w) => {
      const s = sysOf(w);
      return {
        name: w.name, skill: str(s.skill?.value || s.skill), damage: val(s.damage),
        crit: val(s.crit), range: str(s.range?.value || s.range), special: str(s.special?.value || s.special),
      };
    }),
  };
}
