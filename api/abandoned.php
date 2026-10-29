<?php
// Abandoned checkouts: as soon as a customer has typed a phone number at checkout, their cart and contact are
// kept as a draft. Ordered → the draft is closed. Not ordered within 30 minutes → it becomes a lead
// ("Abandoned checkout", follow-up due today) with the cart and a link that puts the same cart back, so the
// team can message them on WhatsApp. An order after that counts as recovered (Dashboard).

declare(strict_types=1);

const ABANDON_AFTER_MIN = 30;

function abandoned_migrate(PDO $pdo): void
{
    $pdo->exec("CREATE TABLE IF NOT EXISTS checkout_drafts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        token TEXT NOT NULL UNIQUE,
        name TEXT DEFAULT '',
        phone TEXT NOT NULL,
        phone_key TEXT NOT NULL,
        email TEXT DEFAULT '',
        items TEXT NOT NULL DEFAULT '[]',
        total REAL NOT NULL DEFAULT 0,
        lang TEXT DEFAULT 'en',
        status TEXT NOT NULL DEFAULT 'open',
        lead_id INTEGER,
        order_id INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        abandoned_at TEXT,
        ordered_at TEXT
    )");
    $pdo->exec('CREATE INDEX IF NOT EXISTS idx_drafts_status ON checkout_drafts(status, updated_at)');
    $pdo->exec('CREATE INDEX IF NOT EXISTS idx_drafts_phone ON checkout_drafts(phone_key)');
}

function draft_token_ok(string $t): bool
{
    return (bool) preg_match('/^[a-f0-9]{24,40}$/', $t);
}

