// gm.js — espace MJ (protégé par clé). Contenu de campagne organisé en rubriques
// thématiques, avec sidebar groupée/repliable, filtre, table des matières fine
// (chapitres + sous-sections) et scroll-spy. Le contenu MJ n'est jamais chargé
// sans la clé (servi gated côté serveur).
import { gmList, gmGet, gmSave, setGMKey, getGMKey, clearGMKey } from './collab.js';
import { Data } from './data.js';
import { mountSidebar } from './tree.js';
import { mountEditablePage } from './editor.js';
import { addSearchDocs } from './search.js';
import { renderCombat } from './combat-tracker.js';
import { linkifyPnj, attachPnjPreview } from './pnj-registry.js';
import { mountNotes, openNotes } from './notes.js';
import { openLoginModal } from './login.js';
import { openScreen } from './gm-screen.js';
import { renderGmHome } from './gm-home.js';
import { mountGmQuests } from './gm-quests.js';
import { mountGmCampaign } from './gm-campaign.js';
import { mountGmSheets } from './gm-fronts.js';
import { mountGmElements } from './gm-elements.js';
import { addShowButton } from './show-image.js';
import { initSession, isSessionOn, toggleSession, teardownSession, refreshSessionBar, injectPins } from './gm-session.js';

const gmApi = { getDoc: gmGet, saveDoc: gmSave };

// Rubriques thématiques (regroupement des chapitres par id, dans l'ordre d'affichage).
// Les chapitres portent des ids stables ({#id} dans le master) ; un chapitre
// non classé tombe dans « Annexes ».
// Rubriques = sous-dossiers Foundry de la bible (fournis par gmList : meta.rubrique).
// Un chapitre à la racine de la bible tombe dans « La campagne ».
let RUBRIQUES = [];
function buildRubriques(list) {
  const seen = new Map();
  for (const meta of list) {
    const raw = meta.rubrique || '';
    const key = raw || '__root__';
    if (!seen.has(key)) {
      const m = raw.match(/^(\p{Extended_Pictographic}\uFE0F?)\s*(.*)$/u);
      seen.set(key, {
        key,
        icon: raw ? (m ? m[1] : '📁') : '📖',
        label: raw ? (m ? m[2] : raw) : 'La campagne',
      });
    }
  }
  RUBRIQUES = [...seen.values()];
}
const rubriqueOf = (meta) => (meta.rubrique || '__root__');

// Chapitre actuellement à l'écran (suivi par le scroll-spy) : sert de contexte
// par défaut au bloc-notes MJ (bouton 📝 de la barre d'outils).
let activeChapter = null;

// Mermaid chargé à la demande (uniquement dans l'espace MJ, jamais côté joueur).
let mermaidPromise = null;
function loadMermaid() {
  if (mermaidPromise) return mermaidPromise;
  mermaidPromise = new Promise((resolve) => {
    if (window.mermaid) return resolve(window.mermaid);
    const s = document.createElement('script');
    s.src = 'vendor/mermaid.min.js';
    s.onload = () => {
      try { window.mermaid.initialize({ startOnLoad: false, theme: 'dark', securityLevel: 'loose' }); } catch {}
      resolve(window.mermaid || null);
    };
    s.onerror = () => resolve(null);
    document.head.appendChild(s);
  });
  return mermaidPromise;
}
async function renderMermaid(root) {
  const nodes = [...root.querySelectorAll('pre.mermaid:not([data-done])')];
  if (!nodes.length) return;
  const m = await loadMermaid();
  if (!m) return;
  for (const node of nodes) {
    node.setAttribute('data-done', '1');
    try { await m.run({ nodes: [node] }); } catch { node.removeAttribute('data-done'); } // garde le code brut si échec
  }
}

