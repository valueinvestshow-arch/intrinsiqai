// Sign in with Google (OAuth 2.0, authorization-code flow). Needs two secrets: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.
//   GET /api/auth/google            -> sends the browser to Google
//   GET /api/auth/google/callback   -> Google sends it back here; we sign the person in and go to /app
// Only the email address is requested. An account is keyed by email, so Google and the email link reach the same account.
import { randomToken, createSession, sessionCookie } from "../lib.js";

const STATE_COOKIE = "__Host-bb_oauth";
const stateCookie = (value, clear = false) => `${STATE_COOKIE}=${clear ? "" : value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${clear ? 0 : 600}`;
const redirectUri = (request) => new URL("/api/auth/google/callback", request.url).toString();
const back = (request, why) => new URL("/app?signin=" + why, request.url).toString();

function cookie(request, name) {
  for (const part of (request.headers.get("Cookie") || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

export const googleEnabled = (env) => !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);

export function start({ request, env }) {
  if (!googleEnabled(env)) return Response.redirect(back(request, "google-off"), 302);
  // "state" ties Google's reply to this browser, so nobody can be signed in to an account by a forged link.
  const state = randomToken(24);
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, redirect_uri: redirectUri(request), response_type: "code", scope: "openid email", state, prompt: "select_account" }).toString();
  return new Response(null, { status: 302, headers: { Location: url.toString(), "Set-Cookie": stateCookie(state), "Cache-Control": "no-store" } });
}

// The ID token comes straight from Google over HTTPS in exchange for our secret, so its contents can be trusted
// without checking the signature; we still check who it was issued for and that it is current.
function readIdToken(idToken, clientId) {
  try {
    const part = idToken.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const claims = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(part), (c) => c.charCodeAt(0))));
    const issuerOk = claims.iss === "https://accounts.google.com" || claims.iss === "accounts.google.com";
    if (!issuerOk || claims.aud !== clientId || !(claims.exp * 1000 > Date.now())) return null;
    if (!claims.email || claims.email_verified !== true) return null;
    return String(claims.email).trim().toLowerCase();
  } catch { return null; }
}

export async function callback({ request, env }) {
  const url = new URL(request.url), fail = (why) => new Response(null, { status: 302, headers: { Location: back(request, why), "Set-Cookie": stateCookie("", true), "Cache-Control": "no-store" } });
  if (!googleEnabled(env) || !env.DB) return fail("google-off");
  const state = url.searchParams.get("state"), code = url.searchParams.get("code"), expected = cookie(request, STATE_COOKIE);
  if (!code || !state || !expected || state !== expected) return fail("google-failed");

  let tokens;
  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, redirect_uri: redirectUri(request), grant_type: "authorization_code" }).toString(),
    });
    if (!res.ok) return fail("google-failed");
    tokens = await res.json();
  } catch { return fail("google-failed"); }

  const email = tokens && tokens.id_token ? readIdToken(tokens.id_token, env.GOOGLE_CLIENT_ID) : null;
  if (!email || email.length > 254) return fail("google-failed");

  // Local development only (.dev.vars): new accounts start subscribed.
  const plan = env.DEV_ECHO_LOGIN_LINK === "1" && env.DEV_AUTO_SUBSCRIBE === "1" ? "premium" : "free";
  await env.DB.prepare("INSERT OR IGNORE INTO users (id, email, plan) VALUES (?1, ?2, ?3)").bind(randomToken(12), email, plan).run();
  const user = await env.DB.prepare("SELECT id FROM users WHERE email = ?1").bind(email).first();
  const session = await createSession(env, user.id);
  const headers = new Headers({ Location: new URL("/app", request.url).toString(), "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
  headers.append("Set-Cookie", sessionCookie(session)); headers.append("Set-Cookie", stateCookie("", true));
  return new Response(null, { status: 302, headers });
}
