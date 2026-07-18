// mcp.mjs — connecteur Foundry (gateway Rust) à deux modes, file SÉQUENTIELLE.
//
//   Mode sidecar (défaut)  : spawn du binaire foundry-mcp-gateway (Rust) en
//     process enfant HTTP sur localhost — supervision : respawn s'il meurt,
//     chien de garde si la session Foundry est morte (échecs consécutifs).
//   Mode http (externe)    : FOUNDRY_MCP_URL vers un gateway déjà déployé
//     (utile quand il sert aussi d'autres clients, ex. sessions Claude).
//
// Le binaire sidecar est téléchargé par scripts/fetch-gateway.mjs (postinstall)
// dans vendor/, ou fourni via FOUNDRY_GATEWAY_BIN (dev : target/release local).
// Règle d'or : le monde Foundry n'aime pas les appels concurrents →
// mcpQueue() sérialise TOUT (sync d'arrière-plan comme routes MJ).
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { randomBytes } from 'node:crypto';

let cfg = { mode: 'none', url: '', bin: null, credsJson: '', logger: console };

export function configureMcp({ foundryMcpUrl, credentialsJson, sidecarBin, logger }) {
  cfg.logger = logger || console;
  if (foundryMcpUrl) {
    cfg.mode = 'http';
    cfg.url = foundryMcpUrl;
  } else if (credentialsJson && sidecarBin) {
    cfg.mode = 'sidecar';
    cfg.bin = sidecarBin;
    // le gateway exige un _id par entrée — les envs historiques (ère TS) ne
    // l'ont pas : on le complète pour rester zéro-config.
    try {
      const arr = JSON.parse(credentialsJson);
      cfg.credsJson = Array.isArray(arr)
        ? JSON.stringify(arr.map((c, i) => ({ _id: `world-${i}`, ...c })))
        : credentialsJson;
    } catch { cfg.credsJson = credentialsJson; }
  } else {
    cfg.mode = 'none';
  }
  return cfg.mode;
}
export function mcpMode() { return cfg.mode; }

/* --------------------------------------------------------------- file unique */
let queueTail = Promise.resolve();
export function mcpQueue(fn) {
  const run = queueTail.then(fn, fn);
  queueTail = run.catch(() => {});
  return run;
}

/* ------------------------------------------------------- client MCP « HTTP » */
let httpSid = null;
let rid = 1000;
async function httpRpc(payload) {
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
  if (httpSid) headers['mcp-session-id'] = httpSid;
  const resp = await fetch(cfg.url, { method: 'POST', headers, body: JSON.stringify(payload) });
  httpSid = resp.headers.get('mcp-session-id') || httpSid;
  const body = await resp.text();
  const events = [...body.matchAll(/^data: (.*)$/gm)].map((m) => JSON.parse(m[1]));
  if (!events.length && body.trim()) events.push(JSON.parse(body));
  return events;
}
async function httpInit() {
  httpSid = null;
  await httpRpc({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'swffg-holocron', version: '1' } } });
  await httpRpc({ jsonrpc: '2.0', method: 'notifications/initialized' });
}
async function httpCall(name, args) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      if (!httpSid) await httpInit();
      const events = await httpRpc({ jsonrpc: '2.0', id: ++rid, method: 'tools/call', params: { name, arguments: args } });
      return unpack(events.at(-1));
    } catch (e) {
      httpSid = null; // session expirée / gateway redéployé → retente une fois
      if (attempt === 1) throw e;
    }
  }
}

/* ------------------------------------------------- sidecar : gateway local -- */
const SIDECAR_PORT = Number(process.env.FOUNDRY_GATEWAY_PORT || 8788);
let child = null;
let childReady = null;      // promesse résolue quand /health répond
let respawnDelay = 5000;    // backoff (5 s → 60 s max)

