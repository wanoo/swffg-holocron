// auth.mjs — authentification par comptes FOUNDRY (security ramp-up).
// Login : on rejoue le flux /join de Foundry (GET session → POST credentials).
// Session : cookie httpOnly signé HMAC (SESSION_SECRET), zéro dépendance.
// Les rôles Foundry pilotent les droits : GM = role >= 3 (Assistant).
import { createHmac, timingSafeEqual } from 'node:crypto';

const COOKIE = 'holocron_session';
const TTL_MS = 30 * 24 * 3600 * 1000;

let SECRET = '';
let FOUNDRY_BASE = '';
export function configureAuth({ sessionSecret, foundryBaseUrl }) {
  SECRET = sessionSecret || '';
  FOUNDRY_BASE = (foundryBaseUrl || '').replace(/\/$/, '');
}
export const authEnabled = () => Boolean(SECRET && FOUNDRY_BASE);

/* ------------------------------------------------------ session signée --- */
function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = createHmac('sha256', SECRET).update(body).digest('base64url');
  return `${body}.${mac}`;
}
function verify(token) {
  const [body, mac] = String(token || '').split('.');
  if (!body || !mac) return null;
  const expect = createHmac('sha256', SECRET).update(body).digest('base64url');
  const a = Buffer.from(mac), b = Buffer.from(expect);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch { return null; }
}

export function sessionFrom(req) {
  if (!authEnabled()) return null;
  const cookies = String(req.headers.cookie || '');
  const m = cookies.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  return m ? verify(decodeURIComponent(m[1])) : null;
}

export function setSessionCookie(res, payload) {
  const token = sign({ ...payload, exp: Date.now() + TTL_MS });
  res.setHeader('Set-Cookie',
    `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${TTL_MS / 1000}`);
}
export function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

/* ----------------------------------------------- validation via Foundry --- */
// POST /join {action:'join', userid, password} → 200 LoginSuccess / 401.
// Vérifié : ne perturbe pas une session active du même user. Le mot de passe
// n'est ni stocké ni loggé.
export async function validateFoundryLogin(userid, password) {
  const r1 = await fetch(`${FOUNDRY_BASE}/join`, { redirect: 'manual' });
  const cookie = (r1.headers.get('set-cookie') || '').split(';')[0];
  const r2 = await fetch(`${FOUNDRY_BASE}/join`, {
    method: 'POST', redirect: 'manual',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ action: 'join', userid, password }),
  });
  if (r2.status !== 200) return false;
  try { return (await r2.json())?.status === 'success'; }
  catch { return false; }
}

/* -------------------------------------------------------------- droits --- */
export const isGM = (session) => Boolean(session && session.role >= 3);

// Un document Foundry est-il visible pour cette session ? (ownership réel)
export function canSee(session, doc) {
  const own = doc?.ownership || {};
  if ((own.default ?? 0) >= 2) return true;
  if (!session) return false;
  if (isGM(session)) return true;
  return (own[session.userId] ?? 0) >= 2;
}
export function canEdit(session, doc) {
  if (!session) return false;
  if (isGM(session)) return true;
  return ((doc?.ownership || {})[session.userId] ?? 0) >= 3;
}
