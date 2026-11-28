#!/usr/bin/env node
// PHP's mail() hands each message to "sendmail"; during write tests this reads it and gives it to the mock server
// (http://127.0.0.1:8098/__mail) as {to, subject, html, text}, the same shape the Worker uses. Nothing is sent.
const chunks = [];
for await (const c of process.stdin) chunks.push(c);
const msg = Buffer.concat(chunks).toString('utf8').replace(/\r\n/g, '\n');
const [head, ...rest] = msg.split('\n\n');
const body = rest.join('\n\n');
const header = (name) => (head.match(new RegExp('^' + name + ':\\s*(.*)$', 'im')) ?? [])[1] ?? '';
const word = (s) => s.replace(/=\?UTF-8\?B\?([^?]+)\?=/gi, (_, b) => Buffer.from(b, 'base64').toString('utf8'));
const part = (type) => {
  const m = body.match(new RegExp('Content-Type: ' + type + '[^\\n]*\\nContent-Transfer-Encoding: base64\\n\\n([A-Za-z0-9+/=\\n]+)', 'i'));
  return m ? Buffer.from(m[1].replace(/\n/g, ''), 'base64').toString('utf8') : '';
};
const to = header('To').split(',').map((s) => s.trim()).filter(Boolean);
await fetch('http://127.0.0.1:8098/__mail', { method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ to, subject: word(header('Subject')), html: part('text/html'), text: part('text/plain') }) });
