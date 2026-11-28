# Porting the shop to Cloudflare

Working notes for moving shop.wheretospot.com from PHP on cPanel to a Cloudflare Worker (TypeScript) + D1 + R2.
The full plan and decisions are outside this public repo (owner's `SHOP-MIGRATION-PLAN.md`); this file holds the parts the code needs.

## Rules for the port

- **Same addresses.** Every URL below keeps working unchanged, so Paymob, Bosta, Meta, WhatsApp and Telegram need no new settings.
- **Same answers.** The Worker must return what the PHP returns for every recorded request (golden snapshots, below).
- **Free plan only.** 10 ms CPU per request. Anything heavier is pre-computed, cached or paged, never moved to a paid plan.
- **Left out:** the UAE market layer (`market*.php`, `areas-ae.php`, `markets/`).
- **Feature freeze** on the PHP side during the port: urgent fixes only.

## Golden snapshots

`tools/golden/record.sh <data-dir> [out-dir]` runs this PHP shop locally on a **copy** of the data (a throwaway owner account,
`site_url` = localhost so it never contacts outside services, emails discarded) and records the answer to every read:
all pages and short links, public API reads and admin API reads. Recording twice gives identical results.
Snapshots contain customer data, so they are written **outside the repo** (`../_shop-golden/`) and `tests/golden/` is git-ignored.
Some answers depend on today's date ("last 30 days"), so compare against a recording made the same day.

## Addresses the Worker must answer

| Path | Today (PHP) |
|---|---|
| `/` | index.html (+ `?lang=ar` → api/page.php) |
| `/*.html` | static pages (+ `?lang=ar` → api/page.php) |
| `/p/{id}` | api/product-page.php |
| `/c/{key}` | api/category-page.php?c= |
| `/b/{slug}` | api/category-page.php?b= |
| `/r/{slug}` | api/qr-page.php |
| `/rate/{token}` | api/review-page.php |
| `/img/{w}/{path}` | api/img.php (resized thumbnails, cached in uploads/thumbs) |
| `/sitemap.xml, /llms.txt` | rewritten files (seo-lib.php) |
| `/admin/` | dashboard app (static) |
| `/uploads/*` | uploaded files (long cache) |

## API files

| File | Lines | Actions |
|---|---|---|
| `api/abandoned.php` | 151 |  |
| `api/admin.php` | 2410 | 140 |
| `api/ai-claude.php` | 37 |  |
| `api/ai.php` | 241 |  |
| `api/alerts.php` | 93 |  |
| `api/areas-ae.php` (left out) | 67 |  |
| `api/automations.php` | 335 |  |
| `api/bootstrap.php` | 1157 |  |
| `api/bosta-webhook.php` | 30 |  |
| `api/bosta.php` | 510 |  |
| `api/bot.php` | 1137 | 1 |
| `api/brand-bot.php` | 93 |  |
| `api/brands.php` | 220 |  |
| `api/category-page.php` | 127 |  |
| `api/config.local.example.php` (left out) | 112 |  |
| `api/customers.php` | 177 |  |
| `api/devices.php` | 341 |  |
| `api/expenses.php` | 159 |  |
| `api/images.php` | 51 |  |
| `api/img.php` | 86 |  |
| `api/insights.php` | 343 |  |
| `api/mailer.php` | 182 |  |
| `api/market-pages.php` (left out) | 92 |  |
| `api/market-text-ae.php` (left out) | 154 |  |
| `api/market.php` (left out) | 154 |  |
| `api/meta.php` | 143 |  |
| `api/offsite.php` | 120 |  |
| `api/order-updates.php` | 235 |  |
| `api/orders.php` | 509 |  |
| `api/page.php` | 74 |  |
| `api/pay.php` | 77 |  |
| `api/paymob-return.php` | 36 |  |
| `api/paymob-webhook.php` | 38 |  |
| `api/paymob.php` | 209 |  |
| `api/places.php` | 251 |  |
| `api/pricing.php` | 180 |  |
| `api/product-page.php` | 119 |  |
| `api/public.php` | 280 | 22 |
| `api/qr-page.php` | 93 |  |
| `api/qr.php` | 58 | 8 |
| `api/qrtool.php` | 242 |  |
| `api/reports.php` | 203 |  |
| `api/review-page.php` | 117 |  |
| `api/review-requests.php` | 174 |  |
| `api/reviews.php` | 91 |  |
| `api/sellers.php` | 154 |  |
| `api/seo-lib.php` | 427 |  |
| `api/seo.php` | 13 |  |
| `api/share-page.php` | 80 |  |
| `api/social.php` | 804 |  |
| `api/telegram-cron.php` | 15 |  |
| `api/telegram-webhook.php` | 19 |  |
| `api/telegram.php` | 407 |  |
| `api/track.php` | 69 |  |
| `api/wa-file.php` | 19 |  |
| `api/whatsapp-webhook.php` | 54 |  |
| `api/whatsapp.php` | 898 |  |

## Running the Cloudflare version

- **Test address:** https://shop.wheretospot.workers.dev (`STAGING=1`: every answer carries `X-Robots-Tag: noindex`). `/__health` shows the database counts.
- **Deploy:** `npx wrangler deploy` (static files come from this repo, filtered by `.assetsignore`; the Worker is `worker/index.ts`).
- **Database:** D1 `shop`. Load a copy of the live SQLite with `tools/d1/import.sh <shop.sqlite> --remote` (replaces everything in D1; `--local` for wrangler's local copy).
- **Compare with PHP:** `tools/golden/record.sh <data-dir>` (PHP, same day), then
  `node tools/golden/record.mjs https://shop.wheretospot.workers.dev <data-dir>/shop.sqlite ../_shop-golden/worker` and
  `node tools/golden/compare.mjs ../_shop-golden/php ../_shop-golden/worker --show 5`.
- **Not ported yet** answers `501` with the old path, so the comparison lists exactly what's left.

## Phase 2 notes (read-only pages)

- `worker/api/public.ts` (public reads), `pages.ts` (product, category/brand, `?lang=ar` pages, track.js, SEO files,
  homepage catalogue), `qr.ts` (`/r/<slug>` and `qr.php?action=me`); helpers in `worker/lib/` behave like the PHP
  functions they replace (`php.ts`: mb_*, round, number_format, htmlspecialchars, json_encode).
- `sitemap.xml`, `llms.txt` and the `<!--seo:home-->` block of `index.html` are built from D1 on each request; the
  copies in the repo are no longer read. `record.sh` refreshes them in PHP first so both sides start from the same data.
- Bosta areas are bundled (`worker/data/bosta-*.json`); a scheduled refresh comes with the Bosta phase.
- `track.js` reads `META_PIXEL_ID` / `GA4_ID` (set as vars on switch day); Paymob reads `PAYMOB_*` secrets.
- Snapshots hold day-relative data: record PHP and the Worker on the same day.

## Phase 3 notes (checkout)

- **Write tests:** `tools/golden/write-test.sh <data-dir>` places the same orders, leads, sign-ins, Paymob payments
  (webhook and return page), QR-tool actions and review-link reviews on the PHP shop and on the Worker (`wrangler dev`,
  local D1 outside the repo), each on a fresh copy of the same data. `tools/golden/mock.mjs` stands in for Paymob,
  Meta, Telegram and email, so nothing real is called. `compare-writes.mjs` compares answers, every saved row and
  every email / outside call. Result on 2026-11-28: **75 steps, 555 rows, 21 emails and calls, 0 differences.**
- Code: `worker/lib/shop.ts` (orders, pricing, stock, leads, promos, alerts), `customers.ts`, `drafts.ts`, `meta.ts`,
  `paymob.ts`, `orders.ts` (status changes), `mail.ts`; endpoints in `worker/api/public.ts`, `qr.ts`, `review.ts`, `paymob.ts`.
- **Stock without transactions:** D1 has no open transactions, so an order and its stock changes go in one atomic batch
  that first checks the products are unchanged since they were read; if another order got in between, it reads again.
- **Email** goes through Brevo's API (secret `BREVO_API_KEY`); without it, emails are logged and skipped.
- **Cron** every 15 minutes: abandoned checkouts become leads, unpaid online orders are released (PHP did this on visits).
- **Switch day:** copy the live `data/SETUP_KEY.txt` into the secret `SETUP_KEY` (payment links already sent keep working),
  and the Paymob / Meta keys into secrets. `tools/d1/import.sh` now keeps the id counters, so order numbers never repeat.
- Not yet (later phases): logo and "sell with us" uploads (R2), WhatsApp / Telegram messages on payment, review requests
  after delivery, IndexNow pings.

## Phase 4 notes (team dashboard)

- `worker/api/admin.ts` (session, dashboard, targets, expenses, team orders, products, reports) with
  `admin-orders.ts` (orders, payments, invoices, customers, leads, quotes), `admin-brands.ts` (partner brands,
  seller requests, promo codes, quote pages) and `admin-team.ts` (Bosta, order delete, search, settings checks,
  backups, team). Libraries: `lib/team.ts` (sessions, roles, devices, working hours), `lib/reports.ts`,
  `lib/products.ts`, `lib/bosta.ts`, `lib/time.ts` (Cairo days and months).
- **Sessions** live in D1 (`team_sessions`, created on first use), keyed by a hash of the `wts_admin` cookie. On switch
  day everyone signs in once more (PHP's session files don't move). **Passwords stay bcrypt** (`bcryptjs`): one check
  is ~100 ms of CPU, which the free plan allows for an occasional sign-in (tested: 6 checks in one request passed).
- **Bosta**: shipments, refresh, waybills, cancel, webhook (`/api/bosta-webhook.php`), and a sync from the cron at
  most every 2 hours. Switch day: secrets `BOSTA_API_KEY` and `BOSTA_WEBHOOK_SECRET` (= live `data/bosta-webhook-secret.txt`).
- **Review requests** after "Delivered" (email) and the 3-day reminder (cron and the orders list).
- **Kept exactly as PHP did, on purpose** (feature freeze): status changes from the dashboard are logged as "Website";
  a new supplier's returned id is the activity line's id; Team → Working hours without `?days` shows 0 days.
- **Different on purpose:** no backup files (D1 Time Travel keeps 30 days: `wrangler d1 time-travel`); copies outside
  Cloudflare come with R2. Photo and file uploads wait for R2. The WhatsApp inbox, Telegram, bot and insights are Phase 5.
- Tests: `tools/golden/read-test-local.sh <data-dir>` (reads, local Worker: 139 match; the rest are the backup field and
  Phase 5 reads) and `write-test.sh` (now 173 steps incl. the dashboard and a mocked Bosta: **0 differences**).
