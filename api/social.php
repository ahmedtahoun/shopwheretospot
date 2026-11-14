<?php
// Instagram Direct and Facebook Messenger in the same inbox as WhatsApp (Meta's Messenger Platform, through
// our Facebook Pages and the Instagram accounts linked to them).
//
// Their chats live in wa_chats / wa_messages next to WhatsApp's, told apart by `channel` ('ig' or 'fb') and
// a wa_id of 'ig:<id>' / 'fb:<id>' (Meta's id for that person on our Page or account; there's no phone
// number). Everything else — handing chats out, waiting times, Telegram alerts, leads, quick replies,
// products — works the same. Meta sends both to api/whatsapp-webhook.php (objects 'page' and 'instagram').
// Settings: 'social' block in api/config.local.php (see config.local.example.php).
//
// More than one Page (our other brands, e.g. Cairo Roast): listed under 'pages' in the 'social' block. Each
// chat remembers its Page in wa_chats.page ('' = the main Page), Meta's messages are matched to a Page by the
// entry id it sends (the Page id, or the linked Instagram account's id), and every reply goes out through
// that chat's own Page and key. The shop's bot, after-hours reply and follow-ups only run on the main Page
// (and on pages with 'bot' => true), since they talk about the shop's products.

declare(strict_types=1);

const SM_NAMES = ['wa' => 'WhatsApp', 'ig' => 'Instagram', 'fb' => 'Messenger'];

function sm_cfg(string $key = '', $default = null)
{
    $c = (array) (cfg('social') ?: []);
    return $key === '' ? $c : ($c[$key] ?? $default);
}

// Every Page in the inbox, by Page id: the main one first (the top of the 'social' block), then 'pages'.
// A page without its own 'page_token' uses the main one (a system user's key can reach several Pages).
function sm_pages(): array
{
    static $memo = [];
    $c = sm_cfg();
    $tag = md5(serialize($c));
    if (isset($memo[$tag])) return $memo[$tag];
    $pages = [];
    $main = preg_replace('/\D/', '', (string) ($c['page_id'] ?? ''));
    if ($main !== '') $pages[$main] = ['id' => $main, 'label' => trim((string) ($c['label'] ?? '')) ?: 'Where To Spot', 'token' => (string) ($c['page_token'] ?? ''),
        'ig_id' => preg_replace('/\D/', '', (string) ($c['ig_id'] ?? '')), 'shop' => true, 'main' => true];
    foreach ((array) ($c['pages'] ?? []) as $p) {
        $id = preg_replace('/\D/', '', (string) ($p['page_id'] ?? ''));
        if ($id === '' || isset($pages[$id])) continue;
        $pages[$id] = ['id' => $id, 'label' => trim((string) ($p['label'] ?? '')) ?: 'Page ' . $id, 'token' => (string) (($p['page_token'] ?? '') ?: ($c['page_token'] ?? '')),
            'ig_id' => preg_replace('/\D/', '', (string) ($p['ig_id'] ?? '')), 'shop' => !empty($p['bot']), 'main' => false];
    }
    return $memo[$tag] = $pages;
}

function sm_main_page(): ?array
{
    foreach (sm_pages() as $p) if ($p['main']) return $p;
    return null;
}

function sm_multi(): bool
{
    return count(sm_pages()) > 1;
}

// The Page a chat belongs to ('' = the main Page). Strict: a Page taken out of config.local.php is an error,
// so a reply never goes out from another brand's Page.
function sm_chat_page(array $chat, bool $strict = true): ?array
{
    $id = (string) ($chat['page'] ?? '');
    $pages = sm_pages();
    if ($id !== '' && isset($pages[$id])) return $pages[$id];
    if ($id === '' || !$strict) return sm_main_page();
    throw new ShopError('This chat came in through Page ' . $id . ', which isn’t in api/config.local.php any more, so it can’t be answered from here.');
}

// The brand name shown on a chat: only once there's more than one Page, and only for chats on a Page.
function sm_brand(array $chat): string
{
    if (sm_channel($chat) === 'wa' || !sm_multi()) return '';
    $p = sm_chat_page($chat, false);
    return $p ? $p['label'] : '';
}

// The shop's own chats (WhatsApp and the main Page): where the bot, after-hours reply and follow-ups may answer.
function sm_shop_chat(array $chat): bool
{
    if (sm_channel($chat) === 'wa') return true;
    $id = (string) ($chat['page'] ?? '');
    if ($id === '') return true;
    $pages = sm_pages();
    return isset($pages[$id]) ? $pages[$id]['shop'] : false;
}

// The Page's access key and id are all that's needed; the app secret is WhatsApp's unless the Page uses another Meta app.
function sm_ready(): bool
{
    return sm_cfg('page_token') && sm_cfg('page_id') && sm_app_secret() !== '';
}

function sm_app_secret(): string
{
    return (string) (sm_cfg('app_secret') ?: wa_cfg('app_secret', ''));
}

function sm_channel(array $chat): string
{
    return (string) ($chat['channel'] ?? '') ?: (preg_match('/^(ig|fb):/', (string) $chat['wa_id'], $m) ? $m[1] : 'wa');
}

// How a chat is named in the activity log and on Telegram: the phone number, or @handle / "Messenger"
// (with the brand when it came in through one of our other Pages).
function sm_label(array $chat): string
{
    $ch = sm_channel($chat);
    if ($ch === 'wa') return wa_local_phone($chat['wa_id']);
    $who = ($chat['handle'] ?? '') !== '' ? '@' . $chat['handle'] : trim((string) $chat['name']);
    $brand = sm_brand($chat);
    return trim(($who !== '' ? $who . ' · ' : '') . SM_NAMES[$ch] . ($brand !== '' ? ' · ' . $brand : ''));
}

function sm_migrate(PDO $pdo): void
{
    $cols = array_column($pdo->query('PRAGMA table_info(wa_chats)')->fetchAll(), 'name');
    if (!in_array('channel', $cols, true)) $pdo->exec("ALTER TABLE wa_chats ADD COLUMN channel TEXT NOT NULL DEFAULT 'wa'");
    if (!in_array('handle', $cols, true)) $pdo->exec("ALTER TABLE wa_chats ADD COLUMN handle TEXT DEFAULT ''");
    // The customer's profile photo (a file next to chat media) and when Meta was last asked for name and photo.
    if (!in_array('avatar', $cols, true)) $pdo->exec("ALTER TABLE wa_chats ADD COLUMN avatar TEXT NOT NULL DEFAULT ''");
    if (!in_array('profile_at', $cols, true)) $pdo->exec('ALTER TABLE wa_chats ADD COLUMN profile_at TEXT');
    // Which of our Pages the chat came in through ('' = the main one, as every chat before there were more).
    if (!in_array('page', $cols, true)) $pdo->exec("ALTER TABLE wa_chats ADD COLUMN page TEXT NOT NULL DEFAULT ''");
    $pdo->exec('CREATE INDEX IF NOT EXISTS idx_wa_chats_channel ON wa_chats(channel, last_at)');
}