// Pose la vraie source des illustrations MJ. Le HTML ne porte que data-gm-asset
// (contenu à spoilers) ; l'image est servie par la route gated /api/gm/asset/<nom>.
// Chargement paresseux : le src n'est posé qu'à l'approche du viewport (l'aspect-ratio
// CSS réserve la place, donc pas de saut de layout ni d'observer aveugle).
function loadGmImg(img) {
  if (img.dataset.gmLoaded) return;
  img.dataset.gmLoaded = '1';
  img.addEventListener('load', () => img.setAttribute('data-loaded', '1'), { once: true });
  const ref = img.getAttribute('data-gm-asset');
  // chemin Foundry complet (worlds/…) → proxy tel quel ; ancien nom nu → idem
  const path = ref.includes('/') ? ref : 'assets/' + ref;
  const key = getGMKey ? getGMKey() : '';
  img.setAttribute('src', 'api/gm/asset/' + path.split('/').map(encodeURIComponent).join('/') + (key ? '?k=' + encodeURIComponent(key) : ''));
  if (img.complete && img.naturalWidth > 0) img.setAttribute('data-loaded', '1');
}
let imgObserver = null;
function ensureImgObserver() {
  if (imgObserver) return imgObserver;
  imgObserver = new IntersectionObserver((entries) => {
    for (const en of entries) {
      if (en.isIntersecting) { loadGmImg(en.target); imgObserver.unobserve(en.target); }
    }
  }, { rootMargin: '600px' });
  return imgObserver;
}
function rewriteAssets(root) {
  // le HTML venu de Foundry porte src="worlds/…" : bascule en lazy gated
  for (const img of root.querySelectorAll('img[src^="worlds/"]')) {
    img.setAttribute('data-gm-asset', img.getAttribute('src'));
    img.removeAttribute('src');
  }
  for (const img of root.querySelectorAll('img[data-gm-asset]')) {
    if (img.dataset.gmWired) continue;
    img.dataset.gmWired = '1';
    img.title = 'Cliquer : plein écran (montrer aux joueurs)';
    // Proche du viewport → chargement immédiat (fiable même onglet en arrière-plan,
    // où les notifications d'IntersectionObserver sont suspendues) ; sinon lazy.
    const r = img.getBoundingClientRect();
    if (r.top < window.innerHeight + 900 && r.bottom > -900) loadGmImg(img);
    else ensureImgObserver().observe(img);
  }
}

// --- Lightbox « montrer aux joueurs » : une image MJ en plein écran, sans
// chrome ni spoiler autour — idéal pour partager l'écran / retourner l'iPad.
let lightbox = null;
function openLightbox(src, alt, foundryPath = '') {
  if (!lightbox) {
    lightbox = document.createElement('div');
    lightbox.className = 'gm-lightbox';
    lightbox.innerHTML = '<img alt=""><p class="gm-lightbox-hint">Échap ou clic pour fermer</p>';
    lightbox.addEventListener('click', () => { lightbox.hidden = true; });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && lightbox && !lightbox.hidden) lightbox.hidden = true; });
    document.body.appendChild(lightbox);
  }
  const im = lightbox.querySelector('img');
  im.src = src;
  im.alt = alt || '';
  // envoi Foundry : on passe le chemin worlds/… d'origine (jamais l'URL proxy MJ)
  addShowButton(lightbox, foundryPath || src, alt || '');
  lightbox.hidden = false;
}
function attachLightbox(main) {
  main.addEventListener('click', (e) => {
    const img = e.target.closest('img[data-gm-asset][data-loaded]');
    if (img) openLightbox(img.src, img.alt, img.dataset.gmAsset);
  });
}

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}
function plain(html) {
  const d = document.createElement('div');
  d.innerHTML = html || '';
  return (d.textContent || '').replace(/\s+/g, ' ').trim();
}
const norm = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// Injecte des id sur les titres h2/h3 d'un HTML et renvoie { html, headings }.
function indexHeadings(html, cid) {
  const headings = [];
  let n = 0;
  const out = String(html || '').replace(/<(h[23])(\s[^>]*)?>([\s\S]*?)<\/\1>/gi, (m, tag, attrs, inner) => {
    const hid = `h-${cid}-${n++}`;
    headings.push({ id: hid, level: tag === 'h3' ? 3 : 2, text: plain(inner) });
    const cleaned = (attrs || '').replace(/\sid="[^"]*"/i, '');
    return `<${tag}${cleaned} id="${hid}">${inner}</${tag}>`;
  });
  return { html: out, headings };
}

