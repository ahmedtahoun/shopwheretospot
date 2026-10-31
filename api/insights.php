<?php
// Chat insights (dashboard → Chat insights, the summary on each chat, the Excel sheet, the weekly Telegram report).
//
// Everything comes from what the inbox already keeps: messages, the bot's steps (bot_events), automatic
// messages (auto_sent), leads and orders. No AI: a chat's topics are the bot's menu items it tapped or whose
// keywords it typed (the same keywords as the bot), and "phrases" are the customers' most repeated 2–3 word
// pieces, counted once per chat.
//
// A chat counts as converted when an order with the same phone number came in after its first message of the
// period (WhatsApp), or its lead is Won (Instagram / Messenger have no phone number).

const IN_STOP = 'و, في, من, على, عن, الى, ال, يا, انا, انت, ده, دي, دا, اللي, هو, هي, مع, ايه, او, لو, كده, بس, عشان, علشان, لا, اه, ايوه, ممكن, عايز, عاوز, عايزه, محتاج, حضرتك, السلام, عليكم, اهلا, مرحبا, شكرا, تمام, ok, okay, the, a, an, i, you, is, are, to, of, for, and, in, on, it, me, my, do, does, can, please, hi, hello, thanks';

function in_range(int $days): array
{
    $days = max(1, min(365, $days));
    return [gmdate('Y-m-d H:i:s', time() - $days * 86400), gmdate('Y-m-d H:i:s'), $days];
}

// The facts of every chat with a customer message in the period, and the raw counts behind the page.
function in_collect(string $from, string $to, ?int $chatId = null): array
{
    $db = db();
    $cfg = bot_cfg();
    $items = [];
    foreach ((array) $cfg['items'] as $it) if (!empty($it['id'])) $items[$it['id']] = $it;
    $where = $chatId ? 'c.id = ?' : "c.id IN (SELECT DISTINCT chat_id FROM wa_messages WHERE dir = 'in' AND created_at BETWEEN ? AND ?)";
    $st = $db->prepare("SELECT c.*, u.name AS agent_name, l.status AS lead_status, l.name AS lead_name FROM wa_chats c LEFT JOIN users u ON u.id = c.assigned_to LEFT JOIN leads l ON l.id = c.lead_id WHERE $where");
    $st->execute($chatId ? [$chatId] : [$from, $to]);
    $chats = [];
    foreach ($st->fetchAll() as $c) $chats[(int) $c['id']] = $c;
    if (!$chats) return [[], []];
    $ids = implode(',', array_keys($chats));
    $msgs = [];
    $m = $db->prepare("SELECT chat_id, dir, kind, body, user_id, meta, created_at FROM wa_messages WHERE chat_id IN ($ids) AND created_at BETWEEN ? AND ? ORDER BY id LIMIT 80000");
    $m->execute([$from, $to]);
    foreach ($m->fetchAll() as $r) $msgs[(int) $r['chat_id']][] = $r;
    $events = [];
    $e = $db->prepare("SELECT chat_id, kind, item, how FROM bot_events WHERE chat_id IN ($ids) AND created_at BETWEEN ? AND ? ORDER BY id");
    $e->execute([$from, $to]);
    foreach ($e->fetchAll() as $r) $events[(int) $r['chat_id']][] = $r;
    $auto = [];
    $a = $db->prepare("SELECT chat_id, kind FROM auto_sent WHERE chat_id IN ($ids) AND created_at BETWEEN ? AND ?");
    $a->execute([$from, $to]);
    foreach ($a->fetchAll() as $r) $auto[(int) $r['chat_id']][$r['kind']] = true;
    // Orders since the period started, by phone (last 9 digits).
    $orders = [];
    $o = $db->prepare("SELECT id, phone, total, status, created_at FROM orders WHERE created_at >= datetime(?, '-1 hour') AND status != 'Cancelled'");
    $o->execute([$from]);
    foreach ($o->fetchAll() as $r) if ($k = phone_key((string) $r['phone'])) $orders[$k][] = $r;
    $products = [];
    foreach (load_products(false) as $p) $products[$p['id']] = $p['name'];
    $host = preg_quote(parse_url((string) cfg('site_url'), PHP_URL_HOST) ?: 'wheretospot.com', '/');
    $rows = [];
    foreach ($chats as $id => $c) $rows[$id] = in_row($c, $msgs[$id] ?? [], $events[$id] ?? [], $auto[$id] ?? [], $orders, $items, $products, $host);
    return [$rows, $msgs];
}