function sm_graph(string $method, string $path, ?array $body = null, ?array $page = null): array
{
    $page = $page ?: sm_main_page();
    if (!$page || $page['token'] === '') throw new ShopError('Instagram and Messenger aren’t connected yet (no Page access key in api/config.local.php).');
    return sm_call($method, $path, $body, sm_token($page));
}

// The Page's own key. The key in config.local.php can be a system user's (Business settings → System users →
// Generate token): Meta then hands us the Page's key for it once, kept until the configured key changes.
function sm_token(?array $page = null): string
{
    static $done = [];
    $page = $page ?: sm_main_page();
    if (!$page) return '';
    $given = (string) $page['token'];
    $tag = substr(hash('sha256', $page['id'] . '|' . $given), 0, 16);
    if (isset($done[$tag])) return $done[$tag];
    $key = $page['main'] ? 'sm_ptok' : 'sm_ptok_' . $page['id'];
    $kept = wa_setting($key);
    // The main Page's kept key was tagged by the key alone before there were more Pages.
    if (is_array($kept) && in_array($kept['k'] ?? '', [$tag, $page['main'] ? substr(hash('sha256', $given), 0, 16) : ''], true)) return $done[$tag] = (string) $kept['t'];
    try {
        $r = sm_call('GET', '/' . rawurlencode($page['id']) . '?fields=access_token', null, $given);
        $own = (string) ($r['access_token'] ?? '');
    } catch (ShopError $e) {
        if (strpos($e->getMessage(), 'Could not reach') === 0) return $given; // offline for a moment: ask again next time
        $own = '';
    }
    wa_set_setting($key, ['k' => $tag, 't' => $own !== '' ? $own : $given]);
    return $done[$tag] = $own !== '' ? $own : $given;
}

function sm_call(string $method, string $path, ?array $body, string $token): array
{
    $base = rtrim((string) (sm_cfg('graph_url') ?: wa_cfg('graph_url', 'https://graph.facebook.com')), '/') . '/' . trim((string) (sm_cfg('graph_version') ?: wa_cfg('graph_version', 'v23.0')), '/');
    $ch = curl_init($base . $path);
    $headers = ['Authorization: Bearer ' . $token, 'Accept: application/json'];
    if ($body !== null) $headers[] = 'Content-Type: application/json';
    curl_setopt_array($ch, [CURLOPT_CUSTOMREQUEST => $method, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 40, CURLOPT_CONNECTTIMEOUT => 8, CURLOPT_HTTPHEADER => $headers,
        CURLOPT_IPRESOLVE => CURL_IPRESOLVE_V4]);
    if ($body !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body, JSON_UNESCAPED_UNICODE));
    $raw = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    if ($raw === false) throw new ShopError('Could not reach Meta: ' . curl_error($ch));
    $json = json_decode((string) $raw, true);
    if (!is_array($json)) throw new ShopError('Unexpected reply from Meta (HTTP ' . $code . ').');
    if ($code >= 400 || isset($json['error'])) throw new ShopError(sm_error_text((array) ($json['error'] ?? []), $code));
    return $json;
}

// Meta's errors in words the team can act on.
function sm_error_text(array $e, int $code = 0): string
{
    $c = (int) ($e['code'] ?? 0);
    $sub = (int) ($e['error_subcode'] ?? 0);
    if ($c === 10 && $sub === 2018278) return 'More than 24 hours since the customer’s last message, so Meta doesn’t allow a reply here. It opens again when they write.';
    if ($c === 10 || $c === 200) return 'Meta didn’t allow this (permission). Check that the Page access key has pages_messaging and instagram_manage_messages, and that the app is approved for them.';
    if ($c === 190) return 'The Page access key has expired or was revoked. Make a new one and put it in api/config.local.php.';
    if ($c === 100 && $sub === 2018001) return 'This person can’t receive messages from the Page (they may have blocked it or deleted the chat).';
    if ($c === 551) return 'This person isn’t available to message right now.';
    return trim('Meta: ' . ($e['error_user_msg'] ?? $e['message'] ?? 'error') . ($code ? ' (HTTP ' . $code . ')' : ''));
}

// Our app's id, to recognise our own messages when Meta echoes them back (found once from the Page key).
function sm_app_id(): string
{
    $id = (string) (sm_cfg('app_id') ?: wa_setting('sm_app_id', ''));
    if ($id !== '' || !sm_cfg('page_token')) return $id;
    if ((int) wa_setting('sm_app_id_try', 0) > time() - 3600) return '';
    wa_set_setting('sm_app_id_try', time());
    try {
        $t = sm_graph('GET', '/debug_token?input_token=' . rawurlencode((string) sm_cfg('page_token')))['data'] ?? [];
        $id = (string) ($t['app_id'] ?? '');
        if ($id !== '') wa_set_setting('sm_app_id', $id);
    } catch (Throwable $e) {}
    return $id;
}

// ---------- receiving ----------

// Each Page's linked Instagram account id: from config.local.php ('ig_id'), else asked from Meta and kept.
function sm_ig_ids(bool $refresh = false): array
{
    $kept = (array) wa_setting('sm_ig_ids', []);
    $out = [];
    $ask = false;
    foreach (sm_pages() as $p) {
        $id = $p['id']; // the keys are numbers to PHP: the Page's id is the string
        if ($p['ig_id'] !== '') $out[$id] = $p['ig_id'];
        elseif (isset($kept[$id]) && $kept[$id] !== '') $out[$id] = (string) $kept[$id];
        else $ask = true;
    }
    if (!$ask && !$refresh) return $out;
    // At most every 10 minutes, so a message from an unknown account doesn't ask Meta each time.
    if ((int) wa_setting('sm_ig_ids_try', 0) > time() - 600) return $out;
    wa_set_setting('sm_ig_ids_try', time());
    foreach (sm_pages() as $p) {
        $id = $p['id'];
        if ($p['ig_id'] !== '' || $p['token'] === '') continue;
        try {
            $ig = (string) (sm_graph('GET', '/' . rawurlencode($id) . '?fields=instagram_business_account', null, $p)['instagram_business_account']['id'] ?? '');
            if ($ig !== '') { $kept[$id] = $ig; $out[$id] = $ig; }
        } catch (Throwable $e) {}
    }
    wa_set_setting('sm_ig_ids', $kept);
    return $out;
}

// Which of our Pages a webhook entry is for: Messenger sends the Page id, Instagram the account's id.
// With one Page everything is that Page's, as before. null = not one of ours (left out, noted in Settings).
function sm_entry_page(string $channel, string $own): ?array
{
    $pages = sm_pages();
    if (count($pages) <= 1) return sm_main_page();
    if ($channel === 'fb') return $pages[$own] ?? null;
    foreach ([false, true] as $refresh) {
        $ids = sm_ig_ids($refresh);
        $hit = array_search($own, $ids, true);
        if ($hit !== false) return $pages[$hit] ?? null;
    }
    // The main Page's Instagram account couldn't be read from Meta: keep its messages coming, as before there were more Pages.
    $main = sm_main_page();
    return $main && !isset($ids[$main['id']]) ? $main : null;
}

