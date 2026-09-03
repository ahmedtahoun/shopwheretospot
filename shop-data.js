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
  { id: 'st1', sku: 'STD-3030', name: 'Modular Expo Stand 3×3', cat: 'stands', vendor: 'Where To Spot Fabrication', price: 1450, cost: 870, stock: 6, discountPct: 0, label: '', status: 'Active', sub: 'Reusable aluminum frame', desc: 'A reusable aluminum-frame stand for a 3×3m footprint, with tool-free assembly and interchangeable graphic panels.', placeholder: 'expo stand product photo' },
  { id: 'st2', sku: 'STD-BLW1', name: 'Backlit Display Wall', cat: 'stands', vendor: 'Where To Spot Fabrication', price: 2100, cost: 1260, stock: 3, discountPct: 0, label: 'New', status: 'Active', sub: 'LED-backlit fabric graphic', desc: 'An LED-backlit fabric graphic wall that ships in a single road case and assembles without tools.', placeholder: 'backlit display photo' },
  { id: 'st3', sku: 'STD-RBS2', name: 'Roll-Up Banner Stand', cat: 'stands', vendor: 'Where To Spot Fabrication', price: 120, cost: 54, stock: 42, discountPct: 0, label: '', status: 'Active', sub: 'Portable, retractable', desc: 'A retractable banner stand that packs into a carry bag under 3kg, suited for single-day events.', placeholder: 'banner stand photo' },
  { id: 'co1', sku: 'COS-FND1', name: 'Matte Silk Foundation', cat: 'cosmetics', vendor: 'Lumen Beauty Co.', price: 38, cost: 12, stock: 58, discountPct: 0, label: '', status: 'Active', sub: 'Buildable, 12-hr wear', desc: 'A buildable matte foundation formulated for 12-hour wear without touch-ups.', placeholder: 'foundation bottle photo' },
  { id: 'co2', sku: 'COS-MSK2', name: 'Rose Clay Face Mask', cat: 'cosmetics', vendor: 'Lumen Beauty Co.', price: 24, cost: 7, stock: 4, discountPct: 20, label: 'Sale', status: 'Active', sub: 'Deep pore cleanse', desc: 'A clay mask with rose extract and kaolin clay that draws out impurities without stripping moisture.', placeholder: 'face mask jar photo' },
  { id: 'co3', sku: 'COS-SER3', name: 'Vitamin C Serum', cat: 'cosmetics', vendor: 'Lumen Beauty Co.', price: 32, cost: 9, stock: 31, discountPct: 0, label: 'Bestseller', status: 'Active', sub: 'Brightening, daily use', desc: 'A daily brightening serum with stabilized vitamin C, suited for use under makeup or alone.', placeholder: 'serum bottle photo' },
  { id: 'pe1', sku: 'PET-BED1', name: 'Orthopedic Pet Bed', cat: 'pets', vendor: 'Wagwell Supply', price: 65, cost: 28, stock: 12, discountPct: 0, label: '', status: 'Active', sub: 'Memory-foam support', desc: 'A memory-foam bed that supports joints, with a removable, washable cover.', placeholder: 'pet bed photo' },
  { id: 'pe2', sku: 'PET-FED2', name: 'Stainless Feeding Set', cat: 'pets', vendor: 'Wagwell Supply', price: 22, cost: 9, stock: 0, discountPct: 0, label: '', status: 'Draft', sub: 'Non-slip, dishwasher-safe', desc: 'A stainless steel feeding set with a non-slip silicone base, dishwasher-safe.', placeholder: 'pet feeding bowls photo' },
  { id: 'pe3', sku: 'PET-HAR3', name: 'Adventure Harness', cat: 'pets', vendor: 'Wagwell Supply', price: 29, cost: 11, stock: 27, discountPct: 15, label: 'Sale', status: 'Active', sub: 'Reflective, adjustable', desc: 'An adjustable harness with reflective stitching for low-light walks, sized for most breeds.', placeholder: 'pet harness photo' },
  { id: 'sc1', sku: 'SCH-BPK1', name: 'Explorer Backpack Kit', cat: 'school', vendor: 'Camp Supply Collective', price: 45, cost: 19, stock: 19, discountPct: 0, label: '', status: 'Active', sub: 'Backpack + supplies bundle', desc: 'A backpack bundled with the basic supplies a camp packing list asks for.', placeholder: 'backpack kit photo' },
  { id: 'sc2', sku: 'SCH-STM2', name: 'STEM Activity Box', cat: 'school', vendor: 'Camp Supply Collective', price: 34, cost: 15, stock: 2, discountPct: 0, label: '', status: 'Active', sub: '6 hands-on experiments', desc: 'A box of six hands-on science experiments with instructions for group activity leaders.', placeholder: 'activity box photo' },
  { id: 'sc3', sku: 'SCH-BTL3', name: 'Bottle & Lunch Set', cat: 'school', vendor: 'Camp Supply Collective', price: 19, cost: 7, stock: 60, discountPct: 0, label: '', status: 'Active', sub: 'BPA-free, matching set', desc: 'A BPA-free bottle and lunch container set in a matching print, sized for day camps.', placeholder: 'bottle and lunch set photo' },
  { id: 'gi1', sku: 'GFT-BOX1', name: 'Signature Gift Box', cat: 'gift', vendor: 'Atelier Gifting', price: 75, cost: 31, stock: 15, discountPct: 0, label: '', status: 'Active', sub: 'Curated 5-piece set', desc: 'A curated five-piece gift set, packaged in signature branded packaging ready to give.', placeholder: 'gift box photo' },
  { id: 'gi2', sku: 'GFT-DSK2', name: 'Engraved Desk Set', cat: 'gift', vendor: 'Atelier Gifting', price: 58, cost: 22, stock: 9, discountPct: 0, label: '', status: 'Draft', sub: 'Pen, tray, nameplate', desc: 'A desk set with pen, tray and nameplate, available with custom engraving on request.', placeholder: 'desk set photo' },
  { id: 'gi3', sku: 'GFT-CND3', name: 'Candle & Ceramics Duo', cat: 'gift', vendor: 'Atelier Gifting', price: 42, cost: 17, stock: 22, discountPct: 10, label: 'Sale', status: 'Active', sub: 'Hand-poured, matte finish', desc: 'A hand-poured candle paired with a matte ceramic vessel, sold as a set.', placeholder: 'candle and ceramics photo' },
  { id: 'nfc1', sku: 'NFC-GRB1', name: 'Google Review NFC Card — Black', cat: 'nfc', vendor: 'Grevo.io', price: 300, cost: 90, stock: 40, discountPct: 33.34, label: '3+1 Free', status: 'Active', sub: 'Tap-to-review NFC card, no app needed', desc: 'A tap-enabled NFC card that opens your Google review page instantly \u2014 customers just tap their phone, no app or typing needed. Buy 3, get 1 free. Also available in white.', placeholder: 'black NFC google review card photo' },
  { id: 'nfc2', sku: 'NFC-GRW1', name: 'Google Review NFC Card — White', cat: 'nfc', vendor: 'Grevo.io', price: 300, cost: 90, stock: 40, discountPct: 33.34, label: '3+1 Free', status: 'Active', sub: 'Tap-to-review NFC card, no app needed', desc: 'A tap-enabled NFC card that opens your Google review page instantly \u2014 customers just tap their phone, no app or typing needed. Buy 3, get 1 free. Also available in black.', placeholder: 'white NFC google review card photo' }
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
  nfc1: ['images/nfc-review-black-lifestyle.png', 'images/nfc-review-black-stack.png']
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

