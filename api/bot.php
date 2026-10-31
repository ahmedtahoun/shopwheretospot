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
const BOT_MAX_ALL = 30;    // with the hidden answers
const BOT_TITLE_MAX = 20;  // an Instagram / Messenger quick reply: 20 characters
const BOT_VIA = '🤖 Bot';  // shown on the bot's messages in the chat

function bot_migrate(PDO $pdo): void
{
    $cols = array_column($pdo->query('PRAGMA table_info(wa_chats)')->fetchAll(), 'name');
    // bot: '' = not started, 'on' = the bot has the chat, 'human' = handed to the team (since bot_at).
    // bot_wait: 'order' = the bot asked for an order number and the next message may be it.
    foreach (['bot' => "TEXT NOT NULL DEFAULT ''", 'bot_at' => 'TEXT', 'bot_fails' => 'INTEGER NOT NULL DEFAULT 0', 'bot_lang' => "TEXT NOT NULL DEFAULT ''", 'bot_wait' => "TEXT NOT NULL DEFAULT ''",
        // bot_ctx: what the bot last showed in this conversation ({"last": product id, "list": [ids]}), so "بكام ده؟", "2" or "اطلبه" make sense.
        'bot_ctx' => "TEXT NOT NULL DEFAULT ''"] as $col => $type) {
        if (!in_array($col, $cols, true)) $pdo->exec("ALTER TABLE wa_chats ADD COLUMN $col $type");
    }
    $pdo->exec("CREATE TABLE IF NOT EXISTS bot_events (id INTEGER PRIMARY KEY AUTOINCREMENT, chat_id INTEGER NOT NULL REFERENCES wa_chats(id) ON DELETE CASCADE,
        kind TEXT NOT NULL, item TEXT DEFAULT '', how TEXT DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')))");
    $pdo->exec('CREATE INDEX IF NOT EXISTS idx_bot_events_at ON bot_events(created_at)');
    // said: what the customer wrote (Settings → Chat bot → "Messages it didn't understand").
    if (!in_array('said', array_column($pdo->query('PRAGMA table_info(bot_events)')->fetchAll(), 'name'), true)) $pdo->exec("ALTER TABLE bot_events ADD COLUMN said TEXT DEFAULT ''");
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
        'welcome' => ['ar' => "أهلًا بيك في Where To Spot 👋\nتحب أساعدك في إيه؟", 'en' => "Hi, welcome to Where To Spot 👋\nHow can I help?"],
        'menu' => ['ar' => 'القائمة', 'en' => 'Menu'],
        // WhatsApp shows at most 3 buttons in the chat: two menu items and "More options" (the full list).
        // Off: one Menu button that opens the list.
        'wa_buttons' => true,
        // "typing…" in the customer's chat and a short pause (longer for longer answers), like a person.
        'typing' => true,
        'more' => ['ar' => '☰ اختيارات تانية', 'en' => '☰ More options'],
        'retry' => ['ar' => "معلش مش واخد بالي قصدك 🙏\nممكن تقولها بطريقة تانية، أو تختار من تحت 👇", 'en' => "Sorry, I didn’t quite get that 🙏\nCould you say it another way, or pick below 👇"],
        'handover' => ['ar' => 'تمام 👍 حد من فريقنا هيرد عليك في أقرب وقت.', 'en' => 'Sure 👍 someone from our team will reply shortly.'],
        'human_words' => 'مشكلة, مرتجع, استرجاع, شكوى, زعلان, اتأخر, ماوصلش, موظف, حد يكلمني, كلمني, اتصل بيا, moshkla, mushkila, شركة, شركات, جملة, كمية كبيرة, complaint, refund, problem, human, agent, call me, wholesale, bulk, company',
        'items' => [
            ['id' => 'prices', 'action' => 'answer', 'title' => ['ar' => '💰 الأسعار', 'en' => '💰 Prices'],
                'keywords' => 'بكام, سعر, السعر, اسعار, الاسعار, كام, تمن, ثمن, bkam, b kam, se3r, el se3r, as3ar, price, prices, cost, how much',
                // {ask_kind:…}: asks which kind of product (buttons: cards, stands…). A product the customer names
                // (or the ad's product) goes as its photo card instead.
                'answer' => ['ar' => "تحب تعرف سعر إيه؟ 👇{ask_kind:nfc,stands}", 'en' => "Which one would you like the price of? 👇{ask_kind:nfc,stands}"]],
            ['id' => 'how', 'action' => 'answer', 'title' => ['ar' => '📲 بيشتغل إزاي؟', 'en' => '📲 How it works'],
                'keywords' => 'ازاي, بيشتغل, يشتغل, طريقه, فكرته, nfc, ان اف سي, ايفون, اندرويد, ezay, izay, bysht8al, byshta8al, how, work, works, iphone, android',
                'answer' => ['ar' => "الفكرة بسيطة 👌\nعميلك يقرّب موبايله من الكارت أو يصوّر الـ QR، فتفتح صفحة تقييمك على جوجل على طول، من غير أي تطبيق.",
                    'en' => "It’s simple 👌\nYour customer taps their phone on the card or scans the QR, and your Google review page opens straight away, no app needed."]],
            ['id' => 'delivery', 'action' => 'answer', 'title' => ['ar' => '🚚 التوصيل والدفع', 'en' => '🚚 Delivery & pay'],
                'keywords' => 'توصيل, شحن, بيوصل, يوصل, هيوصل, محافظه, دفع, استلام, فودافون كاش, كاش, انستاباي, فيزا, tawseel, tawsil, sha7n, shahn, delivery, shipping, ship, deliver, pay, payment, cash, instapay',
                'answer' => ['ar' => "🚚 بنوصّل لكل مصر خلال 2–5 أيام\n💳 الدفع كاش عند الاستلام، أو أونلاين، أو إنستاباي",
                    'en' => "🚚 We deliver all over Egypt in 2–5 days\n💳 Pay cash on delivery, online, or by InstaPay"]],
            ['id' => 'order', 'action' => 'answer', 'title' => ['ar' => '🛒 اطلب دلوقتي', 'en' => '🛒 Order now'],
                'keywords' => 'اطلب, عايز اطلب, عاوز اطلب, اشتري, احجز, atlob, a3mel order, order now, buy, purchase',
                'answer' => ['ar' => "تطلب أونلاين في دقيقة 👇\n{shop}", 'en' => "Order online in a minute 👇\n{shop}"]],
            // 'orders': looks up their orders (api/order-updates.php); the answer is what it says when it needs the order number.
            ['id' => 'track', 'action' => 'orders', 'title' => ['ar' => '📦 طلبي فين؟', 'en' => '📦 My order'],
                'keywords' => 'طلبي, الاوردر, اوردري, الشحنه, تتبع, رقم الطلب, هيوصل امتي, وصل فين, el order, my order, track, tracking, where is',
                'answer' => ['ar' => 'ابعتلنا رقم الطلب (زي WTS-1234) أو رقم الموبايل اللي طلبت بيه 📦',
                    'en' => 'Send us your order number (like WTS-1234) or the phone number you ordered with 📦']],
            ['id' => 'human', 'action' => 'human', 'title' => ['ar' => '💬 كلّم فريقنا', 'en' => '💬 Talk to us'], 'keywords' => '', 'answer' => ['ar' => '', 'en' => '']],
            // Hidden: answered when typed, never shown as a button (everyday questions).
            ['id' => 'hi', 'action' => 'answer', 'hidden' => true, 'title' => ['ar' => '👋 ازيك', 'en' => '👋 How are you'],
                'keywords' => 'ازيك, ازيكم, عامل ايه, عاملين ايه, اخبارك, اخباركم, كيفك, عامله ايه, how are you',
                'answer' => ['ar' => 'الحمد لله تمام 😊 تحب أساعدك في إيه؟', 'en' => 'All good, thanks 😊 How can I help?']],
            ['id' => 'where', 'action' => 'answer', 'hidden' => true, 'title' => ['ar' => '📍 مكاننا', 'en' => '📍 Where we are'],
                'keywords' => 'انتو فين, انتم فين, مكانكم, عنوانكم, العنوان, فرع, فروع, المحل فين, location, address, where are you',
                'answer' => ['ar' => "إحنا متجر أونلاين وبنوصّل لكل مصر 🚚\nمقرّنا في 6 أكتوبر (MQR، طريق الواحات).", 'en' => "We’re an online shop delivering all over Egypt 🚚\nWe’re based in 6th of October City (MQR, El Wahat Road)."]],
            ['id' => 'hours', 'action' => 'answer', 'hidden' => true, 'title' => ['ar' => '🕘 المواعيد', 'en' => '🕘 Hours'],
                'keywords' => 'مواعيد, مواعيدكم, بتفتحوا, بتقفلوا, شغالين امتي, شغالين النهارده, open, hours, working hours',
                'answer' => ['ar' => '{team_hours}', 'en' => '{team_hours}']],
            ['id' => 'design', 'action' => 'human', 'hidden' => true, 'title' => ['ar' => '🎨 التصميم', 'en' => '🎨 Design'],
                'keywords' => 'تصميم, التصميم, لوجو, اللوجو, شعار, بشعاري, اسم المحل, design, logo, custom',
                'answer' => ['ar' => "أيوه 👌 بنطبع الستاندات والكوستر بشعارك وتصميمك.\nابعتلنا اللوجو هنا وحد من الفريق هيكمل معاك.", 'en' => "Yes 👌 we print stands and coasters with your logo and design.\nSend your logo here and someone from the team will take it from there."]],
            ['id' => 'work', 'action' => 'answer', 'hidden' => true, 'title' => ['ar' => '📸 شغلنا', 'en' => '📸 Our work'],
                'keywords' => 'شغلكم, صور, صوره, اشوف, عينات, عينه, نماذج, سابقه اعمال, examples, photos, pictures',
                'answer' => ['ar' => "صور كل المنتجات هنا 👇\n{shop}\nوشغلنا على إنستجرام: instagram.com/wheretospot", 'en' => "Photos of every product here 👇\n{shop}\nAnd our work on Instagram: instagram.com/wheretospot"]],
            ['id' => 'bot', 'action' => 'answer', 'hidden' => true, 'title' => ['ar' => '🤖 مين بيرد', 'en' => '🤖 Who’s replying'],
                'keywords' => 'انت بوت, انت روبوت, بوت, روبوت, رد الي, رد اوتوماتيك, are you a bot, robot',
                'answer' => ['ar' => 'أنا المساعد الآلي لـ Where To Spot 🤖 بساعدك بسرعة، ولو حابب تكلم حد من الفريق اختار «كلّم فريقنا».', 'en' => 'I’m Where To Spot’s automatic assistant 🤖 here to help fast. To talk to someone from the team, choose “Talk to us”.']],
        ],
        'faq_v' => 1, // the hidden answers were added once to settings saved before them
        'ads' => [], // ad id => product id: a chat from that ad gets the product first
        'ad_offers' => [], // ad id => ['ar' => …, 'en' => …]: the ad's offer, under its product in the first answer
    ];
}

