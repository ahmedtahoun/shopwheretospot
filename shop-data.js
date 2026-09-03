// Shared catalog, cart and order storage for Shop Home / Shop Product / Shop Admin.
const INV_KEY = 'spotshop_inventory_v1';
const CART_KEY = 'spotshop_cart_v1';
const ORD_KEY = 'spotshop_orders_v1';
const LEAD_KEY = 'spotshop_leads_v1';
const WISH_KEY = 'spotshop_wishlist_v1';
const REVIEW_KEY = 'spotshop_reviews_v1';
const RECON_KEY = 'spotshop_reconciliation_v1';
const CUR_KEY = 'spotshop_currency_v1';
const SUPPLIER_KEY = 'spotshop_suppliers_v1';
const SUPPLIER_LEDGER_KEY = 'spotshop_supplier_ledger_v1';
const RECENT_KEY = 'spotshop_recent_v1';
const ADMIN_AUTH_KEY = 'spotshop_admin_auth_v1';

export const SEED_PRODUCTS = [
  { id: 'co4', sku: 'COS-TVB1', name: 'Tangerine Vita C Bright Brightening Serum', cat: 'cosmetics', vendor: 'The Face Shop', price: 1650, cost: 700, stock: 20, discountPct: 0, label: '', status: 'Active', sub: 'Clean beauty, tangerine vitamin C', desc: 'A brightening serum from The Face Shop\u2019s Clean Beauty line, formulated with tangerine vitamin C.', placeholder: 'The Face Shop Tangerine Vita C Bright serum bottle and box photo' },
  { id: 'co5', sku: 'COS-BJC1', name: 'Birch Juice Moisturizing Cleanser', cat: 'cosmetics', vendor: 'Round Lab', price: 1400, cost: 600, stock: 20, discountPct: 0, label: '', status: 'Active', sub: '150ml, hydrating ampoule cleanser', desc: 'A hydrating cleanser from Round Lab\u2019s Birch Juice line, made to replenish moisture and recharge tired skin.', placeholder: 'Round Lab Birch Juice Moisturizing Cleanser tube and box photo' },
  { id: 'co6', sku: 'COS-RWE1', name: 'Rice Water Bright Vegan Eye Cream', cat: 'cosmetics', vendor: 'The Face Shop', price: 1500, cost: 650, stock: 20, discountPct: 0, label: '', status: 'Active', sub: '20ml, vegan, fermented rice extract', desc: 'A vegan eye cream from The Face Shop\u2019s Rice Water Bright line. Rice extract fermented for 30 days, with hyaluronic acid and niacinamide, to brighten the under-eye area.', placeholder: 'The Face Shop Rice Water Bright Vegan Eye Cream tube and box photo' },
  { id: 'co7', sku: 'COS-RWP1', name: 'Rice Water Bright Enzyme Powder Wash', cat: 'cosmetics', vendor: 'The Face Shop', price: 1850, cost: 800, stock: 20, discountPct: 0, label: '', status: 'Active', sub: '55g, gentle enzyme cleanser', desc: 'An enzyme powder wash from The Face Shop\u2019s Rice Water Bright line, for a gentle deep clean.', placeholder: 'The Face Shop Rice Water Bright Enzyme Powder Wash bottle and box photo' },
  { id: 'nfc1', sku: 'NFC-GRB1', name: 'Google Review NFC Card — Black', cat: 'nfc', vendor: 'Grevo.io', price: 200, cost: 90, stock: 40, discountPct: 0, label: '3+1 Free', status: 'Active', sub: 'Tap-to-review NFC card, no app needed', desc: 'A tap-enabled NFC card that opens your Google review page instantly \u2014 customers just tap their phone, no app or typing needed. Buy 3, get 1 free. Also available in white.', placeholder: 'black NFC google review card photo' },
  { id: 'nfc2', sku: 'NFC-GRW1', name: 'Google Review NFC Card — White', cat: 'nfc', vendor: 'Grevo.io', price: 300, cost: 90, stock: 40, discountPct: 33.34, label: '3+1 Free', status: 'Active', sub: 'Tap-to-review NFC card, no app needed', desc: 'A tap-enabled NFC card that opens your Google review page instantly \u2014 customers just tap their phone, no app or typing needed. Buy 3, get 1 free. Also available in black.', placeholder: 'white NFC google review card photo' },
  { id: 'nfc3', sku: 'NFC-GRK1', name: 'Google Review NFC Keychain', cat: 'nfc', vendor: 'Grevo.io', price: 250, cost: 75, stock: 40, discountPct: 0, label: '', status: 'Active', sub: 'Tap-to-review NFC keychain, no app needed', desc: 'A tap-enabled NFC keychain that opens your Google review page instantly \u2014 customers just tap their phone, no app or typing needed.', placeholder: 'black NFC google review keychain photo' },
  { id: 'nfc4', sku: 'NFC-DSL1', name: 'Display Stand NFC + QR Code — 12×18cm', cat: 'nfc', vendor: 'Grevo.io', price: 340, cost: 130, stock: 30, discountPct: 0, label: '', status: 'Active', sub: 'Countertop stand, tap or scan for reviews', desc: 'A freestanding countertop display with NFC tap and QR scan, sending customers straight to your Google review page. Also available in 10×15cm.', placeholder: 'orange and black NFC QR display stand photo, 12x18cm' },
  { id: 'nfc5', sku: 'NFC-DSS1', name: 'Display Stand NFC + QR Code — 10×15cm', cat: 'nfc', vendor: 'Grevo.io', price: 299, cost: 115, stock: 30, discountPct: 0, label: '', status: 'Active', sub: 'Countertop stand, tap or scan for reviews', desc: 'A freestanding countertop display with NFC tap and QR scan, sending customers straight to your Google review page. Also available in 12×18cm.', placeholder: 'orange and black NFC QR display stand photo, 10x15cm' }
];

