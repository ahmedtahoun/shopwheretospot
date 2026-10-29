<?php
// Orders on WhatsApp without the team (Settings → Order updates; the chat bot's "My order").
//
// Updates: when an order ships, goes out for delivery, a delivery attempt fails or it's delivered, the
// customer gets a WhatsApp message. While their chat is open (they wrote in the last 24 hours) it's a
// free message; otherwise, only if switched on, the matching approved template (Meta charges for those).
// Each update goes once per order (a failed attempt once a day), and is kept in order_updates.
// After a failed attempt the customer's reply goes straight to the team.
//
// Status: ou_lookup() finds a customer's orders (by the chat's number, an order number like WTS-1234, or
// a phone number they type) and ou_status_text() says where each one is, with the tracking link and,
// for an unpaid online order, the payment link. Only the status: never the address, items or name.

const OU_EVENTS = ['shipped', 'out', 'attempt', 'delivered'];
const OU_TEMPLATES = ['shipped' => 'wts_order_shipped', 'out' => 'wts_out_for_delivery', 'attempt' => 'wts_delivery_failed', 'delivered' => 'wts_order_delivered'];
const OU_VIA = '📦 Order update';
const OU_TRACK = 'https://bosta.co/tracking-shipments?shipment-number=';
const OU_PROBLEM_STATES = [47, 100, 101, 102, 103, 105]; // Bosta: exception, lost, damaged, investigation, awaiting action, on hold

