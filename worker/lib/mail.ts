// Emails (port of api/mailer.php). The PHP shop used its cPanel mailbox; here mail goes out through Brevo's API
// (secret BREVO_API_KEY). In write tests MAIL_CAPTURE_URL receives each message instead and nothing is sent.
// Messages are sent after the answer has gone back (ctx.waitUntil), like PHP's send_mail_later.
import { esc, validEmail } from './php';
import { money, MARKET } from './catalog';
import type { Shop } from './shop';

export const MAIL_FROM = 'no-reply@wheretospot.com';
export const MAIL_FROM_NAME = 'Where To Spot Shop';
export const REPLY_TO = 'info@wheretospot.com';

export async function sendMail(s: Shop, to: string[], subject: string, html: string, text: string): Promise<boolean> {
  to = [...new Set(to.filter((e) => validEmail(e)))];
  if (!to.length) return false;
  const env = s.env;
  try {
    if (env.MAIL_CAPTURE_URL) {
      await fetch(env.MAIL_CAPTURE_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to, subject, html, text }) });
      return true;
    }
    if (!env.BREVO_API_KEY) { console.log('[mail] not sent (no BREVO_API_KEY):', subject); return false; }
    const r = await fetch('https://api.brevo.com/v3/smtp/email', { method: 'POST',
      headers: { 'api-key': env.BREVO_API_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ sender: { name: MAIL_FROM_NAME, email: MAIL_FROM }, replyTo: { email: REPLY_TO }, to: to.map((email) => ({ email })), subject, htmlContent: html, textContent: text }) });
    if (!r.ok) throw new Error('Brevo HTTP ' + r.status + ' ' + (await r.text()).slice(0, 200));
    return true;
  } catch (e) {
    const { opsError } = await import('./shop');
    await opsError(s, 'Email', 'An email to ' + to.join(', ') + ' could not be sent', e);
    return false;
  }
}
export const sendMailLater = (s: Shop, to: string[], subject: string, html: string, text: string): void => s.later(sendMail(s, to, subject, html, text));

// Team members who ticked "Email me new orders", plus any fixed addresses (ALERT_EMAILS, comma separated).
export async function alertRecipients(s: Shop): Promise<string[]> {
  const { results } = await s.db.prepare('SELECT email FROM users WHERE active = 1 AND notify = 1').all<{ email: string }>();
  return [...results.map((r) => r.email), ...String(s.env.ALERT_EMAILS ?? '').split(',').map((e) => e.trim()).filter(Boolean)];
}

export const h = esc;
export const waLink = (phone: string): string => {
  let d = phone.replace(/\D/g, '');
  if (d.startsWith('0')) d = MARKET.phone_cc + d.slice(1);
  return 'https://wa.me/' + d;
};

