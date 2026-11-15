// POST /api/waitlist — stores one early-access sign-up in the D1 database bound as DB.
// Privacy by design: no IP address, user agent or cookie is stored or logged.

const METHODS = new Set(["My own spreadsheet", "A paid research tool", "Analyst targets", "I don't yet"]);
const SOURCES = new Set(["hero", "final"]);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MAX_BODY = 2048;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });

// Only this site's own pages may submit: the browser sets Origin on every cross-site POST.
function sameSite(request) {
  const origin = request.headers.get("Origin");
  if (!origin) return false;
  try { return new URL(origin).host === new URL(request.url).host; } catch { return false; }
}

export async function onRequestPost({ request, env }) {
  if (!sameSite(request)) return json({ error: "Sign-ups are only accepted from this site." }, 403);
  if (!(request.headers.get("Content-Type") || "").includes("application/json")) return json({ error: "Send JSON." }, 415);

  const raw = await request.text();
  if (raw.length > MAX_BODY) return json({ error: "Request too large." }, 413);
  let body;
  try { body = JSON.parse(raw); } catch { return json({ error: "Invalid JSON." }, 400); }
  if (!body || typeof body !== "object") return json({ error: "Invalid JSON." }, 400);

  // Spam trap: real people never see or fill the hidden "company" field. Answer as if it worked.
  if (typeof body.company === "string" && body.company.trim() !== "") return json({ ok: true });

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (email.length > 254 || !EMAIL.test(email)) return json({ error: "Enter a valid email address." }, 400);
  if (body.consent !== true) return json({ error: "Consent is required." }, 400);
  const consentText = typeof body.consent_text === "string" ? body.consent_text.trim().slice(0, 300) : "";
  if (!consentText) return json({ error: "Consent wording is missing." }, 400);

  const method = METHODS.has(body.current_method) ? body.current_method : null;
  const source = SOURCES.has(body.source) ? body.source : null;

  if (!env.DB) return json({ error: "The sign-up list is not connected yet." }, 503);
  try {
    // OR IGNORE: a repeat sign-up changes nothing and gets the same answer, so the form never reveals who is already listed.
    await env.DB.prepare("INSERT OR IGNORE INTO waitlist (email, current_method, source, consent, consent_text) VALUES (?1, ?2, ?3, 1, ?4)")
      .bind(email, method, source, consentText).run();
  } catch {
    return json({ error: "Could not save your sign-up. Try again." }, 500);
  }
  return json({ ok: true });
}

// Anything other than POST.
export function onRequest() {
  return json({ error: "Method not allowed." }, 405);
}