const DAY = 86400000;
export const EGYPT_CITIES = ['Cairo', 'Giza', 'Alexandria', 'Kafr El Sheikh', 'Fayoum', 'Gharbia', 'Assiut', 'Red Sea', 'Dakahlia', 'Sharqia', 'Sohag'];
export const SEED_ORDERS = [
  { id: '#1042', customer: 'Lara Haddad', cat: 'stands', total: 2100, date: 'Aug 27', ts: Date.now() - 5 * DAY, status: 'Fulfilled', city: 'Cairo' },
  { id: '#1043', customer: 'Omar Nassar', cat: 'cosmetics', total: 94, date: 'Aug 27', ts: Date.now() - 5 * DAY, status: 'Paid', city: 'Giza' },
  { id: '#1044', customer: 'Camp Sunbeam', cat: 'school', total: 570, date: 'Aug 28', ts: Date.now() - 4 * DAY, status: 'Pending', city: 'Alexandria' },
  { id: '#1045', customer: 'Nadine Aoun', cat: 'pets', total: 51, date: 'Aug 28', ts: Date.now() - 4 * DAY, status: 'Paid', city: 'Cairo' },
  { id: '#1046', customer: 'Rami Fares', cat: 'gift', total: 75, date: 'Aug 29', ts: Date.now() - 3 * DAY, status: 'Fulfilled', city: 'Sharqia' },
  { id: '#1047', customer: 'Expo Partners LLC', cat: 'stands', total: 4350, date: 'Aug 29', ts: Date.now() - 3 * DAY, status: 'Pending', city: 'Cairo' },
  { id: '#1048', customer: 'Yasmin Kassem', cat: 'cosmetics', total: 56, date: 'Aug 30', ts: Date.now() - 2 * DAY, status: 'Paid', city: 'Alexandria' },
  { id: '#1049', customer: 'Tariq Idris', cat: 'pets', total: 65, date: 'Aug 30', ts: Date.now() - 2 * DAY, status: 'Paid', city: 'Giza' }
];

export function photoId(id, n) { return 'prod-photo-' + id + '-' + n; }
export const PRODUCT_IMAGES = {
  nfc1: ['images/nfc-review-black-lifestyle.png', 'images/nfc-review-black-stack.png'],
  nfc3: ['images/keychain-google-review-lifestyle.png', 'images/keychain-google-review-white.png'],
  nfc4: ['images/nfc-display-stand.png'],
  nfc5: ['images/nfc-display-stand.png'],
  co4: ['images/faceshop-tangerine-vitac-serum.png'],
  co5: ['images/roundlab-birch-juice-cleanser.png'],
  co6: ['images/faceshop-rice-water-eye-cream.png'],
  co7: ['images/faceshop-rice-water-powder-wash.png']
};
export function salePrice(p) { return p.discountPct ? Math.round(p.price * (1 - p.discountPct / 100) * 100) / 100 : p.price; }