// Everything Meta sends for the Pages ('page': Messenger) and their Instagram accounts ('instagram').
function sm_handle_webhook(array $payload): void
{
    $channel = ($payload['object'] ?? '') === 'instagram' ? 'ig' : 'fb';
    wa_set_setting('sm_last_webhook', gmdate('Y-m-d H:i:s'));
    wa_set_setting('sm_last_webhook_' . $channel, gmdate('Y-m-d H:i:s')); // per app: shows whether Instagram sends anything at all
    foreach ((array) ($payload['entry'] ?? []) as $entry) {
        $own = (string) ($entry['id'] ?? ''); // our Page id or Instagram account id
        $page = sm_entry_page($channel, $own);
        if (!$page) {
            wa_set_setting('sm_last_note', ['at' => gmdate('Y-m-d H:i:s'), 'kind' => 'error', 'channel' => $channel,
                'error' => 'A message came for ' . SM_NAMES[$channel] . ' account ' . $own . ', which isn’t one of the Pages in api/config.local.php (or its Instagram account), so it was left out.']);
            continue;
        }
        wa_set_setting('sm_last_webhook_' . $channel . '_' . $page['id'], gmdate('Y-m-d H:i:s'));
        foreach ((array) ($entry['messaging'] ?? []) as $ev) {
            try {
                sm_handle_event($channel, $own, (array) $ev, $page);
                wa_set_setting('sm_last_note', ['at' => gmdate('Y-m-d H:i:s'), 'kind' => 'saved', 'channel' => $channel, 'page' => $page['main'] ? '' : $page['label']]);
            } catch (Throwable $e) {
                ops_error(SM_NAMES[$channel], 'An incoming ' . SM_NAMES[$channel] . ' message could not be saved', $e);
                wa_set_setting('sm_last_note', ['at' => gmdate('Y-m-d H:i:s'), 'kind' => 'error', 'channel' => $channel, 'error' => mb_substr($e->getMessage(), 0, 300)]);
            }
        }
    }
}

function sm_handle_event(string $channel, string $own, array $ev, ?array $page = null): void
{
    $sender = (string) ($ev['sender']['id'] ?? '');
    $recipient = (string) ($ev['recipient']['id'] ?? '');
    $at = isset($ev['timestamp']) ? gmdate('Y-m-d H:i:s', (int) floor($ev['timestamp'] / 1000)) : gmdate('Y-m-d H:i:s');
    $mine = !empty($ev['message']['is_echo']) || ($own !== '' && $sender === $own);
    $person = $mine ? $recipient : $sender;
    if ($person === '' || $person === $own) return;
    $waId = $channel . ':' . preg_replace('/[^\w-]/', '', $person);
    $page = $page ?: sm_main_page();

    if (isset($ev['message'])) {
        $m = (array) $ev['message'];
        if (!empty($m['is_deleted'])) { sm_mark_deleted((string) ($m['mid'] ?? '')); return; }
        if ($mine) sm_store_echo($channel, $waId, $m, $at);
        else sm_store_incoming($channel, $waId, $person, $m, $ev['referral'] ?? ($m['referral'] ?? null), $at, $page);
        return;
    }
    if (isset($ev['postback'])) { // a button the customer tapped (e.g. "Get started" on Messenger)
        $p = (array) $ev['postback'];
        sm_store_incoming($channel, $waId, $person, ['mid' => (string) ($p['mid'] ?? ''), 'text' => (string) ($p['title'] ?? ''), '_kind' => 'button', '_tap' => (string) ($p['payload'] ?? '')], $p['referral'] ?? null, $at, $page);
        return;
    }
    if (isset($ev['referral']) && !$mine) { // opened the chat from an ad without writing yet: remember the ad
        $chat = wa_chat_by_wa_id($waId);
        if ($chat) sm_remember_ad($chat, (array) $ev['referral']);
        return;
    }
    if (isset($ev['reaction'])) { sm_store_reaction($waId, (array) $ev['reaction'], $mine, $at); return; }
    if (isset($ev['delivery'])) { sm_mark_status($waId, 'delivered', (array) ($ev['delivery']['mids'] ?? []), (int) ($ev['delivery']['watermark'] ?? 0)); return; }
    if (isset($ev['read'])) { sm_mark_status($waId, 'read', array_filter([(string) ($ev['read']['mid'] ?? '')]), (int) ($ev['read']['watermark'] ?? 0)); return; }
}

// What the customer is called and looks like: their name (and @username on Instagram) and profile photo.
// Meta only answers for people who messaged us; for everyone outside the app's roles that needs App Review
// (Messenger: "Business Asset User Profile Access"). The last answer is kept for Settings.
function sm_profile(string $channel, string $person, ?array $page = null): array
{
    $tries = $channel === 'ig' ? ['name,username,profile_pic', 'username'] : ['first_name,last_name,profile_pic', 'first_name,last_name'];
    $err = '';
    foreach ($tries as $fields) { // the photo can be refused while the name isn't: then ask for the name alone
        try {
            $p = sm_graph('GET', '/' . rawurlencode($person) . '?fields=' . $fields, null, $page);
            wa_set_setting('sm_profile', ['at' => gmdate('Y-m-d H:i:s'), 'ok' => true, 'channel' => $channel, 'pic' => !empty($p['profile_pic'])]);
            $name = $channel === 'ig' ? trim((string) ($p['name'] ?? '')) : trim(($p['first_name'] ?? '') . ' ' . ($p['last_name'] ?? ''));
            return ['name' => $name, 'handle' => $channel === 'ig' ? (string) ($p['username'] ?? '') : '', 'pic' => (string) ($p['profile_pic'] ?? '')];
        } catch (Throwable $e) { if ($err === '') $err = $e->getMessage(); }
    }
    // Refused (no "Business Asset User Profile Access" yet): the Page's conversation with them still names
    // them (Messenger: name; Instagram: username), with only the messaging permission. No photo this way.
    try {
        $pid = $page ? $page['id'] : (string) sm_cfg('page_id');
        $conv = sm_graph('GET', '/' . rawurlencode($pid) . '/conversations?platform=' . ($channel === 'ig' ? 'instagram' : 'messenger')
            . '&user_id=' . rawurlencode($person) . '&fields=participants', null, $page)['data'][0]['participants']['data'] ?? [];
        foreach ((array) $conv as $who) {
            if ((string) ($who['id'] ?? '') !== $person) continue;
            $name = trim((string) ($who['name'] ?? ''));
            $handle = $channel === 'ig' ? (string) ($who['username'] ?? $name) : '';
            if ($name === '' && $handle === '') break;
            wa_set_setting('sm_profile', ['at' => gmdate('Y-m-d H:i:s'), 'ok' => true, 'channel' => $channel, 'pic' => false, 'via' => 'conversation']);
            return ['name' => $channel === 'ig' ? '' : $name, 'handle' => $handle, 'pic' => ''];
        }
    } catch (Throwable $e) {}
    wa_set_setting('sm_profile', ['at' => gmdate('Y-m-d H:i:s'), 'ok' => false, 'channel' => $channel, 'error' => mb_substr($err, 0, 400)]);
    return ['name' => '', 'handle' => '', 'pic' => ''];
}