// --- porte d'entrée MJ ------------------------------------------------------
// Auth Foundry active → connexion avec un compte MJ (la clé n'est qu'un secours).
// Sans auth (instance minimale) → clé MJ classique.
function renderGate(container, onOk) {
  container.innerHTML = '';
  const wrap = el('div', 'gm-gate holo-frame');
  wrap.innerHTML = `
    <div class="gm-lock" aria-hidden="true">🔒</div>
    <h1>Espace Maître du Jeu</h1>`;
  const authOn = Boolean(Data.authEnabled);
  wrap.insertAdjacentHTML('beforeend', authOn
    ? '<p class="muted">Section réservée. Connecte-toi avec ton compte <b>Foundry</b> de MJ — ce contenu n\'est jamais chargé sans autorisation.</p>'
    : '<p class="muted">Section réservée. Entrez la clé MJ pour accéder aux documents de campagne. Ce contenu n\'est jamais chargé sans la clé.</p>');

  const form = el('form', 'gm-gate-form');
  const input = el('input', 'gm-key-input');
  input.type = 'password';
  input.placeholder = 'Clé MJ';
  input.autocomplete = 'off';
  const btn = el('button', 'gm-key-btn', 'Déverrouiller');
  btn.type = 'submit';
  const msg = el('div', 'gm-key-msg');
  form.append(input, btn, msg);

  if (authOn) {
    const loginBtn = el('button', 'gm-key-btn', '◈ Se connecter');
    loginBtn.type = 'button';
    loginBtn.addEventListener('click', () => openLoginModal());
    wrap.appendChild(loginBtn);
    // dès qu'une session MJ arrive (le login re-déclenche hashchange, mais on
    // couvre aussi le cas d'une connexion depuis le bandeau), on entre.
    const onSess = async () => {
      if (!Data.gm) return;
      const list = await gmList().catch(() => null);
      if (list) { document.removeEventListener('holocron:session', onSess); onOk(list); }
    };
    document.addEventListener('holocron:session', onSess);
    const alt = el('details', 'gm-gate-alt');
    alt.innerHTML = '<summary class="muted">Clé MJ (secours)</summary>';
    alt.appendChild(form);
    wrap.appendChild(alt);
  } else {
    wrap.appendChild(form);
  }
  container.appendChild(wrap);
  if (!authOn) input.focus();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    btn.disabled = true;
    msg.textContent = 'Vérification…';
    setGMKey(input.value.trim());
    try {
      const list = await gmList();
      if (list === null) { msg.textContent = 'Clé refusée.'; clearGMKey(); btn.disabled = false; return; }
      onOk(list);
    } catch (err) {
      msg.textContent = 'Erreur : ' + err.message;
      btn.disabled = false;
    }
  });
}

// --- réglage taille de texte (persisté) ----------------------------------
const FONT_KEY = 'holocron-gm-fontscale';
function applyFontScale(v) { document.documentElement.style.setProperty('--gm-font-scale', String(v)); }
function getFontScale() { const v = parseFloat(localStorage.getItem(FONT_KEY)); return v >= 0.8 && v <= 1.6 ? v : 1; }
function setFontScale(v) { v = Math.min(1.6, Math.max(0.8, Math.round(v * 20) / 20)); localStorage.setItem(FONT_KEY, v); applyFontScale(v); return v; }

// --- mémoire de position (reprendre où on en était) -----------------------
const POS_KEY = 'holocron-gm-pos';
export function getGmPos() {
  try { return JSON.parse(localStorage.getItem(POS_KEY)) || null; } catch { return null; }
}
function saveGmPos(chap, name, heading) {
  try { localStorage.setItem(POS_KEY, JSON.stringify({ chap, name, heading: heading || null, at: Date.now() })); } catch { /* plein */ }
}