// From the checkout form (debounced): who, and what's in the cart. Names and prices are only for the team's
// message; the cart that comes back with the link is priced again by the shop.
function draft_save(array $b): void
{
    $token = (string) ($b['token'] ?? '');
    $phone = str_in($b['phone'] ?? '', 40);
    $pk = phone_key($phone);
    if (!draft_token_ok($token) || !$pk) return;
    $items = [];
    foreach (array_slice(is_array($b['items'] ?? null) ? $b['items'] : [], 0, 50) as $i) {
        $id = str_in($i['id'] ?? '', 80);
        if ($id === '' || !preg_match('/^[\w-]+$/', $id)) continue;
        $items[] = ['id' => $id, 'variant' => isset($i['variant']) && $i['variant'] !== '' ? str_in((string) $i['variant'], 80) : null,
            'addons' => array_values(array_map(function ($a) { return str_in((string) $a, 80); }, array_slice(is_array($i['addons'] ?? null) ? $i['addons'] : [], 0, 10))),
            'qty' => max(1, min(999, (int) ($i['qty'] ?? 1))), 'name' => str_in($i['name'] ?? '', 160), 'price' => round(max(0, (float) ($i['price'] ?? 0)), 2)];
    }
    if (!$items) return;
    $email = str_in($b['email'] ?? '', 160);
    $email = filter_var($email, FILTER_VALIDATE_EMAIL) ? $email : '';
    $lang = ($b['lang'] ?? '') === 'ar' ? 'ar' : 'en';
    $total = round(max(0, min(10000000, (float) ($b['total'] ?? 0))), 2);
    // A draft already ordered or handed to the team isn't changed; a new visit starts a new token anyway.
    db()->prepare("INSERT INTO checkout_drafts (token, name, phone, phone_key, email, items, total, lang) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(token) DO UPDATE SET name = excluded.name, phone = excluded.phone, phone_key = excluded.phone_key, email = excluded.email,
            items = excluded.items, total = excluded.total, lang = excluded.lang, updated_at = datetime('now') WHERE checkout_drafts.status = 'open'")
        ->execute([$token, str_in($b['name'] ?? '', 120), $phone, $pk, $email, json_encode($items, JSON_UNESCAPED_UNICODE), $total, $lang]);
}

// An order was placed: close its draft, and any other recent draft from the same phone. One the team was
// already following up becomes "recovered".
function draft_ordered(string $token, string $phone, int $orderId): void
{
    $pk = phone_key($phone);
    $pdo = db();
    $st = $pdo->prepare("SELECT * FROM checkout_drafts WHERE status IN ('open', 'abandoned') AND (token = ? OR (? IS NOT NULL AND phone_key = ? AND updated_at > datetime('now', '-7 days')))");
    $st->execute([$token, $pk, $pk]);
    foreach ($st->fetchAll() as $d) {
        $recovered = $d['status'] === 'abandoned';
        $pdo->prepare("UPDATE checkout_drafts SET status = ?, order_id = ?, ordered_at = datetime('now') WHERE id = ?")->execute([$recovered ? 'recovered' : 'ordered', $orderId, $d['id']]);
        if ($recovered) log_activity(null, 'Abandoned checkout recovered', order_number($orderId) . ' · ' . $d['name'] . ' · ' . $d['phone']);
    }
}

function draft_resume_url(string $token): string
{
    return rtrim((string) cfg('site_url'), '/') . '/?restore=' . $token;
}

function draft_cart_text(array $items): string
{
    return implode(', ', array_map(function ($i) { return $i['qty'] . '× ' . $i['name']; }, $items));
}

// Drafts left for 30 minutes become leads for the team (follow-up due today). Cheap when there's nothing to do.
function abandoned_due(): void
{
    $pdo = db();
    $st = $pdo->prepare("SELECT * FROM checkout_drafts WHERE status = 'open' AND updated_at < datetime('now', ?) ORDER BY id LIMIT 30");
    $st->execute(['-' . ABANDON_AFTER_MIN . ' minutes']);
    foreach ($st->fetchAll() as $d) {
        try {
            // Ordered from another device or under another token in the meantime: nothing to follow up.
            $o = $pdo->prepare("SELECT id, phone FROM orders WHERE created_at > ? AND status != 'Cancelled' ORDER BY id DESC LIMIT 50");
            $o->execute([$d['created_at']]);
            $done = null;
            foreach ($o->fetchAll() as $x) if (phone_key((string) $x['phone']) === $d['phone_key']) { $done = (int) $x['id']; break; }
            if ($done) { $pdo->prepare("UPDATE checkout_drafts SET status = 'ordered', order_id = ?, ordered_at = datetime('now') WHERE id = ?")->execute([$done, $d['id']]); continue; }
            $items = json_decode((string) $d['items'], true) ?: [];
            $cart = draft_cart_text($items);
            $note = date('Y-m-d') . ' · 🛒 Left checkout without ordering · EGP ' . number_format((float) $d['total']) . "\nCart: " . $cart .
                "\nLanguage: " . ($d['lang'] === 'ar' ? 'Arabic' : 'English') . "\nComplete the order: " . draft_resume_url((string) $d['token']);
            $contact = trim($d['phone'] . ($d['email'] !== '' ? ' · ' . $d['email'] : ''), ' ·');
            $lead = find_lead($d['phone_key'], email_key((string) $d['email']));
            if ($lead) {
                touch_lead($lead, $note, in_array($lead['status'], ['Won', 'Lost'], true) ? 'New' : null, null, $contact);
                $leadId = (int) $lead['id'];
                $pdo->prepare('UPDATE leads SET follow_up = ? WHERE id = ?')->execute([date('Y-m-d'), $leadId]);
            } else {
                $leadId = insert_lead(['name' => $d['name'] !== '' ? $d['name'] : $d['phone'], 'contact' => $contact, 'cat' => mb_substr($cart, 0, 120),
                    'source' => 'Abandoned checkout', 'status' => 'New', 'notes' => $note]);
                $pdo->prepare('UPDATE leads SET follow_up = ? WHERE id = ?')->execute([date('Y-m-d'), $leadId]);
                notify_new_lead(['name' => $d['name'] ?: $d['phone'], 'contact' => $contact, 'cat' => 'Abandoned checkout · EGP ' . number_format((float) $d['total']), 'source' => 'Abandoned checkout', 'notes' => $note]);
            }
            $pdo->prepare("UPDATE checkout_drafts SET status = 'abandoned', abandoned_at = datetime('now'), lead_id = ? WHERE id = ?")->execute([$leadId, $d['id']]);
            // The customer gets the "complete your order" link by themselves, if switched on (api/automations.php).
            try { au_cart($d, $leadId); } catch (Throwable $e) { ops_error('Leads', 'The cart reminder could not be sent', $e); }
        } catch (Throwable $e) {
            ops_error('Leads', 'An abandoned checkout could not be turned into a lead', $e);
        }
    }
}

// The cart behind a "complete your order" link (products only, nothing about the person).
function draft_cart(string $token): array
{
    if (!draft_token_ok($token)) return [];
    $st = db()->prepare('SELECT items FROM checkout_drafts WHERE token = ?');
    $st->execute([$token]);
    $items = json_decode((string) $st->fetchColumn(), true) ?: [];
    return array_map(function ($i) { return ['id' => $i['id'], 'variant' => $i['variant'], 'addons' => $i['addons'], 'qty' => $i['qty']]; }, $items);
}

// Dashboard: abandoned and recovered in the period, with their value.
function abandoned_stats(string $fromUtc, string $toUtc): array
{
    $st = db()->prepare("SELECT status, COUNT(*) n, COALESCE(SUM(total), 0) v FROM checkout_drafts WHERE status IN ('abandoned', 'recovered') AND abandoned_at >= ? AND abandoned_at < ? GROUP BY status");
    $st->execute([$fromUtc, $toUtc]);
    $r = ['abandoned' => 0, 'abandonedValue' => 0.0, 'recovered' => 0, 'recoveredValue' => 0.0];
    foreach ($st as $x) { $r[$x['status']] = (int) $x['n']; $r[$x['status'] . 'Value'] = round((float) $x['v'], 2); }
    $r['abandoned'] += $r['recovered']; $r['abandonedValue'] += $r['recoveredValue']; // every recovered one was abandoned first
    return $r;
}