function in_row(array $c, array $msgs, array $events, array $auto, array $orders, array $items, array $products, string $host): array
{
    $ch = sm_channel($c);
    $in = array_values(array_filter($msgs, function ($m) { return $m['dir'] === 'in'; }));
    $start = $in ? $in[0]['created_at'] : $c['first_in_at'];
    $firstHuman = null; $priceSent = false; $prods = [];
    foreach ($msgs as $m) {
        if ($m['dir'] !== 'out') continue;
        $meta = json_decode((string) $m['meta'], true) ?: [];
        $human = $m['user_id'] !== null || (isset($meta['via']) && empty($meta['bot']));
        if ($human && $firstHuman === null && $m['created_at'] >= $start) $firstHuman = $m['created_at'];
        $b = (string) $m['body'];
        if (preg_match('/ج\.م|EGP|' . $host . '/u', $b)) $priceSent = true;
        if (preg_match_all('#/p/([\w-]+)#', $b, $pm)) foreach ($pm[1] as $pid) if (isset($products[$pid])) $prods[$pid] = $products[$pid];
    }
    // Topics: menu items tapped / answered, plus the keywords in what they typed.
    $topics = [];
    $handover = '';
    // How far towards an order they got with the bot: a product shown, "order it" tapped or a size chosen, an order request sent.
    $kinds = array_column($events, 'kind');
    $shown = (bool) array_intersect($kinds, ['adcard', 'product', 'kind', 'product_price', 'ad_product']);
    $started = (bool) array_intersect($kinds, ['order_last', 'co_start', 'co_details']);
    $requested = (bool) array_filter($events, function ($e) { return $e['kind'] === 'handover' && $e['how'] === 'order'; });
    foreach ($events as $e) {
        if ($e['item'] !== '' && isset($items[$e['item']]) && in_array($e['kind'], ['answer', 'handover', 'orders', 'ask'], true)) $topics[$e['item']] = true;
        if ($e['kind'] === 'handover') $handover = $e['item'] !== '' ? 'tap: ' . $e['item'] : $e['how'];
    }
    foreach ($in as $m) if ($m['kind'] === 'text' && ($hit = bot_match(bot_norm((string) $m['body']), array_values($items)))) $topics[$hit['id']] = true;
    $botOnly = $events && $handover === '' && $firstHuman === null;
    // Orders after their first message (WhatsApp: same number); Won lead for the other apps.
    $mine = [];
    if ($ch === 'wa' && ($k = phone_key(wa_local_phone((string) $c['wa_id'])))) {
        foreach ($orders[$k] ?? [] as $o) if ($o['created_at'] >= gmdate('Y-m-d H:i:s', strtotime($start . ' UTC') - 3600)) $mine[] = $o;
    }
    $converted = (bool) $mine || $c['lead_status'] === 'Won';
    $quiet = !$converted && $priceSent && $c['last_dir'] === 'out' && $c['last_in_at'] && strtotime($c['last_in_at'] . ' UTC') < time() - 86400;
    $stage = $converted ? 'Ordered' : ($c['waiting_since'] ? 'Waiting for us' : ($quiet ? 'Quiet after price' : ($c['status'] === 'closed' ? 'Closed' : ($c['bot'] === 'on' ? 'With the bot' : 'Talking'))));
    $mins = $firstHuman ? max(0, (int) round((strtotime($firstHuman . ' UTC') - strtotime($start . ' UTC')) / 60)) : null;
    return ['id' => (int) $c['id'], 'channel' => $ch, 'name' => $c['lead_name'] ?: $c['name'] ?: sm_label($c), 'contact' => $ch === 'wa' ? wa_local_phone((string) $c['wa_id']) : (($c['handle'] ?? '') !== '' ? '@' . $c['handle'] : SM_NAMES[$ch]),
        'agent' => (string) ($c['agent_name'] ?? ''), 'adId' => (string) $c['ad_id'], 'ad' => (string) ($c['ad_headline'] ?: $c['ad_id']), 'start' => $start, 'lastAt' => $c['last_at'],
        'in' => count($in), 'out' => count($msgs) - count($in), 'replyMins' => $mins, 'botOnly' => $botOnly, 'handover' => $handover,
        'topics' => array_keys($topics), 'products' => array_values($prods), 'priceSent' => $priceSent,
        'orders' => array_map(function ($o) { return order_number((int) $o['id']); }, $mine), 'revenue' => array_sum(array_column($mine, 'total')),
        'converted' => $converted, 'leadStatus' => (string) $c['lead_status'], 'stage' => $stage, 'quiet' => $quiet, 'auto' => array_keys($auto),
        'lastIn' => $c['last_in_at'], 'new' => $c['created_at'] >= $start,
        'shown' => $shown || $priceSent || (bool) $prods, 'started' => $started || $requested, 'requested' => $requested];
}