export const CURRENCY = 'EGP';
export const COUNTRY = 'Egypt';
export const CURRENCIES = [
  { code: 'EGP', symbol: 'EGP', rate: 1 },
  { code: 'USD', symbol: '$', rate: 1 / 49 },
  { code: 'SAR', symbol: 'SAR', rate: 1 / 13.1 },
  { code: 'AED', symbol: 'AED', rate: 1 / 13.3 }
];
export function loadCurrencyCode() {
  try { return localStorage.getItem(CUR_KEY) || 'EGP'; } catch { return 'EGP'; }
}
export function saveCurrencyCode(code) {
  try { localStorage.setItem(CUR_KEY, code); } catch {}
}
export function fmtPrice(n, code) {
  const cc = code || loadCurrencyCode();
  const cur = CURRENCIES.find(c => c.code === cc) || CURRENCIES[0];
  const val = (n || 0) * cur.rate;
  return cur.symbol + ' ' + (cur.code === 'EGP' ? Math.round(val).toLocaleString('en-EG') : val.toFixed(2));
}

const DELETED_KEY = 'spotshop_deleted_ids_v1';
function loadDeletedIds() {
  try { const raw = localStorage.getItem(DELETED_KEY); if (raw) return new Set(JSON.parse(raw)); } catch {}
  return new Set();
}
function saveDeletedIds(set) {
  try { localStorage.setItem(DELETED_KEY, JSON.stringify([...set])); } catch {}
}
export function loadInventory() {
  let stored = null;
  try { const raw = localStorage.getItem(INV_KEY); if (raw) stored = JSON.parse(raw); } catch {}
  const deleted = loadDeletedIds();
  if (!stored) return SEED_PRODUCTS.filter(p => !deleted.has(p.id)).map(p => ({ ...p }));
  const existingIds = new Set(stored.map(p => p.id));
  const missing = SEED_PRODUCTS.filter(p => !existingIds.has(p.id) && !deleted.has(p.id)).map(p => ({ ...p }));
  if (missing.length) {
    const merged = [...stored, ...missing];
    saveInventory(merged);
    return merged;
  }
  return stored;
}
export function saveInventory(list) {
  try { localStorage.setItem(INV_KEY, JSON.stringify(list)); } catch {}
}
export function markDeleted(id) {
  const deleted = loadDeletedIds();
  deleted.add(id);
  saveDeletedIds(deleted);
}
export function unmarkDeleted(id) {
  const deleted = loadDeletedIds();
  deleted.delete(id);
  saveDeletedIds(deleted);
}

export function loadCart() {
  try { const raw = localStorage.getItem(CART_KEY); if (raw) return JSON.parse(raw); } catch {}
  return [];
}
export function saveCart(list) {
  try { localStorage.setItem(CART_KEY, JSON.stringify(list)); } catch {}
}

export function loadOrders() {
  try { const raw = localStorage.getItem(ORD_KEY); if (raw) return JSON.parse(raw); } catch {}
  return SEED_ORDERS.map(o => ({ ...o }));
}
export function saveOrders(list) {
  try { localStorage.setItem(ORD_KEY, JSON.stringify(list)); } catch {}
}
export function addOrder(order) {
  const list = loadOrders();
  list.push(order);
  saveOrders(list);
}

export const SEED_LEADS = [
  { id: 'l1', name: 'Sana Barakat', contact: 'sana@brightco.com', cat: 'stands', status: 'New', source: 'Home — bulk inquiry', ts: Date.now() - 1 * DAY },
  { id: 'l2', name: 'Kevin Lopez', contact: '+1 555 0142', cat: 'cosmetics', status: 'New', source: 'Home — bulk inquiry', ts: Date.now() - 2 * DAY },
  { id: 'l3', name: 'Camp Horizon', contact: 'ops@camphorizon.org', cat: 'school', status: 'Contacted', source: 'Home — bulk inquiry', ts: Date.now() - 3 * DAY },
  { id: 'l4', name: 'Dina Younes', contact: 'dina.y@mail.com', cat: 'pets', status: 'New', source: 'Home — bulk inquiry', ts: Date.now() - 4 * DAY },
  { id: 'l5', name: 'Fahad Al-Otaibi', contact: '+966 55 019 22', cat: 'gift', status: 'Promo sent', source: 'Home — bulk inquiry', ts: Date.now() - 6 * DAY },
  { id: 'l6', name: 'Priya Menon', contact: 'priya.menon@mail.com', cat: 'cosmetics', status: 'New', source: 'Home — bulk inquiry', ts: Date.now() - 7 * DAY }
];
export function loadLeads() {
  try { const raw = localStorage.getItem(LEAD_KEY); if (raw) return JSON.parse(raw); } catch {}
  return SEED_LEADS.map(l => ({ ...l }));
}
export function saveLeads(list) {
  try { localStorage.setItem(LEAD_KEY, JSON.stringify(list)); } catch {}
}
export function addLead(lead) {
  const list = loadLeads();
  list.push({ source: 'Home — bulk inquiry', ts: Date.now(), ...lead });
  saveLeads(list);
}