function bot_cfg(): array
{
    $d = bot_defaults();
    $s = wa_setting('bot', null);
    if (!is_array($s)) return $d;
    $cfg = array_replace($d, array_intersect_key($s, $d));
    // Texts the bot suggested before, never edited: the current suggestion replaces them.
    foreach (BOT_OLD_TEXTS as $key => $olds) if (in_array($cfg[$key]['ar'] ?? '', $olds, true)) $cfg[$key] = $d[$key];
    $def = array_column($d['items'], null, 'id');
    foreach ($cfg['items'] as &$it) {
        $id = $it['id'] ?? '';
        if (isset(BOT_OLD_ANSWERS[$id], $def[$id]) && in_array($it['answer']['ar'] ?? '', BOT_OLD_ANSWERS[$id], true)) $it['answer'] = $def[$id]['answer'];
    }
    unset($it);
    // Settings saved before the hidden everyday answers existed get them once.
    if (empty($s['faq_v'])) {
        $have = array_column($cfg['items'], 'id');
        foreach ($d['items'] as $x) if (!empty($x['hidden']) && !in_array($x['id'], $have, true)) $cfg['items'][] = $x;
        $cfg['faq_v'] = 1;
    }
    // Saved before the bot could look orders up: "My order" with its first, unchanged text now does.
    foreach ($cfg['items'] as &$it) {
        if (($it['id'] ?? '') === 'prices' && ($it['answer']['ar'] ?? '') === "أسعار منتجات تقييمات جوجل 👇\n{prices:nfc,stands}\n\nكل المنتجات والأسعار: {shop}") {
            foreach ($d['items'] as $def) if ($def['id'] === 'prices') $it['answer'] = $def['answer'];
        }
        if (($it['id'] ?? '') === 'track' && ($it['action'] ?? '') === 'human' && ($it['answer']['ar'] ?? '') === 'ابعتلنا رقم الطلب أو رقم الموبايل اللي طلبت بيه، وحد من الفريق هيرد عليك بحالة طلبك 📦') {
            foreach ($d['items'] as $def) if ($def['id'] === 'track') { $it['action'] = 'orders'; $it['answer'] = $def['answer']; $it['keywords'] = $def['keywords']; }
        }
    }
    unset($it);
    return $cfg;
}

// The bot's earlier suggested texts (Arabic), replaced by the current suggestion when left unchanged.
const BOT_OLD_TEXTS = [
    'welcome' => ["أهلًا بحضرتك في Where To Spot 👋\nاختار اللي محتاجه من القائمة وهترد عليك فورًا."],
    'retry' => ["معلش مافهمتش طلبك 🙏\nاختار من القائمة، أو اختار «كلّم فريقنا» وحد من الفريق هيرد عليك."],
];
const BOT_OLD_ANSWERS = [
    'prices' => ["أسعار منتجات تقييمات جوجل 👇\n{prices:nfc,stands}\n\nكل المنتجات والأسعار: {shop}", "أسعارنا تبدأ من 👇\n{prices:nfc,stands}\n\nقولّي محتاج كارت ولا ستاند، وأبعتلك صورته وسعره 😊"],
    'how' => ["الفكرة بسيطة 👌\nعميلك يقرّب موبايله من الكارت أو الستاند، فتفتح له صفحة تقييمك على جوجل على طول، من غير أي تطبيق.\nوالستاند عليه كمان كود QR لأي موبايل مفيهوش NFC.\nبنجهّزه على رابط نشاطك، وتقدر تغيّر الرابط في أي وقت."],
    'delivery' => ["🚚 التوصيل لكل محافظات مصر خلال 2–5 أيام عمل، ومصاريف الشحن بتظهر لك قبل ما تأكد الطلب.\n💳 الدفع عند الاستلام، أو بالبطاقة، أو المحافظ الإلكترونية، أو إنستاباي.\n↩️ استرجاع خلال 14 يوم."],
    'order' => ["تقدر تطلب أونلاين في دقيقة 👇\n{shop}\nاختار المنتج، اكتب عنوانك، وادفع عند الاستلام أو أونلاين.\nلو حابب نساعدك في الطلب، اختار «كلّم فريقنا»."],
];
// Words pointing at what the bot just showed ("بكام ده؟", "سعرها").
const BOT_THIS = 'ده, دي, دا, دى, ديه, داه, سعره, سعرها, بتاعه, بتاعها, منه, منها, this, it, that one';

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
// More ways customers ask, for the suggested menu items (on top of the keywords in Settings).
const BOT_SYNONYMS = [
    'prices' => 'بكم, كم سعر, سعره, سعرها, اسعاركم, التكلفه, تكلفه, عرض, العرض, خصم, مقاسات, المقاسات, مقاس, باكدج, الباكدج, باكيدج, بكام ده, offer, discount, package, size, sizes',
    'how' => 'تفاصيل, التفاصيل, شرح, يعني ايه, فكره, بيعمل ايه, بتشتغل, ازاي استخدم, محتاج ابلكيشن, تطبيق, برنامج, details, explain, app',
    'delivery' => 'بتوصلوا, توصلوا, بتشحنوا, الشحن كام, مصاريف الشحن, اسكندريه, المحافظات, كاش, فيزا, فلوس, pay, visa',
    'order' => 'عايز اشتري, عاوز اشتري, حابب اطلب, اطلبه, ازاي اطلب, طريقه الطلب, خدها, هاخد, هطلب, buy, checkout',
    'track' => 'وصل فين, اوردر, شحنتي, امتي يوصل, لسه موصلش, متابعه الطلب',
];

// Close enough for a typo ("التوصل" for "التوصيل"): one letter off, in a word of 4 letters or more.
function bot_near(string $norm, string $kw): bool
{
    if (mb_strlen($kw) < 4 || strpos($kw, ' ') !== false) return false;
    $k = preg_split('//u', $kw, -1, PREG_SPLIT_NO_EMPTY);
    $words = [];
    // "الاثيوبي" ~ "اثيوبيا": also without the Arabic "ال" / "بال" / "وال" in front.
    foreach (preg_split('/\s+/u', $norm) as $w) { $words[] = $w; if (preg_match('/^(?:وال|بال|ال)(.{3,})$/u', $w, $m)) $words[] = $m[1]; }
    foreach ($words as $w) {
        if (abs(mb_strlen($w) - count($k)) > 1 || mb_strlen($w) < 4) continue;
        $a = preg_split('//u', $w, -1, PREG_SPLIT_NO_EMPTY);
        // Levenshtein on letters (PHP's counts bytes, and an Arabic letter is two).
        $prev = range(0, count($k));
        foreach ($a as $i => $ca) {
            $cur = [$i + 1];
            foreach ($k as $j => $ck) $cur[] = min($prev[$j + 1] + 1, $cur[$j] + 1, $prev[$j] + ($ca === $ck ? 0 : 1));
            $prev = $cur;
        }
        if (end($prev) <= 1) return true;
    }
    return false;
}