function in_topic_title(string $id, string $lang = 'en'): string
{
    foreach ((array) bot_cfg()['items'] as $it) if (($it['id'] ?? '') === $id) return trim(preg_replace('/^[^\p{L}\p{N}]+/u', '', (string) $it['title'][$lang]));
    return $id;
}

// The customers' most repeated phrases (2–3 words) and words, each counted once per chat.
function in_phrases(array $msgs): array
{
    $stop = array_flip(bot_words(IN_STOP));
    $phr = []; $words = [];
    foreach ($msgs as $list) {
        $seenP = []; $seenW = [];
        foreach ($list as $m) {
            if ($m['dir'] !== 'in' || $m['kind'] !== 'text') continue;
            preg_match_all('/[\p{L}\p{N}]+/u', bot_norm((string) $m['body']), $t);
            $w = array_values(array_filter($t[0], function ($x) { return mb_strlen($x) > 1; }));
            foreach ($w as $x) if (!isset($stop[$x]) && !preg_match('/^\d+$/', $x)) $seenW[$x] = true;
            for ($n = 2; $n <= 3; $n++) for ($i = 0; $i + $n <= count($w); $i++) {
                $g = array_slice($w, $i, $n);
                if (isset($stop[$g[0]]) && isset($stop[$g[$n - 1]])) continue;
                $seenP[implode(' ', $g)] = true;
            }
        }
        foreach ($seenP as $p => $_) $phr[$p] = ($phr[$p] ?? 0) + 1;
        foreach ($seenW as $x => $_) $words[$x] = ($words[$x] ?? 0) + 1;
    }
    // A 2-word phrase inside a 3-word one that's just as common says the same thing.
    arsort($phr);
    $out = [];
    foreach ($phr as $p => $n) {
        if ($n < 2) break;
        foreach ($out as $q) if ($q['n'] === $n && mb_strpos($q['p'], $p) !== false) continue 2;
        $out[] = ['p' => $p, 'n' => $n];
        if (count($out) >= 30) break;
    }
    arsort($words);
    $w = [];
    foreach (array_slice($words, 0, 30, true) as $x => $n) if ($n >= 2) $w[] = ['w' => (string) $x, 'n' => $n];
    return [$out, $w];
}

function in_median(array $xs): ?float
{
    if (!$xs) return null;
    sort($xs);
    $n = count($xs);
    return $n % 2 ? (float) $xs[intdiv($n, 2)] : ($xs[$n / 2 - 1] + $xs[$n / 2]) / 2;
}

function in_rate(int $part, int $all): float { return $all ? round($part / $all * 100, 1) : 0.0; }