// Wishlist (array of product ids)
export function loadWishlist() {
  try { const raw = localStorage.getItem(WISH_KEY); if (raw) return JSON.parse(raw); } catch {}
  return [];
}
export function saveWishlist(ids) {
  try { localStorage.setItem(WISH_KEY, JSON.stringify(ids)); } catch {}
}
export function toggleWishlist(id) {
  const list = loadWishlist();
  const next = list.includes(id) ? list.filter(x => x !== id) : [...list, id];
  saveWishlist(next);
  return next;
}

// Reviews
export const SEED_REVIEWS = [
];
export function loadReviews() {
  try { const raw = localStorage.getItem(REVIEW_KEY); if (raw) return JSON.parse(raw); } catch {}
  return SEED_REVIEWS.map(r => ({ ...r }));
}
export function saveReviews(list) {
  try { localStorage.setItem(REVIEW_KEY, JSON.stringify(list)); } catch {}
}
export function addReview(productId, review) {
  const list = loadReviews();
  list.push({ id: 'rv' + Date.now(), productId, date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), ...review });
  saveReviews(list);
  return list;
}
export function deleteReview(id) {
  const list = loadReviews().filter(r => r.id !== id);
  saveReviews(list);
  return list;
}
export function reviewsFor(productId, all) {
  return (all || loadReviews()).filter(r => r.productId === productId);
}
export function ratingStats(productId, all) {
  const rs = reviewsFor(productId, all);
  if (!rs.length) return { avg: 0, count: 0 };
  return { avg: Math.round((rs.reduce((a, r) => a + r.rating, 0) / rs.length) * 10) / 10, count: rs.length };
}

// Recently viewed (array of product ids, most recent first, capped)
export function loadRecent() {
  try { const raw = localStorage.getItem(RECENT_KEY); if (raw) return JSON.parse(raw); } catch {}
  return [];
}
export function pushRecent(id) {
  const list = loadRecent().filter(x => x !== id);
  list.unshift(id);
  const capped = list.slice(0, 8);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(capped)); } catch {}
  return capped;
}

// Promo codes
export const PROMO_CODES = { WELCOME10: 10, SPOT20: 20 };
export function validatePromo(code) {
  const pct = PROMO_CODES[(code || '').trim().toUpperCase()];
  return pct ? { code: code.trim().toUpperCase(), pct } : null;
}

// Customers derived from orders
export function deriveCustomers(orders) {
  const map = new Map();
  (orders || []).forEach(o => {
    const key = (o.email || o.customer || 'unknown').toLowerCase();
    const cur = map.get(key) || { name: o.customer, email: o.email || '', phone: o.phone || '', city: o.city || '', orderCount: 0, totalSpent: 0, lastDate: o.date };
    cur.orderCount += 1;
    cur.totalSpent += o.total || 0;
    cur.lastDate = o.date;
    if (!cur.email && o.email) cur.email = o.email;
    if (!cur.phone && o.phone) cur.phone = o.phone;
    if (o.city) cur.city = o.city;
    map.set(key, cur);
  });
  return Array.from(map.values()).sort((a, b) => b.totalSpent - a.totalSpent);
}

