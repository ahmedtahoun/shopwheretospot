// shop.wheretospot.com on Cloudflare: one Worker in front of everything.
// Static files (the storefront, /admin/, images) come from the repo as assets. Everything the PHP in api/ answered
// is answered here, at the same addresses, as each part gets ported (docs/CLOUDFLARE-PORT.md).
// Apache rules from the .htaccess files are reproduced in `routeRewrites` below.

import { handlePublic } from './api/public';
import { productPage, categoryPage, arPage, trackScript, seoFile, withHomeBlock } from './api/pages';
import { qrPage, handleQr } from './api/qr';
import { reviewPage } from './api/review';
import { paymobWebhook, paymobReturn, payLink } from './api/paymob';
import { makeShop } from './lib/shop';
import { abandonedDue } from './lib/drafts';
import { expireUnpaidOrders } from './lib/orders';
import type { Ctx } from './lib/seo';

export interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  SITE_URL: string;
  STAGING?: string;
  META_PIXEL_ID?: string;
  GA4_ID?: string;
  // Paymob (secrets: PAYMOB_SECRET_KEY, PAYMOB_PUBLIC_KEY, PAYMOB_HMAC_SECRET)
  PAYMOB_SECRET_KEY?: string;
  PAYMOB_PUBLIC_KEY?: string;
  PAYMOB_HMAC_SECRET?: string;
  PAYMOB_CARD_INTEGRATION_ID?: string;
  PAYMOB_WALLET_INTEGRATION_ID?: string;
  PAYMOB_BASE_URL?: string;
  // Meta Conversions API (secret: META_CAPI_TOKEN)
  META_CAPI_TOKEN?: string;
  META_TEST_CODE?: string;
  META_GRAPH_URL?: string;
  META_GRAPH_VERSION?: string;
  // Email: Brevo (secret BREVO_API_KEY); extra alert addresses; write tests send mail to MAIL_CAPTURE_URL instead.
  BREVO_API_KEY?: string;
  ALERT_EMAILS?: string;
  MAIL_CAPTURE_URL?: string;
  // The live shop's SETUP_KEY (payment links), and our Google review link for the review page.
  SETUP_KEY?: string;
  GOOGLE_REVIEW_URL?: string;
}

type Handler = (request: Request, env: Env, url: URL, ctx: ExecutionContext) => Promise<Response> | Response;

const seoCtx = (env: Env): Ctx => ({ db: env.DB, base: env.SITE_URL });

// Ported PHP entry points, by their old path. Filled in phase by phase.
const API: Record<string, Handler> = {
  '/api/public.php': (r, env, url, ctx) => handlePublic(r, env, url, seoCtx(env), ctx),
  '/api/product-page.php': (r, env, url) => productPage(r, env, url, seoCtx(env)),
  '/api/category-page.php': (r, env, url) => categoryPage(r, env, url, seoCtx(env)),
  '/api/page.php': (r, env, url) => arPage(r, env, url, seoCtx(env)),
  '/api/qr-page.php': (r, env, url, ctx) => qrPage(r, env, url, ctx),
  '/api/qr.php': (r, env, url, ctx) => handleQr(r, env, url, ctx),
  '/api/review-page.php': reviewPage,
  '/api/paymob-webhook.php': paymobWebhook,
  '/api/paymob-return.php': paymobReturn,
  '/api/pay.php': payLink,
  '/api/track.php': (_r, env) => trackScript(env),
  '/api/seo.php': (_r, env, url) => seoFile(url.searchParams.get('f') ?? 'sitemap', seoCtx(env)),
};

// Short links and rewrites from the .htaccess files (root, p/, c/, b/, r/, rate/, img/).
// Returns the API path (plus extra query parameters) that answers the request, or null.
function routeRewrites(url: URL): { script: string; params: Record<string, string> } | 'home' | null {
  const p = url.pathname;
  let m: RegExpMatchArray | null;
  if ((m = p.match(/^\/p\/([A-Za-z0-9_-]+)\/?$/))) return { script: '/api/product-page.php', params: { id: m[1] } };
  if ((m = p.match(/^\/c\/([a-z0-9_-]+)\/?$/))) return { script: '/api/category-page.php', params: { c: m[1] } };
  if ((m = p.match(/^\/b\/([a-z0-9_-]+)\/?$/))) return { script: '/api/category-page.php', params: { b: m[1] } };
  if ((m = p.match(/^\/r\/([a-z0-9-]+)\/?$/))) return { script: '/api/qr-page.php', params: { slug: m[1] } };
  if ((m = p.match(/^\/rate\/([a-f0-9]{24})\/?$/))) return { script: '/api/review-page.php', params: { t: m[1] } };
  if ((m = p.match(/^\/img\/(\d+)\/((?:images|uploads\/products)\/.+\.(?:png|jpe?g|webp))$/))) return { script: '/api/img.php', params: { w: m[1], src: m[2] } };
  if (/^\/(p|c|b|r|rate)\/?$/.test(p)) return 'home';
  if (url.searchParams.get('lang') === 'ar') {
    if ((m = p.match(/^\/(index\.html)?$/))) return { script: '/api/page.php', params: { f: 'index' } };
    if ((m = p.match(/^\/(about|contact|sell|plans|privacy-policy|refund-policy|shipping-policy|terms|google-review-link)\.html$/))) return { script: '/api/page.php', params: { f: m[1] } };
  }
  return null;
}

