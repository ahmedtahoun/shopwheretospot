<?php
// Messages that go out by themselves (Settings → Automatic messages), each off until switched on:
//
//  Follow-up    a customer who got prices or a product link and went quiet gets one friendly nudge, a few
//               hours later and always inside WhatsApp's / Meta's free 24-hour window. Not if they ordered.
//  After hours  a message for the team that arrives outside working hours gets "we'll reply at 10" (once
//               every 12 hours), so nobody waits in silence. Chats the bot answers don't need it.
//  Reorder      coffee and skincare run out: a set number of days after delivery, an email (free) and, if
//               switched on, a WhatsApp template with the product link. Once per order.
//  Cart         a checkout left without ordering (api/abandoned.php): an email with the "complete your
//               order" link, and WhatsApp (free if their chat is open, else a template if switched on).
//               The team's follow-up moves to the next day.
//
// Runs with the 15-minute reminders (tg_remind_due: cron every minute, or any dashboard / webhook request).
// What was sent is kept in auto_sent (one row per message), so nothing goes twice.

const AU_FOLLOW_VIA = '⏰ Follow-up';
const AU_AWAY_VIA = '🌙 After hours';
const AU_CART_VIA = '🛒 Cart reminder';
const AU_REORDER_VIA = '🔁 Reorder reminder';