// --- vue documents (rubriques + sidebar) ---------------------------------
async function renderDocs(container, list, scrollTo, cleanup) {
  container.innerHTML = '';
  document.body.classList.add('gm-mode');
  applyFontScale(getFontScale());
  cleanup.push(() => document.body.classList.remove('gm-mode'));

  // Squelette « holocron qui s'allume » pendant le chargement.
  const skel = el('div', 'gm-skeleton', '<div class="gm-skel-bar"></div><div class="gm-skel-bar"></div><div class="gm-skel-bar"></div><p class="muted">Ouverture de l\'holocron…</p>');
  container.appendChild(skel);

  // Charge les chapitres EN PARALLÈLE, indexe leurs titres une fois pour toutes
  // (la nav complète — chapitres + sous-sections — existe avant tout rendu).
  buildRubriques(list);
  const all = await Promise.all(list.map(async (meta) => {
    const doc = await gmGet(meta.id);
    const { html, headings } = indexHeadings(doc ? doc.html : '', meta.id);
    return {
      id: meta.id, name: meta.name, html, headings,
      updatedAt: doc?.updatedAt ?? null, updatedBy: doc?.updatedBy || '',
      rub: rubriqueOf(meta),
    };
  }));
  skel.remove();
  addSearchDocs('gm', all.map((c) => ({ badge: 'MJ', route: `#/mj/${c.id}`, title: c.name, context: RUBRIQUES.find((r) => r.key === c.rub)?.label || 'MJ', text: plain(c.html) })));

  // Layout : [sidebar MJ] [contenu].
  const layout = el('div', 'gm-layout');
  const nav = el('aside', 'gm-nav');
  nav.setAttribute('aria-label', 'Navigation Maître du Jeu');
  // `gm-doc` conserve tous les styles de contenu MJ existants (fiches de combat,
  // figures, Mermaid, code en ligne, encadrés…) qui sont scopés à `.gm-doc`.
  const main = el('div', 'gm-main gm-doc');
  layout.append(nav, main);
  container.appendChild(layout);

  // Chargement des images d'un <details> à son ouverture (elles sont hors
  // viewport tant qu'il est fermé — l'observer seul ne suffirait pas).
  main.addEventListener('toggle', (e) => {
    if (e.target?.open) for (const img of e.target.querySelectorAll('img[data-gm-asset]')) loadGmImg(img);
  }, true);
  attachLightbox(main); // clic sur une image = plein écran « joueurs »
  cleanup.push(() => { imgObserver?.disconnect(); imgObserver = null; });

  // En-tête de la sidebar : titre, verrou, réglages.
  const navHead = el('div', 'gm-nav-head');
  navHead.innerHTML = '<p class="eyebrow">🔒 Maître du Jeu · confidentiel</p>';
  const tools = el('div', 'gm-tools');
  // Retour à l'Archive SANS verrouiller (la topbar qui portait ce retour a disparu).
  const homeBtn = el('a', 'gm-tool', '⌂'); homeBtn.href = '#/'; homeBtn.title = "Retour à l'Archive (reste déverrouillé)";
  const lockBtn = el('button', 'gm-tool danger', '🔒'); lockBtn.type = 'button'; lockBtn.title = 'Verrouiller';
  lockBtn.addEventListener('click', () => { clearGMKey(); location.hash = '#/'; });
  const aMinus = el('button', 'gm-tool', 'A−'); aMinus.type = 'button'; aMinus.title = 'Réduire le texte';
  const aPlus = el('button', 'gm-tool', 'A+'); aPlus.type = 'button'; aPlus.title = 'Agrandir le texte';
  aMinus.addEventListener('click', () => setFontScale(getFontScale() - 0.05));
  aPlus.addEventListener('click', () => setFontScale(getFontScale() + 0.05));
  const readBtn = el('button', 'gm-tool', '📖'); readBtn.type = 'button'; readBtn.title = 'Mode lecture (masque le bandeau d\'édition)';
  const applyReading = (on) => { document.body.classList.toggle('gm-reading', on); readBtn.classList.toggle('active', on); readBtn.setAttribute('aria-pressed', String(on)); };
  readBtn.addEventListener('click', () => { const on = !document.body.classList.contains('gm-reading'); localStorage.setItem('holocron-gm-reading', on ? '1' : ''); applyReading(on); });
  applyReading(localStorage.getItem('holocron-gm-reading') === '1');
  cleanup.push(() => document.body.classList.remove('gm-reading'));
  const printBtn = el('button', 'gm-tool', '🖨️'); printBtn.type = 'button'; printBtn.title = 'Imprimer la rubrique';
  printBtn.addEventListener('click', () => window.print());
  const screenBtn = el('button', 'gm-tool', '🖥️'); screenBtn.type = 'button'; screenBtn.title = 'Écran de MJ (live) : cartes PJ, difficultés, peur, PNJ, rappels';
  screenBtn.addEventListener('click', () => openScreen());
  const notesBtn = el('button', 'gm-tool', '📝'); notesBtn.type = 'button'; notesBtn.title = 'Bloc-notes MJ (chapitre courant / campagne)';
  notesBtn.addEventListener('click', () => openNotes(activeChapter
    ? { type: 'chapter', ref: activeChapter.id, label: activeChapter.name }
    : { type: 'global', ref: '', label: 'Campagne (global)' }));
  const sessionBtn = el('button', 'gm-tool', '🎬'); sessionBtn.type = 'button';
  sessionBtn.title = 'Mode séance (scène épinglée, checklist, ambiances 1-clic)';
  const paintSession = (on) => { sessionBtn.classList.toggle('active', on); sessionBtn.setAttribute('aria-pressed', String(on)); };
  sessionBtn.addEventListener('click', () => paintSession(toggleSession()));
  paintSession(isSessionOn());
  cleanup.push(() => teardownSession());
  tools.append(homeBtn, lockBtn, aMinus, aPlus, readBtn, screenBtn, sessionBtn, printBtn, notesBtn);
  navHead.appendChild(tools);
  nav.appendChild(navHead);

  // Lien « Poste de pilotage » (landing MJ).
  const homeLink = el('a', 'gm-chap-link gm-home-link', '🧭 Poste de pilotage');
  homeLink.href = '#/mj';
  homeLink.addEventListener('click', (e) => { e.preventDefault(); selectChap('home'); });
  nav.appendChild(homeLink);
  const questsLink = el('a', 'gm-chap-link gm-home-link', '🎯 Quêtes');
  questsLink.href = '#/mj/quetes';
  questsLink.addEventListener('click', (e) => { e.preventDefault(); selectChap('quetes'); });
  nav.appendChild(questsLink);
  const campaignLink = el('a', 'gm-chap-link gm-home-link', '🗺️ Campagne');
  campaignLink.href = '#/mj/campagne';
  campaignLink.addEventListener('click', (e) => { e.preventDefault(); selectChap('campagne'); });
  nav.appendChild(campaignLink);
  const sheetsLink = el('a', 'gm-chap-link gm-home-link', '🔥 Fronts & secrets');
  sheetsLink.href = '#/mj/fronts';
  sheetsLink.addEventListener('click', (e) => { e.preventDefault(); selectChap('fronts'); });
  nav.appendChild(sheetsLink);
  const elementsLink = el('a', 'gm-chap-link gm-home-link', '🧩 Bible en éléments');
  elementsLink.href = '#/mj/elements';
  elementsLink.addEventListener('click', (e) => { e.preventDefault(); selectChap('elements'); });
  nav.appendChild(elementsLink);

  // Vues-outils du cockpit : chapId → { mount, link }. Une seule table, pour que
  // l'activation des liens n'ait pas à énumérer chaque outil à trois endroits.
  const TOOL_VIEWS = {
    quetes: { mount: mountGmQuests, link: questsLink },
    campagne: { mount: mountGmCampaign, link: campaignLink },
    fronts: { mount: mountGmSheets, link: sheetsLink },
    elements: { mount: mountGmElements, link: elementsLink },
  };
  const clearToolLinks = () => { for (const v of Object.values(TOOL_VIEWS)) v.link.classList.remove('active'); };

  // Champ de filtre.
  const filter = el('input', 'gm-filter');
  filter.type = 'search'; filter.placeholder = 'Filtrer chapitres…'; filter.setAttribute('aria-label', 'Filtrer les chapitres');
  nav.appendChild(filter);

  // Arbre de navigation : rubriques repliables → chapitres → (sous-sections si actif).
  const tree = el('nav', 'gm-tree');
  nav.appendChild(tree);

  const present = RUBRIQUES.filter((r) => all.some((c) => c.rub === r.key));
  let chapCleanup = [];
  const disposeChap = () => { for (const fn of chapCleanup) fn(); chapCleanup = []; };
  cleanup.push(disposeChap);
  let currentChap = null;

  // Construit l'arbre COMPLET (rubriques → chapitres → sous-sections) dès le
  // départ : les titres de tous les chapitres sont déjà indexés.
  const chapLinks = new Map(); // chapId -> <a>
  const rubBlocks = new Map(); // rubKey -> { details, list }
  for (const r of present) {
    const details = el('details', 'gm-rub');
    details.open = false;
    const summary = el('summary', 'gm-rub-sum');
    const chaps = all.filter((c) => c.rub === r.key);
    summary.innerHTML = `<span class="gm-rub-ico" aria-hidden="true">${r.icon}</span><span class="gm-rub-lbl">${r.label}</span><span class="gm-rub-n">${chaps.length}</span>`;
    details.appendChild(summary);
    const list = el('ul', 'gm-rub-list');
    for (const c of chaps) {
      const li = el('li', 'gm-chap-li');
      const a = el('a', 'gm-chap-link');
      a.href = `#/mj/${c.id}`;
      a.textContent = c.name;
      a.dataset.chap = c.id;
      a.dataset.subtext = c.headings.map((h) => h.text).join(' ');
      a.addEventListener('click', (e) => { e.preventDefault(); selectChap(c.id); });
      li.appendChild(a);
      if (c.headings.length) {
        const sub = el('ul', 'gm-sub');
        for (const h of c.headings) {
          const sa = el('a', `gm-sub-link lvl-${h.level}`);
          sa.href = `#${h.id}`;
          sa.textContent = h.text;
          sa.dataset.target = h.id;
          sa.addEventListener('click', (e) => { e.preventDefault(); selectChap(c.id, h.id); });
          const sli = el('li'); sli.appendChild(sa); sub.appendChild(sli);
        }
        li.appendChild(sub);
      }
      list.appendChild(li);
      chapLinks.set(c.id, a);
    }
    details.appendChild(list);
    tree.appendChild(details);
    rubBlocks.set(r.key, { details, list });
  }

  // Filtre live : masque chapitres/rubriques non-correspondants, ouvre ce qui matche.
  filter.addEventListener('input', () => {
    const q = norm(filter.value.trim());
    const curRub = all.find((c) => c.id === currentChap)?.rub;
    for (const r of present) {
      const { details, list } = rubBlocks.get(r.key);
      let anyVisible = false;
      for (const a of list.querySelectorAll('.gm-chap-link')) {
        const hit = !q || norm(a.textContent).includes(q) || norm(a.dataset.subtext || '').includes(q);
        a.closest('.gm-chap-li').hidden = !hit;
        if (hit) anyVisible = true;
      }
      details.hidden = !anyVisible;
      if (q && anyVisible) details.open = true;
      else if (!q) details.open = (r.key === curRub);
    }
  });

  // Sélectionne (et rend si besoin) UN chapitre — ou le poste de pilotage —
  // puis scrolle vers son heading.
  function selectChap(chapId, headingId) {
    if (TOOL_VIEWS[chapId]) {
      if (currentChap !== chapId) {
        disposeChap();
        currentChap = chapId;
        TOOL_VIEWS[chapId].mount(main, chapCleanup);
        for (const r of present) rubBlocks.get(r.key).details.open = false;
        try { history.replaceState(null, '', `#/mj/${chapId}`); } catch { /* sandbox */ }
      }
      for (const [, a] of chapLinks) a.classList.remove('active');
      homeLink.classList.remove('active');
      clearToolLinks();
      TOOL_VIEWS[chapId].link.classList.add('active');
      activeChapter = null;
      refreshSessionBar();
      window.scrollTo(0, 0);
      return;
    }
    if (chapId === 'home' || !chapId) {
      if (currentChap !== 'home') {
        disposeChap();
        currentChap = 'home';
        renderGmHome(main, { all, selectChap, getPos: getGmPos }, chapCleanup);
        for (const r of present) rubBlocks.get(r.key).details.open = false;
        try { history.replaceState(null, '', '#/mj'); } catch { /* sandbox */ }
      }
      for (const [, a] of chapLinks) a.classList.remove('active');
      clearToolLinks();
      homeLink.classList.add('active');
      activeChapter = null;
      refreshSessionBar(); // retire les chips du chapitre quitté
      window.scrollTo(0, 0);
      return;
    }
    homeLink.classList.remove('active');
    clearToolLinks();
    const chap = all.find((c) => c.id === chapId) || all[0];
    if (!chap) return;
    if (chap.id !== currentChap) {
      disposeChap();
      currentChap = chap.id;
      renderChapter(main, chap, chapCleanup, nav, all, selectChap);
      // Ouvre la rubrique du chapitre, referme les autres ; met à jour l'URL
      // (replaceState : pas d'événement hashchange, donc pas de re-montage).
      for (const r of present) rubBlocks.get(r.key).details.open = (r.key === chap.rub);
      try { history.replaceState(null, '', `#/mj/${chap.id}`); } catch { /* sandbox */ }
    }
    for (const [cid, a] of chapLinks) a.classList.toggle('active', cid === chap.id);
    saveGmPos(chap.id, chap.name, headingId);
    refreshSessionBar(); // chips de la scène épinglée (si ce chapitre la porte)
    if (headingId) {
      const target = document.getElementById(headingId);
      if (target) {
        const details = target.closest('details');
        if (details && !details.open) details.open = true;
        target.scrollIntoView({ behavior: 'auto', block: 'start' });
        // Scroll correctif : les images au-dessus peuvent changer de hauteur en
        // chargeant (ratio réel ≠ ratio réservé) — on réajuste une fois.
        setTimeout(() => {
          const top = target.getBoundingClientRect().top;
          if (Math.abs(top - 70) > 60) target.scrollIntoView({ behavior: 'auto', block: 'start' });
        }, 450);
        return;
      }
    }
    window.scrollTo(0, 0);
  }

  // Bouton flottant « ↑ Sommaire ».
  const toTop = el('button', 'gm-totop', '↑ Sommaire'); toTop.type = 'button';
  toTop.addEventListener('click', () => { main.scrollIntoView({ block: 'start' }); window.scrollTo({ top: 0, behavior: 'smooth' }); nav.querySelector('.gm-filter')?.focus(); });
  container.appendChild(toTop);
  cleanup.push(() => toTop.remove());

  // Mode séance : bandeau + épingles (contexte de navigation partagé).
  initSession({ selectChap: (c, h) => selectChap(c, h), getCurrentChap: () => currentChap });

  selectChap(scrollTo || 'home');
}