function ou_migrate(PDO $pdo): void
{
    $pdo->exec("CREATE TABLE IF NOT EXISTS order_updates (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL, event TEXT NOT NULL,
        how TEXT NOT NULL, detail TEXT DEFAULT '', chat_id INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')))");
    $pdo->exec('CREATE INDEX IF NOT EXISTS idx_order_updates_order ON order_updates(order_id, event)');
}

function ou_cfg(): array
{
    $d = ['on' => false, 'events' => array_fill_keys(OU_EVENTS, true), 'templates' => false];
    $s = wa_setting('order_updates', null);
    if (!is_array($s)) return $d;
    return ['on' => !empty($s['on']), 'events' => array_replace($d['events'], array_map('boolval', (array) ($s['events'] ?? []))), 'templates' => !empty($s['templates'])];
}

// After the order is saved (and the page or Bosta has its answer): never holds anything up.
function order_update_queue(int $orderId, string $event): void
{
    if (!in_array($event, OU_EVENTS, true) || !ou_cfg()['on']) return;
    register_shutdown_function(function () use ($orderId, $event) {
        if (function_exists('fastcgi_finish_request')) fastcgi_finish_request();
        elseif (function_exists('litespeed_finish_request')) litespeed_finish_request();
        try { order_update_send($orderId, $event); }
        catch (Throwable $e) { ops_error('WhatsApp', 'The “' . $event . '” update for ' . order_number($orderId) . ' could not be sent', $e); }
    });
}

// Sends one update if it's due; returns what happened (kept in order_updates, except "already sent").
function order_update_send(int $orderId, string $event): string
{
    $cfg = ou_cfg();
    if (!$cfg['on'] || empty($cfg['events'][$event]) || !wa_ready()) return 'off';
    $st = db()->prepare('SELECT * FROM orders WHERE id = ?');
    $st->execute([$orderId]);
    $o = $st->fetch();
    if (!$o) return 'no order';
    // Still true by the time it goes out (a status can be corrected straight after).
    $due = ['shipped' => $o['status'] === 'Shipped', 'out' => $o['status'] === 'Shipped', 'attempt' => $o['status'] === 'Shipped', 'delivered' => $o['status'] === 'Delivered'][$event];
    if (!$due) return 'not due';
    // Bosta went straight to "out for delivery": that message already said it's on its way.
    if ($event === 'shipped' && (int) $o['bosta_state'] === 41) return ou_log($o, $event, 'skipped', 'Out for delivery already', null);
    $seen = db()->prepare('SELECT 1 FROM order_updates WHERE order_id = ? AND event = ?' . ($event === 'attempt' ? " AND created_at > datetime('now', '-20 hours')" : '') . " AND how IN ('text', 'template') LIMIT 1");
    $seen->execute([$orderId, $event]);
    if ($seen->fetchColumn()) return 'already sent';
    $waId = wa_id_from_phone((string) $o['phone']);
    if (!$waId) return ou_log($o, $event, 'skipped', 'No WhatsApp number on the order', null);
    $ar = ($o['lang'] ?? '') !== 'en';
    $chat = wa_chat_by_wa_id($waId);
    if ($chat && wa_window_open($chat)) {
        // Delivered while the chat is open: the review request already says it (api/review-requests.php).
        if ($event === 'delivered' && review_order_products($o)) return ou_log($o, $event, 'skipped', 'The review request covers it', $chat);
        $id = wa_send_text($chat, ou_text($event, $o, $ar), null, true, true);
        bot_mark($id, OU_VIA);
        ou_after($chat, $event);
        return ou_log($o, $event, 'text', '', $chat);
    }
    if (!$cfg['templates']) return ou_log($o, $event, 'skipped', 'Chat closed (templates are off)', $chat);
    $name = OU_TEMPLATES[$event];
    $lang = $ar ? 'ar' : 'en';
    $status = ((array) wa_setting('templates_seen', []))[$name . '|' . $lang]['status'] ?? 'NOT_SUBMITTED';
    if ($status !== 'APPROVED') return ou_log($o, $event, 'skipped', 'Template not approved by Meta yet', $chat);
    $btn = !empty(WA_TEMPLATES[$name]['button']) ? (string) $o['tracking_number'] : null;
    if ($btn === '') return ou_log($o, $event, 'skipped', 'No tracking number for the template’s button', $chat);
    $chat = $chat ?: ou_chat($waId, $o);
    $vals = array_map(function ($v) use ($o, $ar) { return $v === 'name' ? ou_first($o, $ar) : order_number((int) $o['id']); }, WA_TEMPLATES[$name]['vars']);
    $id = wa_send_template_filled($chat, $name, $lang, $vals, $btn, null);
    bot_mark($id, OU_VIA);
    ou_after($chat, $event);
    return ou_log($o, $event, 'template', '', $chat);
}

// After a failed delivery attempt the customer's answer (a time, an address) is for the team, not the bot.
function ou_after(array $chat, string $event): void
{
    if ($event === 'attempt') db()->prepare("UPDATE wa_chats SET bot = 'human', bot_at = datetime('now') WHERE id = ?")->execute([(int) $chat['id']]);
}

function ou_log(array $o, string $event, string $how, string $detail, ?array $chat): string
{
    db()->prepare("INSERT INTO order_updates (order_id, event, how, detail, chat_id, created_at) VALUES (?, ?, ?, ?, ?, datetime('now'))")
        ->execute([(int) $o['id'], $event, $how, $detail, $chat ? (int) $chat['id'] : null]);
    return $how;
}

// A customer who never wrote to us: a chat to keep the update in (closed; it opens when they reply).
function ou_chat(string $waId, array $o): array
{
    $lead = find_lead(phone_key(wa_local_phone($waId)), null);
    db()->prepare("INSERT INTO wa_chats (wa_id, name, lead_id, status, created_at) VALUES (?, ?, ?, 'closed', datetime('now'))")
        ->execute([$waId, (string) $o['customer'], $lead ? (int) $lead['id'] : null]);
    return wa_chat_by_wa_id($waId);
}

function ou_first(array $o, bool $ar): string
{
    $first = preg_split('/\s+/u', trim((string) $o['customer']))[0] ?? '';
    return mb_strlen($first) > 1 && !preg_match('/\d/', $first) ? $first : ($ar ? 'حضرتك' : 'there');
}

function ou_due(array $o): float
{
    return in_array($o['status'], ['Cancelled', 'Returned'], true) ? 0.0 : max(0.0, round((float) $o['total'] - order_paid((int) $o['id']), 2));
}

function ou_money(float $n, bool $ar): string
{
    $s = number_format($n, $n == floor($n) ? 0 : 2);
    return $ar ? $s . ' ج.م' : 'EGP ' . $s;
}

// The message for one update (while the chat is open; the templates say the same in fewer words).
function ou_text(string $event, array $o, bool $ar): string
{
    $num = order_number((int) $o['id']);
    $hi = ($ar ? 'أهلًا ' : 'Hi ') . ou_first($o, $ar) . ' 👋' . "\n";
    $track = $o['tracking_number'] ? "\n" . ($ar ? 'تتابع الشحنة من هنا: ' : 'Follow the shipment here: ') . OU_TRACK . rawurlencode((string) $o['tracking_number']) : '';
    $cod = ou_due($o) > 0 ? "\n💵 " . ($ar ? 'المطلوب عند الاستلام: ' : 'To pay on delivery: ') . ou_money(ou_due($o), $ar) : '';
    switch ($event) {
        case 'shipped':
            return $hi . ($ar ? 'طلبك ' . $num . ' اتشحن' . ($o['tracking_number'] ? ' مع بوسطة' : '') . ' 🚚 وهيوصلك خلال 2–5 أيام عمل.' : 'Your order ' . $num . ' has shipped' . ($o['tracking_number'] ? ' with Bosta' : '') . ' 🚚 and will reach you in 2–5 working days.') . $track . $cod;
        case 'out':
            return $hi . ($ar ? 'طلبك ' . $num . ' خرج مع المندوب للتوصيل النهارده 🛵' . "\n" . 'خلي موبايلك جنبك عشان المندوب يقدر يكلمك.'
                : 'Your order ' . $num . ' is out for delivery today 🛵' . "\n" . 'Please keep your phone close so the courier can reach you.') . $cod;
        case 'attempt':
            return $hi . ($ar ? 'المندوب حاول يوصل طلبك ' . $num . ' ومقدرش 😕' . "\n" . 'رد علينا هنا بالوقت أو العنوان المناسب لك، وفريقنا هيرتب التوصيل تاني.'
                : 'The courier tried to deliver your order ' . $num . ' but couldn’t 😕' . "\n" . 'Reply here with a time or address that suits you, and our team will arrange delivery again.');
        case 'delivered':
            return $hi . ($ar ? 'طلبك ' . $num . ' اتسلم ✅ نتمنى يعجبك!' : 'Your order ' . $num . ' has been delivered ✅ We hope you love it!');
    }
    return '';
}

// ---------- "Where's my order?" ----------

// Order numbers ("WTS-1234", "wts 1234") or a phone number in a message.
function ou_refs(string $text): array
{
    $text = strtr($text, ['٠' => '0', '١' => '1', '٢' => '2', '٣' => '3', '٤' => '4', '٥' => '5', '٦' => '6', '٧' => '7', '٨' => '8', '٩' => '9']);
    $ids = [];
    if (preg_match_all('/\bwts\s*-?\s*(\d{4,6})\b/i', $text, $m)) foreach ($m[1] as $n) if ((int) $n > 1000) $ids[] = (int) $n - 1000;
    $phone = preg_match('/(?:\+?20|0)?1[0125]\d{8}/', preg_replace('/[\s-]/', '', $text), $p) ? phone_key($p[0]) : null;
    // Just the number, e.g. "1234", once the bot has asked for it.
    if (!$ids && !$phone && preg_match('/^\s*#?(\d{4,5})\s*$/', $text, $m) && (int) $m[1] > 1000) $ids[] = (int) $m[1] - 1000;
    return ['ids' => $ids, 'phone' => $phone];
}

// The customer's orders: by number, by phone, or (WhatsApp) by the chat's own number. Newest first, recent ones.
function ou_lookup(array $chat, array $refs): array
{
    if ($refs['ids']) {
        $in = implode(',', array_map('intval', array_slice($refs['ids'], 0, 3)));
        return db()->query("SELECT * FROM orders WHERE id IN ($in) ORDER BY id DESC")->fetchAll();
    }
    $key = $refs['phone'] ?: (sm_channel($chat) === 'wa' ? phone_key(wa_local_phone((string) $chat['wa_id'])) : null);
    if (!$key) return [];
    $st = db()->prepare("SELECT * FROM orders WHERE REPLACE(REPLACE(REPLACE(phone, ' ', ''), '-', ''), '+', '') LIKE ? AND created_at > datetime('now', '-90 days') ORDER BY id DESC LIMIT 3");
    $st->execute(['%' . $key]);
    return $st->fetchAll();
}

// Something's wrong with one of them (returned, a delivery problem): the team should follow up.
function ou_problem(array $orders): bool
{
    foreach ($orders as $o) if ($o['status'] === 'Returned' || ($o['status'] === 'Shipped' && in_array((int) $o['bosta_state'], OU_PROBLEM_STATES, true))) return true;
    return false;
}

function ou_status_text(array $orders, bool $ar, bool $own = true): string
{
    $words = [
        'Awaiting payment' => ['مستني الدفع', 'waiting for payment'], 'Pending' => ['اتسجل وهنأكده قريب', 'received, we’ll confirm it soon'],
        'Confirmed' => ['اتأكد وبنجهّزه', 'confirmed, we’re preparing it'], 'Designing' => ['بنجهّز التصميم', 'we’re working on the design'],
        'Awaiting approval' => ['مستني موافقتك على التصميم', 'waiting for your approval of the design'], 'In production' => ['بيتصنع دلوقتي', 'being made now'],
        'Ready' => ['جاهز وهيتشحن قريب', 'ready, shipping soon'], 'Shipped' => ['اتشحن 🚚', 'shipped 🚚'], 'Delivered' => ['اتسلم ✅', 'delivered ✅'],
        'Cancelled' => ['اتلغى', 'cancelled'], 'Returned' => ['رجع لنا', 'returned to us'],
    ];
    $out = [];
    foreach ($orders as $o) {
        $state = (int) $o['bosta_state'];
        $w = $words[$o['status']] ?? [$o['status'], $o['status']];
        $line = '📦 ' . ($ar ? 'طلب ' : 'Order ') . order_number((int) $o['id']) . ': ' . $w[$ar ? 0 : 1];
        if ($o['status'] === 'Shipped' && $state === 41) $line = '📦 ' . ($ar ? 'طلب ' : 'Order ') . order_number((int) $o['id']) . ': ' . ($ar ? 'مع المندوب النهارده 🛵' : 'out for delivery today 🛵');
        if ($o['status'] === 'Shipped' && in_array($state, OU_PROBLEM_STATES, true)) $line .= "\n" . ($ar ? 'في مشكلة في التوصيل، وحد من الفريق هيكلمك.' : 'There’s a delivery issue; someone from the team will contact you.');
        if ($o['status'] === 'Delivered' && $o['delivered_at']) $line .= ' · ' . date('j/n', strtotime($o['delivered_at'] . ' UTC'));
        if ($o['status'] === 'Shipped' && $o['tracking_number']) $line .= "\n" . ($ar ? 'تتبع الشحنة: ' : 'Track it: ') . OU_TRACK . rawurlencode((string) $o['tracking_number']);
        if (!$own) { $out[] = $line; continue; }
        if (in_array($o['status'], ['Shipped', 'Ready', 'In production', 'Confirmed', 'Pending'], true) && $o['payment'] === 'cod' && ou_due($o) > 0)
            $line .= "\n💵 " . ($ar ? 'المطلوب عند الاستلام: ' : 'To pay on delivery: ') . ou_money(ou_due($o), $ar);
        if ($o['status'] === 'Awaiting payment' || ($o['payment'] !== 'cod' && in_array($o['status'], ['Pending', 'Confirmed'], true) && ou_due($o) > 0)) {
            if (function_exists('pay_link_problem') && pay_link_problem($o) === '') $line .= "\n💳 " . ($ar ? 'ادفع ' : 'Pay ') . ou_money(ou_due($o), $ar) . ($ar ? ' من هنا: ' : ' here: ') . pay_link_url((int) $o['id']);
        }
        $out[] = $line;
    }
    return implode("\n\n", $out);
}

// ---------- Settings → Order updates ----------

function ou_settings_out(): array
{
    $seen = (array) wa_setting('templates_seen', []);
    $tpl = [];
    foreach (OU_TEMPLATES as $event => $name) $tpl[$event] = ['ar' => $seen[$name . '|ar']['status'] ?? 'NOT_SUBMITTED', 'en' => $seen[$name . '|en']['status'] ?? 'NOT_SUBMITTED'];
    $recent = db()->query('SELECT u.order_id, u.event, u.how, u.detail, u.created_at FROM order_updates u ORDER BY u.id DESC LIMIT 15')->fetchAll();
    $week = db()->query("SELECT how, COUNT(*) FROM order_updates WHERE created_at > datetime('now', '-7 days') GROUP BY how")->fetchAll(PDO::FETCH_KEY_PAIR);
    return ['cfg' => ou_cfg(), 'ready' => wa_ready(), 'templates' => $tpl,
        'recent' => array_map(function ($r) { return ['order' => order_number((int) $r['order_id']), 'orderId' => (int) $r['order_id'], 'event' => $r['event'], 'how' => $r['how'], 'detail' => $r['detail'], 'at' => $r['created_at']]; }, $recent),
        'week' => ['text' => (int) ($week['text'] ?? 0), 'template' => (int) ($week['template'] ?? 0), 'skipped' => (int) ($week['skipped'] ?? 0)]];
}

function ou_save(array $b): void
{
    $events = [];
    foreach (OU_EVENTS as $e) $events[$e] = !empty($b['events'][$e]);
    wa_set_setting('order_updates', ['on' => !empty($b['on']), 'events' => $events, 'templates' => !empty($b['templates'])]);
}
