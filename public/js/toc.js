// toc.js — table des matières (chapitres = pages) + navigation + scroll-spy.

// Construit les pastilles de chapitres (en haut du journal).
export function buildChapNav(pages) {
  const nav = document.createElement('nav');
  nav.className = 'chapnav';
  nav.setAttribute('aria-label', 'Chapitres');
  for (const p of pages) {
    const a = document.createElement('a');
    a.href = `#chap-${p.id}`;
    a.dataset.chap = p.id;
    a.textContent = p.name;
    nav.appendChild(a);
  }
  return nav;
}

// Construit la TOC latérale droite.
export function buildTOC(pages) {
  const aside = document.createElement('aside');
  aside.className = 'toc';
  aside.setAttribute('aria-label', 'Table des matières');
  aside.innerHTML = '<p class="toc-title">Table des matières</p>';
  const ul = document.createElement('ul');
  for (const p of pages) {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = `#chap-${p.id}`;
    a.dataset.chap = p.id;
    a.className = (p.level || 1) >= 2 ? 'lvl-2' : 'lvl-1';
    a.textContent = p.name;
    li.appendChild(a);
    ul.appendChild(li);
  }
  aside.appendChild(ul);
  return aside;
}

// Active le scroll-spy : surligne les liens (TOC + chapnav) du chapitre visible.
// Renvoie une fonction de nettoyage (déconnecte l'observer).
export function setupScrollSpy(root, linkContainers) {
  const sections = [...root.querySelectorAll('.chapter')];
  if (!sections.length) return () => {};

  const setActive = (id) => {
    for (const container of linkContainers) {
      for (const a of container.querySelectorAll('[data-chap]')) {
        a.classList.toggle('spy', a.dataset.chap === id);
      }
    }
  };

  let current = null;
  const visible = new Map();
  const observer = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) visible.set(e.target.id, e.intersectionRatio);
        else visible.delete(e.target.id);
      }
      // Chapitre le plus haut parmi les visibles.
      let best = null;
      let bestTop = Infinity;
      for (const id of visible.keys()) {
        const el = document.getElementById(id);
        if (!el) continue;
        const top = el.getBoundingClientRect().top;
        if (top < bestTop) {
          bestTop = top;
          best = id;
        }
      }
      const id = best ? best.replace('chap-', '') : null;
      if (id && id !== current) {
        current = id;
        setActive(id);
      }
    },
    { rootMargin: '-20% 0px -70% 0px', threshold: [0, 0.25, 0.5, 1] }
  );
  sections.forEach((s) => observer.observe(s));
  return () => observer.disconnect();
}