// The page: totals, by app / ad / agent, reply speed vs buying, questions, handovers, busy hours, phrases, quiet chats.
function insights(int $days): array
{
    [$from, $to, $days] = in_range($days);
    [$rows, $msgs] = in_collect($from, $to);
    $group = function (callable $key) use ($rows) {
        $g = [];
        foreach ($rows as $r) {
            foreach ((array) $key($r) as $k) {
                if ($k === '' || $k === null) continue;
                $g[$k] = $g[$k] ?? ['key' => $k, 'chats' => 0, 'orders' => 0, 'revenue' => 0.0, 'mins' => []];
                $g[$k]['chats']++;
                if ($r['converted']) $g[$k]['orders']++;
                $g[$k]['revenue'] += $r['revenue'];
                if ($r['replyMins'] !== null) $g[$k]['mins'][] = $r['replyMins'];
            }
        }
        $g = array_values(array_map(function ($x) { $x['rate'] = in_rate($x['orders'], $x['chats']); $x['reply'] = in_median($x['mins']); unset($x['mins']); return $x; }, $g));
        usort($g, function ($a, $b) { return $b['chats'] <=> $a['chats']; });
        return $g;
    };
    $n = count($rows);
    $conv = count(array_filter($rows, function ($r) { return $r['converted']; }));
    $bot = count(array_filter($rows, function ($r) { return $r['botOnly']; }));
    $speed = $group(function ($r) {
        $m = $r['replyMins'];
        if ($m === null) return $r['botOnly'] ? 'Bot only' : 'No reply from the team';
        return $m < 5 ? 'Under 5 min' : ($m < 30 ? '5–30 min' : ($m < 120 ? '30 min – 2 h' : 'Over 2 hours'));
    });
    $order = ['Under 5 min', '5–30 min', '30 min – 2 h', 'Over 2 hours', 'Bot only', 'No reply from the team'];
    usort($speed, function ($a, $b) use ($order) { return array_search($a['key'], $order, true) <=> array_search($b['key'], $order, true); });
    $questions = array_map(function ($q) { $q['title'] = in_topic_title($q['key']); $q['titleAr'] = in_topic_title($q['key'], 'ar'); return $q; }, $group(function ($r) { return $r['topics']; }));
    $handover = [];
    foreach ($rows as $r) if ($r['handover'] !== '') $handover[$r['handover']] = ($handover[$r['handover']] ?? 0) + 1;
    arsort($handover);
    // Busy hours: customer messages by Cairo weekday and hour.
    $heat = array_fill(0, 7, array_fill(0, 24, 0));
    $tz = new DateTimeZone('Africa/Cairo');
    $cache = [];
    foreach ($msgs as $list) foreach ($list as $m) {
        if ($m['dir'] !== 'in') continue;
        $h = substr($m['created_at'], 0, 13);
        if (!isset($cache[$h])) { $d = new DateTime($h . ':00:00', new DateTimeZone('UTC')); $d->setTimezone($tz); $cache[$h] = [(int) $d->format('w'), (int) $d->format('G')]; }
        $heat[$cache[$h][0]][$cache[$h][1]]++;
    }
    [$phrases, $words] = in_phrases($msgs);
    $quiet = array_values(array_filter($rows, function ($r) { return $r['quiet'] && !in_array($r['leadStatus'], ['Won', 'Lost'], true); }));
    usort($quiet, function ($a, $b) { return strcmp((string) $b['lastIn'], (string) $a['lastIn']); });
    $mins = array_values(array_filter(array_column($rows, 'replyMins'), function ($x) { return $x !== null; }));
    return ['days' => $days,
        'kpi' => ['chats' => $n, 'new' => count(array_filter($rows, function ($r) { return $r['new']; })), 'orders' => $conv, 'rate' => in_rate($conv, $n),
            'revenue' => array_sum(array_column($rows, 'revenue')), 'botOnly' => $bot, 'botRate' => in_rate($bot, $n), 'handovers' => array_sum($handover), 'reply' => in_median($mins)],
        'apps' => $group(function ($r) { return SM_NAMES[$r['channel']]; }), 'ads' => array_slice($group(function ($r) { return $r['ad']; }), 0, 15),
        'agents' => $group(function ($r) { return $r['agent'] ?: 'Unassigned'; }), 'speed' => $speed, 'questions' => $questions,
        'handover' => array_map(function ($k, $v) { return ['how' => $k, 'n' => $v]; }, array_keys($handover), array_values($handover)),
        'heat' => $heat, 'phrases' => $phrases, 'words' => $words,
        // The sales funnel: how many got to each step, so the step where most stop is visible.
        'funnel' => [
            ['key' => 'Chats', 'n' => $n],
            ['key' => 'Saw a price or a product', 'n' => count(array_filter($rows, function ($r) { return $r['shown']; }))],
            ['key' => 'Started ordering', 'n' => count(array_filter($rows, function ($r) { return $r['started'] || $r['converted']; }))],
            ['key' => 'Sent an order request in the chat', 'n' => count(array_filter($rows, function ($r) { return $r['requested']; }))],
            ['key' => 'Ordered', 'n' => $conv],
        ],
        'quiet' => array_map(function ($r) { return ['id' => $r['id'], 'name' => $r['name'], 'channel' => $r['channel'], 'lastIn' => $r['lastIn'], 'products' => $r['products'], 'followup' => in_array('followup', $r['auto'], true)]; }, array_slice($quiet, 0, 50)),
        'weekly' => (bool) wa_setting('tg_weekly', true)];
}