export function emailShell(s: Shop, title: string, inner: string, forWho: 'team' | 'customer' | 'brand' = 'team'): string {
  const host = s.site.replace(/^https?:\/\//, '');
  return '<!DOCTYPE html><html><body style="margin:0;background:#F7F3ED;font-family:Arial,Helvetica,sans-serif;color:#22201D">'
    + '<div style="max-width:560px;margin:0 auto;padding:24px 16px"><div style="background:#fff;border:1px solid #DDD6CC;border-radius:14px;padding:24px">'
    + '<div style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#A8552F;font-weight:bold">Where To Spot shop</div>'
    + '<h1 style="font-size:22px;margin:6px 0 16px">' + h(title) + '</h1>' + inner
    + '</div><p style="font-size:12px;color:#8A8478;text-align:center">' + (forWho === 'brand' ? 'Where To Spot · ' + host + ' · an order you deliver for us. Reply to this email with any question.' : '')
    + (forWho === 'customer' ? 'Where To Spot · ' + host + ' · ' + MARKET.phone_display : forWho === 'brand' ? '' : 'Sent automatically by your shop. Change who receives these in Dashboard → Team.') + '</p></div></body></html>';
}

export const btn = (href: string, label: string, bg = '#A8552F'): string =>
  '<a href="' + h(href) + '" style="display:inline-block;background:' + bg + ';color:#fff;text-decoration:none;padding:10px 16px;border-radius:999px;font-weight:bold;font-size:14px;margin:4px 6px 4px 0">' + h(label) + '</a>';

type Line = { qty: number; name: string; price: number; total?: number };
export async function notifyNewOrder(s: Shop, number: string, o: Record<string, any>, lines: Line[]): Promise<void> {
  const to = await alertRecipients(s);
  if (!to.length) return;
  let rows = '', textItems = '';
  for (const l of lines) {
    const t = money(l.total ?? l.qty * l.price);
    rows += '<tr><td style="padding:6px 0;border-bottom:1px solid #EFEAE3">' + Math.trunc(Number(l.qty)) + '× ' + h(l.name) + '</td><td style="padding:6px 0;border-bottom:1px solid #EFEAE3;text-align:right">' + t + '</td></tr>';
    textItems += '- ' + l.qty + 'x ' + l.name + ' — ' + t + '\n';
  }
  const sum = (label: string, v: string, bold = false) => '<tr><td style="padding:4px 0;color:#6B6660">' + (bold ? '<b style="color:#22201D">' + label + '</b>' : label) + '</td><td style="padding:4px 0;text-align:right">' + (bold ? '<b>' + v + '</b>' : v) + '</td></tr>';
  const admin = s.site + '/admin/#orders';
  const html = emailShell(s, 'New order ' + number + ' — ' + money(o.total),
    '<p style="margin:0 0 4px"><b>' + h(o.name) + '</b></p>'
    + '<p style="margin:0 0 4px"><a href="tel:' + h(o.phone) + '" style="color:#22201D">' + h(o.phone) + '</a> · ' + h(o.email) + '</p>'
    + '<p style="margin:0 0 16px;color:#6B6660">' + h(o.address || '—') + (o.city ? ', ' + h(o.city) : '') + '</p>'
    + '<table style="width:100%;border-collapse:collapse;font-size:14px">' + rows
    + sum('Subtotal', money(o.subtotal))
    + (o.discount ? sum('Promo ' + h(o.promo), '−' + money(o.discount)) : '')
    + sum('Delivery', o.shipping ? money(o.shipping) : 'Free')
    + sum('Total', money(o.total), true) + '</table>'
    + '<p style="color:#6B6660;font-size:13px">' + h(o.payment ?? 'Cash on delivery') + ' · Source: ' + h(o.source ?? 'Website')
    + (o.rep ? ' · Sales: ' + h(o.rep) : '') + '</p>'
    + '<p style="margin:18px 0 0">' + btn(waLink(o.phone), 'WhatsApp customer', '#1F7A4D') + btn(admin, 'Open in dashboard', '#22201D') + '</p>');
  const text = 'New order ' + number + ' — ' + money(o.total) + '\n\n'
    + o.name + '\n' + o.phone + ' · ' + o.email + '\n' + o.address + ', ' + o.city + '\n\n'
    + textItems + '\nDelivery: ' + (o.shipping ? money(o.shipping) : 'Free') + '\nTotal: ' + money(o.total) + ' (' + (o.payment ?? 'Cash on delivery') + ')\n'
    + 'Source: ' + (o.source ?? 'Website') + (o.rep ? ' · Sales: ' + o.rep : '') + '\n\n'
    + 'WhatsApp: ' + waLink(o.phone) + '\nDashboard: ' + admin + '\n';
  for (const r of new Set(to)) sendMailLater(s, [r], 'New order ' + number + ' · ' + money(o.total) + ' · ' + o.name, html, text);
}

export async function notifyNewLead(s: Shop, l: { name: string; contact: string; cat?: string; source?: string; notes?: string }): Promise<void> {
  const to = await alertRecipients(s);
  if (!to.length) return;
  const admin = s.site + '/admin/#leads';
  const contact = l.contact;
  const action = validEmail(contact) ? btn('mailto:' + contact, 'Email them') : btn(waLink(contact), 'WhatsApp them', '#1F7A4D');
  const html = emailShell(s, 'New enquiry from the website',
    '<p style="margin:0 0 4px"><b>' + h(l.name) + '</b></p><p style="margin:0 0 4px">' + h(contact) + '</p>'
    + '<p style="margin:0 0 4px;color:#6B6660">Interested in: ' + h(l.cat || '—') + '</p>'
    + '<p style="margin:0 0 4px;color:#6B6660">From: ' + h(l.source ?? 'Website') + '</p>'
    + (l.notes ? '<p style="margin:12px 0 16px;white-space:pre-line;background:#F7F3ED;border-radius:10px;padding:12px 14px">' + h(l.notes) + '</p>' : '<p style="margin:0 0 16px"></p>')
    + '<p>' + action + btn(admin, 'Open leads', '#22201D') + '</p>');
  const text = 'New enquiry\n\n' + l.name + '\n' + contact + '\nInterested in: ' + (l.cat ?? '') + '\nFrom: ' + (l.source ?? 'Website') + (l.notes ? '\n\n' + l.notes : '') + '\n\nDashboard: ' + admin + '\n';
  for (const r of new Set(to)) sendMailLater(s, [r], 'New enquiry · ' + l.name, html, text);
}
