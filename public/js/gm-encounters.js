// gm-encounters.js — créateur/éditeur de rencontres (MJ). La bibliothèque vit
// dans Foundry (journal « ⚔️ Bibliothèque de rencontres », flags.holocron.encounters)
// → préparable depuis le web, générable par un assistant IA via MCP, et jouable
// sur place (tracker) ou dans Foundry (🎬 scène + tokens).
import { Data, ensureAdversaries } from './data.js';
import { renderCombat } from './combat-tracker.js';

const API = (window.HOLOCRON && window.HOLOCRON.api) || '/api';
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };

async function api(path, opts = {}) {
  const res = await fetch(API + path, { credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, ...opts });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

// Sérialise une rencontre au format bloc ```combat (pour coller dans un chapitre).
function toBlock(enc) {
  const lines = [`id: ${enc.id}`, `title: ${enc.title}`];
  if (enc.map) lines.push(`map: ${enc.map}`);
  if (enc.note) lines.push(`note: ${enc.note}`);
  for (const g of enc.groups || []) {
    if (g.name) lines.push(`== ${g.name} ==`);
    for (const r of g.rows || []) {
      const thr = [r.w ? `W${r.w}` : '', r.s ? `S${r.s}` : ''].filter(Boolean).join(' ');
      lines.push([r.name, `×${r.count}`, thr, r.soak || '', r.attack || '', r.key || ''].join(' | ').replace(/(\s\|\s)+$/, ''));
    }
  }
  return lines.join('\n');
}

// Auto-remplissage des stats depuis une fiche d'adversaire (ou acteur monde).
function statsFor(name) {
  const norm = (x) => String(x).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  const pool = [...(Data.adversaries || []), ...(Data.worldNpcs || [])];
  let hit = pool.find((a) => norm(a.name) === norm(name));
  if (!hit) hit = pool.filter((a) => norm(a.name).includes(norm(name))).sort((a, b) => a.name.length - b.name.length)[0];
  if (!hit) return null;
  const w0 = hit.weapons?.[0];
  return {
    name: hit.name,
    w: hit.stats?.wounds?.max || 0,
    s: hit.stats?.strain?.max || 0,
    soak: String(hit.stats?.soak ?? ''),
    attack: w0 ? `${w0.name} — Dég ${w0.damage} · Crit ${w0.crit}${w0.range ? ' · ' + w0.range : ''}` : '',
  };
}

export async function mountEncounters(container) {
  container.innerHTML = '<div class="view-head"><h1>⚔️ Rencontres</h1><p class="muted">Prépare tes combats : bibliothèque partagée avec Foundry, tracker intégré, génération de scène.</p></div>';
  const wrap = el('div', 'enc-wrap');
  container.appendChild(wrap);

  const listCol = el('aside', 'enc-list');
  const editCol = el('section', 'enc-edit');
  wrap.append(listCol, editCol);

  let encounters = [];
  let current = null;

  const blank = () => ({ id: `enc-${Math.random().toString(36).slice(2, 10)}`, title: 'Nouvelle rencontre', map: '', note: '', groups: [{ name: '', rows: [] }] });

  async function refresh() {
    try { encounters = (await api('/gm/encounters')).encounters; }
    catch (e) { listCol.innerHTML = `<p class="muted">${esc(e.message)}</p>`; return; }
    paintList();
  }

  function paintList() {
    listCol.innerHTML = '<p class="eyebrow">Bibliothèque</p>';
    const add = el('button', 'enc-new', '＋ Nouvelle rencontre');
    add.type = 'button';
    add.addEventListener('click', () => { current = blank(); paintEditor(); });
    listCol.appendChild(add);
    for (const enc of encounters) {
      const item = el('button', 'enc-item' + (current?.id === enc.id ? ' active' : ''));
      item.type = 'button';
      const n = (enc.groups || []).reduce((t, g) => t + (g.rows || []).reduce((x, r) => x + (r.count || 1), 0), 0);
      item.innerHTML = `<b>${esc(enc.title)}</b><small>${n} combattant(s)${enc.map ? ' · 🗺️' : ''}</small>`;
      item.addEventListener('click', () => { current = JSON.parse(JSON.stringify(enc)); paintEditor(); paintList(); });
      listCol.appendChild(item);
    }
  }

  function rowEditor(g, r, repaint) {
    const row = el('div', 'enc-row');
    const name = el('input'); name.value = r.name; name.placeholder = 'Adversaire (autocomplétion)'; name.setAttribute('list', 'enc-adv');
    name.addEventListener('change', () => {
      r.name = name.value;
      const st = statsFor(name.value);
      if (st) { Object.assign(r, { name: st.name, w: r.w || st.w, s: r.s || st.s, soak: r.soak || st.soak, attack: r.attack || st.attack }); repaint(); }
    });
    const count = el('input'); count.type = 'number'; count.min = 1; count.max = 12; count.value = r.count || 1; count.title = '×N';
    count.addEventListener('change', () => { r.count = +count.value || 1; });
    const w = el('input'); w.type = 'number'; w.value = r.w || 0; w.title = 'Seuil de blessures'; w.className = 'sm';
    w.addEventListener('change', () => { r.w = +w.value || 0; });
    const s = el('input'); s.type = 'number'; s.value = r.s || 0; s.title = 'Seuil de stress'; s.className = 'sm';
    s.addEventListener('change', () => { r.s = +s.value || 0; });
    const soak = el('input'); soak.value = r.soak || ''; soak.placeholder = 'Enc.'; soak.className = 'sm'; soak.title = 'Encaissement';
    soak.addEventListener('change', () => { r.soak = soak.value; });
    const attack = el('input'); attack.value = r.attack || ''; attack.placeholder = 'Attaque (auto)';
    attack.addEventListener('change', () => { r.attack = attack.value; });
    const key = el('input'); key.value = r.key || ''; key.placeholder = 'Note clé';
    key.addEventListener('change', () => { r.key = key.value; });
    const del = el('button', 'enc-del', '✕'); del.type = 'button'; del.title = 'Retirer';
    del.addEventListener('click', () => { g.rows.splice(g.rows.indexOf(r), 1); repaint(); });
    row.append(name, count, w, s, soak, attack, key, del);
    return row;
  }

  function paintEditor() {
    if (!current) { editCol.innerHTML = '<p class="muted">Choisis ou crée une rencontre.</p>'; return; }
    editCol.innerHTML = '';
    const head = el('div', 'enc-fields');
    const title = el('input'); title.value = current.title; title.placeholder = 'Titre'; title.className = 'enc-title';
    title.addEventListener('change', () => { current.title = title.value; });
    const map = el('input'); map.value = current.map || ''; map.placeholder = 'map: worlds/…/battlemap.webp (fond de la scène 🎬)';
    map.addEventListener('change', () => { current.map = map.value; });
    const note = el('input'); note.value = current.note || ''; note.placeholder = 'Note (contexte, déclencheur…)';
    note.addEventListener('change', () => { current.note = note.value; });
    head.append(title, map, note);
    editCol.appendChild(head);

    const groupsBox = el('div', 'enc-groups');
    editCol.appendChild(groupsBox);
    const repaintGroups = () => {
      groupsBox.innerHTML = '';
      for (const g of current.groups) {
        const gbox = el('div', 'enc-group');
        const gname = el('input'); gname.value = g.name || ''; gname.placeholder = 'Nom du groupe (vague 1, renforts…)'; gname.className = 'enc-gname';
        gname.addEventListener('change', () => { g.name = gname.value; });
        gbox.appendChild(gname);
        for (const r of g.rows) gbox.appendChild(rowEditor(g, r, repaintGroups));
        const addRow = el('button', 'enc-add', '＋ combattant'); addRow.type = 'button';
        addRow.addEventListener('click', () => { g.rows.push({ name: '', count: 1, w: 0, s: 0, soak: '', attack: '', key: '' }); repaintGroups(); });
        const delG = el('button', 'enc-del', '✕ groupe'); delG.type = 'button';
        delG.addEventListener('click', () => { current.groups.splice(current.groups.indexOf(g), 1); repaintGroups(); });
        const gfoot = el('div', 'enc-gfoot'); gfoot.append(addRow, delG);
        gbox.appendChild(gfoot);
        groupsBox.appendChild(gbox);
      }
      const addG = el('button', 'enc-add', '＋ groupe'); addG.type = 'button';
      addG.addEventListener('click', () => { current.groups.push({ name: '', rows: [] }); repaintGroups(); });
      groupsBox.appendChild(addG);
    };
    repaintGroups();

    // actions
    const actions = el('div', 'enc-actions');
    const mkBtn = (label, cls, fn) => {
      const b = el('button', 'enc-btn ' + (cls || ''), label); b.type = 'button';
      b.addEventListener('click', async () => {
        b.disabled = true; const t = b.textContent; b.textContent = '…';
        try { await fn(b); b.textContent = '✓'; } catch (e) { alert(e.message); b.textContent = t; }
        finally { setTimeout(() => { b.textContent = t; b.disabled = false; }, 1500); }
      });
      return b;
    };
    actions.append(
      mkBtn('💾 Enregistrer', 'gold', async () => {
        const saved = (await api('/gm/encounters', { method: 'PUT', body: JSON.stringify(current) })).encounter;
        current = saved; await refresh(); paintTracker();
      }),
      mkBtn('📋 Copier le bloc', '', async () => { await navigator.clipboard.writeText('```combat\n' + toBlock(current) + '\n```'); }),
      mkBtn('🎬 Scène Foundry', '', async () => {
        const combatants = current.groups.flatMap((g) => g.rows.map((r) => ({ name: r.name, count: r.count || 1 }))).filter((c) => c.name);
        if (!combatants.length) throw new Error('aucun combattant');
        const out = await api('/gm/foundry/combat-scene', { method: 'POST', body: JSON.stringify({ title: current.title, map: current.map, combatants }) });
        alert(`Scène « ${out.sceneName} » créée (${out.tokens} tokens)`
          + (current.map && !out.bgSet ? `\n⚠️ fond non chargé (chemin d'image non reconnu : ${current.map})` : '')
          + (out.missing?.length ? `\n⚠️ introuvables : ${out.missing.join(', ')}` : ''));
      }),
      mkBtn('🗑️ Supprimer', 'danger', async () => {
        if (!confirm('Supprimer cette rencontre de la bibliothèque ?')) return;
        await api(`/gm/encounters/${encodeURIComponent(current.id)}`, { method: 'DELETE' });
        current = null; await refresh(); paintEditor();
      }),
    );
    editCol.appendChild(actions);

    // tracker live (le même que dans les chapitres)
    const trackBox = el('div', 'enc-track');
    editCol.appendChild(trackBox);
    function paintTracker() {
      trackBox.innerHTML = '<p class="eyebrow">Tracker (état persisté par rencontre)</p>';
      const pre = el('pre', 'combat'); pre.textContent = toBlock(current);
      const host = el('div'); host.appendChild(pre);
      trackBox.appendChild(host);
      try { renderCombat(trackBox); } catch { /* tracker optionnel */ }
    }
    paintTracker();
  }

  // datalist d'autocomplétion (adversaires + PNJ custom)
  await ensureAdversaries();
  const dl = el('datalist'); dl.id = 'enc-adv';
  dl.innerHTML = [...(Data.adversaries || []).map((a) => a.name), ...(Data.worldNpcs || []).map((n) => n.name)]
    .sort().map((n) => `<option value="${esc(n)}">`).join('');
  container.appendChild(dl);

  await refresh();
  paintEditor();
}