// Saves what Meta told us on the chat: name, @username, and the photo as our own copy (Meta's photo links
// expire). The lead keeps its "Messenger customer" placeholder only until the real name is known.
function sm_save_profile(array $chat, array $p): void
{
    $ch = sm_channel($chat);
    $name = $p['name'] !== '' ? $p['name'] : (string) $chat['name'];
    $handle = $p['handle'] !== '' ? $p['handle'] : (string) $chat['handle'];
    $avatar = (string) ($chat['avatar'] ?? '');
    if ($p['pic'] !== '') {
        try {
            $f = sm_download($p['pic'], 'avatar', '');
            if (strpos($f['mime'], 'image/') === 0) {
                if ($avatar !== '' && strpos($avatar, '..') === false) @unlink(wa_media_dir() . '/' . $avatar);
                $avatar = $f['path'];
            } else @unlink(wa_media_dir() . '/' . $f['path']);
        } catch (Throwable $e) { error_log('[' . SM_NAMES[$ch] . '] profile photo: ' . $e->getMessage()); }
    }
    db()->prepare('UPDATE wa_chats SET name = ?, handle = ?, avatar = ? WHERE id = ?')->execute([$name, $handle, $avatar, $chat['id']]);
    if ($chat['lead_id'] && ($name !== '' || $handle !== '')) {
        db()->prepare('UPDATE leads SET name = ? WHERE id = ? AND name = ?')->execute([$name !== '' ? $name : '@' . $handle, $chat['lead_id'], SM_NAMES[$ch] . ' customer']);
        if ($handle !== '') db()->prepare('UPDATE leads SET contact = ? WHERE id = ? AND contact = ?')->execute(['Instagram @' . $handle, $chat['lead_id'], SM_NAMES[$ch]]);
    }
}

// Asks Meta again for a chat still missing its name or photo: at most once a day per chat, unless forced.
function sm_fill_profile(array $chat, bool $force = false): void
{
    if (sm_channel($chat) === 'wa' || ((string) $chat['name'] !== '' && (string) ($chat['avatar'] ?? '') !== '')) return;
    if (!$force && !empty($chat['profile_at']) && strtotime($chat['profile_at'] . ' UTC') > time() - 86400) return;
    db()->prepare("UPDATE wa_chats SET profile_at = datetime('now') WHERE id = ?")->execute([$chat['id']]);
    sm_save_profile($chat, sm_profile(sm_channel($chat), substr((string) $chat['wa_id'], 3), sm_chat_page($chat)));
}

// The ad a chat came from, in the same shape as WhatsApp's (headline, link, id).
function sm_referral(?array $r): ?array
{
    if (!$r || (empty($r['ad_id']) && ($r['source'] ?? '') !== 'ADS')) return null;
    $ctx = (array) ($r['ads_context_data'] ?? []);
    return ['source_id' => (string) ($r['ad_id'] ?? ''), 'headline' => (string) ($ctx['ad_title'] ?? ''), 'source_url' => (string) ($ctx['photo_url'] ?? $ctx['video_url'] ?? ''), 'body' => ''];
}

function sm_remember_ad(array $chat, array $r): void
{
    $ad = sm_referral($r);
    if (!$ad) return;
    db()->prepare('UPDATE wa_chats SET ad_id = ?, ad_headline = ?, ad_url = ? WHERE id = ?')->execute([$ad['source_id'], $ad['headline'], $ad['source_url'], $chat['id']]);
}

// The chat for a person, created on first contact with its lead (no phone number, so one lead per chat).
function sm_open_chat(string $channel, string $waId, string $person, ?array $ad, string $firstText, ?array $page = null): array
{
    $chat = wa_chat_by_wa_id($waId);
    $lead = null;
    if ($chat && $chat['lead_id']) {
        $st = db()->prepare('SELECT * FROM leads WHERE id = ?');
        $st->execute([(int) $chat['lead_id']]);
        $lead = $st->fetch() ?: null;
    }
    $page = $page ?: sm_main_page();
    // The brand goes in front for our other Pages ("Cairo Roast · Instagram"), so leads and the log say where it came from.
    $label = ($page && !$page['main'] ? $page['label'] . ' · ' : '') . SM_NAMES[$channel];
    if ($chat) {
        $quiet = !$chat['last_in_at'] || strtotime($chat['last_in_at'] . ' UTC') < time() - 86400;
        if ($chat['status'] !== 'open' || $quiet) {
            db()->prepare("UPDATE wa_chats SET status = 'open' WHERE id = ?")->execute([$chat['id']]);
            if ($lead) touch_lead($lead, date('Y-m-d') . ' · ' . $label . ': ' . mb_substr($firstText, 0, 160), null, null);
        }
        if (!$chat['assigned_to']) { $agent = wa_pick_agent($lead); if ($agent) wa_assign((int) $chat['id'], $agent); }
        sm_fill_profile($chat);
        return wa_chat_by_wa_id($waId);
    }
    $p = sm_profile($channel, $person, $page);
    $who = $p['name'] !== '' ? $p['name'] : ($p['handle'] !== '' ? '@' . $p['handle'] : SM_NAMES[$channel] . ' customer');
    $contact = $p['handle'] !== '' ? 'Instagram @' . $p['handle'] : SM_NAMES[$channel];
    $adHeadline = $ad ? trim($ad['headline']) : '';
    $agent = wa_pick_agent(null);
    $note = date('Y-m-d') . ' · ' . $label . ($ad ? ' (from ad' . ($adHeadline !== '' ? ': ' . $adHeadline : '') . ')' : '') . ': ' . mb_substr($firstText, 0, 300);
    $leadId = insert_lead(['name' => $who, 'contact' => $contact, 'cat' => mb_substr($adHeadline !== '' ? $adHeadline : $firstText, 0, 120),
        'source' => $ad ? $label . ' ad' . ($adHeadline !== '' ? ': ' . mb_substr($adHeadline, 0, 80) : '') : $label, 'status' => 'New', 'notes' => $note, 'assigned_to' => $agent]);
    // A username can hold digits; it's not a phone number, so it must never match someone's orders.
    db()->prepare('UPDATE leads SET phone_key = NULL, email_key = NULL WHERE id = ?')->execute([$leadId]);
    db()->prepare("INSERT INTO wa_chats (wa_id, channel, page, name, handle, lead_id, status, ad_id, ad_headline, ad_url, ad_body, created_at) VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, '', datetime('now'))")
        ->execute([$waId, $channel, $page && !$page['main'] ? $page['id'] : '', $p['name'], $p['handle'], $leadId, $ad['source_id'] ?? '', $adHeadline, $ad['source_url'] ?? '']);
    $chatId = (int) db()->lastInsertId();
    db()->prepare("UPDATE wa_chats SET profile_at = datetime('now') WHERE id = ?")->execute([$chatId]);
    if ($p['pic'] !== '') sm_save_profile(wa_chat_by_wa_id($waId), $p);
    if ($agent) wa_assign($chatId, $agent);
    log_activity(null, 'New ' . $label . ' chat', $who . ($adHeadline !== '' ? ' · ad: ' . $adHeadline : ''));
    return wa_chat_by_wa_id($waId);
}