export function loadInventory() {
  let stored = null;
  try { const raw = localStorage.getItem(INV_KEY); if (raw) stored = JSON.parse(raw); } catch {}
  if (!stored) return SEED_PRODUCTS.map(p => ({ ...p }));
  const existingIds = new Set(stored.map(p => p.id));
  const missing = SEED_PRODUCTS.filter(p => !existingIds.has(p.id)).map(p => ({ ...p }));
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
  { id: 'rv1', productId: 'co2', name: 'Hana M.', rating: 5, text: 'Cleared up my skin within a week, smells great too.', date: 'Aug 12' },
  { id: 'rv2', productId: 'co2', name: 'Youssef R.', rating: 4, text: 'Good mask, wish the jar was bigger.', date: 'Aug 20' },
  { id: 'rv3', productId: 'co3', name: 'Mira K.', rating: 5, text: 'Noticeable brightening after two weeks of daily use.', date: 'Aug 15' },
  { id: 'rv4', productId: 'gi3', name: 'Adam T.', rating: 5, text: 'Beautiful gift set, arrived well packaged.', date: 'Aug 22' },
  { id: 'rv5', productId: 'st1', name: 'Expo Partners LLC', rating: 4, text: 'Sturdy frame, assembly took about 20 minutes solo.', date: 'Aug 18' }
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
