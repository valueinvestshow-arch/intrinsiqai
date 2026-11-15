// GET /api/export?format=json|csv — feeds the admin page. Needs "Authorization: Bearer <ADMIN_TOKEN>".

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });

// Compare in constant time so the response time says nothing about how much of the token matched.
async function tokenMatches(given, expected) {
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([crypto.subtle.digest("SHA-256", enc.encode(given)), crypto.subtle.digest("SHA-256", enc.encode(expected))]);
  const x = new Uint8Array(a), y = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

// Quote every cell, and defuse cells a spreadsheet would run as a formula.
function csvCell(v) {
  let s = v == null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}

export async function onRequestGet({ request, env }) {
  if (!env.ADMIN_TOKEN) return json({ error: "ADMIN_TOKEN is not set for this site." }, 503);
  const auth = request.headers.get("Authorization") || "";
  const given = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!given || !(await tokenMatches(given, env.ADMIN_TOKEN))) return json({ error: "Wrong admin token" }, 401);
  if (!env.DB) return json({ error: "The database is not connected (add the D1 binding named DB)." }, 503);

  const format = new URL(request.url).searchParams.get("format") || "json";
  try {
    if (format === "csv") {
      const { results } = await env.DB.prepare("SELECT email, current_method, source, consent_text, consent_at, created_at FROM waitlist ORDER BY created_at").all();
      const cols = ["email", "current_method", "source", "consent_text", "consent_at", "created_at"];
      const lines = [cols.join(",")].concat(results.map((r) => cols.map((c) => csvCell(r[c])).join(",")));
      return new Response(lines.join("\r\n") + "\r\n", { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="buybelow-waitlist.csv"', "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
    }
    const [totals, methods, sources, latest] = await env.DB.batch([
      env.DB.prepare("SELECT COUNT(*) AS total, SUM(created_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-7 days')) AS last7days, SUM(date(created_at) = date('now')) AS today FROM waitlist"),
      env.DB.prepare("SELECT COALESCE(current_method, 'Not answered') AS label, COUNT(*) AS n FROM waitlist GROUP BY 1 ORDER BY n DESC"),
      env.DB.prepare("SELECT CASE source WHEN 'hero' THEN 'Top of page' WHEN 'final' THEN 'Bottom of page' ELSE 'Unknown' END AS label, COUNT(*) AS n FROM waitlist GROUP BY 1 ORDER BY n DESC"),
      env.DB.prepare("SELECT email, current_method, created_at FROM waitlist ORDER BY created_at DESC LIMIT 25"),
    ]);
    const t = totals.results[0] || {};
    return json({ total: t.total || 0, last7days: t.last7days || 0, today: t.today || 0, methods: methods.results, sources: sources.results, latest: latest.results });
  } catch {
    return json({ error: "Could not read the list. Has schema.sql been run on the database?" }, 500);
  }
}

export function onRequest() {
  return json({ error: "Method not allowed." }, 405);
}