// A message's text and kind; attachments become the matching WhatsApp-style kind.
function sm_message_parts(array $m): array
{
    $text = (string) ($m['text'] ?? '');
    $files = [];
    $extra = [];
    foreach ((array) ($m['attachments'] ?? []) as $a) {
        $type = (string) ($a['type'] ?? '');
        $url = (string) ($a['payload']['url'] ?? '');
        if (in_array($type, ['image', 'video', 'audio', 'file'], true) && $url !== '') {
            $kind = $type === 'file' ? 'document' : ($type === 'image' && !empty($a['payload']['sticker_id']) ? 'sticker' : $type);
            $files[] = ['kind' => $kind, 'url' => $url, 'name' => (string) ($a['name'] ?? $a['payload']['title'] ?? '')];
        } elseif ($type === 'story_mention') $extra[] = '📣 Mentioned us in their story' . ($url !== '' ? ': ' . $url : '');
        elseif (in_array($type, ['share', 'ig_reel', 'reel', 'ig_post'], true)) $extra[] = '🔗 Shared a post' . (($a['payload']['title'] ?? '') !== '' ? ': ' . $a['payload']['title'] : '') . ($url !== '' ? "\n" . $url : '');
        elseif ($type === 'location') $extra[] = '📍 https://maps.google.com/?q=' . ($a['payload']['coordinates']['lat'] ?? '') . ',' . ($a['payload']['coordinates']['long'] ?? '');
        elseif ($type === 'fallback' || $type === 'template') $extra[] = trim(($a['title'] ?? $a['payload']['title'] ?? '') . ' ' . $url);
    }
    if (isset($m['reply_to']['story'])) $extra[] = '↩️ Replied to our story' . (!empty($m['reply_to']['story']['url']) ? ': ' . $m['reply_to']['story']['url'] : '');
    if (!empty($m['is_unsupported'])) $extra[] = 'Message type not supported by Meta’s API';
    $text = trim($text . ($extra ? "\n" . implode("\n", $extra) : ''));
    return [$text, $files];
}

// An attachment from Meta's servers into wa-media (the links only last a short while).
function sm_download(string $url, string $kind, string $name): array
{
    $rel = date('Y-m') . '/' . $kind . '-' . bin2hex(random_bytes(8));
    $path = wa_media_dir() . '/' . $rel;
    if (!is_dir(dirname($path))) mkdir(dirname($path), 0750, true);
    $fh = fopen($path, 'wb');
    $ch = curl_init($url);
    curl_setopt_array($ch, [CURLOPT_FILE => $fh, CURLOPT_TIMEOUT => 90, CURLOPT_CONNECTTIMEOUT => 8, CURLOPT_FOLLOWLOCATION => true, CURLOPT_MAXFILESIZE => 64 * 1024 * 1024]);
    $ok = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $type = strtolower(trim(explode(';', (string) curl_getinfo($ch, CURLINFO_CONTENT_TYPE))[0]));
    fclose($fh);
    if (!$ok || $code >= 400) { @unlink($path); throw new ShopError('Could not download the customer’s file from Meta.'); }
    $mime = $type !== '' && $type !== 'application/octet-stream' ? $type : ((new finfo(FILEINFO_MIME_TYPE))->file($path) ?: 'application/octet-stream');
    $ext = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/gif' => 'gif', 'image/webp' => 'webp', 'video/mp4' => 'mp4', 'video/quicktime' => 'mov', 'audio/mpeg' => 'mp3',
        'audio/mp4' => 'm4a', 'audio/aac' => 'aac', 'audio/ogg' => 'ogg', 'audio/wav' => 'wav', 'application/pdf' => 'pdf'][$mime] ?? (pathinfo(parse_url($url, PHP_URL_PATH) ?: '', PATHINFO_EXTENSION) ?: 'bin');
    $ext = strtolower(preg_replace('/[^a-z0-9]/i', '', $ext) ?: 'bin');
    rename($path, $path . '.' . $ext);
    return ['path' => $rel . '.' . $ext, 'mime' => $mime, 'size' => filesize($path . '.' . $ext)];
}

function sm_seen(string $mid): bool
{
    if ($mid === '') return false;
    $st = db()->prepare('SELECT 1 FROM wa_messages WHERE wamid = ?');
    $st->execute([$mid]);
    return (bool) $st->fetchColumn();
}