function notPorted(path: string): Response {
  return Response.json({ error: 'Not available on the test shop yet', path }, { status: 501, headers: { 'Cache-Control': 'no-store' } });
}

// Apache served a folder's index.html, refused markdown, and cached admin files as no-cache.
async function serveStatic(request: Request, env: Env, url: URL): Promise<Response> {
  if (/\.(md|markdown)$/i.test(url.pathname)) return new Response('Forbidden', { status: 403 });
  let res: Response;
  if (url.pathname.endsWith('/')) {
    res = await env.ASSETS.fetch(new Request(new URL(url.pathname + 'index.html' + url.search, url), request));
  } else {
    res = await env.ASSETS.fetch(request);
    if (res.status === 404 && !/\.[A-Za-z0-9]+$/.test(url.pathname)) {
      const dir = await env.ASSETS.fetch(new Request(new URL(url.pathname + '/index.html', url), request));
      if (dir.status === 200) return Response.redirect(new URL(url.pathname + '/' + url.search, url).toString(), 301);
    }
  }
  if (res.status === 404) return new Response(NOT_FOUND, { status: 404, headers: { 'Content-Type': 'text/html; charset=iso-8859-1' } });
  if (url.pathname.startsWith('/admin/') && /\.(js|css|html|json)$|\/$/.test(url.pathname)) {
    res = new Response(res.body, res);
    res.headers.set('Cache-Control', 'no-cache');
  }
  return res;
}

const NOT_FOUND = '<!DOCTYPE HTML PUBLIC "-//IETF//DTD HTML 2.0//EN">\n<html><head>\n<title>404 Not Found</title>\n</head><body>\n<h1>Not Found</h1>\n<p>The requested URL was not found on this server.</p>\n</body></html>\n';

async function handle(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === '/__health') {
    const r = await env.DB.prepare('SELECT (SELECT count(*) FROM orders) AS orders, (SELECT count(*) FROM products) AS products').first();
    return Response.json({ ok: true, staging: env.STAGING === '1', db: r });
  }

  const rw = routeRewrites(url);
  if (rw === 'home') return new Response(null, { status: 301, headers: { Location: '/' } });
  if (rw) {
    const target = new URL(rw.script, url);
    url.searchParams.forEach((v, k) => target.searchParams.set(k, v));
    for (const [k, v] of Object.entries(rw.params)) target.searchParams.set(k, v);
    const h = API[rw.script];
    return h ? h(request, env, target, ctx) : notPorted(rw.script);
  }

  if (url.pathname.startsWith('/api/')) {
    const h = API[url.pathname];
    return h ? h(request, env, url, ctx) : notPorted(url.pathname);
  }
  // Server-only folders were blocked by Apache ("Require all denied").
  if (/^\/(data|markets|api\/lib)(\/|$)/.test(url.pathname)) return new Response('Forbidden', { status: 403 });
  if (url.pathname.startsWith('/uploads/')) return notPorted('/uploads/*');

  // Files PHP regenerated from the database: now built on each request.
  if (url.pathname === '/sitemap.xml') return seoFile('sitemap', seoCtx(env));
  if (url.pathname === '/llms.txt') return seoFile('llms', seoCtx(env));
  if (url.pathname === '/' || url.pathname === '/index.html') {
    const res = await serveStatic(request, env, url);
    if (res.status !== 200) return res;
    const out = new Response(await withHomeBlock(await res.text(), seoCtx(env)), res);
    out.headers.delete('ETag');
    out.headers.delete('Content-Length');
    return out;
  }

  return serveStatic(request, env, url);
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const res = await handle(request, env, ctx);
    if (env.STAGING !== '1') return res;
    // The test shop must never be indexed or mistaken for the real one.
    const out = new Response(res.body, res);
    out.headers.set('X-Robots-Tag', 'noindex, nofollow');
    return out;
  },
  // Every 15 minutes: unfinished checkouts become leads, unpaid online orders are released (PHP did this on visits).
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const s = makeShop(new Request(env.SITE_URL + '/__cron'), env, ctx);
    await abandonedDue(s);
    await expireUnpaidOrders(s);
  },
} satisfies ExportedHandler<Env>;