function startSidecar() {
  const secret = randomBytes(24).toString('hex');
  cfg.url = `http://127.0.0.1:${SIDECAR_PORT}/mcp-${secret}`;
  httpSid = null;
  cfg.logger.log(`[mcp] démarrage du gateway sidecar : ${cfg.bin} (port ${SIDECAR_PORT})`);
  child = spawn(cfg.bin, [], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      PORT: String(SIDECAR_PORT),
      MCP_SECRET: secret,
      FOUNDRY_CREDENTIALS_JSON: cfg.credsJson,
    },
  });
  for (const stream of [child.stdout, child.stderr]) {
    const rl = createInterface({ input: stream });
    rl.on('line', (line) => {
      if (!line.trim()) return;
      cfg.logger.log(`[mcp·gw] ${line.length > 400 ? line.slice(0, 400) + '… (tronqué)' : line}`);
    });
  }
  child.on('exit', (code, signal) => {
    cfg.logger.error(`[mcp] gateway sidecar mort (code=${code} signal=${signal}) — redémarrage dans ${respawnDelay / 1000} s`);
    child = null; childReady = null; httpSid = null;
    setTimeout(() => { ensureSidecar().catch(() => {}); }, respawnDelay);
    respawnDelay = Math.min(respawnDelay * 2, 60_000);
  });
  childReady = (async () => {
    const health = `http://127.0.0.1:${SIDECAR_PORT}/health`;
    for (let i = 0; i < 60; i++) {
      try {
        const r = await fetch(health, { signal: AbortSignal.timeout(2000) });
        if (r.ok) { respawnDelay = 5000; failStreak = 0; return; }
      } catch { /* pas encore prêt */ }
      await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error('gateway sidecar : /health injoignable après 60 s');
  })();
  return childReady;
}
function ensureSidecar() {
  if (child && childReady) return childReady;
  return startSidecar();
}

// Chien de garde : le gateway gère sa propre reconnexion Foundry, mais s'il se
// retrouve coincé (session zombie, monde redémarré au mauvais moment), on le
// relance après FAIL_LIMIT échecs consécutifs — tout succès remet à zéro.
const FAIL_LIMIT = 8;
let failStreak = 0;
function noteResult(ok) {
  if (cfg.mode !== 'sidecar') return;
  if (ok) { failStreak = 0; return; }
  failStreak += 1;
  if (failStreak >= FAIL_LIMIT && child) {
    cfg.logger.error(`[mcp] ${failStreak} échecs consécutifs — redémarrage du gateway sidecar`);
    failStreak = 0;
    try { child.kill(); } catch { /* déjà mort */ }
  }
}

async function sidecarCall(name, args) {
  await ensureSidecar();
  return httpCall(name, args);
}

/* ------------------------------------------------------------------ commun */
function unpack(msg) {
  const result = msg?.result;
  if (!result) throw new Error(msg?.error ? JSON.stringify(msg.error).slice(0, 300) : 'réponse MCP vide');
  const text = result.content?.[0]?.text ?? '';
  let parsed; try { parsed = JSON.parse(text); } catch { parsed = text; }
  if (result.isError) throw new Error(String(text).slice(0, 300));
  if (parsed && typeof parsed === 'object' && parsed.error) throw new Error(JSON.stringify(parsed.error).slice(0, 300));
  return parsed;
}

// Appel d'outil, TOUJOURS via la file séquentielle (+ chien de garde sidecar).
export function mcpCall(name, args = {}) {
  if (cfg.mode === 'none') return Promise.reject(new Error('connecteur Foundry non configuré'));
  return mcpQueue(() => (cfg.mode === 'http' ? httpCall(name, args) : sidecarCall(name, args)))
    .then((v) => { noteResult(true); return v; }, (e) => { noteResult(false); throw e; });
}

// Id du user Foundry du bot (author des ChatMessages, requis en v13).
let botUserId = null;
export async function mcpAuthorId() {
  if (!botUserId) botUserId = (await mcpCall('get_world', {}))?.userId || null;
  return botUserId;
}
