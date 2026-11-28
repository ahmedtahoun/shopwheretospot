// Abandoned checkouts (port of api/abandoned.php): the checkout form saves who and what once there's a phone number.
// Ordered → closed. Left 30 minutes → a lead for the team with a link that puts the same cart back.
// PHP checked for due drafts on each checkout_draft request; the Worker does the same, and the cron does it too.
import { round, numberFormat, phpTrim, phpInt, phpFloat, mbSubstr, validEmail, phpJsonU } from './php';
import { type Row } from './catalog';
import { type Shop, strIn, phoneKey, emailKey, findLead, touchLead, insertLead, logActivity, orderNumber, opsError, today } from './shop';
import { notifyNewLead } from './mail';

const ABANDON_AFTER_MIN = 30;
export const draftTokenOk = (t: string): boolean => /^[a-f0-9]{24,40}$/.test(t);

export async function draftSave(s: Shop, b: Row): Promise<void> {
  const token = String(b.token ?? '');
  const phone = strIn(b.phone, 40);
  const pk = phoneKey(phone);
  if (!draftTokenOk(token) || !pk) return;
  const items: Row[] = [];
  for (const i of (Array.isArray(b.items) ? b.items : []).slice(0, 50)) {
    const id = strIn(i?.id, 80);
    if (id === '' || !/^[A-Za-z0-9_-]+$/.test(id)) continue;
    items.push({ id, variant: i.variant !== undefined && i.variant !== null && i.variant !== '' ? strIn(String(i.variant), 80) : null,
      addons: (Array.isArray(i.addons) ? i.addons : []).slice(0, 10).map((a: unknown) => strIn(String(a), 80)),
      qty: Math.max(1, Math.min(999, phpInt(i.qty ?? 1))), name: strIn(i.name, 160), price: round(Math.max(0, phpFloat(i.price ?? 0)), 2) });
  }
  if (!items.length) return;
  let email = strIn(b.email, 160);
  email = validEmail(email) ? email : '';
  const lang = b.lang === 'ar' ? 'ar' : 'en';
  const total = round(Math.max(0, Math.min(10000000, phpFloat(b.total ?? 0))), 2);
  await s.db.prepare(`INSERT INTO checkout_drafts (token, name, phone, phone_key, email, items, total, lang) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(token) DO UPDATE SET name = excluded.name, phone = excluded.phone, phone_key = excluded.phone_key, email = excluded.email,
      items = excluded.items, total = excluded.total, lang = excluded.lang, updated_at = datetime('now') WHERE checkout_drafts.status = 'open'`)
    .bind(token, strIn(b.name, 120), phone, pk, email, phpJsonU(items), total, lang).run();
}

export async function draftOrdered(s: Shop, token: string, phone: string, orderId: number): Promise<void> {
  const pk = phoneKey(phone);
  const { results } = await s.db.prepare("SELECT * FROM checkout_drafts WHERE status IN ('open', 'abandoned') AND (token = ? OR (? IS NOT NULL AND phone_key = ? AND updated_at > datetime('now', '-7 days')))")
    .bind(token, pk, pk).all<Row>();
  for (const d of results) {
    const recovered = d.status === 'abandoned';
    await s.db.prepare("UPDATE checkout_drafts SET status = ?, order_id = ?, ordered_at = datetime('now') WHERE id = ?").bind(recovered ? 'recovered' : 'ordered', orderId, d.id).run();
    if (recovered) await logActivity(s, null, 'Abandoned checkout recovered', orderNumber(orderId) + ' · ' + d.name + ' · ' + d.phone);
  }
}

export const draftResumeUrl = (s: Shop, token: string): string => s.site + '/?restore=' + token;
const cartText = (items: Row[]): string => items.map((i) => i.qty + '× ' + i.name).join(', ');

export async function abandonedDue(s: Shop): Promise<void> {
  const { results } = await s.db.prepare("SELECT * FROM checkout_drafts WHERE status = 'open' AND updated_at < datetime('now', ?) ORDER BY id LIMIT 30").bind('-' + ABANDON_AFTER_MIN + ' minutes').all<Row>();
  for (const d of results) {
    try {
      const { results: os } = await s.db.prepare("SELECT id, phone FROM orders WHERE created_at > ? AND status != 'Cancelled' ORDER BY id DESC LIMIT 50").bind(d.created_at).all<Row>();
      const done = os.find((x) => phoneKey(String(x.phone)) === d.phone_key);
      if (done) { await s.db.prepare("UPDATE checkout_drafts SET status = 'ordered', order_id = ?, ordered_at = datetime('now') WHERE id = ?").bind(done.id, d.id).run(); continue; }
      let items: Row[] = []; try { items = JSON.parse(String(d.items)) || []; } catch { /* none */ }
      const cart = cartText(items);
      const note = today() + ' · 🛒 Left checkout without ordering · EGP ' + numberFormat(phpFloat(d.total)) + '\nCart: ' + cart
        + '\nLanguage: ' + (d.lang === 'ar' ? 'Arabic' : 'English') + '\nComplete the order: ' + draftResumeUrl(s, String(d.token));
      const contact = phpTrim(d.phone + (d.email !== '' ? ' · ' + d.email : ''), ' ·');
      const lead = await findLead(s, d.phone_key, emailKey(String(d.email ?? '')));
      let leadId: number;
      if (lead) {
        await touchLead(s, lead, note, ['Won', 'Lost'].includes(lead.status) ? 'New' : null, null, contact);
        leadId = phpInt(lead.id);
        await s.db.prepare('UPDATE leads SET follow_up = ? WHERE id = ?').bind(today(), leadId).run();
      } else {
        leadId = await insertLead(s, { name: d.name !== '' ? d.name : d.phone, contact, cat: mbSubstr(cart, 0, 120), source: 'Abandoned checkout', status: 'New', notes: note });
        await s.db.prepare('UPDATE leads SET follow_up = ? WHERE id = ?').bind(today(), leadId).run();
        await notifyNewLead(s, { name: d.name || d.phone, contact, cat: 'Abandoned checkout · EGP ' + numberFormat(phpFloat(d.total)), source: 'Abandoned checkout', notes: note });
      }
      await s.db.prepare("UPDATE checkout_drafts SET status = 'abandoned', abandoned_at = datetime('now'), lead_id = ? WHERE id = ?").bind(leadId, d.id).run();
      // The automatic "complete your order" message to the customer comes with the messaging port (api/automations.php au_cart).
    } catch (e) {
      await opsError(s, 'Leads', 'An abandoned checkout could not be turned into a lead', e);
    }
  }
}

export async function draftCart(s: Shop, token: string): Promise<Row[]> {
  if (!draftTokenOk(token)) return [];
  const r = await s.db.prepare('SELECT items FROM checkout_drafts WHERE token = ?').bind(token).first<Row>();
  let items: Row[] = []; try { items = JSON.parse(String(r?.items ?? '')) || []; } catch { /* none */ }
  return items.map((i) => ({ id: i.id, variant: i.variant, addons: i.addons, qty: i.qty }));
}
