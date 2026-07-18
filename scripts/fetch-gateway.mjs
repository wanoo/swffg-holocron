#!/usr/bin/env node
// fetch-gateway.mjs — télécharge le binaire foundry-mcp-gateway (Rust) en
// vendor/ pour le mode sidecar. Lancé en postinstall (Clever comme dev local).
// Épinglé par tag + SHA-256 ; échec NON fatal (l'app peut tourner en mode
// FOUNDRY_MCP_URL externe, ou le binaire être fourni via FOUNDRY_GATEWAY_BIN).
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, chmodSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = 'wanoo/foundry-mcp-gateway';
const TAG = 'v0.1.0';
// sha256 des assets de la release — à mettre à jour à chaque bump de TAG.
const ASSETS = {
  'linux-x64': { name: 'foundry-mcp-linux-x64', sha256: 'c4d7b26a759daf8bb4fdaaf4fac8870e9aca0d662b2475314d377e389dc6791b' },
  'darwin-arm64': { name: 'foundry-mcp-darwin-arm64', sha256: '0dff9f8ac005ac58ea6d2bfe0c07059c24c1bf81b451b9ec282ca7bc6acf178c' },
};

const plat = `${process.platform}-${process.arch}`;
const key = plat === 'linux-x64' ? 'linux-x64' : plat === 'darwin-arm64' ? 'darwin-arm64' : null;
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dest = join(root, 'vendor', 'foundry-mcp');

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

async function main() {
  if (!key) { console.log(`[fetch-gateway] plateforme ${plat} non couverte — mode sidecar indisponible (utiliser FOUNDRY_MCP_URL ou FOUNDRY_GATEWAY_BIN)`); return; }
  const { name, sha256: want } = ASSETS[key];
  if (existsSync(dest) && sha256(readFileSync(dest)) === want) {
    console.log(`[fetch-gateway] binaire déjà présent et vérifié (${TAG}, ${key})`);
    return;
  }
  const url = `https://github.com/${REPO}/releases/download/${TAG}/${name}`;
  console.log(`[fetch-gateway] téléchargement ${url}`);
  const r = await fetch(url, { redirect: 'follow' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  const got = sha256(buf);
  if (got !== want) throw new Error(`SHA-256 inattendu (${got.slice(0, 12)}… ≠ ${want.slice(0, 12)}…)`);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, buf);
  chmodSync(dest, 0o755);
  console.log(`[fetch-gateway] OK → vendor/foundry-mcp (${(buf.length / 1e6).toFixed(1)} Mo, ${key})`);
}

main().catch((e) => {
  console.warn(`[fetch-gateway] échec (non bloquant) : ${e.message}`);
  process.exitCode = 0;
});