function sm_store_incoming(string $channel, string $waId, string $person, array $m, $referral, string $at, ?array $page = null): void
{
    $mid = (string) ($m['mid'] ?? '');
    if (sm_seen($mid)) return; // Meta can deliver the same message twice
    [$text, $files] = sm_message_parts($m);
    if ($text === '' && !$files) return;
    $ad = sm_referral(is_array($referral) ? $referral : null);
    $first = $files ? $files[0]['kind'] : (($m['_kind'] ?? '') ?: 'text');
    $preview = $text !== '' ? $text : ['image' => '📷 Photo', 'video' => '🎥 Video', 'audio' => '🎤 Voice message', 'document' => '📄 Document', 'sticker' => 'Sticker'][$first] ?? '';
    $chat = sm_open_chat($channel, $waId, $person, $ad, $preview, $page);
    if ($ad) sm_remember_ad($chat, (array) $referral);
    $meta = array_filter(['referral' => $ad, 'context' => $m['reply_to']['mid'] ?? null]);
    $ins = db()->prepare("INSERT INTO wa_messages (chat_id, wamid, dir, kind, body, media_path, media_mime, media_name, media_size, status, meta, created_at) VALUES (?, ?, 'in', ?, ?, ?, ?, ?, ?, 'received', ?, ?)");
    // Several photos in one message: one bubble each (the text goes with the first).
    $parts = $files ?: [null];
    foreach ($parts as $i => $f) {
        $media = ['path' => '', 'mime' => '', 'size' => 0];
        $body = $i === 0 ? $text : '';
        if ($f) {
            try { $media = sm_download($f['url'], $f['kind'], $f['name']); }
            catch (Throwable $e) { $body = trim($body . "\n(" . $e->getMessage() . ')'); }
        }
        $ins->execute([$chat['id'], $i === 0 ? $mid : $mid . '#' . $i, $f ? $f['kind'] : (($m['_kind'] ?? '') ?: 'text'), $body, $media['path'], $media['mime'], $f['name'] ?? '', $media['size'],
            $i === 0 && $meta ? json_encode($meta, JSON_UNESCAPED_UNICODE) : '', $at]);
    }
    // The chat bot (api/bot.php). A story mention is a thank-you for the team, not a question; a shared post gets the menu.
    $types = array_column((array) ($m['attachments'] ?? []), 'type');
    $plan = in_array('story_mention', $types, true) ? null : bot_plan_safe($chat, array_intersect($types, ['share', 'ig_reel', 'reel', 'ig_post']) ? 'share' : $first, $text,
        (string) ($m['quick_reply']['payload'] ?? $m['_tap'] ?? ''));
    if ($plan) $plan['wamid'] = $mid; // for "typing…" (api/bot.php)
    $bot = bot_takes($plan);
    db()->prepare("UPDATE wa_chats SET unread = unread + ?, last_in_at = ?, last_at = ?, last_text = ?, last_dir = 'in', first_in_at = COALESCE(first_in_at, ?), waiting_since = COALESCE(waiting_since, ?) WHERE id = ?")
        ->execute([$bot ? 0 : 1, $at, $at, mb_substr($preview, 0, 200), $at, $bot ? null : $at, $chat['id']]);
    bot_run_safe(wa_chat_by_wa_id($waId), $plan);
    if ($bot) return;
    try { tg_alert_message(wa_chat_by_wa_id($waId)); }
    catch (Throwable $e) { error_log('[shop] telegram alert: ' . $e->getMessage()); }
    if (sm_shop_chat($chat)) au_after_hours_safe(wa_chat_by_wa_id($waId)); // "we'll reply at 10" outside working hours (api/automations.php); the shop's text, so not on other brands' Pages
}

// A message the business sent. Ours (from this dashboard) are already saved; one written in the Instagram
// app or Meta Business Suite is added, so the chat here shows the whole conversation.
function sm_store_echo(string $channel, string $waId, array $m, string $at): void
{
    $mid = (string) ($m['mid'] ?? '');
    if (sm_seen($mid)) return;
    $chat = wa_chat_by_wa_id($waId);
    if (!$chat) return; // a chat we never had: nothing to add it to
    $appId = (string) ($m['app_id'] ?? '');
    [$text, $files] = sm_message_parts($m);
    if ($appId !== '' && $appId === sm_app_id()) return;
    // No app id on Instagram's echoes: one of ours sent in the last 10 minutes with the same text (or the same kind of file) is ours.
    $recent = db()->prepare("SELECT id, wamid, body, kind FROM wa_messages WHERE chat_id = ? AND dir = 'out' AND created_at > datetime('now', '-10 minutes') ORDER BY id DESC LIMIT 20");
    $recent->execute([$chat['id']]);
    foreach ($recent->fetchAll() as $r) {
        $same = $files ? $r['kind'] === $files[0]['kind'] || ($r['kind'] === 'image' && $files[0]['kind'] === 'sticker')
            : $text !== '' && ($r['body'] === $text || mb_strpos((string) $r['body'], $text) !== false);
        if ($same) return;
    }
    $kind = $files ? $files[0]['kind'] : 'text';
    $media = ['path' => '', 'mime' => '', 'size' => 0];
    if ($files) { try { $media = sm_download($files[0]['url'], $kind, $files[0]['name']); } catch (Throwable $e) {} }
    $via = $channel === 'ig' ? 'Instagram app' : 'Meta Business Suite';
    db()->prepare("INSERT INTO wa_messages (chat_id, wamid, dir, kind, body, media_path, media_mime, media_name, media_size, status, meta, created_at) VALUES (?, ?, 'out', ?, ?, ?, ?, ?, ?, 'sent', ?, ?)")
        ->execute([$chat['id'], $mid, $kind, $text, $media['path'], $media['mime'], $files[0]['name'] ?? '', $media['size'], json_encode(['via' => $via]), $at]);
    $preview = $text !== '' ? $text : '📎 ' . $kind;
    // Answered from the phone: the customer isn't waiting any more.
    db()->prepare("UPDATE wa_chats SET last_out_at = ?, last_at = ?, last_text = ?, last_dir = 'out', waiting_since = NULL, bot = CASE WHEN bot = 'on' THEN 'human' ELSE bot END, bot_at = CASE WHEN bot = 'on' THEN datetime('now') ELSE bot_at END, first_reply_at = COALESCE(first_reply_at, CASE WHEN first_in_at IS NOT NULL THEN ? END) WHERE id = ?")
        ->execute([$at, $at, mb_substr($preview, 0, 200), $at, $chat['id']]);
}

function sm_store_reaction(string $waId, array $r, bool $mine, string $at): void
{
    if ($mine || ($r['action'] ?? 'react') !== 'react') return;
    $chat = wa_chat_by_wa_id($waId);
    if (!$chat) return;
    $emoji = (string) ($r['emoji'] ?? '') ?: ['love' => '❤️', 'like' => '👍', 'haha' => '😆', 'wow' => '😮', 'sad' => '😢', 'angry' => '😠'][$r['reaction'] ?? ''] ?? '👍';
    db()->prepare("INSERT INTO wa_messages (chat_id, wamid, dir, kind, body, status, meta, created_at) VALUES (?, '', 'in', 'reaction', ?, 'received', ?, ?)")
        ->execute([$chat['id'], $emoji, json_encode(['reaction_to' => $r['mid'] ?? null]), $at]);
}

// Delivered / read: by message id, or everything we sent up to a time (Messenger's "watermark").
function sm_mark_status(string $waId, string $status, array $mids, int $watermark): void
{
    $chat = wa_chat_by_wa_id($waId);
    if (!$chat) return;
    $lower = $status === 'read' ? "('sending', 'sent', 'delivered')" : "('sending', 'sent')";
    if ($mids) {
        $last = 0;
        $st = db()->prepare("SELECT id FROM wa_messages WHERE chat_id = ? AND wamid = ?");
        foreach ($mids as $mid) { $st->execute([$chat['id'], (string) $mid]); $last = max($last, (int) $st->fetchColumn()); }
        // Instagram says "read up to this message": the ones before it were read too.
        if ($last) db()->prepare("UPDATE wa_messages SET status = ? WHERE chat_id = ? AND dir = 'out' AND id <= ? AND status IN $lower")->execute([$status, $chat['id'], $last]);
    }
    if ($watermark > 0) {
        db()->prepare("UPDATE wa_messages SET status = ? WHERE chat_id = ? AND dir = 'out' AND created_at <= ? AND status IN $lower")
            ->execute([$status, $chat['id'], gmdate('Y-m-d H:i:s', (int) floor($watermark / 1000))]);
    }
}

