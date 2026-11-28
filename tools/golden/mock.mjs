// Stand-in for every outside service during write tests (Paymob, Meta, Telegram, Bosta, email), so nothing real is
// ever called. Each request is kept in memory; GET /__log returns them, POST /__reset clears them.
// Emails arrive at POST /__mail as {to, subject, html, text} (from the Worker, or from PHP via sendmail-stub.mjs).
// Usage: node mock.mjs [port]
import { createServer } from 'node:http';

const port = Number(process.argv[2] ?? 8098);
let log = [];
let n = 0;

createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  const url = new URL(req.url, 'http://mock');
  const reply = (code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };

  if (url.pathname === '/__log') return reply(200, log);
  if (url.pathname === '/__reset') { log = []; n = 0; return reply(200, { ok: true }); }
  if (url.pathname === '/__mail') { log.push({ kind: 'mail', ...JSON.parse(raw) }); return reply(200, { ok: true }); }

  let body = raw;
  try { body = JSON.parse(raw); } catch {
    if ((req.headers['content-type'] ?? '').includes('urlencoded')) body = Object.fromEntries(new URLSearchParams(raw));
  }
  log.push({ kind: 'http', method: req.method, path: url.pathname + url.search, auth: req.headers.authorization ?? '', body });

  // Paymob: a payment intention.
  if (url.pathname === '/v1/intention/') return reply(201, { client_secret: 'mock_cs_' + (++n), id: 'pi_mock_' + n });
  // Meta Conversions API.
  if (/\/events$/.test(url.pathname)) return reply(200, { events_received: Array.isArray(body?.data) ? body.data.length : 1 });
  // Telegram Bot API.
  if (url.pathname.startsWith('/bot')) return reply(200, { ok: true, result: { message_id: ++n } });
  return reply(200, { ok: true });
}).listen(port, '127.0.0.1', () => console.log('mock on', port));
