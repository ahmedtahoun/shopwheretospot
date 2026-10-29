<?php
// The chat bot for WhatsApp, Instagram and Messenger (Settings → Chat bot). No AI: menus and keywords.
//
// A customer's first message gets a welcome with a menu (a WhatsApp list; quick-reply buttons on
// Instagram and Messenger). Each choice sends a ready answer written in Settings, with the menu again,
// so most questions end without anyone from the team. Typed messages are matched by keywords; when the
// bot isn't sure it shows the menu again, and the next time (or for a voice note, a photo, words like
// "complaint", or "Talk to us") it hands the chat to the team: from then on it's an ordinary chat
// (waiting, Telegram alert). While the bot has a chat, the chat isn't waiting and nobody is alerted.
// It stays quiet while someone from the team is talking to the customer (pause_hours).
// Each step is kept in bot_events for the reports.

const BOT_MAX_ITEMS = 10;  // a WhatsApp list holds 10 rows
const BOT_TITLE_MAX = 20;  // an Instagram / Messenger quick reply: 20 characters
const BOT_VIA = '🤖 Bot';  // shown on the bot's messages in the chat

function bot_migrate(PDO $pdo): void
{
    $cols = array_column($pdo->query('PRAGMA table_info(wa_chats)')->fetchAll(), 'name');
    // bot: '' = not started, 'on' = the bot has the chat, 'human' = handed to the team (since bot_at).
    // bot_wait: 'order' = the bot asked for an order number and the next message may be it.
    foreach (['bot' => "TEXT NOT NULL DEFAULT ''", 'bot_at' => 'TEXT', 'bot_fails' => 'INTEGER NOT NULL DEFAULT 0', 'bot_lang' => "TEXT NOT NULL DEFAULT ''", 'bot_wait' => "TEXT NOT NULL DEFAULT ''"] as $col => $type) {
        if (!in_array($col, $cols, true)) $pdo->exec("ALTER TABLE wa_chats ADD COLUMN $col $type");
    }
    $pdo->exec("CREATE TABLE IF NOT EXISTS bot_events (id INTEGER PRIMARY KEY AUTOINCREMENT, chat_id INTEGER NOT NULL REFERENCES wa_chats(id) ON DELETE CASCADE,
        kind TEXT NOT NULL, item TEXT DEFAULT '', how TEXT DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')))");
    $pdo->exec('CREATE INDEX IF NOT EXISTS idx_bot_events_at ON bot_events(created_at)');
}

// The texts the bot starts with; Settings → Chat bot changes them. {prices:nfc,stands} = today's prices
// of those categories, {shop} = the shop's address (Arabic or English).
function bot_defaults(): array
{
    return [
        'on' => false,
        'channels' => ['wa' => true, 'ig' => true, 'fb' => true],
        'pause_hours' => 12,
        'fails' => 2,
        'welcome' => ['ar' => "أهلًا بحضرتك في Where To Spot 👋\nاختار اللي محتاجه من القائمة وهترد عليك فورًا.",
            'en' => "Welcome to Where To Spot 👋\nPick what you need from the menu and you’ll get an answer right away."],
        'menu' => ['ar' => 'القائمة', 'en' => 'Menu'],
        'retry' => ['ar' => "معلش مافهمتش طلبك 🙏\nاختار من القائمة، أو اختار «كلّم فريقنا» وحد من الفريق هيرد عليك.",
            'en' => "Sorry, I didn’t get that 🙏\nPick from the menu, or choose “Talk to us” and someone from the team will reply."],
        'handover' => ['ar' => 'تمام 👍 حد من فريقنا هيرد عليك في أقرب وقت.', 'en' => 'Sure 👍 someone from our team will reply shortly.'],
        'human_words' => 'مشكلة, مرتجع, استرجاع, شكوى, زعلان, اتأخر, ماوصلش, موظف, حد يكلمني, كلمني, اتصل بيا, moshkla, mushkila, شركة, شركات, جملة, كمية كبيرة, complaint, refund, problem, human, agent, call me, wholesale, bulk, company',
        'items' => [
            ['id' => 'prices', 'action' => 'answer', 'title' => ['ar' => '💰 الأسعار', 'en' => '💰 Prices'],
                'keywords' => 'بكام, سعر, السعر, اسعار, الاسعار, كام, تمن, ثمن, bkam, b kam, se3r, el se3r, as3ar, price, prices, cost, how much',
                'answer' => ['ar' => "أسعار منتجات تقييمات جوجل 👇\n{prices:nfc,stands}\n\nكل المنتجات والأسعار: {shop}",
                    'en' => "Our Google review products 👇\n{prices:nfc,stands}\n\nEverything we sell: {shop}"]],
            ['id' => 'how', 'action' => 'answer', 'title' => ['ar' => '📲 بيشتغل إزاي؟', 'en' => '📲 How it works'],
                'keywords' => 'ازاي, بيشتغل, يشتغل, طريقه, فكرته, nfc, ان اف سي, ايفون, اندرويد, ezay, izay, bysht8al, byshta8al, how, work, works, iphone, android',
                'answer' => ['ar' => "الفكرة بسيطة 👌\nعميلك يقرّب موبايله من الكارت أو الستاند، فتفتح له صفحة تقييمك على جوجل على طول، من غير أي تطبيق.\nوالستاند عليه كمان كود QR لأي موبايل مفيهوش NFC.\nبنجهّزه على رابط نشاطك، وتقدر تغيّر الرابط في أي وقت.",
                    'en' => "It’s simple 👌\nYour customer holds their phone near the card or stand and your Google review page opens straight away, no app needed.\nThe stand also has a QR code for phones without NFC.\nWe set it up with your business link, and you can change the link any time."]],
            ['id' => 'delivery', 'action' => 'answer', 'title' => ['ar' => '🚚 التوصيل والدفع', 'en' => '🚚 Delivery & pay'],
                'keywords' => 'توصيل, شحن, بيوصل, يوصل, هيوصل, محافظه, دفع, استلام, فودافون كاش, كاش, انستاباي, فيزا, tawseel, tawsil, sha7n, shahn, delivery, shipping, ship, deliver, pay, payment, cash, instapay',
                'answer' => ['ar' => "🚚 التوصيل لكل محافظات مصر خلال 2–5 أيام عمل، ومصاريف الشحن بتظهر لك قبل ما تأكد الطلب.\n💳 الدفع عند الاستلام، أو بالبطاقة، أو المحافظ الإلكترونية، أو إنستاباي.\n↩️ استرجاع خلال 14 يوم.",
                    'en' => "🚚 Delivery to every governorate in Egypt in 2–5 working days; the delivery fee shows before you confirm the order.\n💳 Cash on delivery, card, mobile wallet or InstaPay.\n↩️ 14-day returns."]],
            ['id' => 'order', 'action' => 'answer', 'title' => ['ar' => '🛒 اطلب دلوقتي', 'en' => '🛒 Order now'],
                'keywords' => 'اطلب, عايز اطلب, عاوز اطلب, اشتري, احجز, atlob, a3mel order, order now, buy, purchase',
                'answer' => ['ar' => "تقدر تطلب أونلاين في دقيقة 👇\n{shop}\nاختار المنتج، اكتب عنوانك، وادفع عند الاستلام أو أونلاين.\nلو حابب نساعدك في الطلب، اختار «كلّم فريقنا».",
                    'en' => "You can order online in a minute 👇\n{shop}\nPick the product, add your address, and pay on delivery or online.\nIf you’d like help with the order, choose “Talk to us”."]],
            // 'orders': looks up their orders (api/order-updates.php); the answer is what it says when it needs the order number.
            ['id' => 'track', 'action' => 'orders', 'title' => ['ar' => '📦 طلبي فين؟', 'en' => '📦 My order'],
                'keywords' => 'طلبي, الاوردر, اوردري, الشحنه, تتبع, رقم الطلب, هيوصل امتي, وصل فين, el order, my order, track, tracking, where is',
                'answer' => ['ar' => 'ابعتلنا رقم الطلب (زي WTS-1234) أو رقم الموبايل اللي طلبت بيه 📦',
                    'en' => 'Send us your order number (like WTS-1234) or the phone number you ordered with 📦']],
            ['id' => 'human', 'action' => 'human', 'title' => ['ar' => '💬 كلّم فريقنا', 'en' => '💬 Talk to us'], 'keywords' => '', 'answer' => ['ar' => '', 'en' => '']],
        ],
        'ads' => [], // ad id => product id: a chat from that ad gets the product first
    ];
}

function bot_cfg(): array
{
    $d = bot_defaults();
    $s = wa_setting('bot', null);
    return is_array($s) ? array_replace($d, array_intersect_key($s, $d)) : $d;
}

// Short words that don't need an answer, and hellos (the menu again rather than "didn't get that").
const BOT_THANKS = 'شكرا, متشكر, تسلم, تمام, ماشي, اوك, حاضر, جميل, ok, okay, thanks, thank you, thx, 👍, ❤️, 🙏, 🌹';
const BOT_HELLO = 'سلام, السلام عليكم, اهلا, مرحبا, صباح الخير, مساء الخير, هاي, hi, hello, hey, salam';

// Arabic written many ways becomes one form: أ/إ/آ → ا, ة → ه, ى → ي, no harakat, ٣ → 3, "بكاااام" → "بكام".
function bot_norm(string $s): string
{
    $s = mb_strtolower($s);
    $s = strtr($s, ['أ' => 'ا', 'إ' => 'ا', 'آ' => 'ا', 'ٱ' => 'ا', 'ة' => 'ه', 'ى' => 'ي', 'ؤ' => 'و', 'ئ' => 'ي', 'ـ' => '',
        '٠' => '0', '١' => '1', '٢' => '2', '٣' => '3', '٤' => '4', '٥' => '5', '٦' => '6', '٧' => '7', '٨' => '8', '٩' => '9']);
    $s = preg_replace('/[\x{064B}-\x{065F}\x{0670}]/u', '', $s);
    $s = preg_replace('/(\p{Arabic})\1{2,}/u', '$1', $s);
    return trim(preg_replace('/\s+/u', ' ', $s));
}

function bot_words(string $list): array
{
    return array_values(array_filter(array_map('bot_norm', preg_split('/[,،\n]+/u', $list))));
}

// Arabic words also match inside a longer word ("والتوصيل", "بالسعر"); English ones only as whole words.
function bot_hit(string $norm, string $kw): bool
{
    if (preg_match('/\p{Arabic}/u', $kw)) return mb_strpos($norm, $kw) !== false;
    return (bool) preg_match('/(?<![\p{L}\p{N}])' . preg_quote($kw, '/') . '(?![\p{L}\p{N}])/u', $norm);
}

function bot_has(string $norm, string $list): bool
{
    foreach (bot_words($list) as $kw) if (bot_hit($norm, $kw)) return true;
    return false;
}

// The menu item a typed message is about: the one with the most (and longest) keywords; none on a tie.
function bot_match(string $norm, array $items): ?array
{
    $scores = [];
    foreach ($items as $i => $it) {
        $hits = array_values(array_filter(bot_words($it['keywords']), function ($kw) use ($norm) { return bot_hit($norm, $kw); }));
        $n = 0;
        // "كام" inside "بكام" counts once.
        foreach ($hits as $kw) {
            $inside = false;
            foreach ($hits as $other) if ($other !== $kw && mb_strpos($other, $kw) !== false) $inside = true;
            if (!$inside) $n += mb_strlen($kw);
        }
        if ($n) $scores[$i] = $n;
    }
    if (!$scores) return null;
    arsort($scores);
    $top = array_values($scores);
    if (count($top) > 1 && $top[0] === $top[1]) return null;
    return $items[array_key_first($scores)];
}

// Items that can be shown: with a title in both languages (cut to what every app accepts).
function bot_items(array $cfg): array
{
    $out = [];
    foreach ((array) $cfg['items'] as $it) {
        if (!is_array($it) || empty($it['id']) || trim((string) ($it['title']['ar'] ?? '')) === '' || trim((string) ($it['title']['en'] ?? '')) === '') continue;
        $out[] = $it;
        if (count($out) >= BOT_MAX_ITEMS) break;
    }
    return $out;
}

function bot_lang(string $text, array $chat): string
{
    $text = preg_replace('/\bwts\s*-?\s*\d+/i', '', $text); // an order number says nothing about the language
    if (preg_match('/\p{Arabic}/u', $text)) return 'ar';
    // Arabic in Latin letters ("3ayez a3raf el se3r"): they read Arabic.
    if (preg_match('/[a-z][2357]|[2357][a-z]/i', $text)) return 'ar';
    if (preg_match('/[a-z]{2,}/i', $text)) return 'en';
    return in_array($chat['bot_lang'] ?? '', ['ar', 'en'], true) ? $chat['bot_lang'] : 'ar';
}

// The bot leaves the chat alone while a person has it: the customer is waiting for the team, it was
// handed over, or someone from the team wrote (here, in the Instagram app or Business Suite) recently.
function bot_quiet(array $chat, array $cfg): bool
{
    if (!empty($chat['waiting_since'])) return true;
    $since = gmdate('Y-m-d H:i:s', time() - max(1, (int) $cfg['pause_hours']) * 3600);
    if (($chat['bot'] ?? '') === 'human' && $chat['bot_at'] && $chat['bot_at'] > $since) return true;
    if (empty($chat['id'])) return false;
    $st = db()->prepare("SELECT 1 FROM wa_messages WHERE chat_id = ? AND dir = 'out' AND created_at > ? AND (user_id IS NOT NULL OR (meta LIKE '%\"via\"%' AND meta NOT LIKE '%\"bot\":1%')) LIMIT 1");
    $st->execute([(int) $chat['id'], $since]);
    return (bool) $st->fetchColumn();
}

// What the bot does with one incoming message, decided before it's saved (so a message the bot
// answers never shows as waiting). Null: not the bot's, an ordinary chat.
// $tap: the id of a menu button the customer tapped. $fresh: start of a conversation.
function bot_plan(array $chat, string $kind, string $text, string $tap = '', ?array $cfg = null): ?array
{
    $cfg = $cfg ?? bot_cfg();
    if (empty($cfg['on']) || empty($cfg['channels'][sm_channel($chat)]) || $kind === 'reaction' || bot_quiet($chat, $cfg)) return null;
    $items = bot_items($cfg);
    if (!$items) return null;
    $since = time() - max(1, (int) $cfg['pause_hours']) * 3600;
    $fresh = ($chat['bot'] ?? '') !== 'on' || !$chat['last_in_at'] || strtotime($chat['last_in_at'] . ' UTC') < $since;
    $lang = bot_lang(in_array($kind, ['text', 'button', 'interactive'], true) ? $text : '', $chat);
    $plan = function (string $do, ?array $item, string $how, array $more = []) use ($fresh, &$lang) { return ['do' => $do, 'item' => $item, 'lang' => $lang, 'how' => $how, 'fresh' => $fresh] + $more; };
    // Their orders: the status of each (with the team following up a problem one), or ask for the order number.
    $orders = function (?array $it, string $how, array $refs) use ($plan, $chat) {
        $found = ou_lookup($chat, $refs);
        // Money (what's due, a payment link) only for the chat's own WhatsApp number, not for a number someone typed.
        if ($found) return $plan('orders', $it, $how, ['orders' => $found, 'team' => ou_problem($found), 'own' => !$refs['ids'] && !$refs['phone']]);
        if ($refs['ids'] || $refs['phone']) return $plan('handover', $it, $how, ['say' => 'notfound']);
        return $plan('ask', $it, $how);
    };
    $none = ['ids' => [], 'phone' => null];
    $pick = function (array $it, string $how) use ($plan, $orders, $none) {
        if ($it['action'] === 'orders') return $orders($it, $how, $none);
        return $plan($it['action'] === 'human' ? 'handover' : 'answer', $it, $how);
    };
    if (strpos($tap, 'bot:') === 0) {
        // The menu came in the chat's language, so the answer does too.
        if (in_array($chat['bot_lang'] ?? '', ['ar', 'en'], true)) $lang = $chat['bot_lang'];
        foreach ($items as $it) if ('bot:' . $it['id'] === $tap) return $pick($it, 'tap');
        return $plan('welcome', null, 'old'); // a button from a menu that has changed since
    }
    if ($kind === 'share') return $plan('welcome', null, 'share');
    if ($kind === 'sticker') return $fresh ? $plan('welcome', null, 'first') : $plan('ignore', null, 'sticker');
    // A voice note, photo, video, file or location: a person needs to look at it.
    if (!in_array($kind, ['text', 'button', 'interactive'], true)) return $plan('handover', null, $kind);
    $norm = bot_norm($text);
    if ($norm === '') return $fresh ? $plan('welcome', null, 'first') : null;
    // An order number (or, once asked, a phone number): straight to its status.
    $refs = ou_refs($text);
    $track = null;
    foreach ($items as $it) if ($it['action'] === 'orders') $track = $it;
    if ($track && ($refs['ids'] || (!$fresh && ($chat['bot_wait'] ?? '') === 'order' && $refs['phone']))) return $orders($track, 'number', $refs);
    if (bot_has($norm, (string) $cfg['human_words'])) return $plan('handover', null, 'words');
    // "2": the second line of the menu.
    if (!$fresh && preg_match('/^\d{1,2}$/', $norm) && isset($items[(int) $norm - 1])) return $pick($items[(int) $norm - 1], 'number');
    if ($it = bot_match($norm, $items)) return $pick($it, 'keyword');
    $short = count(explode(' ', $norm)) <= 4;
    // "Thanks" after an order update or an answer: nothing to add, even at the start of a conversation.
    if ($short && bot_has($norm, BOT_THANKS) && !bot_has($norm, BOT_HELLO)) return $plan('ignore', null, 'thanks');
    if ($fresh || ($short && bot_has($norm, BOT_HELLO))) return $plan('welcome', null, $fresh ? 'first' : 'hello');
    if ((int) $chat['bot_fails'] + 1 >= max(1, (int) $cfg['fails'])) return $plan('handover', null, 'not understood');
    return $plan('retry', null, 'not understood');
}

// What the bot says for a plan: the text, and whether the menu goes with it.
function bot_reply(array $plan, array $cfg): array
{
    $lang = $plan['lang'];
    $ar = $lang === 'ar';
    $it = $plan['item'];
    switch ($plan['do']) {
        case 'welcome': return ['text' => bot_fill((string) $cfg['welcome'][$lang], $ar), 'menu' => true];
        case 'retry': return ['text' => bot_fill((string) $cfg['retry'][$lang], $ar), 'menu' => true];
        case 'handover':
            if (($plan['say'] ?? '') === 'notfound') return ['text' => $ar ? 'مالقيناش طلب بالرقم ده 🤔 حد من فريقنا هيراجع ويرد عليك.' : 'We couldn’t find an order with that number 🤔 Someone from our team will check and reply.', 'menu' => false];
            $t = $it && $it['action'] === 'human' ? trim((string) ($it['answer'][$lang] ?? '')) : '';
            return ['text' => bot_fill($t !== '' ? $t : (string) $cfg['handover'][$lang], $ar), 'menu' => false];
        case 'ask':
            $t = trim((string) ($it['answer'][$lang] ?? ''));
            return ['text' => $t !== '' ? $t : ($ar ? 'ابعتلنا رقم الطلب (زي WTS-1234) أو رقم الموبايل اللي طلبت بيه 📦' : 'Send us your order number (like WTS-1234) or the phone number you ordered with 📦'), 'menu' => true];
        case 'orders':
            $t = ou_status_text($plan['orders'], $ar, !empty($plan['own']));
            if ($plan['fresh']) $t = trim(strtok((string) $cfg['welcome'][$lang], "\n")) . "\n\n" . $t;
            if (!empty($plan['team'])) return ['text' => $t . "\n\n" . (string) $cfg['handover'][$lang], 'menu' => false];
            return ['text' => $t, 'menu' => true];
        case 'answer':
            $t = bot_fill((string) ($it['answer'][$lang] ?? ''), $ar);
            // The first message of a conversation answered straight away still gets a hello.
            if ($plan['fresh']) $t = trim(strtok((string) $cfg['welcome'][$lang], "\n")) . "\n\n" . $t;
            return ['text' => $t, 'menu' => true];
    }
    return ['text' => '', 'menu' => false];
}

function bot_fill(string $text, bool $ar): string
{
    $text = str_replace('{shop}', seo_base() . ($ar ? '/ar' : ''), $text);
    return trim(preg_replace_callback('/\{prices(?::([a-z0-9_,-]+))?\}/i', function ($m) use ($ar) {
        $cats = !empty($m[1]) ? explode(',', strtolower($m[1])) : null;
        $lines = [];
        foreach (load_products(true) as $p) {
            if ($cats && !in_array($p['cat'], $cats, true)) continue;
            $i = wa_product_brief($p, $ar);
            if (!$i['inStock']) continue;
            $prices = $i['sizes'] ? array_column($i['sizes'], 'price') : [$i['low']];
            $from = count(array_unique($prices)) > 1 ? ($ar ? 'من ' : 'from ') : '';
            $lines[] = '• ' . $i['title'] . ': ' . $from . ($ar ? number_format($i['low']) . ' ج.م' : 'EGP ' . number_format($i['low'])) . ($p['cat'] === 'services' ? ($ar ? ' / شهريًا' : ' / month') : '');
        }
        return implode("\n", array_slice($lines, 0, 15));
    }, $text));
}

// Carry out a plan once the customer's message is saved. The messages go out after Meta has its answer.
function bot_run(array $chat, array $plan): void
{
    $cfg = bot_cfg();
    $lang = $plan['lang'];
    if ($plan['do'] !== 'ignore') {
        // A chat from an ad starts with the ad's product (Settings → Chat bot → Ads).
        $pid = $plan['fresh'] && $chat['ad_id'] !== '' ? (string) ($cfg['ads'][$chat['ad_id']] ?? '') : '';
        if ($pid !== '' && $plan['do'] !== 'handover' && !bot_sent_product($chat, $pid)) {
            try { bot_mark(wa_send_product($chat, $pid, $lang === 'ar', null)); bot_event($chat, 'ad_product', $pid, 'ad'); }
            catch (Throwable $e) { error_log('[shop] bot ad product: ' . $e->getMessage()); }
        }
        $r = bot_reply($plan, $cfg);
        if ($r['text'] !== '') bot_send($chat, $r['text'], $r['menu'], $lang, $cfg);
    }
    $state = bot_takes($plan) ? 'on' : 'human';
    $fails = $plan['do'] === 'retry' ? (int) $chat['bot_fails'] + 1 : 0;
    db()->prepare("UPDATE wa_chats SET bot = ?, bot_at = datetime('now'), bot_fails = ?, bot_lang = ?, bot_wait = ? WHERE id = ?")
        ->execute([$state, $fails, $lang, $plan['do'] === 'ask' ? 'order' : '', (int) $chat['id']]);
    // An order lookup that found a problem counts as a handover in the reports.
    bot_event($chat, bot_takes($plan) || $plan['do'] === 'handover' ? $plan['do'] : 'handover', $plan['item']['id'] ?? '', $plan['how']);
}

// The bot answers this one itself (not waiting, no alert); otherwise the team takes over.
function bot_takes(?array $plan): bool
{
    return $plan && $plan['do'] !== 'handover' && empty($plan['team']);
}

// Once per chat: a customer coming back another day doesn't get the ad's product again.
function bot_sent_product(array $chat, string $pid): bool
{
    $st = db()->prepare("SELECT 1 FROM bot_events WHERE chat_id = ? AND kind = 'ad_product' AND item = ? LIMIT 1");
    $st->execute([(int) $chat['id'], $pid]);
    return (bool) $st->fetchColumn();
}

function bot_event(array $chat, string $kind, string $item, string $how): void
{
    db()->prepare("INSERT INTO bot_events (chat_id, kind, item, how, created_at) VALUES (?, ?, ?, ?, datetime('now'))")->execute([(int) $chat['id'], $kind, $item, $how]);
}

// The bot's messages say so in the chat ("🤖 Bot", "📦 Order update" instead of a team member's name).
function bot_mark(int $messageId, string $via = BOT_VIA): void
{
    db()->prepare('UPDATE wa_messages SET meta = ? WHERE id = ?')->execute([json_encode(['via' => $via, 'bot' => 1], JSON_UNESCAPED_UNICODE), $messageId]);
}

// A text with the menu under it: a WhatsApp list (one "Menu" button that opens the choices), or
// quick-reply buttons on Instagram and Messenger. The chat history shows the choices under the text.
function bot_send(array $chat, string $text, bool $withMenu, string $lang, array $cfg, string $via = BOT_VIA): void
{
    $rows = [];
    foreach (bot_items($cfg) as $it) $rows[] = ['id' => 'bot:' . $it['id'], 'title' => mb_substr(trim((string) $it['title'][$lang]), 0, BOT_TITLE_MAX)];
    if (!$withMenu || !$rows) { bot_mark(wa_send_text($chat, $text, null, false, true), $via); return; }
    $ch = sm_channel($chat);
    if ($ch === 'wa') {
        // A list's text holds 1024 characters: a long answer goes first on its own, the menu after it.
        if (mb_strlen($text) > 1000) { bot_mark(wa_send_text($chat, $text, null, false, true), $via); $text = $lang === 'ar' ? 'اختار من القائمة 👇' : 'Pick from the menu 👇'; }
        $label = mb_substr(trim((string) $cfg['menu'][$lang]) ?: 'Menu', 0, 20);
        $body = ['messaging_product' => 'whatsapp', 'recipient_type' => 'individual', 'to' => $chat['wa_id'], 'type' => 'interactive',
            'interactive' => ['type' => 'list', 'body' => ['text' => $text], 'action' => ['button' => $label,
                'sections' => [['title' => mb_substr($label, 0, 24), 'rows' => array_map(function ($r) { return ['id' => $r['id'], 'title' => mb_substr($r['title'], 0, 24)]; }, $rows)]]]]];
        $send = function () use ($body) { return wa_graph('POST', '/' . wa_cfg('phone_number_id') . '/messages', $body); };
    } else {
        $send = function () use ($chat, $text, $rows, $ch) {
            $pieces = sm_chunks($text, $ch);
            $last = array_pop($pieces);
            foreach ($pieces as $p) sm_send($chat, ['text' => $p]);
            return sm_send($chat, ['text' => $last, 'quick_replies' => array_map(function ($r) { return ['content_type' => 'text', 'title' => $r['title'], 'payload' => $r['id']]; }, $rows)]);
        };
    }
    $shown = $text . "\n\n☰ " . implode(' · ', array_column($rows, 'title'));
    $id = wa_record_out($chat, '', 'interactive', $shown, [], null, 'sending');
    bot_mark($id, $via);
    wa_send_later($id, (int) $chat['id'], $send);
}

// The incoming side, for wa_store_incoming() and sm_store_incoming(): the plan (never fails the save).
function bot_plan_safe(array $chat, string $kind, string $text, string $tap): ?array
{
    try { return bot_plan($chat, $kind, $text, $tap); }
    catch (Throwable $e) { error_log('[shop] bot plan: ' . $e->getMessage()); return null; }
}

function bot_run_safe(array $chat, ?array $plan): void
{
    if (!$plan) return;
    try { bot_run($chat, $plan); }
    catch (Throwable $e) { ops_error('Chat bot', 'The chat bot could not answer a message', $e); }
}

// ---------- Settings → Chat bot ----------

function bot_settings_out(): array
{
    $cfg = bot_cfg();
    $products = array_map(function ($p) { return ['id' => $p['id'], 'name' => $p['name'], 'cat' => $p['cat']]; }, load_products(true));
    $cats = db()->query('SELECT key FROM categories ORDER BY sort')->fetchAll(PDO::FETCH_COLUMN);
    // Ads that brought chats (newest first), to pick the product each one is about.
    $ads = db()->query("SELECT ad_id, MAX(ad_headline) AS headline, COUNT(*) AS chats, MAX(created_at) AS last FROM wa_chats WHERE ad_id != '' GROUP BY ad_id ORDER BY last DESC LIMIT 40")->fetchAll();
    $week = db()->query("SELECT kind, COUNT(DISTINCT chat_id) AS n FROM bot_events WHERE created_at > datetime('now', '-7 days') GROUP BY kind")->fetchAll(PDO::FETCH_KEY_PAIR);
    $chats = (int) db()->query("SELECT COUNT(DISTINCT chat_id) FROM bot_events WHERE created_at > datetime('now', '-7 days')")->fetchColumn();
    return ['cfg' => $cfg, 'defaults' => bot_defaults(), 'products' => $products, 'cats' => $cats,
        'ads' => array_map(function ($a) { return ['id' => $a['ad_id'], 'headline' => $a['headline'], 'chats' => (int) $a['chats']]; }, $ads),
        'week' => ['chats' => $chats, 'handover' => (int) ($week['handover'] ?? 0)], 'titleMax' => BOT_TITLE_MAX, 'maxItems' => BOT_MAX_ITEMS];
}

// The settings from the page, checked (fails with what to fix). Also what Try it uses before saving.
function bot_clean(array $b): array
{
    $d = bot_defaults();
    $two = function ($v, int $max) { return ['ar' => str_in($v['ar'] ?? '', $max), 'en' => str_in($v['en'] ?? '', $max)]; };
    $cfg = ['on' => !empty($b['on']),
        'channels' => ['wa' => !empty($b['channels']['wa']), 'ig' => !empty($b['channels']['ig']), 'fb' => !empty($b['channels']['fb'])],
        'pause_hours' => max(1, min(72, (int) ($b['pause_hours'] ?? 12))), 'fails' => max(1, min(5, (int) ($b['fails'] ?? 2))),
        'welcome' => $two($b['welcome'] ?? [], 900), 'menu' => $two($b['menu'] ?? [], 20), 'retry' => $two($b['retry'] ?? [], 900),
        'handover' => $two($b['handover'] ?? [], 900), 'human_words' => str_in($b['human_words'] ?? '', 2000), 'items' => [], 'ads' => []];
    foreach (['welcome', 'retry', 'handover'] as $k) foreach (['ar', 'en'] as $l) if ($cfg[$k][$l] === '') fail('Write the ' . ($k === 'welcome' ? 'welcome' : ($k === 'retry' ? '“didn’t understand”' : '“handing to the team”')) . ' message in ' . ($l === 'ar' ? 'Arabic' : 'English') . '.');
    foreach (['ar', 'en'] as $l) if ($cfg['menu'][$l] === '') $cfg['menu'][$l] = $d['menu'][$l];
    $seen = [];
    foreach (array_slice((array) ($b['items'] ?? []), 0, BOT_MAX_ITEMS) as $it) {
        $title = $two($it['title'] ?? [], 60);
        if ($title['ar'] === '' && $title['en'] === '') continue;
        foreach (['ar' => 'Arabic', 'en' => 'English'] as $l => $name) {
            if ($title[$l] === '') fail('Every menu item needs a button in Arabic and in English.');
            if (mb_strlen($title[$l]) > BOT_TITLE_MAX) fail('“' . $title[$l] . '” is too long for a button: at most ' . BOT_TITLE_MAX . ' characters (Instagram’s limit).');
        }
        $action = in_array($it['action'] ?? '', ['human', 'orders'], true) ? $it['action'] : 'answer';
        $answer = $two($it['answer'] ?? [], 3000);
        if ($action === 'answer' && ($answer['ar'] === '' || $answer['en'] === '')) fail('Write the answer for “' . $title['en'] . '” in Arabic and in English.');
        $id = preg_replace('/[^a-z0-9_-]/', '', strtolower((string) ($it['id'] ?? '')));
        if ($id === '' || isset($seen[$id])) $id = 'i' . substr(bin2hex(random_bytes(4)), 0, 6);
        $seen[$id] = true;
        $cfg['items'][] = ['id' => $id, 'action' => $action, 'title' => $title, 'keywords' => str_in($it['keywords'] ?? '', 1000), 'answer' => $answer];
    }
    if (!$cfg['items']) fail('Add at least one menu item.');
    $ids = array_column(load_products(true), 'id');
    foreach ((array) ($b['ads'] ?? []) as $ad => $pid) {
        $ad = preg_replace('/[^\w-]/', '', (string) $ad);
        if ($ad !== '' && in_array((string) $pid, $ids, true)) $cfg['ads'][$ad] = (string) $pid;
    }
    return $cfg;
}

function bot_save(array $b): void
{
    wa_set_setting('bot', bot_clean($b));
}

// Settings → Chat bot → Try it: what the bot would answer, without sending anything. $state is the
// pretend chat (fresh conversation or not, failed guesses so far, language of the last menu).
function bot_try(array $b): array
{
    $cfg = is_array($b['cfg'] ?? null) ? bot_clean($b['cfg']) : bot_cfg();
    $fresh = !empty($b['fresh']);
    $chat = ['id' => 0, 'channel' => in_array($b['channel'] ?? '', ['wa', 'ig', 'fb'], true) ? $b['channel'] : 'wa', 'wa_id' => '', 'waiting_since' => null,
        'bot' => $fresh ? '' : 'on', 'bot_at' => gmdate('Y-m-d H:i:s'), 'bot_fails' => (int) ($b['fails'] ?? 0), 'bot_lang' => (string) ($b['lang'] ?? ''), 'bot_wait' => (string) ($b['wait'] ?? ''),
        'last_in_at' => $fresh ? null : gmdate('Y-m-d H:i:s'), 'ad_id' => ''];
    // It can be tried before it's switched on.
    $cfg['on'] = true;
    $cfg['channels'][$chat['channel']] = true;
    $plan = bot_plan($chat, (string) ($b['kind'] ?? 'text'), str_in($b['text'] ?? '', 1000), (string) ($b['tap'] ?? ''), $cfg);
    if (!$plan) return ['do' => 'none'];
    $r = bot_reply($plan, $cfg);
    return ['do' => $plan['do'], 'how' => $plan['how'], 'item' => $plan['item']['id'] ?? '', 'lang' => $plan['lang'], 'text' => $r['text'],
        'menu' => $r['menu'] ? array_map(function ($it) use ($plan) { return ['id' => 'bot:' . $it['id'], 'title' => $it['title'][$plan['lang']]]; }, bot_items($cfg)) : [],
        'fails' => $plan['do'] === 'retry' ? (int) $chat['bot_fails'] + 1 : 0, 'wait' => $plan['do'] === 'ask' ? 'order' : '', 'team' => !bot_takes($plan)];
}