function sm_mark_deleted(string $mid): void
{
    if ($mid === '') return;
    db()->prepare("UPDATE wa_messages SET body = TRIM(body || ?) WHERE wamid = ? AND dir = 'in'")->execute(["\n(the customer deleted this message)", $mid]);
}

// ---------- sending ----------

// Text in pieces Meta accepts: Instagram takes 1000 bytes per message (about 500 Arabic letters), Messenger 2000 letters.
function sm_chunks(string $text, string $channel): array
{
    $out = [];
    $fits = function (string $s) use ($channel) { return $channel === 'ig' ? strlen($s) <= 990 : mb_strlen($s) <= 1990; };
    while ($text !== '') {
        if ($fits($text)) { $out[] = $text; break; }
        // Cut at the last line break (or space) that still fits.
        $n = $channel === 'ig' ? 480 : 1900;
        $piece = mb_substr($text, 0, $n);
        while (!$fits($piece)) $piece = mb_substr($piece, 0, (int) (mb_strlen($piece) * 0.9));
        $cut = max((int) mb_strrpos($piece, "\n"), (int) mb_strrpos($piece, ' '));
        if ($cut > mb_strlen($piece) / 2) $piece = mb_substr($piece, 0, $cut);
        $out[] = rtrim($piece);
        $text = ltrim(mb_substr($text, mb_strlen($piece)));
    }
    return $out;
}

// One message to a person; returns the shape wa_send_later() reads (['messages' => [['id' => …]]]).
function sm_send(array $chat, array $message): array
{
    $person = substr((string) $chat['wa_id'], 3);
    $page = sm_chat_page($chat); // always from the Page the customer wrote to
    $r = sm_graph('POST', '/' . rawurlencode($page['id']) . '/messages', ['recipient' => ['id' => $person], 'messaging_type' => 'RESPONSE', 'message' => $message], $page);
    return ['messages' => [['id' => (string) ($r['message_id'] ?? '')]]];
}

function sm_send_text(array $chat, string $text): array
{
    $r = [];
    foreach (sm_chunks($text, sm_channel($chat)) as $piece) $r = sm_send($chat, ['text' => $piece]);
    return $r;
}

// A file is sent by link: a signed address to our copy that works for an hour (Meta fetches it straight away).
function sm_file_url(string $rel): string
{
    $exp = time() + 3600;
    $sig = substr(hash_hmac('sha256', $rel . '|' . $exp, sm_app_secret()), 0, 32);
    return rtrim((string) cfg('site_url'), '/') . '/api/wa-file.php?f=' . rawurlencode($rel) . '&e=' . $exp . '&s=' . $sig;
}

function sm_file_ok(string $rel, int $exp, string $sig): bool
{
    return $exp > time() && sm_app_secret() !== '' && strpos($rel, '..') === false && hash_equals(substr(hash_hmac('sha256', $rel . '|' . $exp, sm_app_secret()), 0, 32), $sig);
}

// What Instagram and Messenger take as a file: kind => [types, max bytes].
function sm_send_types(string $channel): array
{
    $docs = WA_SEND_TYPES['document'][0];
    return $channel === 'ig'
        ? ['image' => [['image/jpeg', 'image/png', 'image/gif'], 8 * 1024 * 1024], 'video' => [['video/mp4', 'video/quicktime', 'video/webm'], 25 * 1024 * 1024],
           'audio' => [['audio/aac', 'audio/mp4', 'audio/wav', 'audio/x-wav'], 25 * 1024 * 1024], 'document' => [['application/pdf'], 25 * 1024 * 1024]]
        : ['image' => [['image/jpeg', 'image/png', 'image/gif'], 25 * 1024 * 1024], 'video' => [['video/mp4', 'video/quicktime'], 25 * 1024 * 1024],
           'audio' => [['audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/wav', 'audio/x-wav', 'audio/ogg'], 25 * 1024 * 1024], 'document' => [$docs, 25 * 1024 * 1024]];
}

function sm_send_file(array $chat, string $rel, string $kind, string $caption): array
{
    $r = sm_send($chat, ['attachment' => ['type' => $kind === 'document' ? 'file' : $kind, 'payload' => ['url' => sm_file_url($rel), 'is_reusable' => false]]]);
    if (trim($caption) !== '') $r = sm_send_text($chat, $caption);
    return $r;
}

// Seen ✓ for the customer once the team opens the chat (best effort).
function sm_mark_seen(array $chat): void
{
    sm_action($chat, 'mark_seen');
}

// "Seen" / "typing…" on the chat's own Page (best effort).
function sm_action(array $chat, string $action): void
{
    if (!sm_ready()) return;
    try { $page = sm_chat_page($chat); sm_graph('POST', '/' . rawurlencode($page['id']) . '/messages', ['recipient' => ['id' => substr((string) $chat['wa_id'], 3)], 'sender_action' => $action], $page); }
    catch (Throwable $e) {}
}

// ---------- Settings → Instagram & Messenger ----------