// One chat's summary card (the last 30 days of it).
function in_chat_summary(array $chat): array
{
    [$rows] = in_collect(gmdate('Y-m-d H:i:s', time() - 30 * 86400), gmdate('Y-m-d H:i:s'), (int) $chat['id']);
    $r = $rows[(int) $chat['id']] ?? null;
    if (!$r) return [];
    return ['start' => $r['start'], 'in' => $r['in'], 'out' => $r['out'], 'replyMins' => $r['replyMins'], 'botOnly' => $r['botOnly'], 'handover' => $r['handover'],
        'topics' => array_map(function ($t) { return ['en' => in_topic_title($t), 'ar' => in_topic_title($t, 'ar')]; }, $r['topics']),
        'products' => $r['products'], 'priceSent' => $r['priceSent'], 'orders' => $r['orders'], 'stage' => $r['stage'], 'auto' => $r['auto']];
}

// ---------- Excel ----------

// A real .xlsx (several sheets, bold first row, frozen header) with ZipArchive.
function in_xlsx(array $sheets): string
{
    $x = function ($s) { return htmlspecialchars((string) $s, ENT_XML1 | ENT_QUOTES, 'UTF-8'); };
    $col = function (int $i) { $s = ''; for ($i++; $i > 0; $i = intdiv($i - 1, 26)) $s = chr(65 + ($i - 1) % 26) . $s; return $s; };
    $tmp = tempnam(sys_get_temp_dir(), 'xlsx');
    $z = new ZipArchive();
    $z->open($tmp, ZipArchive::OVERWRITE);
    $names = array_keys($sheets);
    $z->addFromString('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
        . implode('', array_map(function ($i) { return '<Override PartName="/xl/worksheets/sheet' . ($i + 1) . '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'; }, array_keys($names))) . '</Types>');
    $z->addFromString('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
    $z->addFromString('xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'
        . implode('', array_map(function ($i) use ($names, $x) { return '<sheet name="' . $x(mb_substr($names[$i], 0, 31)) . '" sheetId="' . ($i + 1) . '" r:id="rId' . ($i + 1) . '"/>'; }, array_keys($names))) . '</sheets></workbook>');
    $z->addFromString('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        . implode('', array_map(function ($i) { return '<Relationship Id="rId' . ($i + 1) . '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' . ($i + 1) . '.xml"/>'; }, array_keys($names)))
        . '<Relationship Id="rId' . (count($names) + 1) . '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>');
    $z->addFromString('xl/styles.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF7E9E0"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="3"><xf xfId="0"/><xf fontId="1" fillId="2" xfId="0" applyFont="1" applyFill="1"/><xf xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>');
    foreach ($names as $i => $name) {
        $rows = $sheets[$name];
        $widths = [];
        foreach ($rows as $r) foreach (array_values($r) as $j => $v) $widths[$j] = min(60, max($widths[$j] ?? 8, mb_strlen((string) $v) + 2));
        $xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
            . ($widths ? '<cols>' . implode('', array_map(function ($j, $w) { return '<col min="' . ($j + 1) . '" max="' . ($j + 1) . '" width="' . $w . '" customWidth="1"/>'; }, array_keys($widths), $widths)) . '</cols>' : '') . '<sheetData>';
        foreach ($rows as $ri => $r) {
            $xml .= '<row r="' . ($ri + 1) . '">';
            foreach (array_values($r) as $j => $v) {
                $ref = $col($j) . ($ri + 1);
                $style = $ri === 0 ? ' s="1"' : '';
                if ((is_int($v) || is_float($v)) && $ri > 0) $xml .= '<c r="' . $ref . '"' . $style . '><v>' . $v . '</v></c>';
                else $xml .= '<c r="' . $ref . '" t="inlineStr"' . $style . '><is><t xml:space="preserve">' . $x(preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F]/', '', (string) $v)) . '</t></is></c>';
            }
            $xml .= '</row>';
        }
        $z->addFromString('xl/worksheets/sheet' . ($i + 1) . '.xml', $xml . '</sheetData></worksheet>');
    }
    $z->close();
    $data = (string) file_get_contents($tmp);
    @unlink($tmp);
    return $data;
}

// The sheet: one row per chat, then the questions, phrases and ads.
function in_workbook(int $days): string
{
    [$from, $to, $days] = in_range($days);
    [$rows, $msgs] = in_collect($from, $to);
    $cairo = function ($utc) { if (!$utc) return ''; $d = new DateTime($utc, new DateTimeZone('UTC')); $d->setTimezone(new DateTimeZone('Africa/Cairo')); return $d->format('Y-m-d H:i'); };
    $chats = [['Chat', 'App · التطبيق', 'Customer · العميل', 'Phone / username', 'Agent · الموظف', 'Ad · الإعلان', 'Started (Cairo) · البداية', 'Last message', 'Customer messages', 'Our messages',
        'First reply from the team (min)', 'Bot only · الرد الآلي فقط', 'Handed to the team because', 'Asked about · سأل عن', 'Products sent', 'Price sent', 'Stage · المرحلة', 'Orders · الطلبات', 'Order value (EGP)', 'Lead status', 'Automatic messages']];
    usort($rows, function ($a, $b) { return strcmp((string) $b['start'], (string) $a['start']); });
    foreach ($rows as $r) {
        $chats[] = [$r['id'], SM_NAMES[$r['channel']], $r['name'], $r['contact'], $r['agent'], $r['ad'], $cairo($r['start']), $cairo($r['lastAt']), $r['in'], $r['out'],
            $r['replyMins'] ?? '', $r['botOnly'] ? 'Yes' : '', $r['handover'], implode(', ', array_map('in_topic_title', $r['topics'])), implode(', ', $r['products']), $r['priceSent'] ? 'Yes' : '',
            $r['stage'], implode(', ', $r['orders']), (float) $r['revenue'], $r['leadStatus'], implode(', ', $r['auto'])];
    }
    $ins = insights($days);
    $q = [['Question · السؤال', 'Arabic', 'Chats', 'Ordered', 'Rate %']];
    foreach ($ins['questions'] as $x) $q[] = [$x['title'], $x['titleAr'], $x['chats'], $x['orders'], $x['rate']];
    $p = [['Phrase · العبارة', 'Chats']];
    foreach ($ins['phrases'] as $x) $p[] = [$x['p'], $x['n']];
    $p[] = ['', '']; $p[] = ['Word · الكلمة', 'Chats'];
    foreach ($ins['words'] as $x) $p[] = [$x['w'], $x['n']];
    $a = [['Ad · الإعلان', 'Chats', 'Ordered', 'Rate %', 'Order value (EGP)']];
    foreach ($ins['ads'] as $x) $a[] = [$x['key'], $x['chats'], $x['orders'], $x['rate'], (float) $x['revenue']];
    $s = [['Reply speed · سرعة الرد', 'Chats', 'Ordered', 'Rate %']];
    foreach ($ins['speed'] as $x) $s[] = [$x['key'], $x['chats'], $x['orders'], $x['rate']];
    return in_xlsx(['Chats' => $chats, 'Questions' => $q, 'Phrases' => $p, 'Ads' => $a, 'Reply speed' => $s]);
}

// ---------- weekly Telegram report (Saturday from 10:00, Cairo) ----------

function in_weekly_due(): void
{
    if (!wa_setting('tg_weekly', true)) return;
    $now = new DateTime('now', new DateTimeZone('Africa/Cairo'));
    if ((int) $now->format('w') !== 6 || (int) $now->format('G') < 10 || wa_setting('tg_weekly_sent') === $now->format('Y-m-d')) return;
    wa_set_setting('tg_weekly_sent', $now->format('Y-m-d'));
    if (!db()->query("SELECT 1 FROM wa_messages WHERE created_at > datetime('now', '-7 days') LIMIT 1")->fetchColumn()) return;
    $text = in_weekly_text();
    foreach (tg_managers() as $u) tg_send_user($u, $text, ['Chat insights · تحليل المحادثات', rtrim((string) cfg('site_url'), '/') . '/admin/#insights']);
}

function in_weekly_text(): string
{
    $d = insights(7);
    $k = $d['kpi'];
    $L = ['📊 <b>Chats this week · المحادثات الأسبوع ده</b>', '',
        '💬 Chats · محادثات: <b>' . $k['chats'] . '</b> (' . $k['new'] . ' new · جديد)',
        '🛒 Ordered · طلبوا: <b>' . $k['orders'] . '</b> (' . $k['rate'] . '%) · EGP ' . number_format($k['revenue']),
        '🤖 Bot only · الرد الآلي لوحده: ' . $k['botOnly'] . ' (' . $k['botRate'] . '%) · handed over · اتحولت للفريق: ' . $k['handovers'],
        '⏱ Team first reply (median) · أول رد: ' . ($k['reply'] === null ? '—' : round($k['reply']) . ' min')];
    if ($d['questions']) $L[] = '❓ Top questions · أكتر الأسئلة: ' . implode(' · ', array_map(function ($q) { return tg_h($q['titleAr']) . ' (' . $q['chats'] . ')'; }, array_slice($d['questions'], 0, 4)));
    if ($d['phrases']) $L[] = '🗣 Most said · أكتر عبارات: ' . implode(' · ', array_map(function ($p) { return '«' . tg_h($p['p']) . '» ' . $p['n']; }, array_slice($d['phrases'], 0, 3)));
    $ads = array_values(array_filter($d['ads'], function ($a) { return $a['chats'] >= 2; }));
    if ($ads) { usort($ads, function ($a, $b) { return $b['orders'] <=> $a['orders'] ?: $b['chats'] <=> $a['chats']; }); $L[] = '📣 Best ad · أحسن إعلان: ' . tg_h(mb_substr($ads[0]['key'], 0, 50)) . ' — ' . $ads[0]['chats'] . ' chats, ordered · طلبوا: ' . $ads[0]['orders']; }
    $slow = array_values(array_filter($d['speed'], function ($s) { return $s['key'] === 'Over 2 hours' && $s['chats'] > 0; }));
    if ($slow) $L[] = '🐢 Replied after 2 h · ردينا بعد ساعتين: ' . $slow[0]['chats'] . ' chats, ' . $slow[0]['rate'] . '% ordered';
    if ($d['quiet']) $L[] = '🔕 Quiet after the price · سكتوا بعد السعر: <b>' . count($d['quiet']) . '</b> → Chat insights';
    $best = null;
    foreach ($d['heat'] as $day => $hours) foreach ($hours as $h => $n) if (!$best || $n > $best[2]) $best = [$day, $h, $n];
    if ($best && $best[2]) $L[] = '⏰ Busiest · أكتر وقت زحمة: ' . ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][$best[0]] . ' ' . sprintf('%02d:00', $best[1]);
    return implode("\n", $L);
}
