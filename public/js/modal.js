// modal.js — ouverture de la modale « carte » (compendium, talents, améliorations).
export function openCard(title, node, metaText) {
  document.getElementById('card-title').textContent = title || 'Référence';
  const body = document.getElementById('card-body');
  body.innerHTML = '';
  if (metaText) {
    const meta = document.createElement('div');
    meta.className = 'card-meta';
    meta.textContent = metaText;
    body.appendChild(meta);
  }
  if (node) body.appendChild(node);
  document.getElementById('card-modal').hidden = false;
}