// The main Page's status as before, plus 'pages': the same for each of our other Pages.
function sm_status(bool $live): array
{
    $c = sm_cfg();
    $main = sm_main_page();
    $out = ['pageId' => !empty($c['page_id']), 'pageToken' => !empty($c['page_token']), 'appSecret' => sm_app_secret() !== '', 'ready' => sm_ready(),
        'verifyToken' => (bool) (($c['verify_token'] ?? '') ?: wa_cfg('verify_token')), 'webhook' => rtrim((string) cfg('site_url'), '/') . '/api/whatsapp-webhook.php',
        'lastWebhook' => wa_setting('sm_last_webhook', null), 'lastNote' => wa_setting('sm_last_note', null),
        'last' => ['ig' => null, 'fb' => null], 'profile' => wa_setting('sm_profile', null), 'label' => $main ? $main['label'] : '',
        'chats' => ['ig' => 0, 'fb' => 0], 'token' => null, 'page' => null, 'instagram' => null, 'subscribed' => null, 'errors' => [], 'pages' => []];
    $byPage = [];
    foreach (db()->query("SELECT page, channel, COUNT(*) n, MAX(last_in_at) last FROM wa_chats WHERE channel IN ('ig', 'fb') GROUP BY page, channel") as $r) {
        $pid = (string) $r['page'] === '' && $main ? $main['id'] : (string) $r['page'];
        $byPage[$pid]['chats'][$r['channel']] = ($byPage[$pid]['chats'][$r['channel']] ?? 0) + (int) $r['n'];
        $byPage[$pid]['last'][$r['channel']] = max((string) ($byPage[$pid]['last'][$r['channel']] ?? ''), (string) $r['last']) ?: null;
    }
    if ($main) {
        $out['chats'] = array_merge($out['chats'], $byPage[$main['id']]['chats'] ?? []);
        $out['last'] = array_merge($out['last'], $byPage[$main['id']]['last'] ?? []);
    }
    // Anything Meta sent for that app, even what didn't become a message (newer than the last saved message).
    foreach (['ig', 'fb'] as $chn) $out['last'][$chn] = max((string) $out['last'][$chn], (string) wa_setting(sm_multi() && $main ? 'sm_last_webhook_' . $chn . '_' . $main['id'] : 'sm_last_webhook_' . $chn, '')) ?: null;
    foreach (sm_pages() as $p) {
        $id = $p['id'];
        if ($p['main']) continue;
        $row = ['id' => $id, 'label' => $p['label'], 'pageToken' => $p['token'] !== '', 'ownToken' => $p['token'] !== (string) ($c['page_token'] ?? ''), 'bot' => $p['shop'],
            'chats' => array_merge(['ig' => 0, 'fb' => 0], $byPage[$id]['chats'] ?? []), 'last' => array_merge(['ig' => null, 'fb' => null], $byPage[$id]['last'] ?? []),
            'token' => null, 'page' => null, 'instagram' => null, 'subscribed' => null, 'errors' => []];
        foreach (['ig', 'fb'] as $chn) $row['last'][$chn] = max((string) $row['last'][$chn], (string) wa_setting('sm_last_webhook_' . $chn . '_' . $id, '')) ?: null;
        if ($live && $p['token'] !== '' && sm_app_secret() !== '') $row = array_merge($row, sm_page_live($p));
        $out['pages'][] = $row;
    }
    if (!$live || !sm_ready()) return $out;
    // The test also asks Meta again for chats still without a name or photo (the newest few).
    foreach (db()->query("SELECT * FROM wa_chats WHERE channel IN ('ig', 'fb') AND (COALESCE(name, '') = '' OR COALESCE(avatar, '') = '') ORDER BY last_at DESC LIMIT 10")->fetchAll() as $ch) {
        try { sm_fill_profile($ch, true); } catch (Throwable $e) {}
    }
    $out['profile'] = wa_setting('sm_profile', null);
    return array_merge($out, sm_page_live($main));
}

// What Meta says about one Page: its key's permissions, name, linked Instagram account and webhook subscription.
function sm_page_live(array $page): array
{
    $out = ['token' => null, 'page' => null, 'instagram' => null, 'subscribed' => null, 'errors' => []];
    // What the key in config.local.php is allowed to do, so a missing permission is named, not guessed.
    // pages_read_engagement isn't needed for messages (only for the Page's name), so it's not required.
    $igIds = [];
    try {
        $given = (string) $page['token'];
        $t = sm_call('GET', '/debug_token?input_token=' . rawurlencode($given), null, $given)['data'] ?? [];
        $scopes = array_values((array) ($t['scopes'] ?? []));
        $need = ['pages_messaging', 'pages_manage_metadata', 'pages_show_list', 'pages_read_engagement', 'instagram_basic', 'instagram_manage_messages'];
        $pages = [];
        foreach ((array) ($t['granular_scopes'] ?? []) as $g) {
            if (($g['scope'] ?? '') === 'pages_messaging') $pages = array_map('strval', (array) ($g['target_ids'] ?? []));
            // The Instagram accounts this key may message: how we find the linked account without reading the Page.
            if (in_array($g['scope'] ?? '', ['instagram_manage_messages', 'instagram_basic'], true)) $igIds = array_merge($igIds, array_map('strval', (array) ($g['target_ids'] ?? [])));
        }
        $out['token'] = ['type' => (string) ($t['type'] ?? ''), 'valid' => !empty($t['is_valid']), 'expires' => (int) ($t['expires_at'] ?? 0),
            'missing' => array_values(array_diff($need, $scopes)), 'pageAllowed' => !$pages || in_array($page['id'], $pages, true), 'app' => (string) ($t['application'] ?? '')];
    } catch (Throwable $e) { $out['errors'][] = 'Token check: ' . $e->getMessage(); }
    // The Page's name and linked Instagram account: from the Page when allowed, else from the Instagram account(s) on the key
    // (only with one Page: a system user's key can hold several Pages' accounts, and then it can't tell which is whose).
    try {
        $p = sm_graph('GET', '/' . rawurlencode($page['id']) . '?fields=name,instagram_business_account{id,username,name}', null, $page);
        $out['page'] = (string) ($p['name'] ?? '');
        $out['instagram'] = isset($p['instagram_business_account']['username']) ? (string) $p['instagram_business_account']['username'] : null;
        $ig = (string) ($p['instagram_business_account']['id'] ?? '');
        if ($ig !== '') { $kept = (array) wa_setting('sm_ig_ids', []); if (($kept[$page['id']] ?? '') !== $ig) { $kept[$page['id']] = $ig; wa_set_setting('sm_ig_ids', $kept); } }
    } catch (Throwable $e) {
        try { $out['page'] = (string) (sm_graph('GET', '/' . rawurlencode($page['id']) . '?fields=name', null, $page)['name'] ?? ''); } catch (Throwable $e2) {}
    }
    if ($out['instagram'] === null && $page['ig_id'] !== '') $igIds = [$page['ig_id']];
    elseif ($out['instagram'] === null && sm_multi()) $igIds = [];
    if ($out['instagram'] === null) {
        foreach (array_unique($igIds) as $id) {
            try { $u = (string) (sm_graph('GET', '/' . rawurlencode($id) . '?fields=username', null, $page)['username'] ?? ''); if ($u !== '') { $out['instagram'] = $u; break; } }
            catch (Throwable $e) { $out['errors'][] = 'Instagram account: ' . $e->getMessage(); }
        }
    }
    try {
        $apps = sm_graph('GET', '/' . rawurlencode($page['id']) . '/subscribed_apps', null, $page)['data'] ?? [];
        $fields = [];
        foreach ($apps as $a) if (sm_app_id() === '' || (string) ($a['id'] ?? '') === sm_app_id()) $fields = array_merge($fields, (array) ($a['subscribed_fields'] ?? []));
        $out['subscribed'] = in_array('messages', $fields, true);
    } catch (Throwable $e) { $out['errors'][] = $e->getMessage(); }
    return $out;
}

// Tell Meta to send this Page's (and its Instagram account's) messages to our webhook. '' = the main Page.
function sm_subscribe(string $pageId = ''): array
{
    $pages = sm_pages();
    $page = $pageId === '' ? sm_main_page() : ($pages[$pageId] ?? null);
    if (!$page) throw new ShopError('That Page isn’t in api/config.local.php.');
    sm_graph('POST', '/' . rawurlencode($page['id']) . '/subscribed_apps?subscribed_fields=messages,messaging_postbacks,message_deliveries,message_reads,message_echoes,messaging_referrals,message_reactions', null, $page);
    return $page;
}
