# BuyBelow (working name; repository still called intrinsiqai)

Value a stock under bear, base and bull cases, keep every valuation next to the live price, and get an email when the price reaches the number you set.

```
site/                          the pre-launch website (static files)
  index.html                   landing page, built from src/landing.src.html
  privacy.html                 privacy policy
  admin.html                   private dashboard for the sign-up list
  _headers                     security headers
  fonts/                       self-hosted DM Sans and Caveat, with their licence
worker/index.js                routes /api/* and serves site/
worker/api/waitlist.js         saves a sign-up (POST /api/waitlist)
worker/api/export.js           feeds the admin page (GET /api/export, needs the admin token)
worker/api/auth.js             sign-in by emailed link: /api/auth/request, /api/auth/verify, /api/auth/logout, /api/me
worker/api/watchlist.js        saved valuations, with the free and premium limits enforced
worker/lib.js                  sessions, plans and shared helpers
db/schema.sql                  run once to create the sign-up table
db/schema_app.sql              run once to create accounts, sessions and watchlists
src/landing.src.html           landing page source; edit this, then run tools/build_landing.py
src/tester.src.html            the product prototype (KPI charts, three-case valuation, watchlist)
tester.html, landing.html      preview copies of the two pages
tools/                         data builders (see "Data" below) and build_landing.py
data/adbe.json, aapl.json      sample company data files
```

## How it is deployed (Cloudflare Workers, free plan)

The site is a Cloudflare Worker with static assets: `wrangler.toml` serves everything in `site/` and routes `/api/*` to `worker/index.js`. Cloudflare's Git integration builds on every push to `main` with the deploy command `npx wrangler deploy`.

- Database: D1 `buybelow-waitlist`, EU jurisdiction, bound as `DB` in `wrangler.toml`. The table comes from `db/schema.sql`.
- Admin password: a secret named `ADMIN_TOKEN`, set in the dashboard (Worker -> Settings -> Variables and Secrets). Never in the repository.
- Domain: buybelow.io, added under the Worker's Domains & Routes.

Sign-in emails need a `RESEND_API_KEY` secret; until it is set, `/api/auth/request` answers that sign-in is not open yet.

Plans: there is no free tier. An account without a subscription can sign in but opens no company and saves nothing; a subscribed account (`plan = premium`) has everything. The rule is `isSubscribed` in `worker/lib.js`.

## Run it on your own computer

Everything runs locally with a private database: no email service, no payments, nothing public. You need [Node.js](https://nodejs.org) (the LTS version) and Git.

```bash
git clone https://github.com/valueinvestshow-arch/intrinsiqai.git
```

```bash
cd intrinsiqai
```

```bash
npm install
```

```bash
npm run setup
```

```bash
npm run dev
```

Then open http://localhost:8787/app and sign in with any email: the page shows a "Click here to sign in" link instead of sending one, and local accounts start subscribed. The landing page is at http://localhost:8787 and the waitlist page at http://localhost:8787/admin (password `local-admin`).

For real share prices, paste your Twelve Data key after `TWELVEDATA_API_KEY=` in the `.dev.vars` file and restart `npm run dev`. That file never leaves your computer.

Stop the app with Ctrl+C. To pick up new changes later: `git pull`, then `npm run dev` again. To wipe the local database and start over, delete the `.wrangler` folder and run `npm run setup`.

What the sign-up function does: accepts sign-ups only from the site's own pages, requires the consent tick, stores the exact consent wording and time, never stores an IP address, gives the same answer for a repeat sign-up (so it never reveals who is listed), and silently drops submissions that fill the hidden spam-trap field.

Delete someone on request: D1 → Console → `DELETE FROM waitlist WHERE email = 'person@example.com';`

## Data, and what each source allows

| Source | Used for | Terms |
|---|---|---|
| SEC EDGAR company facts | every financial statement figure | US government public data. Free to use and republish. Send a User-Agent naming the app and a contact email, and stay under 10 requests a second. |
| open.er-api.com | converting foreign filers to US dollars | Free tier allows commercial use with a visible "Rates By Exchange Rate API" link (the prototype shows it). Raw rates may not be redistributed, so move to a paid plan before launch. |
| Share prices | price, market value, ADR ratio | **No source is included.** Prices need a licensed feed with the right to display them to your customers. The prototype reads an optional `data/prices.json` (`{"asOf": ..., "p": {"TICKER": [price, dayChangePct, marketValue, sector, industry]}}`); without it, prices are typed in. |

Rebuild the company data (about 70 MB, not kept in this repository):

```bash
python3 tools/fetch_all.py "<app name> <contact email>" out/data
```

```bash
python3 tools/fetch_fx.py out/data
```

The landing page uses example prices, labelled as such, and real figures from SEC filings.

Fonts are under the SIL Open Font License; the licence text ships in `site/fonts/LICENSE.txt`.

Research tool, not investment advice.