// Rend UN chapitre (page éditable + footer préc/suiv) + scroll-spy de ses titres.
function renderChapter(main, chap, chapCleanup, nav, all, selectChap) {
  main.innerHTML = '';
  activeChapter = { id: chap.id, name: chap.name };

  const sec = el('section', 'chapter page-surface reader');
  sec.id = `chap-${chap.id}`;
  const body = el('div', 'journal-content');
  chapCleanup.push(mountEditablePage(body, { id: chap.id, name: chap.name, html: chap.html }, {
    api: gmApi,
    available: true,
    initial: { html: chap.html, updatedAt: chap.updatedAt, updatedBy: chap.updatedBy },
    onChange: (html, updatedAt, updatedBy) => { chap.html = html; chap.updatedAt = updatedAt; chap.updatedBy = updatedBy; },
  }));
  sec.appendChild(body);
  main.appendChild(sec);

  // Footer : navigation chapitre précédent / suivant (ordre du seed).
  const idx = all.indexOf(chap);
  const prev = all[idx - 1], next = all[idx + 1];
  if (prev || next) {
    const foot = el('nav', 'gm-chap-footer');
    foot.setAttribute('aria-label', 'Chapitres voisins');
    if (prev) {
      const a = el('a', 'gm-foot-link prev', `<span class="gf-dir">← Précédent</span><span class="gf-name">${prev.name}</span>`);
      a.href = `#/mj/${prev.id}`;
      a.addEventListener('click', (e) => { e.preventDefault(); selectChap(prev.id); });
      foot.appendChild(a);
    }
    if (next) {
      const a = el('a', 'gm-foot-link next', `<span class="gf-dir">Suivant →</span><span class="gf-name">${next.name}</span>`);
      a.href = `#/mj/${next.id}`;
      a.addEventListener('click', (e) => { e.preventDefault(); selectChap(next.id); });
      foot.appendChild(a);
    }
    main.appendChild(foot);
  }

  // Illustrations + Mermaid + fiches de combat + liens PNJ + épingles de scène —
  // sur CE chapitre, ré-exécutés à chaque mutation (édition, poll) de son contenu.
  const enhance = () => { rewriteAssets(sec); renderMermaid(sec); renderCombat(sec); linkifyPnj(sec); injectPins(sec, chap); };
  enhance();
  const mo = new MutationObserver(enhance);
  mo.observe(sec, { childList: true, subtree: true });
  chapCleanup.push(() => mo.disconnect());

  // Scroll-spy des sous-sections du chapitre courant + mémoire de position.
  let onScroll = null;
  let current = null;
  const update = () => {
    let chosen = null, top0 = -Infinity;
    for (const h of chap.headings) {
      const node = document.getElementById(h.id);
      if (!node) continue;
      const top = node.getBoundingClientRect().top;
      if (top <= 180 && top > top0) { top0 = top; chosen = h; }
    }
    const cid = chosen ? chosen.id : null;
    if (cid === current) return;
    current = cid;
    for (const sa of nav.querySelectorAll('.gm-sub-link')) sa.classList.toggle('spy', sa.dataset.target === cid);
    saveGmPos(chap.id, chap.name, cid);
  };
  onScroll = () => window.requestAnimationFrame(update);
  window.addEventListener('scroll', onScroll, { passive: true });
  chapCleanup.push(() => window.removeEventListener('scroll', onScroll));
}

// Point d'entrée : monte la section MJ (gate ou documents).
export function mountGM(container, scrollTo, cleanup = []) {
  attachPnjPreview(); // aperçu au survol des liens PNJ (écoute déléguée, une fois)
  mountNotes();       // bloc-notes MJ (panneau + écoute d'ouverture, une fois)
  (async () => {
    if (getGMKey() || Data.gm) {
      let list = null;
      try { list = await gmList(); } catch { /* réseau */ }
      if (list) { await renderDocs(container, list, scrollTo, cleanup); return; }
      clearGMKey();
    }
    renderGate(container, (list) => { mountSidebar(); renderDocs(container, list, scrollTo, cleanup); });
  })();
  return cleanup;
}
