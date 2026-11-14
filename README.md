# IntrinsiQAI

Value a stock under bear, base and bull cases, keep every valuation next to the live price, and get an email when the price reaches the number you set.

```
site/                          the pre-launch website (Cloudflare Pages output directory)
  index.html                   landing page, built from src/landing.src.html
  privacy.html                 privacy policy
  admin.html                   private dashboard for the sign-up list
  _headers                     security headers
  fonts/                       self-hosted Geologica and IBM Plex Mono, with their licence
functions/api/waitlist.js      saves a sign-up (POST /api/waitlist)
functions/api/export.js        feeds the admin page (GET /api/export, needs the admin token)
db/schema.sql                  run once to create the sign-up table
src/landing.src.html           landing page source; edit this, then run tools/build_landing.py
src/tester.src.html            the product prototype (KPI charts, three-case valuation, watchlist)
tester.html, landing.html      preview copies of the two pages
tools/                         data builders (see "Data" below) and build_landing.py
data/adbe.json, aapl.json      sample company data files
```

## Put the landing page live (Cloudflare, free plan)

1. **Database.** Cloudflare dashboard → Storage & Databases → D1 → Create database. Name it `intrinsiqai-waitlist`. Under data location choose **Specify jurisdiction → European Union** (this can only be set at creation). Open it → Console → paste all of `db/schema.sql` → Execute.
2. **Site.** Workers & Pages → Create → Pages → Connect to Git → choose this repository. Framework preset **None**, build command **empty**, build output directory **site**. Save and Deploy.
3. **Connect the database.** Pages project → Settings → Bindings → Add → D1 database. Variable name `DB`, database `intrinsiqai-waitlist`.
4. **Admin token.** Settings → Variables and Secrets → Add. Type **Secret**, name `ADMIN_TOKEN`, value a long random password. Keep it in a password manager.
5. **Redeploy** (Deployments → latest → Retry deployment) so the binding and secret take effect.
6. **Test.** Sign up with your own email on the live site, then open `/admin`, paste the token, and check you see one sign-up.
7. **Domain.** Pages project → Custom domains.

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