function au_migrate(PDO $pdo): void
{
    $pdo->exec("CREATE TABLE IF NOT EXISTS auto_sent (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, ref TEXT NOT NULL, how TEXT NOT NULL DEFAULT '',
        chat_id INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')))");
    $pdo->exec('CREATE INDEX IF NOT EXISTS idx_auto_sent ON auto_sent(kind, ref)');
    $pdo->exec('CREATE INDEX IF NOT EXISTS idx_auto_sent_at ON auto_sent(created_at)');
}

function au_defaults(): array
{
    return [
        'followup' => ['on' => false, 'hours' => 3, 'team' => true,
            'text' => ['ar' => "لسه معانا؟ 😊\nلو حابب تكمل، تقدر تطلب من هنا في دقيقة: {shop}\nولو عندك أي سؤال، اختار من القائمة أو اكتبلنا.",
                'en' => "Still with us? 😊\nIf you’d like to go ahead, you can order here in a minute: {shop}\nAny question, pick from the menu or just write to us."]],
        'hours' => ['on' => false, 'days' => [0, 1, 2, 3, 4, 6], 'from' => '10:00', 'to' => '22:00',
            'text' => ['ar' => "شكرًا لرسالتك 🌙\nفريقنا متاح {hours}، وهنرد عليك أول ما نبدأ.", 'en' => "Thanks for your message 🌙\nOur team is available {hours}, and we’ll reply as soon as we’re back."]],
        'reorder' => ['on' => false, 'cats' => ['coffee' => 30, 'cosmetics' => 60], 'wa' => false],
        'cart' => ['on' => false, 'wa' => false],
    ];
}

function au_cfg(): array
{
    $d = au_defaults();
    $s = wa_setting('auto', null);
    if (!is_array($s)) return $d;
    foreach ($d as $k => $v) if (isset($s[$k]) && is_array($s[$k])) $d[$k] = array_replace($v, array_intersect_key($s[$k], $v));
    return $d;
}

function au_sent(string $kind, string $ref, string $how, ?array $chat = null): void
{
    db()->prepare("INSERT INTO auto_sent (kind, ref, how, chat_id, created_at) VALUES (?, ?, ?, ?, datetime('now'))")->execute([$kind, $ref, $how, $chat ? (int) $chat['id'] : null]);
}

function au_was_sent(string $kind, string $ref, string $since = ''): bool
{
    $st = db()->prepare('SELECT 1 FROM auto_sent WHERE kind = ? AND ref = ?' . ($since !== '' ? ' AND created_at > ?' : '') . ' LIMIT 1');
    $st->execute($since !== '' ? [$kind, $ref, $since] : [$kind, $ref]);
    return (bool) $st->fetchColumn();
}

function au_cairo(): DateTime
{
    return new DateTime('now', new DateTimeZone('Africa/Cairo'));
}

// Everything due right now (cheap when there's nothing to do).
function au_due(): void
{
    $cfg = au_cfg();
    if ($cfg['followup']['on']) { try { au_followups_due($cfg['followup']); } catch (Throwable $e) { ops_error('Chat bot', 'Follow-up messages could not be checked', $e); } }
    if ($cfg['reorder']['on'] && (int) wa_setting('au_reorder_run', 0) < time() - 3600) {
        wa_set_setting('au_reorder_run', time());
        try { au_reorder_due($cfg['reorder']); } catch (Throwable $e) { ops_error('Chat bot', 'Reorder reminders could not be checked', $e); }
    }
}

// ---------- follow-up ----------

// Chats where our last message was a while ago, the customer hasn't answered, and the free window is still open.
function au_followups_due(array $c): void
{
    $hours = max(1, min(20, (int) $c['hours']));
    $st = db()->prepare("SELECT * FROM wa_chats WHERE status = 'open' AND last_dir = 'out' AND waiting_since IS NULL AND last_in_at IS NOT NULL
        AND last_in_at > datetime('now', '-23 hours') AND (last_out_at <= datetime('now', ?) OR (last_in_at <= datetime('now', '-22 hours') AND last_out_at <= datetime('now', '-30 minutes')))
        ORDER BY last_out_at LIMIT 20");
    $st->execute(['-' . $hours . ' hours']);
    foreach ($st->fetchAll() as $chat) {
        $why = au_followup_skip($chat, $c);
        if ($why !== '') continue;
        $lang = in_array($chat['bot_lang'], ['ar', 'en'], true) ? $chat['bot_lang'] : 'ar';
        $text = bot_fill((string) $c['text'][$lang], $lang === 'ar');
        $bot = bot_cfg();
        // With the bot's menu when the bot is on for this app, so one tap answers the next question.
        if (!empty($bot['on']) && !empty($bot['channels'][sm_channel($chat)])) bot_send($chat, $text, true, $lang, $bot, AU_FOLLOW_VIA);
        else bot_mark(wa_send_text($chat, $text, null, true, true), AU_FOLLOW_VIA);
        au_sent('followup', (string) $chat['id'], $chat['bot'] === 'on' ? 'bot' : 'team', $chat);
    }
}

// '' = send. Only once per conversation, after we talked prices, never after they ordered or the lead was closed.
function au_followup_skip(array $chat, array $c): string
{
    if (au_was_sent('followup', (string) $chat['id'], (string) $chat['last_in_at'])) return 'sent';
    if ($chat['bot'] !== 'on' && empty($c['team'])) return 'team chat';
    $last = db()->prepare("SELECT meta FROM wa_messages WHERE chat_id = ? AND dir = 'out' ORDER BY id DESC LIMIT 1");
    $last->execute([(int) $chat['id']]);
    $via = (json_decode((string) $last->fetchColumn(), true) ?: [])['via'] ?? '';
    if (in_array($via, [AU_FOLLOW_VIA, AU_AWAY_VIA, OU_VIA, AU_CART_VIA, AU_REORDER_VIA], true)) return 'last was automatic';
    // We sent a price, a product or the shop's link since the conversation started.
    $host = parse_url((string) cfg('site_url'), PHP_URL_HOST) ?: 'wheretospot.com';
    $p = db()->prepare("SELECT 1 FROM wa_messages WHERE chat_id = ? AND dir = 'out' AND created_at > datetime(?, '-24 hours') AND (body LIKE '%ج.م%' OR body LIKE '%EGP%' OR body LIKE ?) LIMIT 1");
    $p->execute([(int) $chat['id'], $chat['last_in_at'], '%' . $host . '%']);
    if (!$p->fetchColumn()) return 'no prices';
    if ($chat['lead_id']) {
        $l = db()->prepare('SELECT status FROM leads WHERE id = ?');
        $l->execute([(int) $chat['lead_id']]);
        if (in_array($l->fetchColumn(), ['Won', 'Lost'], true)) return 'lead closed';
    }
    if (sm_channel($chat) === 'wa' && ($key = phone_key(wa_local_phone((string) $chat['wa_id'])))) {
        $o = db()->prepare("SELECT 1 FROM orders WHERE REPLACE(REPLACE(REPLACE(phone, ' ', ''), '-', ''), '+', '') LIKE ? AND created_at > datetime(?, '-24 hours') LIMIT 1");
        $o->execute(['%' . $key, $chat['last_in_at']]);
        if ($o->fetchColumn()) return 'ordered';
    }
    return '';
}

// ---------- after hours ----------

// Outside working hours (Cairo time)? Hours like 10:00–22:00; 22:00–02:00 runs past midnight.
function au_closed(array $h, ?DateTime $now = null): bool
{
    if (empty($h['on'])) return false;
    $now = $now ?: au_cairo();
    $t = $now->format('H:i');
    $from = (string) $h['from']; $to = (string) $h['to'];
    $day = (int) $now->format('w');
    if ($from <= $to) return !in_array($day, (array) $h['days'], true) || $t < $from || $t >= $to;
    // Past midnight: the early hours belong to the day before.
    if ($t < $to) return !in_array(($day + 6) % 7, (array) $h['days'], true);
    return !in_array($day, (array) $h['days'], true) || $t < $from;
}

function au_hours_text(array $h, bool $ar): string
{
    $days = array_map('intval', (array) $h['days']);
    sort($days);
    $names = $ar ? ['الأحد', 'الاتنين', 'التلات', 'الأربع', 'الخميس', 'الجمعة', 'السبت'] : ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    $off = array_values(array_diff(range(0, 6), $days));
    $time = $ar ? 'من ' . $h['from'] . ' لحد ' . $h['to'] : 'from ' . $h['from'] . ' to ' . $h['to'];
    if (!$off) return $time . ($ar ? ' كل يوم' : ' every day');
    return $time . ($ar ? ' (ما عدا ' : ' (except ') . implode($ar ? ' و' : ' and ', array_map(function ($d) use ($names) { return $names[$d]; }, $off)) . ')';
}

// A message for the team arrived (the bot didn't take it): outside hours, say when we'll answer.
function au_after_hours(array $chat): void
{
    $h = au_cfg()['hours'];
    if (!au_closed($h) || !wa_window_open($chat)) return;
    if (au_was_sent('away', (string) $chat['id'], gmdate('Y-m-d H:i:s', time() - 12 * 3600))) return;
    // Someone from the team is answering anyway (late shift).
    $st = db()->prepare("SELECT 1 FROM wa_messages WHERE chat_id = ? AND dir = 'out' AND user_id IS NOT NULL AND created_at > datetime('now', '-60 minutes') LIMIT 1");
    $st->execute([(int) $chat['id']]);
    if ($st->fetchColumn()) return;
    $last = db()->prepare("SELECT body FROM wa_messages WHERE chat_id = ? AND dir = 'in' AND kind = 'text' ORDER BY id DESC LIMIT 1");
    $last->execute([(int) $chat['id']]);
    $lang = in_array($chat['bot_lang'] ?? '', ['ar', 'en'], true) ? $chat['bot_lang'] : bot_lang((string) $last->fetchColumn(), $chat);
    $text = str_replace('{hours}', au_hours_text($h, $lang === 'ar'), (string) $h['text'][$lang]);
    bot_mark(wa_send_text($chat, $text, null, false, true), AU_AWAY_VIA);
    au_sent('away', (string) $chat['id'], 'text', $chat);
}

function au_after_hours_safe(array $chat): void
{
    try { au_after_hours($chat); }
    catch (Throwable $e) { ops_error('Chat bot', 'The after-hours reply could not be sent', $e); }
}

// ---------- WhatsApp to someone who may not have written: free text if the chat is open, else a template ----------

// $tplVals/$btn fill the template. Returns 'text', 'template' or '' (nothing sent).
function au_whatsapp(string $phone, string $text, string $via, bool $templates, string $tpl, array $tplVals, ?string $btn, bool $ar, string $name): array
{
    if (!wa_ready() || !($waId = wa_id_from_phone($phone))) return ['', null];
    $chat = wa_chat_by_wa_id($waId);
    if ($chat && wa_window_open($chat)) {
        bot_mark(wa_send_text($chat, $text, null, true, true), $via);
        return ['text', $chat];
    }
    if (!$templates) return ['', $chat];
    $lang = $ar ? 'ar' : 'en';
    if ((((array) wa_setting('templates_seen', []))[$tpl . '|' . $lang]['status'] ?? '') !== 'APPROVED') return ['', $chat];
    $chat = $chat ?: ou_chat($waId, ['customer' => $name]);
    bot_mark(wa_send_template_filled($chat, $tpl, $lang, $tplVals, $btn, null), $via);
    return ['template', $chat];
}

function au_first(string $name, bool $ar): string
{
    $first = preg_split('/\s+/u', trim($name))[0] ?? '';
    return mb_strlen($first) > 1 && !preg_match('/\d/', $first) ? $first : ($ar ? 'حضرتك' : 'there');
}

// ---------- abandoned checkout ----------

// Called by abandoned_due() when a draft becomes a lead.
function au_cart(array $d, int $leadId): void
{
    $c = au_cfg()['cart'];
    if (!$c['on'] || au_was_sent('cart', (string) $d['id'])) return;
    $ar = $d['lang'] === 'ar';
    $url = draft_resume_url((string) $d['token']);
    $first = au_first((string) $d['name'], $ar);
    $cart = draft_cart_text(json_decode((string) $d['items'], true) ?: []);
    $text = ($ar ? 'أهلًا ' : 'Hi ') . $first . " 👋\n" . ($ar ? 'لاحظنا إن طلبك ما كملش 🛒 (' . $cart . ")\nتقدر تكمله من هنا في دقيقة، والسلة زي ما سبتها: " . $url . "\nلو عندك أي سؤال، رد علينا هنا."
        : 'Looks like your order wasn’t finished 🛒 (' . $cart . ")\nYou can complete it here in a minute, with your cart just as you left it: " . $url . "\nAny question, just reply here.");
    [$how, $chat] = au_whatsapp((string) $d['phone'], $text, AU_CART_VIA, !empty($c['wa']), 'wts_cart_reminder', [$first], (string) $d['token'], $ar, (string) $d['name']);
    $mailed = false;
    if (filter_var((string) $d['email'], FILTER_VALIDATE_EMAIL)) {
        $inner = '<p style="font-size:15px;line-height:1.7">' . ($ar ? 'أهلًا ' . h($first) . ' 👋<br>طلبك لسه مستنيك: <b>' . h($cart) . '</b>. تقدر تكمله في دقيقة، والسلة زي ما سبتها.'
                : 'Hi ' . h($first) . ' 👋<br>Your order is still waiting: <b>' . h($cart) . '</b>. You can complete it in a minute, with your cart just as you left it.') . '</p>'
            . '<p style="text-align:center;margin:22px 0">' . btn($url, $ar ? '🛒 كمّل طلبك' : '🛒 Complete your order') . '</p>';
        send_mail_later([(string) $d['email']], $ar ? 'طلبك لسه مستنيك 🛒' : 'Your cart is waiting 🛒', email_shell($ar ? 'كمّل طلبك' : 'Complete your order', $inner, 'customer'), ($ar ? 'كمّل طلبك: ' : 'Complete your order: ') . $url);
        $mailed = true;
    }
    if ($how === '' && !$mailed) return;
    au_sent('cart', (string) $d['id'], trim($how . ($mailed ? ' email' : '')), $chat);
    // The reminder went out: the team follows up tomorrow if they still haven't ordered.
    $l = db()->prepare('SELECT * FROM leads WHERE id = ?');
    $l->execute([$leadId]);
    if ($lead = $l->fetch()) {
        touch_lead($lead, date('Y-m-d') . ' · 🛒 Cart reminder sent automatically (' . trim(($how !== '' ? 'WhatsApp' : '') . ($mailed ? ($how !== '' ? ' + ' : '') . 'email' : '')) . ')', null, null);
        db()->prepare('UPDATE leads SET follow_up = ? WHERE id = ?')->execute([date('Y-m-d', strtotime('+1 day')), $leadId]);
    }
}

// ---------- reorder ----------

// Delivered orders with a product from a reorder category, its days passed, and no newer order of that category.
function au_reorder_due(array $c): void
{
    $now = au_cairo();
    if ((int) $now->format('G') < 10 || (int) $now->format('G') >= 21) return; // daytime only
    $cats = array_filter(array_map('intval', (array) $c['cats']));
    if (!$cats) return;
    $catOf = [];
    $names = [];
    foreach (load_products(false) as $p) { $catOf[$p['id']] = $p['cat']; $names[$p['id']] = [$p['nameAr'] ?: $p['name'], $p['name'], $p['status'] === 'Active']; }
    $sent = 0;
    foreach ($cats as $cat => $days) {
        $st = db()->prepare("SELECT * FROM orders WHERE status = 'Delivered' AND delivered_at <= datetime('now', ?) AND delivered_at > datetime('now', ?) ORDER BY delivered_at LIMIT 60");
        $st->execute(['-' . $days . ' days', '-' . ($days + 14) . ' days']);
        foreach ($st->fetchAll() as $o) {
            if ($sent >= 15) return;
            if (au_was_sent('reorder', $o['id'] . ':' . $cat)) continue;
            $pid = null;
            foreach (json_decode((string) $o['items'], true) ?: [] as $it) if (($catOf[$it['id'] ?? ''] ?? '') === $cat && !empty($names[$it['id']][2])) { $pid = (string) $it['id']; break; }
            if (!$pid || au_reordered($o, $cat, $catOf)) continue;
            au_reorder_send($o, $pid, $names[$pid], !empty($c['wa']), $cat);
            $sent++;
        }
    }
}

// Ordered from that category again since (same phone or email): no reminder needed.
function au_reordered(array $o, string $cat, array $catOf): bool
{
    $pk = phone_key((string) $o['phone']);
    $st = db()->prepare("SELECT phone, email, items FROM orders WHERE id > ? AND status NOT IN ('Cancelled')");
    $st->execute([(int) $o['id']]);
    foreach ($st->fetchAll() as $n) {
        $same = ($pk && phone_key((string) $n['phone']) === $pk) || ($o['email'] !== '' && strcasecmp((string) $n['email'], (string) $o['email']) === 0);
        if (!$same) continue;
        foreach (json_decode((string) $n['items'], true) ?: [] as $it) if (($catOf[$it['id'] ?? ''] ?? '') === $cat) return true;
    }
    return false;
}

function au_reorder_send(array $o, string $pid, array $name, bool $wa, string $cat): void
{
    $ar = ($o['lang'] ?? '') !== 'en';
    $first = au_first((string) $o['customer'], $ar);
    $title = $ar ? $name[0] : $name[1];
    $url = seo_product_url($pid, $ar);
    $text = ($ar ? 'أهلًا ' . $first . " 👋\nقرّبت تخلص " . $title . '؟ تقدر تطلبها تاني من هنا في دقيقة: ' . $url
        : 'Hi ' . $first . " 👋\nRunning low on " . $title . '? You can order it again here in a minute: ' . $url);
    [$how, $chat] = $wa ? au_whatsapp((string) $o['phone'], $text, AU_REORDER_VIA, true, 'wts_reorder', [$first, $title], $pid, $ar, (string) $o['customer']) : ['', null];
    $mailed = false;
    if (filter_var((string) $o['email'], FILTER_VALIDATE_EMAIL)) {
        $inner = '<p style="font-size:15px;line-height:1.7">' . ($ar ? 'أهلًا ' . h($first) . ' 👋<br>قرّبت تخلص <b>' . h($title) . '</b>؟ اطلبها تاني في دقيقة، وتوصلك خلال 2–5 أيام.'
                : 'Hi ' . h($first) . ' 👋<br>Running low on <b>' . h($title) . '</b>? Order it again in a minute; it reaches you in 2–5 days.') . '</p>'
            . '<p style="text-align:center;margin:22px 0">' . btn($url, $ar ? 'اطلب تاني' : 'Order again') . '</p>';
        send_mail_later([(string) $o['email']], $ar ? 'قرّبت تخلص ' . $title . '؟' : 'Running low on ' . $title . '?', email_shell($ar ? 'اطلب تاني' : 'Order again', $inner, 'customer'), ($ar ? 'اطلب تاني: ' : 'Order again: ') . $url);
        $mailed = true;
    }
    au_sent('reorder', $o['id'] . ':' . $cat, trim($how . ($mailed ? ' email' : '')) ?: 'nothing', $chat);
}

// ---------- Settings → Automatic messages ----------

function au_settings_out(): array
{
    $seen = (array) wa_setting('templates_seen', []);
    $tpl = [];
    foreach (['cart' => 'wts_cart_reminder', 'reorder' => 'wts_reorder'] as $k => $n) $tpl[$k] = ['ar' => $seen[$n . '|ar']['status'] ?? 'NOT_SUBMITTED', 'en' => $seen[$n . '|en']['status'] ?? 'NOT_SUBMITTED'];
    $week = db()->query("SELECT kind, COUNT(*) FROM auto_sent WHERE created_at > datetime('now', '-7 days') AND how != 'nothing' GROUP BY kind")->fetchAll(PDO::FETCH_KEY_PAIR);
    $cats = db()->query('SELECT key FROM categories ORDER BY sort')->fetchAll(PDO::FETCH_COLUMN);
    return ['cfg' => au_cfg(), 'defaults' => au_defaults(), 'templates' => $tpl, 'week' => array_map('intval', $week), 'cats' => $cats,
        'closedNow' => au_closed(array_replace(au_cfg()['hours'], ['on' => true])), 'cairo' => au_cairo()->format('D H:i')];
}

function au_save(array $b): void
{
    $d = au_defaults();
    $two = function ($v, int $max) { return ['ar' => str_in($v['ar'] ?? '', $max), 'en' => str_in($v['en'] ?? '', $max)]; };
    $time = function ($v, string $def) { return preg_match('/^([01]\d|2[0-3]):[0-5]\d$/', (string) $v) ? (string) $v : $def; };
    $f = (array) ($b['followup'] ?? []); $h = (array) ($b['hours'] ?? []); $r = (array) ($b['reorder'] ?? []); $c = (array) ($b['cart'] ?? []);
    $cfg = [
        'followup' => ['on' => !empty($f['on']), 'hours' => max(1, min(20, (int) ($f['hours'] ?? 3))), 'team' => !empty($f['team']), 'text' => $two($f['text'] ?? [], 900)],
        'hours' => ['on' => !empty($h['on']), 'days' => array_values(array_unique(array_filter(array_map('intval', (array) ($h['days'] ?? [])), function ($x) { return $x >= 0 && $x <= 6; }))),
            'from' => $time($h['from'] ?? '', '10:00'), 'to' => $time($h['to'] ?? '', '22:00'), 'text' => $two($h['text'] ?? [], 900)],
        'reorder' => ['on' => !empty($r['on']), 'cats' => [], 'wa' => !empty($r['wa'])],
        'cart' => ['on' => !empty($c['on']), 'wa' => !empty($c['wa'])],
    ];
    foreach (['followup', 'hours'] as $k) foreach (['ar', 'en'] as $l) if ($cfg[$k]['text'][$l] === '') $cfg[$k]['text'][$l] = $d[$k]['text'][$l];
    if ($cfg['hours']['on'] && !$cfg['hours']['days']) fail('Pick at least one working day.');
    if ($cfg['hours']['from'] === $cfg['hours']['to']) fail('Working hours start and end at the same time.');
    $known = db()->query('SELECT key FROM categories')->fetchAll(PDO::FETCH_COLUMN);
    foreach ((array) ($r['cats'] ?? []) as $cat => $days) if (in_array($cat, $known, true) && (int) $days > 0) $cfg['reorder']['cats'][$cat] = min(365, (int) $days);
    wa_set_setting('auto', $cfg);
}
