// Sign-in by email link. No passwords.
//   POST /api/auth/request  {email}   -> emails a one-time link (valid 15 minutes)
//   GET  /api/auth/verify?token=...   -> signs the browser in and redirects to /app
//   POST /api/auth/logout
//   GET  /api/me                      -> who is signed in, and whether they are subscribed
import { json, sameSite, readJson, randomToken, sha256, isoIn, createSession, currentUser, endSession, sessionCookie, isSubscribed } from "../lib.js";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const LINK_MINUTES = 15;
const MAX_LINKS_PER_HOUR = 5;

async function sendLoginEmail(env, email, link) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: env.EMAIL_FROM || "BuyBelow <login@buybelow.io>",
      to: [email],
      subject: "Your BuyBelow sign-in link",
      text: `Sign in to BuyBelow:\n\n${link}\n\nThis link works once and expires in ${LINK_MINUTES} minutes. If you didn't ask for it, ignore this email.`,
      html: `<p>Sign in to BuyBelow:</p><p><a href="${link}">Sign in</a></p><p style="color:#6B6862;font-size:13px">This link works once and expires in ${LINK_MINUTES} minutes. If you didn't ask for it, ignore this email.</p>`,
    }),
  });
  return res.ok;
}

export async function requestLink({ request, env }) {
  if (!sameSite(request)) return json({ error: "Sign in from the BuyBelow site." }, 403);
  const body = await readJson(request, 1024);
  const email = body && typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (email.length > 254 || !EMAIL.test(email)) return json({ error: "Enter a valid email address." }, 400);
  if (!env.DB) return json({ error: "Sign-in is not connected yet." }, 503);
  // DEV_ECHO_LOGIN_LINK is for local development only (.dev.vars). Never set it on the live site.
  const echo = env.DEV_ECHO_LOGIN_LINK === "1";
  if (!env.RESEND_API_KEY && !echo) return json({ error: "Sign-in is not open yet." }, 503);

  const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM login_tokens WHERE email = ?1 AND created_at > ?2").bind(email, isoIn(-3600e3)).first();
  if (recent && recent.n >= MAX_LINKS_PER_HOUR) return json({ error: "Too many sign-in links requested. Try again in an hour." }, 429);

  const token = randomToken();
  await env.DB.prepare("INSERT INTO login_tokens (token_hash, email, expires_at) VALUES (?1, ?2, ?3)").bind(await sha256(token), email, isoIn(LINK_MINUTES * 60e3)).run();
  const link = `${new URL(request.url).origin}/api/auth/verify?token=${token}`;
  if (echo) return json({ ok: true, dev_link: link });
  if (!(await sendLoginEmail(env, email, link))) return json({ error: "Could not send the email. Try again." }, 502);
  // Same answer whether or not the address already has an account.
  return json({ ok: true });
}

export async function verify({ request, env }) {
  const url = new URL(request.url), token = url.searchParams.get("token") || "";
  const fail = () => Response.redirect(`${url.origin}/app?signin=expired`, 302);
  if (!token || !env.DB) return fail();
  const hash = await sha256(token), now = new Date().toISOString();
  // Claim the token in one statement so it cannot be used twice.
  const claimed = await env.DB.prepare("UPDATE login_tokens SET used_at = ?1 WHERE token_hash = ?2 AND used_at IS NULL AND expires_at > ?1 RETURNING email").bind(now, hash).first();
  if (!claimed) return fail();
  await env.DB.prepare("INSERT OR IGNORE INTO users (id, email) VALUES (?1, ?2)").bind(randomToken(12), claimed.email).run();
  const user = await env.DB.prepare("SELECT id FROM users WHERE email = ?1").bind(claimed.email).first();
  const session = await createSession(env, user.id);
  return new Response(null, { status: 302, headers: { Location: `${url.origin}/app`, "Set-Cookie": sessionCookie(session), "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}

export async function logout({ request, env }) {
  if (!sameSite(request)) return json({ error: "Not allowed." }, 403);
  await endSession(request, env);
  return json({ ok: true }, 200, { "Set-Cookie": sessionCookie("", true) });
}

export async function me({ request, env }) {
  const user = await currentUser(request, env);
  if (!user) return json({ signedIn: false, subscribed: false });
  return json({ signedIn: true, email: user.email, subscribed: isSubscribed(user) });
}
