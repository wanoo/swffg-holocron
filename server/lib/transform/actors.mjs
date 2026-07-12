// transform/actors.mjs — Actor Foundry (starwarsffg, v1 export ou v2 live) →
// formes de fiches consommées par le front (mêmes clés que les anciens
// pcs.json / world-npcs.json / adversaries.json). Transformations TOLÉRANTES :
// chaque champ a un repli, une fiche incomplète rend une fiche partielle.

const num = (v, d = 0) => (Number.isFinite(+v) ? +v : d);
const str = (v, d = '') => (v == null ? d : String(v));
const val = (v, d = 0) => num(v && typeof v === 'object' ? v.value : v, d);
// Déballe un champ système { value, type, label } en chaîne (jamais "[object Object]").
const unwrap = (v) => str(v && typeof v === 'object' ? v.value : v);

// Noms FR des compétences (traduction OggDude FR — `ffg-star-wars-traduction-fr-oggdude`,
// celle du monde de l'utilisateur) : [FR, EN, caractéristique, groupe]. Clé = clé système
// EN normalisée. Groupe : Combat | General | Social | Knowledge (ordre de la fiche officielle).
const SKILL_FR = {
  ASTRO: ['Astrogation', 'Astrogation', 'Intellect', 'General'],
  ATHL: ['Athlétisme', 'Athletics', 'Brawn', 'General'],
  BRAWL: ['Pugilat', 'Brawl', 'Brawn', 'Combat'],
  CHARM: ['Charme', 'Charm', 'Presence', 'Social'],
  COERC: ['Coercition', 'Coercion', 'Willpower', 'Social'],
  COMP: ['Informatique', 'Computers', 'Intellect', 'General'],
  COOL: ['Calme', 'Cool', 'Presence', 'General'],
  COORD: ['Coordination', 'Coordination', 'Agility', 'General'],
  CORE: ['Mondes du Noyau', 'Core Worlds', 'Intellect', 'Knowledge'],
  DECEP: ['Tromperie', 'Deception', 'Cunning', 'Social'],
  DISC: ['Sang-froid', 'Discipline', 'Willpower', 'General'],
  EDU: ['Éducation', 'Education', 'Intellect', 'Knowledge'],
  GUNN: ['Artillerie', 'Gunnery', 'Agility', 'Combat'],
  LEAD: ['Commandement', 'Leadership', 'Presence', 'Social'],
  LTSABER: ['Sabre laser', 'Lightsaber', 'Brawn', 'Combat'],
  LORE: ['Culture', 'Lore', 'Intellect', 'Knowledge'],
  MECH: ['Mécanique', 'Mechanics', 'Intellect', 'General'],
  MED: ['Médecine', 'Medicine', 'Intellect', 'General'],
  MELEE: ['Corps à corps', 'Melee', 'Brawn', 'Combat'],
  NEG: ['Négociation', 'Negotiation', 'Presence', 'Social'],
  OUTER: ['Bordure Extérieure', 'Outer Rim', 'Intellect', 'Knowledge'],
  PERC: ['Perception', 'Perception', 'Cunning', 'General'],
  PILOTPL: ['Pilotage : Planétaire', 'Piloting: Planetary', 'Agility', 'General'],
  PILOTSP: ['Pilotage : Spatial', 'Piloting: Space', 'Agility', 'General'],
  RANGHVY: ['Armes lourdes', 'Ranged: Heavy', 'Agility', 'Combat'],
  RANGLGHT: ['Armes légères', 'Ranged: Light', 'Agility', 'Combat'],
  RESIL: ['Résistance', 'Resilience', 'Brawn', 'General'],
  SKUL: ['Magouilles', 'Skulduggery', 'Cunning', 'General'],
  STEAL: ['Discrétion', 'Stealth', 'Agility', 'General'],
  STREET: ['Système D', 'Streetwise', 'Cunning', 'General'],
  SURV: ['Survie', 'Survival', 'Cunning', 'General'],
  SW: ['Pègre', 'Underworld', 'Intellect', 'Knowledge'],
  UND: ['Pègre', 'Underworld', 'Intellect', 'Knowledge'],
  VIGIL: ['Vigilance', 'Vigilance', 'Willpower', 'General'],
  WARF: ['Stratégie', 'Warfare', 'Intellect', 'Knowledge'],
  XEN: ['Xénologie', 'Xenology', 'Intellect', 'Knowledge'],
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

// Rang final = max(rang stocké, rangs octroyés espèce/carrière, cible d'achat XP).
// `skillMods`/`xpTargets`/`boost`/`setback` sont indexés par nom EN ou clé système.
function transformSkills(sysSkills, skillMods = {}, xpTargets = {}, boost = {}, setback = {}) {
  const idx = (map) => { const o = {}; for (const [k, v] of Object.entries(map || {})) o[normKey(k)] = num(v); return o; };
  const mods = idx(skillMods), xps = idx(xpTargets), bst = idx(boost), stb = idx(setback);
  const out = [];
  for (const [key, s] of Object.entries(sysSkills || {})) {
    if (!s || typeof s !== 'object') continue;
    const nk = normKey(s.value || key);
    const fr = SKILL_FR[nk] || SKILL_FR[normKey(key)] || SKILL_BY_EN[nk] || SKILL_BY_EN[normKey(key)] || null;
    const lookups = [fr ? normKey(fr[1]) : null, nk, normKey(key)].filter(Boolean);
    const pick = (m) => Math.max(0, ...lookups.map((k) => m[k] || 0));
    out.push({
      name: fr ? fr[0] : str(s.label || key),
      en: fr ? fr[1] : str(key),
      rank: Math.max(val(s.rank, 0), pick(mods), pick(xps)),
      boost: pick(bst),            // dés boost ajoutés par des talents (Skill Boost)
      setbackRemove: pick(stb),    // dés de contrainte retirés (Skill Remove Setback)
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
// Parcourt les porteurs de mods NON-talent : `src` ∈ 'species' | 'item'. Les talents
// des arbres ne sont PAS parcourus ici — leur contribution vient des achats xpLog
// (compter les cases apprises sur-compte les talents dupliqués dans un arbre).
function eachAttrSource(doc, fn) {
  const sys = doc.system || doc.data || {};
  fn(sys.attributes, 'item');
  for (const it of doc.items || []) {
    if (it.type === 'specialization' || it.type === 'talent') continue;
    const s = sysOf(it);
    fn(s.attributes, it.type === 'species' ? 'species' : 'item');
    for (const key of ['itemmodifier', 'itemattachment']) {
      for (const mod of Object.values(s[key] || {})) {
        if (mod && typeof mod === 'object') fn(sysOf(mod).attributes || mod.attributes, 'item');
      }
    }
  }
}

// Somme des mods NON-talent : { species, item }[modtype][mod].
function sumMods(doc) {
  const species = {}, item = {};
  eachAttrSource(doc, (attrs, src) => {
    const bucket = src === 'species' ? species : item;
    for (const v of Object.values(attrs || {})) {
      if (!v || typeof v !== 'object' || !v.modtype || !v.mod) continue;
      const n = Number(v.value);
      if (!Number.isFinite(n) || n === 0) continue;
      (bucket[v.modtype] = bucket[v.modtype] || {});
      bucket[v.modtype][v.mod] = (bucket[v.modtype][v.mod] || 0) + n;
    }
  });
  return { species, item };
}

// Index des mods par talent (nom → {Characteristic, Stat} par exemplaire), lus dans les
// arbres — pour attribuer les achats xpLog (« … upgrade Endurci ») à leur effet.
function talentModIndex(doc) {
  const idx = {};
  for (const it of doc.items || []) {
    if (it.type !== 'specialization') continue;
    for (const t of Object.values(sysOf(it).talents || {})) {
      if (!t || typeof t !== 'object' || !t.name) continue;
      const e = idx[t.name] || (idx[t.name] = { Characteristic: {}, Stat: {}, 'Skill Boost': {}, 'Skill Remove Setback': {} });
      for (const v of Object.values(t.attributes || {})) {
        if (!v || typeof v !== 'object' || !v.mod || !e[v.modtype]) continue;
        const n = Number(v.value);
        if (Number.isFinite(n) && n) e[v.modtype][v.mod] = Math.max(e[v.modtype][v.mod] || 0, n); // max par exemplaire (les copies OggDude ne cumulent pas)
      }
    }
  }
  return idx;
}

// Journal d'XP : cibles d'achats (caract, compétences), talents achetés (nom → nb),
// XP dépensée/disponible. La 1re entrée (la plus récente) porte l'XP disponible courante.
export function parseXpLog(doc) {
  const raw = doc.flags?.starwarsffg?.xpLog || [];
  const chars = {}, skills = {}, talentRanks = {};
  let spent = 0, available = null;
  for (const e of raw) {
    const desc = String(e?.description || '');
    if (e?.action === 'purchased') spent += num(e?.xp?.cost);
    if (available == null && e?.xp && e.xp.available != null) available = num(e.xp.available);
    let m = /characteristic\s+(\w+)\s+level\s+\d+\s*-+>\s*(\d+)/i.exec(desc);
    if (m) chars[m[1]] = Math.max(chars[m[1]] || 0, +m[2]);
    m = /skill rank\s+(.+?)\s+\d+\s*-+>\s*(\d+)/i.exec(desc);
    if (m) { const k = m[1].trim(); skills[k] = Math.max(skills[k] || 0, +m[2]); }
    m = /\bupgrade\s+(.+)$/.exec(desc);
    if (m && e?.action === 'purchased') { const k = m[1].trim(); talentRanks[k] = (talentRanks[k] || 0) + 1; }
  }
  return { chars, skills, talentRanks, spent, available, raw };
}

// Valeurs de jeu dérivées (ce que Foundry affiche).
function deriveFFG(doc) {
  const sys = doc.system || doc.data || {};
  const stored = sys.characteristics || {};
  const { species, item } = sumMods(doc);
  const xp = parseXpLog(doc);
  const tIdx = talentModIndex(doc);
  // contribution des talents = achats xpLog × mod par exemplaire (fiable).
  const talentContrib = (modtype, mod) => {
    let s = 0;
    for (const [name, cnt] of Object.entries(xp.talentRanks)) s += (tIdx[name]?.[modtype]?.[mod] || 0) * cnt;
    return s;
  };
  const sCh = species.Characteristic || {};
  const chars = {};
  for (const c of CHARS) {
    // PNJ/droïde/export plat = caractéristique stockée directement (finale).
    // PJ construit = base espèce ou achat d'XP + mods d'items + Dedication (talents achetés).
    const s = num(stored[c]?.value);
    chars[c] = s > 0 ? s : Math.max(num(sCh[c]), num(xp.chars[c])) + num(item.Characteristic?.[c]) + talentContrib('Characteristic', c);
  }
  // armures ÉQUIPÉES : soak/defence stockés en { value } → val().
  const armour = itemsOf(doc, 'armour').concat(itemsOf(doc, 'armor')).filter((a) => {
    const eq = sysOf(a).equippable;
    return eq == null || (typeof eq === 'object' ? eq.value !== false : eq !== false);
  });
  const armSoak = armour.reduce((s, a) => s + val(sysOf(a).soak), 0);
  const armDef = armour.reduce((s, a) => s + val(sysOf(a).defence ?? sysOf(a).defense), 0);
  // seuil Stat = espèce + items (carrière/attachements) + talents (via achats xpLog)
  const stat = (m) => num(species.Stat?.[m]) + num(item.Stat?.[m]) + talentContrib('Stat', m);
  const skillMods = { ...(species['Skill Rank'] || {}) };
  for (const [k, v] of Object.entries(item['Skill Rank'] || {})) skillMods[k] = (skillMods[k] || 0) + v;
  // effets de talents sur les JETS de compétence (dés boost ajoutés, contraintes retirées)
  const skillBoost = {}, skillSetback = {};
  for (const [name, cnt] of Object.entries(xp.talentRanks)) {
    for (const [sk, v] of Object.entries(tIdx[name]?.['Skill Boost'] || {})) skillBoost[sk] = (skillBoost[sk] || 0) + v * cnt;
    for (const [sk, v] of Object.entries(tIdx[name]?.['Skill Remove Setback'] || {})) skillSetback[sk] = (skillSetback[sk] || 0) + v * cnt;
  }
  return {
    chars,
    wounds: stat('Wounds') + chars.Brawn,
    strain: stat('Strain') + chars.Willpower,
    soak: chars.Brawn + stat('Soak') + armSoak,
    defenceRanged: stat('Defence-Ranged') + num(item.Stat?.Defence) + armDef,
    defenceMelee: stat('Defence-Melee') + num(item.Stat?.Defence) + armDef,
    forceRating: stat('ForcePool'),
    encumbrance: 5 + chars.Brawn + stat('Encumbrance'),
    skillMods, skillBoost, skillSetback, xpSkills: xp.skills, xp,
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
    skills: transformSkills(sys.skills, d.skillMods, d.xpSkills, d.skillBoost, d.skillSetback),
    experience: (() => {
      const total = num(sys.experience?.total ?? st.experience?.total);
      // l'XP disponible stockée est périmée (le système la recalcule) → l'xpLog fait foi.
      const spent = d.xp.raw.length ? d.xp.spent : num(sys.experience?.total) - num(sys.experience?.available);
      const available = d.xp.available != null ? d.xp.available : Math.max(0, total - spent);
      return { total, available, spent, log: xpLogView(d.xp.raw) };
    })(),
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
      // les champs sont wrappés en { value } — unwrap systématique (sinon "[object Object]"
      // quand value est vide et qu'on retombe sur l'objet). + qualités (itemmodifier).
      // qualités = itemmodifier « Qualité X » ; on ignore les mods génériques et les
      // entrées descriptives longues (descriptions d'attachements, pas des qualités).
      const quals = [...new Set(Object.values(s.itemmodifier || {})
        .filter((m) => /^Qualité\s/i.test(str(m?.name)))
        .map((m) => str(m?.name).replace(/^Qualité\s+/i, '').trim())
        .filter((n) => n && n.length <= 28))];
      const skEn = unwrap(s.skill);
      const skFr = (SKILL_FR[normKey(skEn)] || SKILL_BY_EN[normKey(skEn)] || null);
      return {
        name: w.name,
        skill: skFr ? skFr[0] : skEn,
        damage: val(s.damage),
        crit: val(s.crit),
        range: unwrap(s.range),
        special: unwrap(s.special),
        qualities: quals,
        description: descOf(w),
      };
    }),
    armour: itemsOf(doc, 'armour').map((a) => {
      const s = sysOf(a);
      return { name: a.name, defence: val(s.defence), soak: val(s.soak), description: descOf(a) };
    }),
    gear: itemsOf(doc, 'gear').map((g) => ({ name: g.name, quantity: val(sysOf(g).quantity, 1), description: descOf(g) })),
    forcepowers: itemsOf(doc, 'forcepower').map((f) => {
      const fs = sysOf(f);
      // toutes les cases VISIBLES de l'arbre (pour dessiner la grille + connecteurs),
      // avec l'état appris. La 1re case = le pouvoir de base.
      const upgrades = Object.values(fs.upgrades || {})
        .filter((u) => u && u.visible !== false)
        .map((u, i) => ({
          index: i, name: str(u.name), description: str(u.description),
          cost: num(u.cost), size: str(u.size || 'single'),
          learned: Boolean(u.islearned ?? u.learned), visible: u.visible !== false,
          linkTop: Boolean(u['links-top-1'] ?? u.links?.top),
          linkRight: Boolean(u['links-right'] ?? u.links?.right),
        }));
      return { name: f.name, description: descOf(f), cost: num(fs.base_cost), forceRating: num(fs.required_force_rating), upgrades };
    }),
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
          size: str(t?.size || 'single'),
          // connecteurs d'arbre : les vraies clés du système sont links-top-1 / links-right
          linkTop: Boolean(t?.['links-top-1'] ?? t?.links?.top),
          linkRight: Boolean(t?.['links-right'] ?? t?.links?.right),
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
    img: str(doc.img || ''),
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
