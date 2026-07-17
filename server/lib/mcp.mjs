// mcp.mjs — connecteur Foundry à deux modes, avec file d'appels SÉQUENTIELLE.
//
//   Mode A (embarqué, défaut)  : spawn du serveur foundry-mcp-server en process
//     enfant STDIO (JSON-RPC ligne à ligne) — un seul runtime, supervision +
//     redémarrage automatique du child s'il meurt.
//   Mode B (externe)           : FOUNDRY_MCP_URL vers un gateway MCP
//     « streamable HTTP » (setup historique ; utile quand le gateway sert aussi
//     d'autres clients, ex. sessions Claude).
//
// Règle d'or : le client Foundry ne supporte PAS les appels concurrents →
// mcpQueue() sérialise TOUT (sync d'arrière-plan comme routes MJ).
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

let cfg = { mode: 'none', url: '', childCmd: null, credsJson: '', credsPath: '', logger: console };

export function configureMcp({ foundryMcpUrl, credentialsJson, childEntry, dataDir = './data', logger }) {
  cfg.logger = logger || console;
  if (foundryMcpUrl) {
    cfg.mode = 'http';
    cfg.url = foundryMcpUrl;
  } else if (credentialsJson && childEntry) {
    cfg.mode = 'stdio';
    cfg.childCmd = childEntry;
    cfg.credsJson = credentialsJson;
    // le serveur MCP lit un FICHIER de credentials (env FOUNDRY_CREDENTIALS)
    mkdirSync(dataDir, { recursive: true });
    cfg.credsPath = join(dataDir, 'foundry_credentials.json');
    writeFileSync(cfg.credsPath, credentialsJson, { mode: 0o600 });
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

/* ------------------------------------------------------------- mode B : HTTP */
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

/* ----------------------------------------------------------- mode A : stdio */
let child = null;
let childReady = null;
const pending = new Map(); // id → {resolve, reject}

// Chien de garde : quand le monde Foundry redémarre, le child reste vivant
// mais sa session WebSocket est morte — tous les appels échouent (« Response
// does not contain … array ») sans que 'exit' ne se déclenche jamais. Au bout
// de FAIL_LIMIT échecs consécutifs on tue le child : le handler 'exit' le
// relance avec une session fraîche (plus besoin de redémarrer l'app).
const FAIL_LIMIT = 8;
let failStreak = 0;
function noteResult(ok) {
  if (cfg.mode !== 'stdio') return;
  if (ok) { failStreak = 0; return; }
  failStreak += 1;
  if (failStreak >= FAIL_LIMIT && child) {
    cfg.logger.error(`[mcp] ${failStreak} échecs consécutifs — session Foundry supposée morte, redémarrage du connecteur`);
    failStreak = 0;
    try { child.kill(); } catch { /* déjà mort */ }
  }
}

function startChild() {
  failStreak = 0;
  cfg.logger.log(`[mcp] démarrage du connecteur embarqué : ${cfg.childCmd.join(' ')}`);
  child = spawn(cfg.childCmd[0], cfg.childCmd.slice(1), {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, FOUNDRY_CREDENTIALS: cfg.credsPath },
  });
  // stderr du connecteur : il logge CHAQUE message WebSocket — sur un monde
  // volumineux ce sont des dumps de plusieurs Mo par tick qui saturent le
  // pipeline de logs (et la mémoire d'une petite instance). On filtre le
  // bruit et on tronque le reste.
  const rlErr = createInterface({ input: child.stderr });
  rlErr.on('line', (line) => {
    if (line.includes('WebSocket message') || line.includes('userActivity')) return;
    cfg.logger.error(`[mcp·child] ${line.length > 500 ? line.slice(0, 500) + '… (tronqué)' : line}`);
  });
  const rl = createInterface({ input: child.stdout });
  rl.on('line', (line) => {
    let msg; try { msg = JSON.parse(line); } catch { return; }
    const waiter = pending.get(msg.id);
    if (waiter) { pending.delete(msg.id); waiter.resolve(msg); }
  });
  child.on('exit', (code, signal) => {
    cfg.logger.error(`[mcp] connecteur mort (code=${code} signal=${signal}) — redémarrage dans 5 s`);
    for (const [, w] of pending) w.reject(new Error('connecteur redémarré'));
    pending.clear();
    child = null; childReady = null;
    setTimeout(() => { ensureChild().catch(() => {}); }, 5000);
  });
  childReady = (async () => {
    await stdioSend({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'swffg-holocron', version: '1' } } });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  })();
  return childReady;
}
function ensureChild() {
  if (child && childReady) return childReady;
  return startChild();
}
function stdioSend(payload, timeoutMs = 120_000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { pending.delete(payload.id); reject(new Error('timeout MCP stdio')); }, timeoutMs);
    pending.set(payload.id, { resolve: (m) => { clearTimeout(t); resolve(m); }, reject: (e) => { clearTimeout(t); reject(e); } });
    child.stdin.write(JSON.stringify(payload) + '\n');
  });
}
async function stdioCall(name, args) {
  await ensureChild();
  // le client Foundry du child se connecte en asynchrone au démarrage : on
  // laisse quelques secondes avant d'abandonner sur « Not connected ».
  for (let attempt = 0; ; attempt++) {
    const msg = await stdioSend({ jsonrpc: '2.0', id: ++rid, method: 'tools/call', params: { name, arguments: args } });
    try { return unpack(msg); }
    catch (e) {
      if (attempt < 5 && /Not connected/i.test(e.message)) {
        await new Promise((r) => setTimeout(r, 3000));
        continue;
      }
      throw e;
    }
  }
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

// Appel d'outil, TOUJOURS via la file séquentielle (+ chien de garde stdio).
export function mcpCall(name, args = {}) {
  if (cfg.mode === 'none') return Promise.reject(new Error('connecteur Foundry non configuré'));
  return mcpQueue(() => (cfg.mode === 'http' ? httpCall(name, args) : stdioCall(name, args)))
    .then((v) => { noteResult(true); return v; }, (e) => { noteResult(false); throw e; });
}

// Id du user Foundry du bot (author des ChatMessages, requis en v13).
let botUserId = null;
export async function mcpAuthorId() {
  if (!botUserId) botUserId = (await mcpCall('get_world', {}))?.userId || null;
  return botUserId;
}
