// Shared helpers for the BuyBelow API.

export const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers } });

// State-changing requests must come from this site's own pages: browsers set Origin on every cross-site POST.
export function sameSite(request) {
  const origin = request.headers.get("Origin");
  if (!origin) return false;
  try { return new URL(origin).host === new URL(request.url).host; } catch { return false; }
}

export async function readJson(request, maxBytes = 16384) {
  if (!(request.headers.get("Content-Type") || "").includes("application/json")) return null;
  const raw = await request.text();
  if (raw.length > maxBytes) return null;
  try { const v = JSON.parse(raw); return v && typeof v === "object" ? v : null; } catch { return null; }
}

export function randomToken(bytes = 32) {
  const a = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...a)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function sha256(text) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const isoIn = (ms) => new Date(Date.now() + ms).toISOString();

// ---- Plans ----
// BuyBelow is a paid product with no free tier. An account is either subscribed ("premium") or not ("free",
// which here means "no subscription yet": it can sign in, but opens no company and saves nothing).
export const isSubscribed = (user) => !!user && user.plan === "premium";

// ---- Sessions ----
export const SESSION_COOKIE = "__Host-bb_session";
const SESSION_DAYS = 30;

export function sessionCookie(token, clear = false) {
  return `${SESSION_COOKIE}=${clear ? "" : token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${clear ? 0 : SESSION_DAYS * 86400}`;
}

export async function createSession(env, userId) {
  const token = randomToken();
  await env.DB.prepare("INSERT INTO sessions (id_hash, user_id, expires_at) VALUES (?1, ?2, ?3)").bind(await sha256(token), userId, isoIn(SESSION_DAYS * 86400e3)).run();
  return token;
}

function cookieValue(request, name) {
  for (const part of (request.headers.get("Cookie") || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

// The signed-in user for this request, or null.
export async function currentUser(request, env) {
  const token = cookieValue(request, SESSION_COOKIE);
  if (!token || !env.DB) return null;
  const row = await env.DB.prepare(
    "SELECT u.id, u.email, u.plan FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id_hash = ?1 AND s.expires_at > ?2"
  ).bind(await sha256(token), new Date().toISOString()).first();
  return row || null;
}

export async function endSession(request, env) {
  const token = cookieValue(request, SESSION_COOKIE);
  if (token && env.DB) await env.DB.prepare("DELETE FROM sessions WHERE id_hash = ?1").bind(await sha256(token)).run();
}
