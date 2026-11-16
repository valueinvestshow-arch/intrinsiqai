// BuyBelow site Worker: serves the static pages in site/ and the API routes.
import * as waitlist from "./api/waitlist.js";
import * as exporter from "./api/export.js";
import * as auth from "./api/auth.js";
import * as google from "./api/google.js";
import * as watch from "./api/watchlist.js";
import * as company from "./api/company.js";
import * as price from "./api/price.js";
import { runPriceJob } from "./prices.js";
import { json } from "./lib.js";

const notAllowed = () => json({ error: "Method not allowed." }, 405);

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url), method = request.method, ctx = { request, env };
    try {
      // Pre-launch waitlist
      if (pathname === "/api/waitlist") return method === "POST" ? waitlist.onRequestPost(ctx) : waitlist.onRequest();
      if (pathname === "/api/export") return method === "GET" ? exporter.onRequestGet(ctx) : exporter.onRequest();
      // Accounts
      if (pathname === "/api/auth/request") return method === "POST" ? auth.requestLink(ctx) : notAllowed();
      if (pathname === "/api/auth/verify") return method === "GET" ? auth.verify(ctx) : notAllowed();
      if (pathname === "/api/auth/google") return method === "GET" ? google.start(ctx) : notAllowed();
      if (pathname === "/api/auth/google/callback") return method === "GET" ? google.callback(ctx) : notAllowed();
      if (pathname === "/api/auth/logout") return method === "POST" ? auth.logout(ctx) : notAllowed();
      if (pathname === "/api/me") return method === "GET" ? auth.me(ctx) : notAllowed();
      // Watchlist
      if (pathname === "/api/watchlist") return method === "GET" ? watch.list(ctx) : notAllowed();
      if (pathname.startsWith("/api/watchlist/")) {
        const ticker = decodeURIComponent(pathname.slice("/api/watchlist/".length));
        if (method === "PUT") return watch.save(ctx, ticker);
        if (method === "DELETE") return watch.remove(ctx, ticker);
        return notAllowed();
      }
      // Company data, gated by plan
      if (pathname.startsWith("/api/company/")) return method === "GET" ? company.get(ctx, decodeURIComponent(pathname.slice("/api/company/".length))) : notAllowed();
      // Share prices
      if (pathname === "/api/prices") return method === "GET" ? price.many(ctx) : notAllowed();
      if (pathname.startsWith("/api/price/")) return method === "GET" ? price.one(ctx, decodeURIComponent(pathname.slice("/api/price/".length))) : notAllowed();
      if (pathname.startsWith("/data/s/")) return json({ error: "Not found." }, 404);   // only readable through /api/company
      if (pathname.startsWith("/api/")) return json({ error: "Not found." }, 404);
    } catch {
      return json({ error: "Something went wrong. Try again." }, 500);
    }
    return env.ASSETS.fetch(request);
  },
  // Every 15 minutes: refresh the stalest watchlist prices and send any buy-price emails that are due.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runPriceJob(env).catch(() => {}));
  },
};