// Suppliers and their payment ledger (supports partial payments — balance = charges - payments)
export const SEED_SUPPLIERS = [
  { id: 'sup1', name: 'Where To Spot Fabrication', contact: '+20 100 111 2222' },
  { id: 'sup2', name: 'Lumen Beauty Co.', contact: '+20 101 222 3333' },
  { id: 'sup3', name: 'Wagwell Supply', contact: '+20 102 333 4444' },
  { id: 'sup4', name: 'Camp Supply Collective', contact: '+20 103 444 5555' },
  { id: 'sup5', name: 'Atelier Gifting', contact: '+20 104 555 6666' }
];
export function loadSuppliers() {
  try { const raw = localStorage.getItem(SUPPLIER_KEY); if (raw) return JSON.parse(raw); } catch {}
  return SEED_SUPPLIERS.map(s => ({ ...s }));
}
export function saveSuppliers(list) {
  try { localStorage.setItem(SUPPLIER_KEY, JSON.stringify(list)); } catch {}
}
export const SEED_SUPPLIER_LEDGER = [
  { id: 'sl1', supplierId: 'sup1', type: 'charge', amount: 5220, note: 'Restock: expo stands & banners', ts: Date.now() - 10 * DAY, date: 'Aug 21' },
  { id: 'sl2', supplierId: 'sup1', type: 'payment', amount: 3000, note: 'Bank transfer', ts: Date.now() - 6 * DAY, date: 'Aug 25' },
  { id: 'sl3', supplierId: 'sup2', type: 'charge', amount: 940, note: 'Restock: cosmetics', ts: Date.now() - 8 * DAY, date: 'Aug 23' },
  { id: 'sl4', supplierId: 'sup2', type: 'payment', amount: 940, note: 'Paid in full', ts: Date.now() - 7 * DAY, date: 'Aug 24' }
];
export function loadSupplierLedger() {
  try { const raw = localStorage.getItem(SUPPLIER_LEDGER_KEY); if (raw) return JSON.parse(raw); } catch {}
  return SEED_SUPPLIER_LEDGER.map(l => ({ ...l }));
}
export function saveSupplierLedger(list) {
  try { localStorage.setItem(SUPPLIER_LEDGER_KEY, JSON.stringify(list)); } catch {}
}

// Admin passcode gate (demo-level, not real auth)
export const ADMIN_PASSCODE = 'spot2026';
export function isAdminAuthed() {
  try { return sessionStorage.getItem(ADMIN_AUTH_KEY) === '1'; } catch { return false; }
}
export function setAdminAuthed(v) {
  try { v ? sessionStorage.setItem(ADMIN_AUTH_KEY, '1') : sessionStorage.removeItem(ADMIN_AUTH_KEY); } catch {}
}

// Sales team: reps, commission %, per-rep login code, monthly payouts (demo-level, not real auth)
const SALES_KEY = 'spotshop_sales_reps_v1';
const SALES_AUTH_KEY = 'spotshop_sales_auth_v1';
const PAYOUT_KEY = 'spotshop_sales_payouts_v1';

export const SEED_SALES_REPS = [
  { id: 'rep1', name: 'Youssef Adel', code: '1234', commissionPct: 5 },
  { id: 'rep2', name: 'Mona Zaki', code: '5678', commissionPct: 5 }
];
export function loadSalesReps() {
  try { const raw = localStorage.getItem(SALES_KEY); if (raw) return JSON.parse(raw); } catch {}
  return SEED_SALES_REPS.map(r => ({ ...r }));
}
export function saveSalesReps(list) {
  try { localStorage.setItem(SALES_KEY, JSON.stringify(list)); } catch {}
}
export function isSalesAuthed() {
  try { return sessionStorage.getItem(SALES_AUTH_KEY) || ''; } catch { return ''; }
}
export function setSalesAuthed(repId) {
  try { repId ? sessionStorage.setItem(SALES_AUTH_KEY, repId) : sessionStorage.removeItem(SALES_AUTH_KEY); } catch {}
}
export function loadPayouts() {
  try { const raw = localStorage.getItem(PAYOUT_KEY); if (raw) return JSON.parse(raw); } catch {}
  return {};
}
export function savePayouts(obj) {
  try { localStorage.setItem(PAYOUT_KEY, JSON.stringify(obj)); } catch {}
}
export function monthKey(ts) {
  const d = new Date(ts || Date.now());
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}
export function monthLabel(key) {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, (m || 1) - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}
export function shiftMonth(key, delta) {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, (m || 1) - 1 + delta, 1);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

// Financial reconciliation inputs (shipping/tax/insurance), keyed by month
export function loadReconciliation() {
  try { const raw = localStorage.getItem(RECON_KEY); if (raw) return JSON.parse(raw); } catch {}
  return {};
}
export function saveReconciliation(map) {
  try { localStorage.setItem(RECON_KEY, JSON.stringify(map)); } catch {}
}

// Full-data backup export (demo-level)
export function buildBackup() {
  return {
    exportedAt: new Date().toISOString(),
    inventory: loadInventory(), orders: loadOrders(), leads: loadLeads(),
    salesReps: loadSalesReps(), payouts: loadPayouts(), reviews: loadReviews(),
    reconciliation: loadReconciliation(), suppliers: loadSuppliers(), supplierLedger: loadSupplierLedger()
  };
}
