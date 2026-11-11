# IntrinsiQAI

Value a stock under bear, base and bull cases, keep every valuation next to the live price, and get an email when the price reaches the number you set.

```
site/                          the pre-launch website, ready for Cloudflare Pages
  index.html                   landing page (built from src/landing.src.html)
  privacy.html                 privacy policy: fill in the highlighted [brackets] before launch
  admin.html, schema.sql       waitlist dashboard and database table
  fonts/                       self-hosted Geologica and IBM Plex Mono
src/landing.src.html           landing page source; edit this, then run tools/build_landing.py
src/tester.src.html            the product prototype (KPI charts, three-case valuation, watchlist)
tester.html, landing.html      preview copies of the two pages
tools/
  build_company_data.py        SEC EDGAR companyfacts JSON -> one company's data file
  fetch_all.py                 every NYSE / Nasdaq listing -> data/index.json + data/s/NNN.json
  fetch_prices.py              last-sale price snapshot -> data/prices.json
  fetch_fx.py                  exchange rates to US dollars -> data/fx.json
  build_landing.py             src/landing.src.html -> landing.html + site/index.html
data/adbe.json, aapl.json      sample company data files
```

## Not in this repository

- `functions/api/waitlist.js`, `functions/api/export.js` and `_headers` from the original waitlist site. Add them to `site/` before deploying; the landing page posts sign-ups to `/api/waitlist`.
- The full data build (about 70 MB). Rebuild it:

```bash
python3 tools/fetch_all.py "<app name> <contact email>" out/data
```

```bash
python3 tools/fetch_prices.py out/data
```

```bash
python3 tools/fetch_fx.py out/data
```

## Data sources

- Financial statements: SEC EDGAR XBRL company facts (free, no key, 10 requests a second).
- Prices: the public listing behind nasdaq.com. A snapshot, and not a licensed feed: replace before launch.
- Exchange rates: open.er-api.com.

Research tool, not investment advice.
