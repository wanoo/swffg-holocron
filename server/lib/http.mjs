// http.mjs — primitives HTTP zéro-dépendance : JSON, CORS, corps, rate-limit,
// statique, et réponses compressées avec ETag (pour /api/content/*).
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { gzipSync } from 'node:zlib';

export const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.otf': 'font/otf', '.ttf': 'font/ttf', '.woff': 'font/woff', '.woff2': 'font/woff2',
};

let CORS_ORIGIN = '*';
export function setCorsOrigin(origin) { CORS_ORIGIN = origin || '*'; }
export function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-gm-key, x-player-key');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
}

export function sendJSON(res, code, obj) {
  cors(res);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

// Réponse JSON versionnée : ETag = version de collection, 304 si If-None-Match,
// gzip si le client l'accepte. `version` doit changer à chaque mutation.
export function sendVersioned(req, res, obj, version) {
  cors(res);
  const etag = `"v${version}"`;
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, { ETag: etag });
    return res.end();
  }
  const body = Buffer.from(JSON.stringify(obj));
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-cache',
    ETag: etag,
  };
  if (/\bgzip\b/.test(req.headers['accept-encoding'] || '') && body.length > 1024) {
    headers['Content-Encoding'] = 'gzip';
    res.writeHead(200, headers);
    return res.end(gzipSync(body));
  }
  res.writeHead(200, headers);
  res.end(body);
}

export function readBody(req, limit = 2_000_000) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > limit) reject(new Error('corps trop volumineux'));
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

const rlHits = new Map();
export function rateLimited(req, max = 8, windowMs = 60_000) {
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '?').split(',')[0].trim();
  const now = Date.now();
  const hits = (rlHits.get(ip) || []).filter((t) => now - t < windowMs);
  if (hits.length >= max) { rlHits.set(ip, hits); return true; }
  hits.push(now);
  rlHits.set(ip, hits);
  if (rlHits.size > 500) rlHits.clear(); // borne mémoire
  return false;
}

export function makeStatic(publicDir) {
  return async function serveStatic(req, res, urlPath) {
    let rel = decodeURIComponent(urlPath.split('?')[0]);
    if (rel === '/' || rel === '') rel = '/index.html';
    const filePath = normalize(join(publicDir, rel));
    if (!filePath.startsWith(publicDir)) return sendJSON(res, 403, { error: 'interdit' });
    try {
      const s = await stat(filePath);
      if (s.isDirectory()) return serveStatic(req, res, rel.replace(/\/?$/, '/index.html'));
      const buf = await readFile(filePath);
      res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] || 'application/octet-stream' });
      res.end(buf);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Introuvable');
    }
  };
}