function bot_match(string $norm, array $items): ?array
{
    $scores = [];
    foreach ($items as $i => $it) {
        $words = array_merge(bot_words((string) $it['keywords']), bot_words(BOT_SYNONYMS[$it['id']] ?? ''));
        $hits = array_values(array_unique(array_filter($words, function ($kw) use ($norm) { return bot_hit($norm, $kw); })));
        // Nothing exact: a typo of a keyword counts too.
        if (!$hits) $hits = array_values(array_unique(array_filter($words, function ($kw) use ($norm) { return bot_near($norm, $kw); })));
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

// Every item the bot understands (menu buttons and hidden answers), with a title in both languages.
function bot_items(array $cfg): array
{
    $out = [];
    foreach ((array) $cfg['items'] as $it) {
        if (!is_array($it) || empty($it['id']) || trim((string) ($it['title']['ar'] ?? '')) === '' || trim((string) ($it['title']['en'] ?? '')) === '') continue;
        $out[] = $it;
        if (count($out) >= BOT_MAX_ALL) break;
    }
    return $out;
}

// The menu: the items shown as buttons (not the hidden ones).
function bot_buttons(array $cfg): array
{
    return array_slice(array_values(array_filter(bot_items($cfg), function ($it) { return empty($it['hidden']); })), 0, BOT_MAX_ITEMS);
}

// The item that answers prices ({prices…} or {ask_kind…} in its answer).
function bot_prices_item(array $items): ?array
{
    foreach ($items as $x) if (($x['action'] ?? '') === 'answer' && preg_match('/\{(prices|ask_kind)/', json_encode($x['answer'], JSON_UNESCAPED_UNICODE))) return $x;
    return null;
}

function bot_ctx(array $chat): array
{
    $c = json_decode((string) ($chat['bot_ctx'] ?? ''), true);
    return is_array($c) ? $c : [];
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
// $ai: whether Claude may answer (default: when AI answers are on and ready).
function bot_plan(array $chat, string $kind, string $text, string $tap = '', ?array $cfg = null, ?bool $ai = null): ?array
{
    $cfg = $cfg ?? bot_cfg();
    if (empty($cfg['on']) || empty($cfg['channels'][sm_channel($chat)]) || $kind === 'reaction' || bot_quiet($chat, $cfg)) return null;
    $items = bot_items($cfg);
    if (!$items) return null;
    $since = time() - max(1, (int) $cfg['pause_hours']) * 3600;
    $fresh = ($chat['bot'] ?? '') !== 'on' || !$chat['last_in_at'] || strtotime($chat['last_in_at'] . ' UTC') < $since;
    $lang = bot_lang(in_array($kind, ['text', 'button', 'interactive'], true) ? $text : '', $chat);
    // What the bot showed last in this conversation (none in a new one).
    $ctx = $fresh ? [] : bot_ctx($chat);
    $priceIt = bot_prices_item($items);
    $adPid = $fresh ? bot_ad_product($cfg, $chat) : '';
    $said = $tap === '' ? bot_norm($text) : '';
    $plan = function (string $do, ?array $item, string $how, array $more = []) use ($fresh, &$lang, $said) { return ['do' => $do, 'item' => $item, 'lang' => $lang, 'how' => $how, 'fresh' => $fresh, 'said' => $said] + $more; };
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
    // The guided price questions: a kind of product (or all prices), then one product.
    if (preg_match('/^bot:k:([\w-]+)$/', $tap, $m)) { if (in_array($chat['bot_lang'] ?? '', ['ar', 'en'], true)) $lang = $chat['bot_lang']; return $m[1] === '_all' ? $plan('allprices', $priceIt, 'tap') : $plan('kind', $priceIt, 'tap', ['kindKey' => $m[1]]); }
    // "🛒 اطلبه" under a product card: that product's order link.
    // Ordering in the chat: the product, then its size (when it has several), then name and address.
    if ($tap === 'bot:chatorder' && !empty($ctx['last'])) { if (in_array($chat['bot_lang'] ?? '', ['ar', 'en'], true)) $lang = $chat['bot_lang']; return $plan('co_start', null, 'tap', ['products' => [$ctx['last']]]); }
    if ($tap === 'bot:buy') { if (in_array($chat['bot_lang'] ?? '', ['ar', 'en'], true)) $lang = $chat['bot_lang']; return !empty($ctx['last']) ? $plan('order_last', null, 'tap', ['products' => [$ctx['last']]]) : $plan('welcome', null, 'tap'); }
    if (preg_match('/^bot:p:([\w-]+)$/', $tap, $m)) { if (in_array($chat['bot_lang'] ?? '', ['ar', 'en'], true)) $lang = $chat['bot_lang']; return $plan('product', $priceIt, 'tap', ['products' => [$m[1]]]); }
    if ($tap === 'bot:_more') { if (in_array($chat['bot_lang'] ?? '', ['ar', 'en'], true)) $lang = $chat['bot_lang']; return $plan('more', null, 'tap'); }
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
    // The order in the chat, step by step (Settings never needed: the product's own sizes).
    $wait = $fresh ? '' : (string) ($chat['bot_wait'] ?? '');
    if ($wait === 'size' && !empty($ctx['co'])) {
        $sizes = [];
        foreach (load_products(true) as $x) if ($x['id'] === $ctx['co']) $sizes = wa_product_brief($x, $lang === 'ar')['sizes'];
        $pickSize = null;
        if (preg_match('/^\d{1,2}$/', $norm) && isset($sizes[(int) $norm - 1])) $pickSize = $sizes[(int) $norm - 1]['label'];
        foreach ($sizes as $z) if ($pickSize === null && bot_hit($norm, bot_norm(str_replace(['×', 'x', 'cm', 'سم'], ' ', $z['label'])))) $pickSize = $z['label'];
        if ($pickSize === null) foreach ($sizes as $z) { preg_match_all('/\d+/', $z['label'], $d); if ($d[0] && count(array_intersect($d[0], preg_split('/\D+/', $norm))) === count($d[0])) $pickSize = $z['label']; }
        if ($pickSize !== null) return $plan('co_details', null, 'size', ['products' => [$ctx['co']], 'size' => $pickSize]);
    }
    if ($wait === 'details' && !empty($ctx['co']) && count(explode(' ', $norm)) >= 2 && !bot_has($norm, BOT_THANKS . ', ' . $cfg['human_words'])) {
        return $plan('handover', null, 'order', ['say' => 'ordered', 'products' => [$ctx['co']], 'size' => (string) ($ctx['size'] ?? ''), 'details' => str_in($text, 600), 'orderRequest' => true]);
    }
    // "2": the second product of the list it just sent, else the second line of the menu.
    if (!$fresh && preg_match('/^\d{1,2}$/', $norm)) {
        $n = (int) $norm - 1;
        if (!empty($ctx['list']) && isset($ctx['list'][$n])) return $plan('product', $priceIt, 'pick', ['products' => [$ctx['list'][$n]]]);
        $menu = bot_buttons($cfg);
        if (isset($menu[$n])) return $pick($menu[$n], 'number');
    }
    $it = bot_match($norm, $items);
    // First message from an ad ("سعر الباكدج؟", "الأسعار والمقاسات المتاحة", "تفاصيل الاستاندات…"): the ad's
    // product, all its sizes and prices and the ad's offer, in one message, instead of asking "which one?".
    if ($fresh && $adPid !== '' && (!$it || in_array($it['id'], ['prices', 'order', 'how', 'design', 'hi', 'work'], true) || bot_about_products($it))) {
        $named = array_column(bot_products_named($norm), 'id');
        if (!$named || in_array($adPid, $named, true)) return $plan('adcard', $priceIt, 'ad', ['products' => [$adPid], 'adId' => (string) $chat['ad_id']]);
    }
    // A product named ("كارت", "عايز ستاند A5", "الأبيض"), unless they asked something else about it (how it
    // works, delivery…): its photo card or its price, like a salesperson would answer. Several match: the ones
    // it just showed come first ("الأبيض" after the two cards).
    if ((!$it || bot_about_products($it)) && ($found = bot_products_named($norm))) {
        if (count($found) > 1 && ($ctx['list'] ?? $ctx['last'] ?? null)) {
            $near = array_values(array_filter($found, function ($p) use ($ctx) { return in_array($p['id'], (array) ($ctx['list'] ?? []), true) || $p['id'] === ($ctx['last'] ?? ''); }));
            if (!$near && !empty($ctx['last'])) { $k = ''; foreach (load_products(true) as $p) if ($p['id'] === $ctx['last']) $k = bot_kind($p); $near = array_values(array_filter($found, function ($p) use ($k) { return $k !== '' && bot_kind($p) === $k; })); }
            if ($near) $found = $near;
        }
        $order = $it && $it['id'] === 'order';
        if ($order && count($found) === 1) return $plan('order_last', $it, 'product', ['products' => [$found[0]['id']]]);
        return $plan('product', $it && bot_about_products($it) && !$order ? $it : $priceIt, 'product', ['products' => array_column($found, 'id')]);
    }
    // About what it just showed: "بكام ده؟" → that product's price; "اطلبه" → that product's link.
    if (!empty($ctx['last'])) {
        $this_ = bot_has($norm, BOT_THIS);
        if ($it && $it['id'] === 'order') return $plan('order_last', $it, 'context', ['products' => [$ctx['last']]]);
        if (($it && $priceIt && $it['id'] === $priceIt['id']) || (!$it && $this_)) return $plan('product_price', $priceIt, 'context', ['products' => [$ctx['last']]]);
    }
    if ($it) return $pick($it, 'keyword');
    $short = count(explode(' ', $norm)) <= 4;
    // "Thanks" after an order update or an answer: nothing to add, even at the start of a conversation.
    if ($short && bot_has($norm, BOT_THANKS) && !bot_has($norm, BOT_HELLO)) return $plan('ignore', null, 'thanks');
    $hello = $short && bot_has($norm, BOT_HELLO);
    // "بتعملوا علب؟": not something it knows we sell: say so honestly and ask the team (not "didn't get that").
    if (!$hello && !$it && bot_has($norm, BOT_ASK_HAVE) && !($ai ?? (function_exists('ai_ready') && ai_ready()))) return $plan('handover', null, 'unknown', ['say' => 'unknown']);
    // Not understood by the menus and keywords: Claude answers (api/ai.php), unless it's just a hello.
    // A real question at the start of a chat goes to it too, rather than the welcome.
    if (!$hello && ($ai ?? (function_exists('ai_ready') && ai_ready())) && (!$fresh || count(explode(' ', $norm)) >= 3)) return $plan('ai', null, 'ai');
    if ($fresh || $hello) return $plan('welcome', null, $fresh ? 'first' : 'hello');
    if ((int) $chat['bot_fails'] + 1 >= max(1, (int) $cfg['fails'])) return $plan('handover', null, 'not understood');
    return $plan('retry', null, 'not understood');
}

// An item whose answer is about the products (prices, ordering): a named product answers it better.
function bot_about_products(array $it): bool
{
    return $it['action'] === 'answer' && preg_match('/\{(prices|products|shop|ask_kind)/', json_encode($it['answer'], JSON_UNESCAPED_UNICODE));
}

const BOT_KIND_ICON = ['card' => '💳', 'keychain' => '🔑', 'stand' => '🪧', 'coaster' => '🟦', 'coffee' => '☕', 'serum' => '🧴', 'cream' => '🧴', 'cleanser' => '🧼', 'wash' => '🧼', 'plan' => '📈'];

// The kinds of product in these categories (most products first), for the "which one?" buttons.
function bot_kinds(?array $cats): array
{
    $n = [];
    foreach (load_products(true) as $p) {
        if ($cats && !in_array($p['cat'], $cats, true)) continue;
        if (($k = bot_kind($p)) !== '' && wa_product_brief($p, true)['inStock']) $n[$k] = ($n[$k] ?? 0) + 1;
    }
    arsort($n);
    return array_keys($n);
}

// Buttons for those kinds: all of them, or (WhatsApp, more than 3) the first two and "All prices".
function bot_kind_buttons(array $kinds, string $lang, bool $three): array
{
    $b = [];
    foreach ($kinds as $k) $b[] = ['id' => 'bot:k:' . $k, 'title' => mb_substr((BOT_KIND_ICON[$k] ?? '•') . ' ' . BOT_KIND_NAMES[$k][$lang === 'ar' ? 0 : 1], 0, BOT_TITLE_MAX)];
    $all = ['id' => 'bot:k:_all', 'title' => $lang === 'ar' ? '☰ كل الأسعار' : '☰ All prices'];
    if ($three && count($b) > 3) return array_merge(array_slice($b, 0, 2), [$all]);
    return array_merge($b, count($b) > 1 ? [$all] : []);
}

// "1️⃣ name: price" lines for a short list the customer answers with a number.
function bot_numbered(array $products, bool $ar): string
{
    $nums = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣'];
    $out = [];
    foreach (array_values($products) as $i => $p) $out[] = ($nums[$i] ?? ($i + 1) . '.') . ' ' . ltrim(bot_price_line($p, $ar), '• ');
    return implode("\n", $out);
}

// One product: its photo card. Several: a short numbered list; the customer answers with a number or a name.
function bot_product_reply(array $found, bool $ar): array
{
    if (count($found) === 1) return ['text' => bot_card_text($found[0], $ar), 'menu' => true, 'card' => $found[0]];
    $found = array_slice(array_values($found), 0, 9);
    return ['text' => bot_numbered($found, $ar) . "\n\n" . ($ar ? 'ابعتلي رقم اللي يعجبك وأبعتلك صورته 😊' : 'Send me the number you like and I’ll send its photo 😊'),
        'menu' => true, 'list_ids' => array_column($found, 'id')];
}

// What the bot says for a plan: the text, and whether the menu goes with it.
function bot_reply(array $plan, array $cfg): array
{
    $lang = $plan['lang'];
    $ar = $lang === 'ar';
    $it = $plan['item'];
    switch ($plan['do']) {
        case 'welcome': return ['text' => bot_fill((string) $cfg['welcome'][$lang], $ar), 'menu' => true];
        case 'product':
        case 'product_price':
        case 'order_last':
            $found = array_values(array_filter(load_products(true), function ($p) use ($plan) { return in_array($p['id'], $plan['products'], true); }));
            if (!$found) return ['text' => bot_fill((string) $cfg['welcome'][$lang], $ar), 'menu' => true];
            if ($plan['do'] === 'product') return bot_product_reply($found, $ar);
            $p = $found[0];
            $i = wa_product_brief($p, $ar);
            if ($plan['do'] === 'order_last') return ['text' => ($ar ? 'تمام 👌 اطلب ' : 'Great 👌 Order ') . $i['title'] . ($ar ? ' من هنا في دقيقة:' : ' here in a minute:') . "\n" . seo_product_url($p['id'], $ar)
                . "\n" . ($ar ? 'أو نسجله لك هنا في الشات 👇' : 'Or we can take your order right here in the chat 👇'), 'menu' => true, 'keep' => true,
                'buttons' => array_merge([['id' => 'bot:chatorder', 'title' => $ar ? '📝 سجّله هنا' : '📝 Order in chat']], array_slice(bot_card_buttons($p, $lang, $cfg), 1))];
            return ['text' => '💰 ' . ltrim(bot_price_line($p, $ar), '• ') . "\n🛒 " . seo_product_url($p['id'], $ar), 'menu' => true, 'keep' => true];
        case 'adcard':
            $found = array_values(array_filter(load_products(true), function ($p) use ($plan) { return in_array($p['id'], $plan['products'], true); }));
            if (!$found) return ['text' => bot_fill((string) $cfg['welcome'][$lang], $ar), 'menu' => true];
            $offer = trim((string) ($cfg['ad_offers'][$plan['adId'] ?? '']['' . $lang] ?? ''));
            $t = ($ar ? 'أهلًا بيك 👋' : 'Hi 👋') . "\n" . bot_card_text($found[0], $ar, true) . ($offer !== '' ? "\n\n🔥 " . $offer : '')
                . "\n\n" . ($ar ? 'تحب أجهزلك أنهي مقاس؟ 😊' : 'Which size shall I prepare for you? 😊');
            // "Which size?" was asked: a size in the reply goes straight on to the order.
            $many = count(wa_product_brief($found[0], $ar)['sizes']) > 1;
            return ['text' => $t, 'menu' => true, 'card' => $found[0]] + ($many ? ['wait' => 'size', 'ctx' => ['co' => $found[0]['id'], 'last' => $found[0]['id']]] : []);
        case 'co_start':
        case 'co_details':
            $found = array_values(array_filter(load_products(true), function ($p) use ($plan) { return in_array($p['id'], $plan['products'], true); }));
            if (!$found) return ['text' => bot_fill((string) $cfg['welcome'][$lang], $ar), 'menu' => true];
            $sizes = wa_product_brief($found[0], $ar)['sizes'];
            if ($plan['do'] === 'co_start' && count($sizes) > 1) {
                $nums = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣'];
                $lines = [];
                foreach (array_slice($sizes, 0, 9) as $i => $z) $lines[] = $nums[$i] . ' ' . $z['label'] . ': ' . ($ar ? number_format($z['price']) . ' ج.م' : 'EGP ' . number_format($z['price']));
                return ['text' => ($ar ? 'تمام 👌 أنهي مقاس؟ ابعتلي رقمه 👇' : 'Great 👌 Which size? Send me its number 👇') . "\n" . implode("\n", $lines), 'menu' => false, 'wait' => 'size', 'ctx' => ['co' => $found[0]['id'], 'last' => $found[0]['id']]];
            }
            $size = (string) ($plan['size'] ?? ($sizes[0]['label'] ?? ''));
            return ['text' => ($ar ? 'تمام 👌 ' . wa_product_brief($found[0], true)['title'] . ($size !== '' && count($sizes) > 1 ? ' · ' . $size : '') . "\nابعتلي في رسالة واحدة: الاسم، المحافظة والعنوان، والعدد لو أكتر من واحد 📝"
                : 'Great 👌 ' . wa_product_brief($found[0], false)['title'] . ($size !== '' && count($sizes) > 1 ? ' · ' . $size : '') . "\nSend me in one message: your name, governorate and address, and how many if more than one 📝"),
                'menu' => false, 'wait' => 'details', 'ctx' => ['co' => $found[0]['id'], 'size' => count($sizes) > 1 ? $size : '', 'last' => $found[0]['id']]];
        case 'kind':
            $list = array_values(array_filter(load_products(true), function ($p) use ($plan) { return bot_kind($p) === $plan['kindKey'] && wa_product_brief($p, true)['inStock']; }));
            if (!$list) return ['text' => bot_fill('{prices}', $ar), 'menu' => true];
            if (count($list) === 1) return bot_product_reply($list, $ar);
            $r = bot_product_reply($list, $ar);
            $r['text'] = (BOT_KIND_ICON[$plan['kindKey']] ?? '') . ' ' . BOT_KIND_NAMES[$plan['kindKey']][$ar ? 0 : 1] . ' 👇' . "\n" . $r['text'];
            return $r;
        case 'allprices':
            $raw = (string) ($it['answer'][$lang] ?? '');
            $cats = preg_match('/\{(?:prices|ask_kind):([a-z0-9_,-]+)\}/i', $raw, $m) ? $m[1] : '';
            return ['text' => bot_fill('{prices' . ($cats !== '' ? ':' . $cats : '') . '}', $ar), 'menu' => true];
        case 'more': return ['text' => $ar ? 'كل الاختيارات 👇' : 'All the options 👇', 'menu' => true, 'list' => true];
        case 'retry': return ['text' => bot_fill((string) $cfg['retry'][$lang], $ar), 'menu' => true];
        case 'handover':
            if (($plan['say'] ?? '') === 'ordered') return ['text' => $ar ? "تمام ✅ سجلنا طلبك.\nحد من الفريق هيكلمك دلوقتي يأكده معاك ويقولك مصاريف الشحن 🙏" : "Done ✅ We’ve got your order.\nSomeone from the team will contact you now to confirm it and the delivery fee 🙏", 'menu' => false];
            if (($plan['say'] ?? '') === 'unknown') return ['text' => $ar ? "سؤال حلو 👌 هسأل الفريق عن ده ويردوا عليك في أقرب وقت.\nوعلى ما يردوا، دي كل منتجاتنا: " . seo_base() . '/ar' : "Good question 👌 I’ll check with the team and they’ll reply shortly.\nMeanwhile, here’s everything we sell: " . seo_base(), 'menu' => false];
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
            $raw = (string) ($it['answer'][$lang] ?? '');
            if (strpos($raw, '{prices') !== false) {
                // The product they named, or the ad they came from: its photo card. Several: just those, short.
                $found = bot_products_named((string) ($plan['said'] ?? ''));
                if (!$found && !empty($plan['adProduct'])) foreach (load_products(true) as $p) if ($p['id'] === $plan['adProduct']) $found = [$p];
                if ($found) return bot_product_reply($found, $ar);
            }
            // "Which one?" with a button per kind of product (cards, stands…), instead of every price at once.
            $buttons = null;
            if (preg_match('/\{ask_kind(?::([a-z0-9_,-]+))?\}/i', $raw, $m)) {
                $kinds = bot_kinds(!empty($m[1]) ? explode(',', strtolower($m[1])) : null);
                $raw = str_replace($m[0], '', $raw);
                if (count($kinds) > 1) $buttons = bot_kind_buttons($kinds, $lang, !empty($plan['three']));
                else $raw .= "\n" . '{prices' . (!empty($m[1]) ? ':' . $m[1] : '') . '}';
            }
            $t = bot_fill($raw, $ar);
            // The first message of a conversation answered straight away still gets a hello.
            if ($plan['fresh']) $t = trim(strtok((string) $cfg['welcome'][$lang], "\n")) . "\n\n" . $t;
            return ['text' => $t, 'menu' => true] + ($buttons ? ['buttons' => $buttons] : []);
    }
    return ['text' => '', 'menu' => false];
}

// {shop}: the shop's link. {prices:nfc,stands}: one line per category, its lowest price and its page.
// {products:nfc}: every product of those categories with its price.
function bot_fill(string $text, bool $ar): string
{
    $text = str_replace('{shop}', seo_base() . ($ar ? '/ar' : ''), $text);
    if (strpos($text, '{team_hours}') !== false) {
        $h = function_exists('au_cfg') ? au_cfg()['hours'] : ['on' => false];
        $text = str_replace('{team_hours}', !empty($h['on']) ? ($ar ? 'فريقنا متاح ' . au_hours_text($h, true) . '، والطلب أونلاين شغال 24 ساعة 🛒' : 'Our team is available ' . au_hours_text($h, false) . ', and online ordering is open 24 hours 🛒')
            : ($ar ? 'الطلب أونلاين شغال 24 ساعة 🛒 وفريقنا بيرد في أسرع وقت.' : 'Online ordering is open 24 hours 🛒 and our team replies as soon as possible.'), $text);
    }
    $text = preg_replace_callback('/\{prices(?::([a-z0-9_,-]+))?\}/i', function ($m) use ($ar) {
        // One line per kind of product (cards, keychains, stands, coasters…), so a cheap coaster doesn't
        // make "stands from 45" — then one link to see them all with photos.
        $cats = db()->query('SELECT key, label, label_ar FROM categories ORDER BY sort')->fetchAll(PDO::FETCH_UNIQUE);
        $want = !empty($m[1]) ? explode(',', strtolower($m[1])) : array_keys($cats);
        $low = [];
        foreach (load_products(true) as $p) {
            if (!in_array($p['cat'], $want, true)) continue;
            $i = wa_product_brief($p, $ar);
            if (!$i['inStock']) continue;
            $k = bot_kind($p);
            $c = $cats[$p['cat']] ?? ['label' => $p['cat'], 'label_ar' => ''];
            $name = BOT_KIND_NAMES[$k][$ar ? 0 : 1] ?? ($ar && $c['label_ar'] !== '' ? $c['label_ar'] : $c['label']);
            $low[$name] = min($low[$name] ?? PHP_INT_MAX, $i['low']);
        }
        $lines = [];
        foreach ($low as $name => $n) $lines[] = '• ' . $name . ': ' . ($ar ? 'من ' . number_format($n) . ' ج.م' : 'from EGP ' . number_format($n));
        return implode("\n", $lines) . ($lines ? "\n\n🛒 " . ($ar ? 'كلها بالصور: ' : 'All with photos: ') . seo_base() . ($ar ? '/ar' : '') : '');
    }, $text);
    return trim(preg_replace_callback('/\{products(?::([a-z0-9_,-]+))?\}/i', function ($m) use ($ar) {
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
    if ($plan['do'] === 'ai') {
        // Claude takes a moment anyway: "typing…" without the extra pause, then its answer (or the team).
        bot_typing($chat, (string) ($plan['wamid'] ?? ''), false);
        ai_reply_later($chat, $plan);
        db()->prepare("UPDATE wa_chats SET bot = 'on', bot_at = datetime('now'), bot_fails = 0, bot_lang = ?, bot_wait = '' WHERE id = ?")->execute([$lang, (int) $chat['id']]);
        return;
    }
    if ($plan['do'] !== 'ignore' && !empty($cfg['typing'])) bot_typing($chat, (string) ($plan['wamid'] ?? ''));
    if ($plan['do'] !== 'ignore') {
        // A chat from an ad starts with the ad's product (Settings → Chat bot → Ads).
        $pid = bot_ad_product($cfg, $chat);
        $plan['adProduct'] = $pid;
        $plan['three'] = sm_channel($chat) === 'wa' && !empty($cfg['wa_buttons']);
        $r = bot_reply($plan, $cfg);
        $skip = (string) ($plan['item']['id'] ?? '');
        // A chat from an ad starts with the ad's product (Settings → Chat bot → Ads), unless the answer is that card.
        $adCard = !empty($r['card']) && $r['card']['id'] === $pid;
        if ($pid !== '' && $plan['fresh'] && !$adCard && $plan['do'] !== 'handover' && !bot_sent_product($chat, $pid)) {
            // Just the photo and its text: the buttons come with the message right after it.
            try { bot_mark(wa_send_product($chat, $pid, $lang === 'ar', null)); bot_event($chat, 'ad_product', $pid, 'ad'); }
            catch (Throwable $e) { error_log('[shop] bot ad product: ' . $e->getMessage()); }
        }
        if (!empty($r['card'])) {
            bot_send_card($chat, $r['card'], $lang, $cfg, $r['text'], $skip);
            if ($adCard) bot_event($chat, 'ad_product', $pid, 'ad');
        } elseif ($r['text'] !== '') bot_send($chat, $r['text'], $r['menu'], $lang, $cfg, BOT_VIA, $skip, !empty($r['list']), null, $r['buttons'] ?? null);
    }
    $state = bot_takes($plan) ? 'on' : 'human';
    $fails = $plan['do'] === 'retry' ? (int) $chat['bot_fails'] + 1 : 0;
    $ctx = bot_next_ctx($plan['fresh'] ? [] : bot_ctx($chat), $r ?? []);
    $wait = $plan['do'] === 'ask' ? 'order' : (string) ($r['wait'] ?? '');
    db()->prepare("UPDATE wa_chats SET bot = ?, bot_at = datetime('now'), bot_fails = ?, bot_lang = ?, bot_wait = ?, bot_ctx = ? WHERE id = ?")
        ->execute([$state, $fails, $lang, $wait, $ctx ? json_encode($ctx) : '', (int) $chat['id']]);
    if (!empty($plan['orderRequest'])) { try { bot_order_request($chat, $plan); } catch (Throwable $e) { ops_error('Chat bot', 'An order request from the chat could not be passed on', $e); } }
    // An order lookup that found a problem counts as a handover in the reports.
    bot_event($chat, bot_takes($plan) || $plan['do'] === 'handover' ? $plan['do'] : 'handover', $plan['item']['id'] ?? '', $plan['how'], (string) ($plan['said'] ?? ''));
}

// What the bot remembers after an answer: the product card it sent (last), the numbered list (list).
// Other answers keep the last product (so "اطلبه" still works) and forget the list.
function bot_next_ctx(array $ctx, array $r): array
{
    if (!empty($r['ctx'])) return $r['ctx'];
    if (!empty($r['card'])) return ['last' => $r['card']['id']];
    if (!empty($r['list_ids'])) return array_filter(['list' => $r['list_ids'], 'last' => $ctx['last'] ?? null]);
    if (!empty($r['keep'])) return $ctx;
    return array_filter(['last' => $ctx['last'] ?? null]);
}

// Customers' words for a kind of product, added to the words of each product's name.
const BOT_KINDS = ['card' => 'كارت, كارد, كروت, card', 'keychain' => 'ميداليه, ميداليا, سلسله, keychain', 'coaster' => 'كوستر, coaster', 'stand' => 'ستاند, استاند, ستاندات, stand',
    'coffee' => 'قهوه, بن, coffee', 'blend' => 'قهوه, بن, coffee', 'serum' => 'سيروم, serum', 'cream' => 'كريم, cream', 'cleanser' => 'غسول, cleanser', 'wash' => 'غسول, wash', 'plan' => 'خطه, باقه, plan'];
// What a product is, from its English name (the first kind that fits); '' = none of these.
function bot_kind(array $p): string
{
    foreach (['keychain', 'coaster', 'card', 'stand', 'coffee', 'blend', 'serum', 'cream', 'cleanser', 'wash', 'plan'] as $k) if (preg_match('/\b' . $k . '/i', (string) $p['name'])) return $k === 'blend' ? 'coffee' : $k;
    // Names that don't say it ("Ethiopia Limu"): the category does.
    return ['coffee' => 'coffee', 'services' => 'plan'][$p['cat']] ?? '';
}
const BOT_KIND_NAMES = ['card' => ['كروت NFC', 'NFC cards'], 'keychain' => ['ميداليات NFC', 'NFC keychains'], 'stand' => ['ستاندات', 'Stands'], 'coaster' => ['كوستر QR', 'QR coasters'],
    'coffee' => ['قهوة', 'Coffee'], 'serum' => ['سيروم', 'Serums'], 'cream' => ['كريمات', 'Creams'], 'cleanser' => ['غسول', 'Cleansers'], 'wash' => ['غسول', 'Cleansers'], 'plan' => ['خطط التسويق', 'Marketing plans']];

const BOT_CAT_WORDS = ['coffee' => 'قهوه, بن, coffee', 'cosmetics' => 'سكين كير, عنايه, بشره, skincare, skin care', 'services' => 'تسويق, اعلانات, marketing, ads'];

// Words in many product names that don't tell products apart.
const BOT_PRODUCT_COMMON = 'nfc, qr, google, review, reviews, جوجل, تقييمات, لتقييمات, تقييم, كود, عرض, social, media, payment, سوشيال, ميديا, والدفع, الدفع, display, code, cm, سم, اكريليك, acrylic, shape, شكل, علي, على, with, and, لتقييم, generation, lead';

// The products a message names: the best-matching ones (one = a clear match, up to 5 on a tie).
function bot_products_named(string $norm): array
{
    if ($norm === '') return [];
    $common = array_flip(bot_words(BOT_PRODUCT_COMMON));
    $scores = [];
    foreach (load_products(true) as $p) {
        preg_match_all('/[\p{L}\p{N}]+/u', bot_norm($p['name'] . ' ' . $p['nameAr']), $t);
        $words = array_filter($t[0], function ($w) use ($common) { return mb_strlen($w) >= 2 && !isset($common[$w]); });
        foreach (BOT_KINDS as $en => $list) if (preg_match('/\b' . $en . '/i', $p['name'])) $words = array_merge($words, bot_words($list));
        // Some names don't say what they are ("Ethiopia Limu"): their category does.
        $words = array_merge($words, bot_words(BOT_CAT_WORDS[$p['cat']] ?? ''));
        $s = 0;
        foreach (array_unique($words) as $w) $s += bot_hit($norm, $w) ? (preg_match('/^\d+$/', $w) ? 1 : 2) : (bot_near($norm, $w) ? 1 : 0);
        if ($s) $scores[] = [$s, $p];
    }
    if (!$scores) return [];
    usort($scores, function ($a, $b) { return $b[0] <=> $a[0]; });
    $top = $scores[0][0];
    return array_slice(array_map(function ($x) { return $x[1]; }, array_filter($scores, function ($x) use ($top) { return $x[0] === $top; })), 0, 5);
}

function bot_price_line(array $p, bool $ar): string
{
    $i = wa_product_brief($p, $ar);
    $prices = $i['sizes'] ? array_column($i['sizes'], 'price') : [$i['low']];
    $from = count(array_unique($prices)) > 1 ? ($ar ? 'من ' : 'from ') : '';
    return '• ' . $i['title'] . ': ' . $from . ($ar ? number_format($i['low']) . ' ج.م' : 'EGP ' . number_format($i['low']));
}

// A product in a few lines: name, one line about it, price (sizes when there are 3 or fewer), its page.
// $sizes: every size with its price, one per line (the first answer to an ad, which asks for them).
function bot_card_text(array $p, bool $ar, bool $sizes = false): string
{
    $i = wa_product_brief($p, $ar);
    if ($sizes && count($i['sizes']) > 1) {
        $lines = array_map(function ($z) use ($ar) { return '• ' . $z['label'] . ': ' . ($ar ? number_format($z['price']) . ' ج.م' : 'EGP ' . number_format($z['price'])); }, $i['sizes']);
        return '*' . $i['title'] . "*\n" . implode("\n", $lines) . "\n🛒 " . ($ar ? 'التفاصيل والطلب: ' : 'Details and order: ') . seo_product_url($p['id'], $ar);
    }
    $prices = $i['sizes'] ? array_unique(array_column($i['sizes'], 'price')) : [$i['low']];
    $price = count($prices) > 1 && count($i['sizes']) <= 3 ? seo_price_text($i, $ar) : (count($prices) > 1 ? ($ar ? 'من ' . number_format($i['low']) . ' ج.م (' . count($i['sizes']) . ' مقاسات)' : 'from EGP ' . number_format($i['low']) . ' (' . count($i['sizes']) . ' sizes)') : seo_price_text($i, $ar));
    return '*' . $i['title'] . '*' . "\n💰 " . $price . (!$i['inStock'] ? ' ' . ($ar ? '(غير متوفر حاليًا)' : '(out of stock)') : '')
        . "\n🛒 " . ($ar ? 'التفاصيل والطلب: ' : 'Details and order: ') . seo_product_url($p['id'], $ar);
}

// A product card: WhatsApp — its photo on top, the text, and the menu buttons, in one message.
// Instagram / Messenger — the photo, then the text with the quick replies. $text '' = the card's own text.
// Under a product card, the next step to a sale: order it, see the others of its kind, or ask the team.
function bot_card_buttons(array $p, string $lang, array $cfg): array
{
    $ar = $lang === 'ar';
    $b = [['id' => 'bot:buy', 'title' => $ar ? '🛒 اطلبه' : '🛒 Order it']];
    $k = bot_kind($p);
    if ($k !== '' && count(array_filter(load_products(true), function ($x) use ($k) { return bot_kind($x) === $k; })) > 1) $b[] = ['id' => 'bot:k:' . $k, 'title' => mb_substr((BOT_KIND_ICON[$k] ?? '🔁') . ' ' . ($ar ? 'شوف غيره' : 'See others'), 0, BOT_TITLE_MAX)];
    foreach (bot_buttons($cfg) as $it) if ($it['action'] === 'human') { $b[] = ['id' => 'bot:' . $it['id'], 'title' => mb_substr(trim((string) $it['title'][$lang]), 0, BOT_TITLE_MAX)]; break; }
    return $b;
}

function bot_send_card(array $chat, array $p, string $lang, array $cfg, string $text, string $skip): void
{
    $text = $text !== '' ? $text : bot_card_text($p, $lang === 'ar');
    $buttons = bot_card_buttons($p, $lang, $cfg);
    $photo = $p['images'] ? wa_product_photo((string) $p['images'][0]) : null;
    if (!$photo) { bot_send($chat, $text, true, $lang, $cfg, BOT_VIA, $skip, false, null, $buttons); return; }
    if (sm_channel($chat) !== 'wa' || empty($cfg['wa_buttons'])) {
        $plain = sm_channel($chat) === 'wa' ? $text : str_replace('*', '', $text);
        $id = wa_record_out($chat, '', 'image', '', ['path' => $photo['path'], 'mime' => 'image/jpeg', 'name' => $p['id'] . '.jpg', 'size' => filesize(wa_media_dir() . '/' . $photo['path'])], null, 'sending');
        bot_mark($id);
        wa_send_later($id, (int) $chat['id'], function () use ($chat, $photo) {
            if (sm_channel($chat) !== 'wa') return sm_send_file($chat, $photo['path'], 'image', '');
            return wa_graph('POST', '/' . wa_cfg('phone_number_id') . '/messages', ['messaging_product' => 'whatsapp', 'recipient_type' => 'individual', 'to' => $chat['wa_id'], 'type' => 'image', 'image' => ['id' => bot_media_id($photo, false)]]);
        });
        bot_send($chat, $plain, true, $lang, $cfg, BOT_VIA, $skip, false, null, $buttons);
        return;
    }
    bot_send($chat, $text, true, $lang, $cfg, BOT_VIA, $skip, false, $photo, $buttons);
}

// The product photo's id at Meta, uploaded once and kept 20 days (Meta keeps uploads 30), like wa_send_product().
function bot_media_id(array $photo, bool $fresh): string
{
    $mid = $fresh ? null : wa_setting('pm.' . $photo['key']);
    if (!is_array($mid) || ($mid['at'] ?? 0) < time() - 20 * 86400) {
        $up = wa_graph('POST', '/' . wa_cfg('phone_number_id') . '/media', ['messaging_product' => 'whatsapp', 'type' => 'image/jpeg',
            'file' => new CURLFile(wa_media_dir() . '/' . $photo['path'], 'image/jpeg', 'product.jpg')], true);
        wa_set_setting('pm.' . $photo['key'], $mid = ['id' => (string) $up['id'], 'at' => time()]);
    }
    return (string) $mid['id'];
}

// "typing…" under the customer's message, then a short pause before the answer goes out, as a person would.
// Runs after Meta has its reply (shutdown, before the messages, which are queued after it). Never fails the answer.
function bot_typing(array $chat, string $mid, bool $pause = true): void
{
    register_shutdown_function(function () use ($chat, $mid, $pause) {
        if (function_exists('litespeed_finish_request')) litespeed_finish_request();
        elseif (function_exists('fastcgi_finish_request')) fastcgi_finish_request();
        ignore_user_abort(true);
        try {
            if (sm_channel($chat) === 'wa') {
                // Also shows the customer's message as read (blue ticks), like a person opening it.
                if ($mid !== '') wa_graph('POST', '/' . wa_cfg('phone_number_id') . '/messages', ['messaging_product' => 'whatsapp', 'status' => 'read', 'message_id' => $mid, 'typing_indicator' => ['type' => 'text']]);
            } else sm_graph('POST', '/' . rawurlencode((string) sm_cfg('page_id')) . '/messages', ['recipient' => ['id' => substr((string) $chat['wa_id'], 3)], 'sender_action' => 'typing_on']);
        } catch (Throwable $e) { /* the answer still goes */ }
        if ($pause) usleep(random_int(1500, 2600) * 1000);
    });
}

// The product an ad is about: chosen in Settings → Chat bot → Ads, else read from the ad's own text when
// it names exactly one product. '' = unknown.
function bot_ad_product(array $cfg, array $chat): string
{
    if (($chat['ad_id'] ?? '') === '' && ($chat['ad_headline'] ?? '') === '') return '';
    $ids = array_column(load_products(true), 'id');
    $pid = (string) ($cfg['ads'][$chat['ad_id']] ?? '');
    if ($pid !== '' && in_array($pid, $ids, true)) return $pid;
    $found = bot_products_named(bot_norm(($chat['ad_headline'] ?? '') . ' ' . ($chat['ad_body'] ?? '')));
    return count($found) === 1 ? $found[0]['id'] : '';
}

// Questions about something we may not sell ("بتعملوا علب؟", "عندكم …؟").
const BOT_ASK_HAVE = 'بتعملوا, تعملوا, بتعمل, بتعملو, عندكم, عندك, بتبيعوا, بتصنعوا, في عندكم, فيه عندكم, do you have, do you make, do you sell';

// Ordering in the chat: what the customer chose and what they sent, for the team (lead note + Telegram).
function bot_order_request(array $chat, array $plan): void
{
    $p = null;
    foreach (load_products(true) as $x) if ($x['id'] === ($plan['products'][0] ?? '')) $p = $x;
    if (!$p) return;
    $line = '🛒 ' . $p['name'] . (($plan['size'] ?? '') !== '' ? ' · ' . $plan['size'] : '') . "\n" . trim((string) ($plan['details'] ?? ''));
    if ($chat['lead_id']) {
        $st = db()->prepare('SELECT * FROM leads WHERE id = ?');
        $st->execute([(int) $chat['lead_id']]);
        if ($lead = $st->fetch()) {
            touch_lead($lead, date('Y-m-d') . ' · Order request in the chat: ' . str_replace("\n", ' · ', $line), in_array($lead['status'], ['New', 'Contacted'], true) ? 'Quoted' : null, null);
            db()->prepare('UPDATE leads SET follow_up = ? WHERE id = ?')->execute([date('Y-m-d'), (int) $lead['id']]);
        }
    }
    if (!function_exists('tg_ready') || !tg_ready()) return;
    $fresh = wa_chat_by_wa_id((string) $chat['wa_id']) ?: $chat;
    $head = '🔥 Order request in the chat · طلب من الشات' . "\n" . tg_h($line);
    $sent = [];
    foreach (array_merge(tg_chat_recipients($fresh), tg_managers()) as $u) {
        if (isset($sent[(int) $u['id']])) continue;
        $sent[(int) $u['id']] = true;
        tg_send_user($u, tg_chat_text($fresh, $head), tg_open_button($fresh));
    }
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

function bot_event(array $chat, string $kind, string $item, string $how, string $said = ''): void
{
    db()->prepare("INSERT INTO bot_events (chat_id, kind, item, how, said, created_at) VALUES (?, ?, ?, ?, ?, datetime('now'))")->execute([(int) $chat['id'], $kind, $item, $how, mb_substr($said, 0, 200)]);
}

// The bot's messages say so in the chat ("🤖 Bot", "📦 Order update" instead of a team member's name).
function bot_mark(int $messageId, string $via = BOT_VIA): void
{
    db()->prepare('UPDATE wa_messages SET meta = ? WHERE id = ?')->execute([json_encode(['via' => $via, 'bot' => 1], JSON_UNESCAPED_UNICODE), $messageId]);
}

// A text with the menu under it: a WhatsApp list (one "Menu" button that opens the choices), or
// quick-reply buttons on Instagram and Messenger. The chat history shows the choices under the text.
// $skip: the item just answered (not offered again as a button); $list: the full list even with buttons on.
// $photo: a product photo on top (WhatsApp buttons only).
// $buttons: these choices instead of the menu (e.g. the kinds of product).
function bot_send(array $chat, string $text, bool $withMenu, string $lang, array $cfg, string $via = BOT_VIA, string $skip = '', bool $list = false, ?array $photo = null, ?array $buttons = null): void
{
    $rows = [];
    foreach (bot_buttons($cfg) as $it) $rows[] = ['id' => 'bot:' . $it['id'], 'title' => mb_substr(trim((string) $it['title'][$lang]), 0, BOT_TITLE_MAX)];
    if ($buttons) { $rows = $buttons; $skip = ''; }
    if (!$withMenu || !$rows) { bot_mark(wa_send_text($chat, $text, null, false, true), $via); return; }
    $ch = sm_channel($chat);
    if ($ch === 'wa') {
        // A list's text holds 1024 characters: a long answer goes first on its own, the menu after it.
        if (mb_strlen($text) > 1000) { bot_mark(wa_send_text($chat, $text, null, false, true), $via); $text = $lang === 'ar' ? 'اختار من القائمة 👇' : 'Pick from the menu 👇'; }
        $label = mb_substr(trim((string) $cfg['menu'][$lang]) ?: 'Menu', 0, 20);
        if (!empty($cfg['wa_buttons']) && !$list) {
            // Buttons right under the message: all of them when there are 3 or fewer, else the first two
            // (not the one just answered) and "More options".
            $btns = count($rows) <= 3 || $buttons ? $rows : array_values(array_filter($rows, function ($r) use ($skip) { return $r['id'] !== 'bot:' . $skip; }));
            if (count($btns) > 3) $btns = array_merge(array_slice($btns, 0, 2), [['id' => 'bot:_more', 'title' => mb_substr(trim((string) ($cfg['more'][$lang] ?? '')) ?: '☰', 0, 20)]]);
            $rows = $btns;
            $body = ['messaging_product' => 'whatsapp', 'recipient_type' => 'individual', 'to' => $chat['wa_id'], 'type' => 'interactive',
                'interactive' => ['type' => 'button', 'body' => ['text' => $text], 'action' => ['buttons' => array_map(function ($r) { return ['type' => 'reply', 'reply' => ['id' => $r['id'], 'title' => $r['title']]]; }, $btns)]]];
            if ($photo) {
                $send = function () use ($body, $photo) {
                    $go = function (bool $fresh) use ($body, $photo) {
                        $body['interactive']['header'] = ['type' => 'image', 'image' => ['id' => bot_media_id($photo, $fresh)]];
                        return wa_graph('POST', '/' . wa_cfg('phone_number_id') . '/messages', $body);
                    };
                    try { return $go(false); } catch (ShopError $e) { return $go(true); } // Meta no longer has the photo: upload again once
                };
            }
        } else $body = ['messaging_product' => 'whatsapp', 'recipient_type' => 'individual', 'to' => $chat['wa_id'], 'type' => 'interactive',
            'interactive' => ['type' => 'list', 'body' => ['text' => $text], 'action' => ['button' => $label,
                'sections' => [['title' => mb_substr($label, 0, 24), 'rows' => array_map(function ($r) { return ['id' => $r['id'], 'title' => mb_substr($r['title'], 0, 24)]; }, $rows)]]]]];
        $send = $send ?? function () use ($body) { return wa_graph('POST', '/' . wa_cfg('phone_number_id') . '/messages', $body); };
    } else {
        $send = function () use ($chat, $text, $rows, $ch) {
            $pieces = sm_chunks($text, $ch);
            $last = array_pop($pieces);
            foreach ($pieces as $p) sm_send($chat, ['text' => $p]);
            return sm_send($chat, ['text' => $last, 'quick_replies' => array_map(function ($r) { return ['content_type' => 'text', 'title' => $r['title'], 'payload' => $r['id']]; }, $rows)]);
        };
    }
    $shown = $text . "\n\n☰ " . implode(' · ', array_column($rows, 'title'));
    $media = $photo ? ['path' => $photo['path'], 'mime' => 'image/jpeg', 'name' => 'product.jpg', 'size' => filesize(wa_media_dir() . '/' . $photo['path'])] : [];
    $id = wa_record_out($chat, '', $photo ? 'image' : 'interactive', $shown, $media, null, 'sending');
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
    $ads = db()->query("SELECT ad_id, MAX(ad_headline) AS headline, MAX(ad_body) AS body, COUNT(*) AS chats, MAX(created_at) AS last FROM wa_chats WHERE ad_id != '' GROUP BY ad_id ORDER BY last DESC LIMIT 40")->fetchAll();
    $week = db()->query("SELECT kind, COUNT(DISTINCT chat_id) AS n FROM bot_events WHERE created_at > datetime('now', '-7 days') GROUP BY kind")->fetchAll(PDO::FETCH_KEY_PAIR);
    $chats = (int) db()->query("SELECT COUNT(DISTINCT chat_id) FROM bot_events WHERE created_at > datetime('now', '-7 days')")->fetchColumn();
    // What customers wrote that the bot didn't understand (last 60 days, most frequent first), to teach it.
    $missed = db()->query("SELECT said, COUNT(*) AS n, MAX(created_at) AS last FROM bot_events WHERE said != '' AND (kind = 'retry' OR (kind = 'handover' AND how = 'not understood'))
        AND created_at > datetime('now', '-60 days') GROUP BY said ORDER BY n DESC, last DESC LIMIT 30")->fetchAll();
    return ['cfg' => $cfg, 'ai' => ai_status(), 'defaults' => bot_defaults(), 'products' => $products, 'cats' => $cats, 'missed' => array_map(function ($m) { return ['said' => $m['said'], 'n' => (int) $m['n']]; }, $missed),
        // With the product read from the ad's own text, used when none is chosen.
        'ads' => array_map(function ($a) use ($cfg) { return ['id' => $a['ad_id'], 'headline' => $a['headline'], 'body' => mb_substr((string) $a['body'], 0, 160), 'chats' => (int) $a['chats'],
            'auto' => bot_ad_product(['ads' => []] + $cfg, ['ad_id' => $a['ad_id'], 'ad_headline' => (string) $a['headline'], 'ad_body' => (string) $a['body']])]; }, $ads),
        'week' => ['chats' => $chats, 'handover' => (int) ($week['handover'] ?? 0)], 'titleMax' => BOT_TITLE_MAX, 'maxItems' => BOT_MAX_ITEMS, 'maxAll' => BOT_MAX_ALL];
}

// The settings from the page, checked (fails with what to fix). Also what Try it uses before saving.
function bot_clean(array $b): array
{
    $d = bot_defaults();
    $two = function ($v, int $max) { return ['ar' => str_in($v['ar'] ?? '', $max), 'en' => str_in($v['en'] ?? '', $max)]; };
    $cfg = ['on' => !empty($b['on']),
        'channels' => ['wa' => !empty($b['channels']['wa']), 'ig' => !empty($b['channels']['ig']), 'fb' => !empty($b['channels']['fb'])],
        'pause_hours' => max(1, min(72, (int) ($b['pause_hours'] ?? 12))), 'fails' => max(1, min(5, (int) ($b['fails'] ?? 2))),
        'welcome' => $two($b['welcome'] ?? [], 900), 'menu' => $two($b['menu'] ?? [], 20), 'wa_buttons' => !empty($b['wa_buttons']), 'typing' => !empty($b['typing']), 'more' => $two($b['more'] ?? [], 20), 'retry' => $two($b['retry'] ?? [], 900),
        'handover' => $two($b['handover'] ?? [], 900), 'faq_v' => 1, 'human_words' => str_in($b['human_words'] ?? '', 2000), 'items' => [], 'ads' => [], 'ad_offers' => []];
    foreach (['welcome', 'retry', 'handover'] as $k) foreach (['ar', 'en'] as $l) if ($cfg[$k][$l] === '') fail('Write the ' . ($k === 'welcome' ? 'welcome' : ($k === 'retry' ? '“didn’t understand”' : '“handing to the team”')) . ' message in ' . ($l === 'ar' ? 'Arabic' : 'English') . '.');
    foreach (['ar', 'en'] as $l) foreach (['menu', 'more'] as $k) if ($cfg[$k][$l] === '') $cfg[$k][$l] = $d[$k][$l];
    $seen = [];
    $shown = 0;
    foreach (array_slice((array) ($b['items'] ?? []), 0, BOT_MAX_ALL) as $it) {
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
        $hidden = !empty($it['hidden']);
        if (!$hidden && ++$shown > BOT_MAX_ITEMS) fail('At most ' . BOT_MAX_ITEMS . ' menu buttons (WhatsApp’s limit). Make some of them hidden: they still answer when typed.');
        $cfg['items'][] = ['id' => $id, 'action' => $action, 'title' => $title, 'keywords' => str_in($it['keywords'] ?? '', 1000), 'answer' => $answer] + ($hidden ? ['hidden' => true] : []);
    }
    if (!$shown) fail('Add at least one menu item that shows as a button.');
    $cfg['faq_v'] = 1;
    $ids = array_column(load_products(true), 'id');
    foreach ((array) ($b['ads'] ?? []) as $ad => $pid) {
        $ad = preg_replace('/[^\w-]/', '', (string) $ad);
        if ($ad !== '' && in_array((string) $pid, $ids, true)) $cfg['ads'][$ad] = (string) $pid;
    }
    foreach ((array) ($b['ad_offers'] ?? []) as $ad => $o) {
        $ad = preg_replace('/[^\w-]/', '', (string) $ad);
        $o = $two((array) $o, 300);
        if ($ad !== '' && ($o['ar'] !== '' || $o['en'] !== '')) $cfg['ad_offers'][$ad] = $o;
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
        'bot_ctx' => is_array($b['ctx'] ?? null) ? json_encode($b['ctx']) : '', 'last_in_at' => $fresh ? null : gmdate('Y-m-d H:i:s'), 'ad_id' => ''];
    // It can be tried before it's switched on.
    $cfg['on'] = true;
    $cfg['channels'][$chat['channel']] = true;
    $aiOk = function_exists('ai_key') && ai_key() !== '' && ai_lib() && !empty($b['ai']);
    $plan = bot_plan($chat, (string) ($b['kind'] ?? 'text'), str_in($b['text'] ?? '', 1000), (string) ($b['tap'] ?? ''), $cfg, $aiOk);
    if (!$plan) return ['do' => 'none'];
    if ($plan['do'] === 'ai') {
        // Only this message (Try it keeps no history on the server); a real answer, costs a fraction of a cent.
        try { $a = ai_ask([['role' => 'user', 'content' => ai_redact(str_in($b['text'] ?? '', 1000))]], null); }
        catch (Throwable $e) { $a = ['reply' => $e->getMessage(), 'handover' => true, 'product' => '']; }
        return ['do' => $a['handover'] ? 'handover' : 'ai', 'how' => 'ai', 'item' => '', 'lang' => $plan['lang'], 'text' => $a['reply'], 'photo' => '', 'ctx' => $a['product'] !== '' ? ['last' => $a['product']] : (object) [],
            'menu' => $a['handover'] ? [] : array_map(function ($it) use ($plan) { return ['id' => 'bot:' . $it['id'], 'title' => $it['title'][$plan['lang']]]; }, bot_buttons($cfg)),
            'fails' => 0, 'wait' => '', 'team' => $a['handover']];
    }
    $plan['three'] = $chat['channel'] === 'wa' && !empty($cfg['wa_buttons']);
    $r = bot_reply($plan, $cfg);
    return ['do' => $plan['do'], 'ctx' => bot_next_ctx($fresh ? [] : bot_ctx($chat), $r), 'how' => $plan['how'], 'item' => $plan['item']['id'] ?? '', 'lang' => $plan['lang'], 'text' => $r['text'], 'photo' => !empty($r['card']['images']) ? (string) $r['card']['images'][0] : '',
        'menu' => !empty($r['card']) ? bot_card_buttons($r['card'], $plan['lang'], $cfg) : (!empty($r['buttons']) ? $r['buttons'] : ($r['menu'] ? array_map(function ($it) use ($plan) { return ['id' => 'bot:' . $it['id'], 'title' => $it['title'][$plan['lang']]]; }, bot_buttons($cfg)) : [])),
        'fails' => $plan['do'] === 'retry' ? (int) $chat['bot_fails'] + 1 : 0, 'wait' => $plan['do'] === 'ask' ? 'order' : '', 'team' => !bot_takes($plan)];
}
