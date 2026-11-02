# Where To Spot shop

The online shop at [shop.wheretospot.com](https://shop.wheretospot.com) (NFC Google-review cards, QR stands and more, delivered across Egypt) and the team dashboard behind it (`/admin`): orders, chats, leads, payments and reports.

Plain PHP and SQLite on shared cPanel hosting. There's no build step and no framework: the files in this repo are the site.

## What's inside

| Part | Where | What it does |
|---|---|---|
| Shop | `index.html`, `ar/`, `p/`, `c/`, `shop-data.js`, `site.css` | Arabic and English storefront, product pages, cart and checkout |
| API | `api/` | Everything server-side: orders, payments, shipping, chats, the bot, reports |
| Dashboard | `admin/` | The team's single-page app (`admin.js`), Arabic/English (`i18n.js`), installable on phones (`sw.js`) |
| Data | outside the web root (`wts-shop-data/`) | The SQLite database, chat files and backups. Never in git |

### Main features

- **Orders**: checkout with cash on delivery, cards and wallets (Paymob), Bosta shipping and waybills, payments and balances, a production board.
- **Chats**: WhatsApp, Instagram and Messenger in one inbox (`api/whatsapp.php`, `api/social.php`). Chats are handed out to the team, with reply timers, quotes and reactions, voice notes, product cards and suggested replies.
- **Chat bot**: menu answers, product lookup and ordering inside the chat (`api/bot.php`), with optional AI answers through Claude (`api/ai.php`; phone numbers and emails are removed first).
- **Automations**: order updates on WhatsApp, follow-ups, abandoned checkouts, review requests, Telegram alerts for the team.
- **Business**: leads, quotes, customers, partner brands, promo codes, expenses and suppliers, salaries and commissions, monthly reports.
- **SEO and ads**: sitemap, `llms.txt`, product feed for Meta and Google, the Meta Pixel and Conversions API, and GA4.

## Running it locally

```bash
mkdir -p ../wts-shop-data
php -S localhost:8000
```

Open `http://localhost:8000` for the shop and `http://localhost:8000/admin/` for the dashboard. The database is created and updated automatically on the first request (`SCHEMA_VERSION` in `api/bootstrap.php`). To use another data folder, set `WTS_DATA_DIR=/path/to/folder`. Short product links (`/p/…`, `/r/…`) and the Arabic `?lang=ar` pages come from the `.htaccess` rewrite rules, which the PHP built-in server doesn't read: test those on the server.

When you change the database, raise `SCHEMA_VERSION`, or the server won't apply your `*_migrate()` changes.

## Settings and secrets

All keys (WhatsApp, Meta, Paymob, Bosta, Telegram, Anthropic, email) live in **`api/config.local.php` on the server only**. It's never committed and can't be opened from the web. Copy `api/config.local.example.php`, which explains every setting and where to find it. Dashboard → **Settings** checks each connection without showing any secret.

## Deploying

Push to `main` on GitHub. Then in cPanel → **Git Version Control** → this repo → **Update from Remote** → **Deploy HEAD Commit**. `.cpanel.yml` copies the site into place and never touches `data/` or `uploads/` on the server.

A cron job runs `api/telegram-cron.php` every minute: it sends the team's "no reply yet" reminders on Telegram. The exact command is in Dashboard → Settings → WhatsApp.

## Privacy

What customers' data is used for, and how they ask for it to be deleted: [privacy policy](https://shop.wheretospot.com/privacy-policy.html#delete). Owners can delete a chat and its data from the chat's side panel.
