// GET /api/company/:ticker — one company's financial data, if the visitor's plan covers it.
// The data files under /data/s/ are never served directly; this is the only way to read them.
import { json, currentUser, canOpen } from "../lib.js";

const TICKER = /^[A-Z0-9][A-Z0-9.\-]{0,11}$/;
let shardByTicker = null;   // ticker -> shard number, loaded once per Worker instance

async function asset(env, request, path) {
  return env.ASSETS.fetch(new Request(new URL(path, request.url).toString()));
}

export async function get({ request, env }, ticker) {
  ticker = String(ticker || "").toUpperCase();
  if (!TICKER.test(ticker)) return json({ error: "Unknown ticker." }, 400);
  const user = await currentUser(request, env), plan = user ? user.plan : "free";
  if (!canOpen(plan, ticker)) return json({ error: "That company is part of Premium.", upgrade: true, signedIn: !!user }, 402);

  if (!shardByTicker) {
    const res = await asset(env, request, "/data/index.json");
    if (!res.ok) return json({ error: "Company data is not available." }, 503);
    shardByTicker = new Map((await res.json()).companies.map((c) => [c[0], c[2]]));
  }
  const shard = shardByTicker.get(ticker);
  if (shard === undefined || shard < 0) return json({ error: "No financial data for that ticker." }, 404);
  const res = await asset(env, request, `/data/s/${String(shard).padStart(3, "0")}.json`);
  if (!res.ok) return json({ error: "Company data is not available." }, 503);
  const company = (await res.json())[ticker];
  if (!company) return json({ error: "No financial data for that ticker." }, 404);
  return json(company, 200, { "Cache-Control": "private, max-age=3600" });
}
