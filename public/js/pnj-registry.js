// pnj-registry.js — registre unifié des personnages de campagne : « une info,
// un seul endroit ». Résout un nom (et ses alias/orthographes) vers sa fiche
// canonique déjà présente dans l'app (#/pc, #/npc, #/adv), rend les mentions
// cliquables dans le contenu MJ, et affiche un aperçu au survol.
import { Data } from './data.js';
import { REGISTRY, ROUTE } from './pnj-registry-data.js';

// kind → index de données. (ROUTE vient du registre partagé.)
const INDEX = { pc: 'pcById', npc: 'npcById', adv: 'advById' };

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Table form (minuscule) → {kind,id} et regex globale (formes longues d'abord).
let FORM_MAP = null, FORM_RE = null, FORM_TEST = null;
function build() {
  if (FORM_MAP) return;
  FORM_MAP = new Map();
  const forms = [];
  for (const e of REGISTRY) {
    // ne garde que les entrées dont la fiche existe réellement dans les données
    if (!Data[INDEX[e.kind]]?.has(e.id)) continue;
    for (const f of e.forms) { FORM_MAP.set(f.toLowerCase(), e); forms.push(f); }
  }
  forms.sort((a, b) => b.length - a.length);
  const src = '(?<![\\p{L}\\p{N}])(' + forms.map(esc).join('|') + ')(?![\\p{L}\\p{N}])';
  FORM_RE = new RegExp(src, 'giu');     // global : pour exec (parcours)
  FORM_TEST = new RegExp(src, 'iu');    // non-global : pour test (acceptNode)
}

export function pnjEntry(kind, id) { return Data[INDEX[kind]]?.get(id) || null; }
export function pnjRoute(kind, id) { return ROUTE[kind] + id; }

// Rôle court pour l'aperçu.
function roleOf(kind, e) {
  if (!e) return '';
  if (kind === 'adv') { const t = e.type ? e.type[0].toUpperCase() + e.type.slice(1) : ''; return [t, e.source].filter(Boolean).join(' · '); }
  const bits = [e.species, e.career].filter(Boolean);
  return bits.join(' · ') || (kind === 'pc' ? 'Personnage-joueur' : ''); // '' → ligne masquée
}

const SKIP = new Set(['A', 'CODE', 'PRE', 'SUMMARY', 'H1', 'H2', 'H3', 'H4', 'BUTTON']);
function inSkip(node) {
  for (let p = node.parentNode; p && p !== document.body; p = p.parentNode) {
    if (p.nodeType !== 1) continue;
    if (SKIP.has(p.tagName)) return true;
    // Les fiches de combat ont déjà leur bouton « 📊 Fiche » → pas de lien PNJ.
    if (p.classList && (p.classList.contains('gm-cond-lbl') || p.classList.contains('gm-rub-sum') || p.classList.contains('pnj-link') || p.classList.contains('combat-sheet'))) return true;
  }
  return false;
}

// Rend cliquable la 1re occurrence de chaque personnage par chapitre.
// Idempotent : « déjà lié » est déduit des liens présents (survit aux
// re-rendus de l'éditeur, sans drapeau persistant qui bloquerait la recréation).
export function linkifyPnj(root) {
  build();
  if (!FORM_RE) return;
  for (const chap of root.querySelectorAll('section.chapter')) {
    const seen = new Set([...chap.querySelectorAll('a.pnj-link')].map((a) => a.dataset.id));
    const walker = document.createTreeWalker(chap, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.nodeValue && FORM_TEST.test(n.nodeValue) && !inSkip(n)) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT,
    });
    const targets = [];
    let t; while ((t = walker.nextNode())) targets.push(t);
    for (const node of targets) {
      FORM_RE.lastIndex = 0;
      const text = node.nodeValue;
      const frag = document.createDocumentFragment();
      let last = 0, m, changed = false;
      while ((m = FORM_RE.exec(text)) !== null) {
        const e = FORM_MAP.get(m[1].toLowerCase());
        if (!e || seen.has(e.id)) continue; // 1re occurrence par chapitre
        seen.add(e.id);
        changed = true;
        if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
        const a = document.createElement('a');
        a.className = 'pnj-link';
        a.href = pnjRoute(e.kind, e.id);
        a.dataset.kind = e.kind; a.dataset.id = e.id;
        a.textContent = m[0];
        frag.appendChild(a);
        last = m.index + m[0].length;
      }
      if (changed) {
        if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
        node.parentNode.replaceChild(frag, node);
      }
    }
  }
}

// --- aperçu au survol -----------------------------------------------------
let tip = null;
function ensureTip() {
  if (tip) return tip;
  tip = document.createElement('div');
  tip.className = 'pnj-preview';
  tip.hidden = true;
  document.body.appendChild(tip);
  return tip;
}
let hideTimer = null;
function showTip(link) {
  const kind = link.dataset.kind, id = link.dataset.id;
  const e = pnjEntry(kind, id);
  const name = (e && e.name) || link.textContent;
  const t = ensureTip();
  clearTimeout(hideTimer);
  const badge = kind === 'pc' ? 'PJ' : kind === 'adv' ? 'Adversaire' : 'PNJ';
  const role = roleOf(kind, e);
  t.innerHTML = `<div class="pnj-pv-head"><span class="pnj-pv-badge k-${kind}">${badge}</span><strong>${name}</strong></div>` +
    (role ? `<div class="pnj-pv-role">${role}</div>` : '') +
    `<div class="pnj-pv-actions"><a class="pnj-pv-go" href="${link.getAttribute('href')}">Ouvrir la fiche →</a>` +
    `<button type="button" class="pnj-pv-note">📝 Note</button></div>`;
  t.querySelector('.pnj-pv-note').addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('gm-open-notes', { detail: { type: 'pnj', ref: id, label: name } }));
    hideTip();
  });
  t.hidden = false;
  const r = link.getBoundingClientRect();
  t.style.top = (window.scrollY + r.bottom + 6) + 'px';
  t.style.left = Math.min(window.scrollX + r.left, window.scrollX + window.innerWidth - t.offsetWidth - 12) + 'px';
}
function scheduleHide() { clearTimeout(hideTimer); hideTimer = setTimeout(hideTip, 260); }
function hideTip() { if (tip) tip.hidden = true; }

// Écoute déléguée (une fois) : survol/focus d'un .pnj-link → aperçu interactif.
let wired = false;
export function attachPnjPreview() {
  if (wired) return;
  wired = true;
  document.addEventListener('pointerover', (e) => {
    const a = e.target.closest?.('.pnj-link');
    if (a) { showTip(a); return; }
    if (e.target.closest?.('.pnj-preview')) clearTimeout(hideTimer); // survol du tooltip → garder
  });
  document.addEventListener('pointerout', (e) => {
    if (e.target.closest?.('.pnj-link') || e.target.closest?.('.pnj-preview')) scheduleHide();
  });
  document.addEventListener('focusin', (e) => { const a = e.target.closest?.('.pnj-link'); if (a) showTip(a); });
  window.addEventListener('hashchange', hideTip);
}
