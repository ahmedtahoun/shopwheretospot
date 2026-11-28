// Order status changes used by checkout and payments (port of set_order_status, confirm_online_order and
// expire_unpaid_orders). The WhatsApp "shipped / delivered" messages and review requests that a status change can
// start come with the messaging and admin ports; checkout never moves an order to Shipped or Delivered.
import { round, phpInt, phpTrim } from './php';
import { money, type Row } from './catalog';
import { type Shop, ShopError, ORDER_STATUSES, stockAfter, orderPaid, paymentStmt, activityStmt, orderNumber, findLead, phoneKey, emailKey, touchLead, insertLead,
  leadFromOrder, notifyOrder, opsError, today, logActivity } from './shop';
import { UNPAID_EXPIRED_NOTE } from './customers';
import { metaPurchase } from './meta';

export async function setOrderStatus(s: Shop, id: number, status: string, notes: string | null = null, user: Row | null = null): Promise<Row> {
  const o = await s.db.prepare('SELECT * FROM orders WHERE id = ?').bind(id).first<Row>();
  if (!o) throw new ShopError('Order not found.');
  if (!ORDER_STATUSES.includes(status)) status = o.status;
  const wasOpen = !['Cancelled', 'Returned'].includes(o.status), isOpen = !['Cancelled', 'Returned'].includes(status);
  const stmts: D1PreparedStatement[] = [];
  if (wasOpen !== isOpen) {
    const sign = isOpen ? -1 : 1;
    let items: Row[] = []; try { items = JSON.parse(String(o.items)) || []; } catch { /* none */ }
    const after = new Map<string, Row>();
    for (const it of items) {
      if ((it.id ?? '') === 'custom') continue;
      const pid = String(it.id);
      const p = after.get(pid) ?? await s.db.prepare('SELECT id, cat, stock, variants FROM products WHERE id = ?').bind(pid).first<Row>();
      if (!p) continue;
      const na = stockAfter(p, it.variant !== undefined && it.variant !== null ? String(it.variant) : null, sign * phpInt(it.qty));
      if (!na) continue;
      after.set(pid, { ...p, stock: na.stock, variants: na.variants ?? p.variants, _v: na.variants !== null || p._v });
    }
    for (const [pid, p] of after) stmts.push(p._v
      ? s.db.prepare("UPDATE products SET variants = ?, stock = ?, updated_at = datetime('now') WHERE id = ?").bind(p.variants, p.stock, pid)
      : s.db.prepare("UPDATE products SET stock = MAX(0, ?), updated_at = datetime('now') WHERE id = ?").bind(p.stock, pid));
  }
  stmts.push(s.db.prepare("UPDATE orders SET status = ?, notes = ?, updated_at = datetime('now') WHERE id = ?").bind(status, notes === null ? o.notes : notes, id));
  if (status === 'Delivered' && o.status !== 'Delivered') stmts.push(s.db.prepare("UPDATE orders SET delivered_at = datetime('now') WHERE id = ?").bind(id));
  if (o.status === 'Delivered' && isOpen && status !== 'Delivered') stmts.push(s.db.prepare('UPDATE orders SET delivered_at = NULL WHERE id = ?').bind(id));
  if (status === 'Delivered' && o.status !== 'Delivered') {
    const due = round(Number(o.total) - await orderPaid(s, id), 2);
    if (due > 0) stmts.push(paymentStmt(s, id, due, 'cod', 'Collected on delivery', null));
  }
  if (!isOpen && wasOpen) stmts.push(s.db.prepare("DELETE FROM payments WHERE order_id = ? AND method = 'cod' AND note = 'Collected on delivery' AND created_by IS NULL").bind(id));
  await s.db.batch(stmts);
  if (status !== o.status) await logActivity(s, user, 'Order ' + status, orderNumber(id));
  return o;
}

// Paid online (→ Confirmed) or switched to cash on delivery (→ Pending): the order becomes a normal new order.
export async function confirmOnlineOrder(s: Shop, id: number, why: string, status = 'Pending'): Promise<void> {
  const o = await s.db.prepare('SELECT * FROM orders WHERE id = ?').bind(id).first<Row>();
  if (!o) return;
  if (o.status === 'Pending' && status === 'Confirmed') {
    await setOrderStatus(s, id, 'Confirmed');
    await logActivity(s, null, why, orderNumber(id) + ' · ' + o.customer + ' · ' + money(o.total));
    return;
  }
  const expired = o.status === 'Cancelled' && String(o.notes ?? '').includes(UNPAID_EXPIRED_NOTE);
  if (o.status !== 'Awaiting payment' && !expired) return;
  await setOrderStatus(s, id, status, expired ? phpTrim(String(o.notes ?? '').replace(UNPAID_EXPIRED_NOTE, '')) : null);
  await logActivity(s, null, why, orderNumber(id) + ' · ' + o.customer + ' · ' + money(o.total));
  await notifyOrder(s, id);
  try { await metaPurchase(s, id); } catch (e) { await opsError(s, 'Ad tracking', 'Purchase ' + orderNumber(id) + ' was not sent to Meta', e); }
  try {
    await leadFromOrder(s, { name: o.customer, phone: o.phone, email: o.email }, { id, number: orderNumber(id), total: Number(o.total) }, o.rep_id ? phpInt(o.rep_id) : null, 'Website');
  } catch (e) { await opsError(s, 'Leads', 'A paid order was saved but its lead wasn’t', e); }
}

// Online orders still unpaid after 3 hours: cancelled (stock goes back), the customer kept as a lead.
export async function expireUnpaidOrders(s: Shop): Promise<void> {
  const { results } = await s.db.prepare("SELECT * FROM orders WHERE status = 'Awaiting payment' AND created_at < datetime('now', '-3 hours') LIMIT 50").all<Row>();
  for (const o of results) {
    try {
      await setOrderStatus(s, phpInt(o.id), 'Cancelled', phpTrim(UNPAID_EXPIRED_NOTE + ' ' + String(o.notes ?? '')));
      let items: Row[] = []; try { items = JSON.parse(String(o.items)) || []; } catch { /* none */ }
      const what = items.map((i) => i.qty + '× ' + i.name).join(', ');
      const note = today() + ' · Started checkout (' + orderNumber(phpInt(o.id)) + ', ' + money(o.total) + ') but didn’t finish paying online · ' + what;
      const contact = phpTrim(o.phone + (o.email !== '' ? ' · ' + o.email : ''), ' ·');
      const lead = await findLead(s, phoneKey(String(o.phone)), emailKey(String(o.email)));
      if (lead) await touchLead(s, lead, note, lead.status === 'Won' ? null : 'New', o.rep_id ? phpInt(o.rep_id) : null, contact);
      else await insertLead(s, { name: o.customer, contact, cat: [...what].slice(0, 120).join(''), source: 'Unfinished online payment', status: 'New', notes: note, assigned_to: o.rep_id || null });
    } catch (e) { await opsError(s, 'Orders', 'An unpaid online order could not be released', e); }
  }
}
export { activityStmt };
