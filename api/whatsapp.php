<?php
// WhatsApp Business (Meta Cloud API): one business number, every chat kept in the dashboard.
//
// Incoming messages arrive at api/whatsapp-webhook.php and are stored here (wa_chats / wa_messages).
// A new number becomes a lead (with the ad it came from, if any) and the chat is given to a team
// member who takes WhatsApp chats, in turn. The team replies from the dashboard's Inbox.
//
// Photos, videos, voice notes and documents are downloaded straight away (Meta only keeps them for a
// short time) into <data_dir>/wa-media, outside the website folder; the team opens them through the
// dashboard only. Settings: 'whatsapp' block in api/config.local.php (see config.local.example.php).

const WA_KINDS = ['text', 'image', 'video', 'audio', 'document', 'sticker', 'location', 'contacts', 'reaction', 'interactive', 'button', 'template', 'note', 'unsupported'];
// What WhatsApp accepts when we send a file: kind => [mime types, max bytes].
const WA_SEND_TYPES = [
    'image' => [['image/jpeg', 'image/png'], 5 * 1024 * 1024],
    'video' => [['video/mp4', 'video/3gpp'], 16 * 1024 * 1024],
    'audio' => [['audio/aac', 'audio/mp4', 'audio/mpeg', 'audio/amr', 'audio/ogg'], 16 * 1024 * 1024],
    'document' => [['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'text/plain'], 32 * 1024 * 1024],
];

function wa_cfg(string $key = '', $default = null)
{
    $c = (array) (cfg('whatsapp') ?: []);
    return $key === '' ? $c : ($c[$key] ?? $default);
}

// Ready to send and receive: access key + phone number ID + app secret (to check incoming webhooks).
function wa_ready(): bool
{
    return wa_cfg('token') && wa_cfg('phone_number_id') && wa_cfg('app_secret');
}

function wa_graph_base(): string
{
    return rtrim((string) wa_cfg('graph_url', 'https://graph.facebook.com'), '/') . '/' . trim((string) wa_cfg('graph_version', 'v23.0'), '/');
}

// One call to Meta's Graph API. $body: array (sent as JSON) or, with $multipart, form fields incl. CURLFile.
function wa_graph(string $method, string $path, ?array $body = null, bool $multipart = false): array
{
    if (!wa_cfg('token')) throw new ShopError('WhatsApp isn’t connected yet (no access key in api/config.local.php).');
    $ch = curl_init(wa_graph_base() . $path);
    $headers = ['Authorization: Bearer ' . wa_cfg('token'), 'Accept: application/json'];
    if ($body !== null && !$multipart) $headers[] = 'Content-Type: application/json';
    // IPv4: some hosts try IPv6 first and wait seconds for it to fail before every call to Meta.
    curl_setopt_array($ch, [CURLOPT_CUSTOMREQUEST => $method, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 40, CURLOPT_CONNECTTIMEOUT => 8, CURLOPT_HTTPHEADER => $headers,
        CURLOPT_IPRESOLVE => CURL_IPRESOLVE_V4, CURLOPT_TCP_KEEPALIVE => 1]);
    if ($body !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, $multipart ? $body : json_encode($body, JSON_UNESCAPED_UNICODE));
    $raw = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err = curl_error($ch);
    if ($raw === false) throw new ShopError('Could not reach WhatsApp: ' . $err);
    $json = json_decode((string) $raw, true);
    if (!is_array($json)) throw new ShopError('Unexpected reply from WhatsApp (HTTP ' . $code . ').');
    if ($code >= 400 || isset($json['error'])) throw new ShopError('WhatsApp: ' . wa_error_text($json['error'] ?? [], $code));
    return $json;
}

// Meta's errors in words the team can act on.
function wa_error_text(array $e, int $code = 0): string
{
    $c = (int) ($e['code'] ?? 0);
    $known = [
        131047 => 'More than 24 hours have passed since the customer’s last message. Only an approved template can be sent now.',
        131026 => 'This number can’t receive WhatsApp messages.',
        131051 => 'This kind of message isn’t supported.',
        131052 => 'The customer’s file couldn’t be downloaded.',
        131053 => 'The file couldn’t be sent — check its type and size.',
        131056 => 'Too many messages to this customer in a short time. Wait a moment.',
        130429 => 'Too many messages at once. Try again shortly.',
        190 => 'The WhatsApp access key has expired or is wrong. Update it in api/config.local.php.',
        100 => 'WhatsApp rejected the request (check the phone number ID in api/config.local.php).',
        131030 => 'This number isn’t on the test number’s allowed list (Meta test mode).',
        133010 => 'The WhatsApp number isn’t registered yet. Settings → WhatsApp → Register the number.',
        133005 => 'Wrong PIN. Use the six-digit two-step verification PIN of this number (or reset it in WhatsApp Manager).',
        131031 => 'Meta has locked this WhatsApp account. Check WhatsApp Manager for the reason.',
        131042 => 'There’s a payment problem on the WhatsApp account. Add or fix the payment method in WhatsApp Manager.',
        368 => 'Meta has temporarily blocked this account for policy reasons. Check WhatsApp Manager.',
        131049 => 'Meta didn’t deliver this message to keep engagement healthy. Try again later or reply when the customer writes.',
        132001 => 'That message template doesn’t exist or isn’t approved yet.',
    ];
    if (isset($known[$c])) return $known[$c];
    $msg = $e['error_data']['details'] ?? $e['message'] ?? $e['title'] ?? ('HTTP ' . $code);
    return is_string($msg) ? $msg : json_encode($msg);
}

// ---------- storage ----------

function wa_media_dir(): string
{
    return cfg('data_dir') . '/wa-media';
}

// Small settings kept in the database (routing, how long videos are kept, last clean-up).
function wa_setting(string $key, $default = null)
{
    $st = db()->prepare('SELECT value FROM kv WHERE key = ?');
    $st->execute(['wa.' . $key]);
    $v = $st->fetchColumn();
    return $v === false ? $default : json_decode((string) $v, true);
}

function wa_set_setting(string $key, $value): void
{
    db()->prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')->execute(['wa.' . $key, json_encode($value)]);
}

// "201012345678" (WhatsApp's form) -> "01012345678" for Egyptian numbers; others as +country number.
function wa_local_phone(string $waId): string
{
    return preg_match('/^20(1\d{9})$/', $waId, $m) ? '0' . $m[1] : '+' . $waId;
}

// Any phone the team types -> WhatsApp's form (Egypt by default).
function wa_id_from_phone(string $phone): ?string
{
    $d = preg_replace('/\D/', '', strtr($phone, ['٠' => '0', '١' => '1', '٢' => '2', '٣' => '3', '٤' => '4', '٥' => '5', '٦' => '6', '٧' => '7', '٨' => '8', '٩' => '9']));
    if ($d === '') return null;
    if (strpos($d, '00') === 0) $d = substr($d, 2);
    if (preg_match('/^01\d{9}$/', $d)) $d = '2' . $d;
    if (preg_match('/^1\d{9}$/', $d)) $d = '20' . $d;
    return strlen($d) >= 10 ? $d : null;
}

function wa_chat_by_wa_id(string $waId): ?array
{
    $st = db()->prepare('SELECT * FROM wa_chats WHERE wa_id = ?');
    $st->execute([$waId]);
    return $st->fetch() ?: null;
}

// The team member a new chat goes to: the lead's own rep if they take WhatsApp chats, otherwise the
// next one in turn (whoever got a chat longest ago), skipping anyone marked away. Null = unassigned.
function wa_pick_agent(?array $lead): ?int
{
    $agents = db()->query("SELECT id, wa_away, wa_last_assigned FROM users WHERE active = 1 AND wa_agent = 1")->fetchAll();
    if (!$agents) return null;
    if ($lead && $lead['assigned_to']) {
        foreach ($agents as $a) if ((int) $a['id'] === (int) $lead['assigned_to'] && !(int) $a['wa_away']) return (int) $a['id'];
    }
    $free = array_values(array_filter($agents, function ($a) { return !(int) $a['wa_away']; }));
    if (!$free) return null;
    usort($free, function ($a, $b) { return strcmp((string) $a['wa_last_assigned'], (string) $b['wa_last_assigned']) ?: ((int) $a['id'] <=> (int) $b['id']); });
    return (int) $free[0]['id'];
}

function wa_assign(int $chatId, ?int $userId): void
{
    db()->prepare('UPDATE wa_chats SET assigned_to = ? WHERE id = ?')->execute([$userId, $chatId]);
    // Milliseconds, so chats arriving in the same second still alternate.
    if ($userId) db()->prepare("UPDATE users SET wa_last_assigned = strftime('%Y-%m-%d %H:%M:%f', 'now') WHERE id = ?")->execute([$userId]);
}

// The chat for a number, created on first contact together with its lead (or linked to the existing lead).
function wa_open_chat(string $waId, string $name, ?array $referral, string $firstText): array
{
    $chat = wa_chat_by_wa_id($waId);
    $local = wa_local_phone($waId);
    $lead = find_lead(phone_key($local), null);
    if ($chat) {
        // A customer writing again after a quiet day (or after the chat was closed) is noted on their lead.
        $quiet = !$chat['last_in_at'] || strtotime($chat['last_in_at'] . ' UTC') < time() - 86400;
        if ($chat['status'] !== 'open' || $quiet) {
            db()->prepare("UPDATE wa_chats SET status = 'open' WHERE id = ?")->execute([$chat['id']]);
            if ($lead) touch_lead($lead, date('Y-m-d') . ' · WhatsApp: ' . mb_substr($firstText, 0, 160), null, null);
        }
        if (!$chat['lead_id'] && $lead) db()->prepare('UPDATE wa_chats SET lead_id = ? WHERE id = ?')->execute([(int) $lead['id'], $chat['id']]);
        if (!$chat['assigned_to']) { $agent = wa_pick_agent($lead); if ($agent) wa_assign((int) $chat['id'], $agent); }
        if ($name !== '' && $chat['name'] !== $name) db()->prepare('UPDATE wa_chats SET name = ? WHERE id = ?')->execute([$name, $chat['id']]);
        return wa_chat_by_wa_id($waId);
    }
    $agent = wa_pick_agent($lead);
    $adHeadline = $referral ? trim((string) ($referral['headline'] ?? '')) : '';
    $note = date('Y-m-d') . ' · WhatsApp' . ($referral ? ' (from ad' . ($adHeadline !== '' ? ': ' . $adHeadline : '') . ')' : '') . ': ' . mb_substr($firstText, 0, 300);
    if ($lead) {
        touch_lead($lead, $note, null, $agent);
        $leadId = (int) $lead['id'];
    } else {
        $leadId = insert_lead(['name' => $name !== '' ? $name : $local, 'contact' => $local, 'cat' => mb_substr($adHeadline !== '' ? $adHeadline : $firstText, 0, 120),
            'source' => $referral ? 'WhatsApp ad' . ($adHeadline !== '' ? ': ' . mb_substr($adHeadline, 0, 80) : '') : 'WhatsApp',
            'status' => 'New', 'notes' => $note, 'assigned_to' => $agent]);
    }
    db()->prepare("INSERT INTO wa_chats (wa_id, name, lead_id, status, ad_id, ad_headline, ad_url, ad_body, created_at) VALUES (?, ?, ?, 'open', ?, ?, ?, ?, datetime('now'))")
        ->execute([$waId, $name, $leadId, $referral ? (string) ($referral['source_id'] ?? '') : '', $adHeadline,
            $referral ? (string) ($referral['source_url'] ?? '') : '', $referral ? mb_substr((string) ($referral['body'] ?? ''), 0, 500) : '']);
    $chatId = (int) db()->lastInsertId();
    if ($agent) wa_assign($chatId, $agent);
    log_activity(null, 'New WhatsApp chat', $local . ($name !== '' ? ' · ' . $name : '') . ($adHeadline !== '' ? ' · ad: ' . $adHeadline : ''));
    return wa_chat_by_wa_id($waId);
}

// Text shown in the chat list and on the lead for one incoming message.
function wa_message_text(array $m): array
{
    $type = (string) ($m['type'] ?? 'unsupported');
    switch ($type) {
        case 'text': return ['text', (string) ($m['text']['body'] ?? '')];
        case 'image': case 'video': case 'document': case 'sticker':
            return [$type, (string) ($m[$type]['caption'] ?? '')];
        case 'audio': return ['audio', ''];
        case 'location':
            $l = $m['location'] ?? [];
            return ['location', trim(($l['name'] ?? '') . ' ' . ($l['address'] ?? '')) . "\nhttps://maps.google.com/?q=" . ($l['latitude'] ?? '') . ',' . ($l['longitude'] ?? '')];
        case 'contacts':
            $out = [];
            foreach ((array) ($m['contacts'] ?? []) as $c) $out[] = trim(($c['name']['formatted_name'] ?? '') . ' ' . implode(', ', array_map(function ($p) { return $p['phone'] ?? ''; }, (array) ($c['phones'] ?? []))));
            return ['contacts', implode("\n", $out)];
        case 'reaction': return ['reaction', (string) ($m['reaction']['emoji'] ?? '')];
        case 'button': return ['button', (string) ($m['button']['text'] ?? '')];
        case 'interactive':
            $i = $m['interactive'] ?? [];
            return ['interactive', (string) ($i['button_reply']['title'] ?? $i['list_reply']['title'] ?? '')];
        default: return ['unsupported', 'Message type not supported by WhatsApp’s API (' . $type . ')'];
    }
}

// Download an incoming file from Meta into wa-media (streamed, so big files don't use memory).
function wa_download_media(string $mediaId, string $kind, string $filename = ''): array
{
    $info = wa_graph('GET', '/' . rawurlencode($mediaId));
    $mime = strtolower((string) ($info['mime_type'] ?? 'application/octet-stream'));
    $mime = trim(explode(';', $mime)[0]);
    $ext = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp', 'video/mp4' => 'mp4', 'video/3gpp' => '3gp', 'audio/ogg' => 'ogg', 'audio/mpeg' => 'mp3',
        'audio/mp4' => 'm4a', 'audio/aac' => 'aac', 'audio/amr' => 'amr', 'application/pdf' => 'pdf', 'text/plain' => 'txt'][$mime] ?? (pathinfo($filename, PATHINFO_EXTENSION) ?: 'bin');
    $ext = preg_replace('/[^a-z0-9]/i', '', $ext) ?: 'bin';
    $rel = date('Y-m') . '/' . $kind . '-' . bin2hex(random_bytes(8)) . '.' . strtolower($ext);
    $path = wa_media_dir() . '/' . $rel;
    if (!is_dir(dirname($path))) mkdir(dirname($path), 0750, true);
    $fh = fopen($path, 'wb');
    $ch = curl_init((string) $info['url']);
    curl_setopt_array($ch, [CURLOPT_FILE => $fh, CURLOPT_TIMEOUT => 90, CURLOPT_CONNECTTIMEOUT => 8, CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . wa_cfg('token')]]);
    $ok = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    fclose($fh);
    if (!$ok || $code >= 400) { @unlink($path); throw new ShopError('Could not download the customer’s file from WhatsApp.'); }
    return ['path' => $rel, 'mime' => $mime, 'size' => filesize($path)];
}

// Everything Meta sends to the webhook: new messages and delivery/read updates.
function wa_handle_webhook(array $payload): void
{
    // For Settings → WhatsApp: proof that Meta is delivering to us, and when.
    wa_set_setting('last_webhook', gmdate('Y-m-d H:i:s'));
    foreach ((array) ($payload['entry'] ?? []) as $entry) {
        foreach ((array) ($entry['changes'] ?? []) as $change) {
            $v = $change['value'] ?? [];
            // Only our own number (a WhatsApp account can hold several). Meta's "Test" button uses a made-up
            // number, so its sample lands here too; Settings shows it as a skipped sample, not a lost chat.
            if (wa_cfg('phone_number_id') && isset($v['metadata']['phone_number_id']) && (string) $v['metadata']['phone_number_id'] !== (string) wa_cfg('phone_number_id')) {
                wa_set_setting('last_note', ['at' => gmdate('Y-m-d H:i:s'), 'kind' => 'other_number', 'number' => (string) ($v['metadata']['display_phone_number'] ?? '')]);
                continue;
            }
            $names = [];
            foreach ((array) ($v['contacts'] ?? []) as $c) $names[(string) ($c['wa_id'] ?? '')] = (string) ($c['profile']['name'] ?? '');
            foreach ((array) ($v['messages'] ?? []) as $m) {
                try {
                    wa_store_incoming($m, $names[(string) ($m['from'] ?? '')] ?? '');
                    wa_set_setting('last_note', ['at' => gmdate('Y-m-d H:i:s'), 'kind' => 'saved']);
                } catch (Throwable $e) {
                    ops_error('WhatsApp', 'An incoming WhatsApp message could not be saved', $e);
                    wa_set_setting('last_note', ['at' => gmdate('Y-m-d H:i:s'), 'kind' => 'error', 'error' => mb_substr($e->getMessage(), 0, 300)]);
                }
            }
            foreach ((array) ($v['statuses'] ?? []) as $s) wa_store_status($s);
        }
    }
}

function wa_store_incoming(array $m, string $name): void
{
    $wamid = (string) ($m['id'] ?? '');
    $from = preg_replace('/\D/', '', (string) ($m['from'] ?? ''));
    if ($wamid === '' || $from === '') return;
    $seen = db()->prepare('SELECT 1 FROM wa_messages WHERE wamid = ?');
    $seen->execute([$wamid]);
    if ($seen->fetchColumn()) return; // Meta can deliver the same message twice
    [$kind, $text] = wa_message_text($m);
    $referral = isset($m['referral']) && is_array($m['referral']) ? $m['referral'] : null;
    $preview = $text !== '' ? $text : ['image' => '📷 Photo', 'video' => '🎥 Video', 'audio' => '🎤 Voice message', 'document' => '📄 Document', 'sticker' => 'Sticker'][$kind] ?? '';
    $chat = wa_open_chat($from, $name, $referral, $preview);
    if ($referral && !$chat['ad_id'] && !empty($referral['source_id'])) {
        // An existing customer tapping an ad: remember the latest ad on the chat too.
        db()->prepare('UPDATE wa_chats SET ad_id = ?, ad_headline = ?, ad_url = ? WHERE id = ?')
            ->execute([(string) $referral['source_id'], (string) ($referral['headline'] ?? ''), (string) ($referral['source_url'] ?? ''), $chat['id']]);
    }
    $media = ['path' => '', 'mime' => '', 'size' => 0];
    $fileName = '';
    if (in_array($kind, ['image', 'video', 'audio', 'document', 'sticker'], true) && !empty($m[$kind]['id'])) {
        $fileName = (string) ($m[$kind]['filename'] ?? '');
        try { $media = wa_download_media((string) $m[$kind]['id'], $kind, $fileName); }
        catch (Throwable $e) { $text = trim($text . "\n(" . $e->getMessage() . ')'); }
    }
    $meta = array_filter(['referral' => $referral, 'context' => $m['context']['id'] ?? null, 'reaction_to' => $m['reaction']['message_id'] ?? null]);
    $at = isset($m['timestamp']) ? gmdate('Y-m-d H:i:s', (int) $m['timestamp']) : gmdate('Y-m-d H:i:s');
    db()->prepare("INSERT INTO wa_messages (chat_id, wamid, dir, kind, body, media_path, media_mime, media_name, media_size, status, meta, created_at) VALUES (?, ?, 'in', ?, ?, ?, ?, ?, ?, 'received', ?, ?)")
        ->execute([$chat['id'], $wamid, $kind, $text, $media['path'], $media['mime'], $fileName, $media['size'], $meta ? json_encode($meta, JSON_UNESCAPED_UNICODE) : '', $at]);
    if ($kind === 'reaction') return; // a reaction doesn't need an answer
    // The chat bot (api/bot.php): a message it answers isn't waiting for anyone and alerts nobody.
    $tap = (string) ($m['interactive']['list_reply']['id'] ?? $m['interactive']['button_reply']['id'] ?? '');
    $plan = bot_plan_safe($chat, $kind, $text, $tap);
    if ($plan) $plan['wamid'] = $wamid; // for "typing…" (api/bot.php)
    $bot = bot_takes($plan);
    db()->prepare("UPDATE wa_chats SET unread = unread + ?, last_in_at = ?, last_at = ?, last_text = ?, last_dir = 'in', first_in_at = COALESCE(first_in_at, ?), waiting_since = COALESCE(waiting_since, ?) WHERE id = ?")
        ->execute([$bot ? 0 : 1, $at, $at, mb_substr($preview, 0, 200), $at, $bot ? null : $at, $chat['id']]);
    bot_run_safe(wa_chat_by_wa_id($from), $plan);
    if ($bot) return;
    // A ping on the phone of whoever has the chat (api/telegram.php); never holds up saving the message.
    try { tg_alert_message(wa_chat_by_wa_id($from)); }
    catch (Throwable $e) { error_log('[shop] telegram alert: ' . $e->getMessage()); }
    au_after_hours_safe(wa_chat_by_wa_id($from)); // "we'll reply at 10" outside working hours (api/automations.php)
}

// Sent → delivered → read (never backwards), or failed with the reason.
function wa_store_status(array $s): void
{
    $rank = ['sending' => 0, 'sent' => 1, 'delivered' => 2, 'read' => 3, 'failed' => 4];
    $status = (string) ($s['status'] ?? '');
    if (!isset($rank[$status])) return;
    $st = db()->prepare('SELECT id, status FROM wa_messages WHERE wamid = ?');
    $st->execute([(string) ($s['id'] ?? '')]);
    $row = $st->fetch();
    if (!$row || ($rank[$row['status']] ?? 0) >= $rank[$status]) return;
    $error = $status === 'failed' ? wa_error_text((array) ($s['errors'][0] ?? [])) : '';
    db()->prepare('UPDATE wa_messages SET status = ?, error = ? WHERE id = ?')->execute([$status, $error, $row['id']]);
}

// ---------- sending ----------

// The free-reply window: 24 hours from the customer's last message.
function wa_window_open(array $chat): bool
{
    return $chat['last_in_at'] && strtotime($chat['last_in_at'] . ' UTC') > time() - 86400;
}

// Replying after the window has closed: WhatsApp needs a template; Instagram and Messenger don't allow it at all.
function wa_window_check(array $chat): void
{
    if (wa_window_open($chat)) return;
    if (sm_channel($chat) === 'wa') throw new ShopError(wa_error_text(['code' => 131047]));
    throw new ShopError('More than 24 hours since the customer’s last message, so ' . SM_NAMES[sm_channel($chat)] . ' doesn’t allow a reply. The chat opens again when they write.');
}

// $userId null: sent by the shop itself (e.g. the payment thank-you).
function wa_record_out(array $chat, string $wamid, string $kind, string $body, array $media, ?int $userId, string $status = 'sent'): int
{
    db()->prepare("INSERT INTO wa_messages (chat_id, wamid, dir, kind, body, media_path, media_mime, media_name, media_size, status, user_id, created_at) VALUES (?, ?, 'out', ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))")
        ->execute([$chat['id'], $wamid, $kind, $body, $media['path'] ?? '', $media['mime'] ?? '', $media['name'] ?? '', $media['size'] ?? 0, $status, $userId]);
    $id = (int) db()->lastInsertId();
    $preview = $body !== '' ? $body : ['image' => '📷 Photo', 'video' => '🎥 Video', 'audio' => '🎤 Voice message', 'document' => '📄 ' . ($media['name'] ?? 'Document')][$kind] ?? '';
    // An automatic message (no team member) doesn't count as answering the customer.
    if ($userId === null) {
        db()->prepare("UPDATE wa_chats SET last_out_at = datetime('now'), last_at = datetime('now'), last_text = ?, last_dir = 'out' WHERE id = ?")->execute([mb_substr($preview, 0, 200), $chat['id']]);
        return $id;
    }
    // The customer got an answer: no longer waiting, and the first answer time is kept for the reports.
    // A person writing takes the chat from the bot.
    db()->prepare("UPDATE wa_chats SET last_out_at = datetime('now'), last_at = datetime('now'), last_text = ?, last_dir = 'out', waiting_since = NULL,
        bot = CASE WHEN bot = 'on' THEN 'human' ELSE bot END, bot_at = CASE WHEN bot = 'on' THEN datetime('now') ELSE bot_at END,
        first_reply_at = COALESCE(first_reply_at, CASE WHEN first_in_at IS NOT NULL THEN datetime('now') END), first_reply_by = COALESCE(first_reply_by, ?) WHERE id = ?")
        ->execute([mb_substr($preview, 0, 200), $userId, $chat['id']]);
    return $id;
}

// Sending in the background: the message is saved as 'sending' (🕓) and the dashboard gets its answer at
// once; the call to Meta runs after the reply has gone out. ✓ (or ⚠ with the reason) shows on the chat's
// next update. One chat's messages go out one at a time, in the order they were written.
function wa_send_later(int $messageId, int $chatId, callable $send): void
{
    register_shutdown_function(function () use ($messageId, $chatId, $send) {
        if (function_exists('litespeed_finish_request')) litespeed_finish_request();
        elseif (function_exists('fastcgi_finish_request')) fastcgi_finish_request();
        ignore_user_abort(true);
        $dir = wa_media_dir();
        if (!is_dir($dir)) @mkdir($dir, 0750, true);
        $lock = @fopen($dir . '/.send-' . $chatId . '.lock', 'c');
        if ($lock) flock($lock, LOCK_EX);
        try {
            $r = $send();
            db()->prepare("UPDATE wa_messages SET wamid = ?, status = CASE WHEN status = 'sending' THEN 'sent' ELSE status END WHERE id = ?")->execute([(string) ($r['messages'][0]['id'] ?? ''), $messageId]);
        } catch (Throwable $e) {
            db()->prepare("UPDATE wa_messages SET status = 'failed', error = ? WHERE id = ?")->execute([mb_substr($e->getMessage(), 0, 300), $messageId]);
        }
        if ($lock) { flock($lock, LOCK_UN); fclose($lock); }
    });
}

// $background: the inbox (instant, 🕓 then ✓); false for other pages, which wait for Meta's answer.
function wa_send_text(array $chat, string $text, ?int $userId, bool $preview = true, bool $background = false): int
{
    $text = trim($text);
    if ($text === '') throw new ShopError('Write a message first.');
    // The same message from the same person a moment ago (Enter pressed twice, a double tap): not sent again.
    if ($userId !== null) {
        $dup = db()->prepare("SELECT id FROM wa_messages WHERE chat_id = ? AND dir = 'out' AND user_id = ? AND body = ? AND created_at > datetime('now', '-20 seconds') ORDER BY id DESC LIMIT 1");
        $dup->execute([(int) $chat['id'], $userId, $text]);
        if ($id = (int) $dup->fetchColumn()) return $id;
    }
    wa_window_check($chat);
    $send = sm_channel($chat) !== 'wa' ? function () use ($chat, $text) { return sm_send_text($chat, $text); } : function () use ($chat, $text, $preview) {
        return wa_graph('POST', '/' . wa_cfg('phone_number_id') . '/messages', ['messaging_product' => 'whatsapp', 'recipient_type' => 'individual',
            'to' => $chat['wa_id'], 'type' => 'text', 'text' => ['body' => mb_substr($text, 0, 4096), 'preview_url' => $preview]]);
    };
    if ($background) {
        $id = wa_record_out($chat, '', 'text', $text, [], $userId, 'sending');
        wa_send_later($id, (int) $chat['id'], $send);
        return $id;
    }
    $r = $send();
    return wa_record_out($chat, (string) ($r['messages'][0]['id'] ?? ''), 'text', $text, [], $userId);
}

// Send a file the team uploaded (or a document made by the dashboard, e.g. a quote PDF).
function wa_send_file(array $chat, string $tmpPath, string $name, string $caption, ?int $userId, bool $background = false): int
{
    wa_window_check($chat);
    $channel = sm_channel($chat);
    $mime = (new finfo(FILEINFO_MIME_TYPE))->file($tmpPath) ?: 'application/octet-stream';
    if ($mime === 'audio/x-m4a') $mime = 'audio/mp4';
    // A voice note recorded on an iPhone (M4A) can look like an MP4 video to the type check.
    if ($mime === 'video/mp4' && preg_match('/\.m4a$/i', $name)) $mime = 'audio/mp4';
    $kind = null;
    $allowed = $channel === 'wa' ? WA_SEND_TYPES : sm_send_types($channel);
    $app = SM_NAMES[$channel];
    foreach ($allowed as $k => [$types, $max]) if (in_array($mime, $types, true)) { $kind = $k; break; }
    if (!$kind) throw new ShopError($app . ' can’t send this kind of file (' . $mime . ').' . ($channel === 'ig' ? ' Instagram takes photos (JPG, PNG), videos (MP4), and PDF files.' : ' Photos must be JPG or PNG; videos MP4.'));
    $size = filesize($tmpPath);
    if ($size > $allowed[$kind][1]) throw new ShopError('This file is too large for ' . $app . ' (max ' . ($allowed[$kind][1] >> 20) . ' MB for this type).');
    // Keep our own copy for the chat history.
    $ext = strtolower(pathinfo($name, PATHINFO_EXTENSION) ?: 'bin');
    $ext = preg_replace('/[^a-z0-9]/', '', $ext) ?: 'bin';
    $rel = date('Y-m') . '/out-' . $kind . '-' . bin2hex(random_bytes(8)) . '.' . $ext;
    $path = wa_media_dir() . '/' . $rel;
    if (!is_dir(dirname($path))) mkdir(dirname($path), 0750, true);
    if (!copy($tmpPath, $path)) throw new ShopError('Could not save the file.');
    $send = $channel !== 'wa' ? function () use ($chat, $rel, $kind, $caption) { return sm_send_file($chat, $rel, $kind, $caption); } : function () use ($chat, $path, $mime, $name, $caption, $kind) {
        $up = wa_graph('POST', '/' . wa_cfg('phone_number_id') . '/media', ['messaging_product' => 'whatsapp', 'type' => $mime, 'file' => new CURLFile($path, $mime, $name)], true);
        $obj = ['id' => (string) $up['id']];
        if ($caption !== '' && $kind !== 'audio') $obj['caption'] = mb_substr($caption, 0, 1024);
        if ($kind === 'document') $obj['filename'] = mb_substr($name, 0, 240);
        return wa_graph('POST', '/' . wa_cfg('phone_number_id') . '/messages', ['messaging_product' => 'whatsapp', 'recipient_type' => 'individual', 'to' => $chat['wa_id'], 'type' => $kind, $kind => $obj]);
    };
    $media = ['path' => $rel, 'mime' => $mime, 'name' => $name, 'size' => $size];
    if ($background) {
        // The copy stays for the chat history even if WhatsApp refuses it (the message shows ⚠).
        $id = wa_record_out($chat, '', $kind, $caption, $media, $userId, 'sending');
        wa_send_later($id, (int) $chat['id'], $send);
        return $id;
    }
    try { $r = $send(); } catch (Throwable $e) { @unlink($path); throw $e; }
    return wa_record_out($chat, (string) ($r['messages'][0]['id'] ?? ''), $kind, $caption, $media, $userId);
}

// A product from the shop: its photo, with name, short line, price and the link to order as the caption
// (in Arabic or English). The photo is sent as a JPEG, which WhatsApp always accepts.
function wa_send_product(array $chat, string $productId, bool $ar, ?int $userId): int
{
    wa_window_check($chat);
    $p = null;
    foreach (load_products(true) as $row) if ($row['id'] === $productId) { $p = $row; break; }
    if (!$p) throw new ShopError('That product isn’t in the shop (it may be a draft or archived).');
    $item = wa_product_brief($p, $ar);
    // Short, like the chat bot's cards (api/bot.php): the photo says the rest, the link has the details.
    $caption = bot_card_text($p, $ar);
    $photo = $p['images'] ? wa_product_photo((string) $p['images'][0]) : null;
    if (!$photo) return wa_send_text($chat, $caption, $userId, true, true);
    if (sm_channel($chat) !== 'wa') {
        // Instagram / Messenger: the photo, then the text (no *bold* there, so plain).
        $plain = str_replace('*', '', $caption);
        $id = wa_record_out($chat, '', 'image', $plain,
            ['path' => $photo['path'], 'mime' => 'image/jpeg', 'name' => $p['id'] . '.jpg', 'size' => filesize(wa_media_dir() . '/' . $photo['path'])], $userId, 'sending');
        wa_send_later($id, (int) $chat['id'], function () use ($chat, $photo, $plain) { return sm_send_file($chat, $photo['path'], 'image', $plain); });
        return $id;
    }
    // The photo's id at Meta is kept for 20 days (Meta keeps uploads 30), so sending the same product
    // again is a single quick call. If Meta no longer has it, upload again once.
    $send = function (bool $fresh) use ($chat, $photo, $caption) {
        $mid = $fresh ? null : wa_setting('pm.' . $photo['key']);
        if (!is_array($mid) || ($mid['at'] ?? 0) < time() - 20 * 86400) {
            $up = wa_graph('POST', '/' . wa_cfg('phone_number_id') . '/media', ['messaging_product' => 'whatsapp', 'type' => 'image/jpeg',
                'file' => new CURLFile(wa_media_dir() . '/' . $photo['path'], 'image/jpeg', 'product.jpg')], true);
            wa_set_setting('pm.' . $photo['key'], $mid = ['id' => (string) $up['id'], 'at' => time()]);
        }
        return wa_graph('POST', '/' . wa_cfg('phone_number_id') . '/messages', ['messaging_product' => 'whatsapp', 'recipient_type' => 'individual',
            'to' => $chat['wa_id'], 'type' => 'image', 'image' => ['id' => $mid['id'], 'caption' => mb_substr($caption, 0, 1024)]]);
    };
    $id = wa_record_out($chat, '', 'image', $caption,
        ['path' => $photo['path'], 'mime' => 'image/jpeg', 'name' => $p['id'] . '.jpg', 'size' => filesize(wa_media_dir() . '/' . $photo['path'])], $userId, 'sending');
    wa_send_later($id, (int) $chat['id'], function () use ($send) { try { return $send(false); } catch (ShopError $e) { return $send(true); } });
    return $id;
}

// What a product message needs (name, short line, price, in stock) without the full SEO texts.
function wa_product_brief(array $p, bool $ar): array
{
    $sizes = [];
    foreach ($p['variants'] as $v) {
        $price = (float) ($v['price'] ?: $p['price']);
        if ($p['discountPct']) $price = round($price * (1 - $p['discountPct'] / 100)); // whole pounds, like checkout (api/pricing.php)
        $sizes[] = ['label' => $v['label'], 'price' => $price, 'stock' => (int) $v['stock']];
    }
    $sale = $p['discountPct'] ? round($p['price'] * (1 - $p['discountPct'] / 100)) : (float) $p['price'];
    return ['title' => $ar && $p['nameAr'] ? $p['nameAr'] : $p['name'], 'summary' => $ar && $p['subAr'] ? $p['subAr'] : (string) $p['sub'],
        'cat' => $p['cat'], 'sizes' => $sizes, 'low' => $sizes ? min(array_column($sizes, 'price')) : $sale,
        'inStock' => $p['cat'] === 'services' || ($sizes ? array_sum(array_column($sizes, 'stock')) > 0 : $p['stock'] > 0)];
}

// A product photo as a JPEG (at most 1200 px wide, white behind transparent parts), made once and kept in
// wa-media/products/ (a new copy when the photo changes). It's also the picture shown in the chat history.
function wa_product_photo(string $path): ?array
{
    $root = realpath(dirname(__DIR__));
    $file = realpath($root . '/' . ltrim($path, '/'));
    if (!$file || strpos($file, $root) !== 0) return null;
    $key = substr(sha1($file . '|' . filemtime($file)), 0, 20);
    $rel = 'products/' . $key . '.jpg';
    $dest = wa_media_dir() . '/' . $rel;
    if (is_file($dest)) return ['path' => $rel, 'key' => $key];
    if (!function_exists('imagecreatetruecolor')) return null;
    $info = @getimagesize($file);
    $load = ['image/jpeg' => 'imagecreatefromjpeg', 'image/png' => 'imagecreatefrompng', 'image/webp' => 'imagecreatefromwebp'][$info['mime'] ?? ''] ?? null;
    if (!$load || !function_exists($load) || !($src = @$load($file))) return null;
    [$w, $h] = [imagesx($src), imagesy($src)];
    $nw = min(1200, $w);
    $nh = (int) round($h * $nw / $w);
    $out = imagecreatetruecolor($nw, $nh);
    imagefill($out, 0, 0, imagecolorallocate($out, 255, 255, 255));
    imagecopyresampled($out, $src, 0, 0, 0, 0, $nw, $nh, $w, $h);
    if (!is_dir(dirname($dest))) mkdir(dirname($dest), 0750, true);
    $ok = imagejpeg($out, $dest, 85);
    unset($src, $out);
    return $ok ? ['path' => $rel, 'key' => $key] : null;
}

// Blue ticks for the customer once the team opens the chat.
function wa_mark_read(array $chat): void
{
    $st = db()->prepare("SELECT wamid FROM wa_messages WHERE chat_id = ? AND dir = 'in' AND kind != 'reaction' ORDER BY id DESC LIMIT 1");
    $st->execute([$chat['id']]);
    $wamid = $st->fetchColumn();
    db()->prepare('UPDATE wa_chats SET unread = 0 WHERE id = ?')->execute([$chat['id']]);
    if (sm_channel($chat) !== 'wa') { if ($wamid) sm_mark_seen($chat); return; }
    if ($wamid && wa_ready()) {
        try { wa_graph('POST', '/' . wa_cfg('phone_number_id') . '/messages', ['messaging_product' => 'whatsapp', 'status' => 'read', 'message_id' => $wamid]); }
        catch (Throwable $e) { /* not important enough to bother the team */ }
    }
}

// ---------- payments ----------

// A Paymob payment arrived for an order: thank the customer in their WhatsApp chat (when the 24-hour
// window allows it) and tell whoever handles them on Telegram. Runs after the reply to Paymob/the customer.
function wa_payment_received(int $orderId, float $amount): void
{
    register_shutdown_function(function () use ($orderId, $amount) {
        if (function_exists('litespeed_finish_request')) litespeed_finish_request();
        elseif (function_exists('fastcgi_finish_request')) fastcgi_finish_request();
        ignore_user_abort(true);
        try {
            $st = db()->prepare('SELECT o.*, u.name AS rep_name FROM orders o LEFT JOIN users u ON u.id = o.rep_id WHERE o.id = ?');
            $st->execute([$orderId]);
            $o = $st->fetch();
            if (!$o) return;
            $num = order_number($orderId);
            $due = max(0, round((float) $o['total'] - order_paid($orderId), 2));
            $fmt = function ($n) { return number_format($n, $n == floor($n) ? 0 : 2); };
            $waId = wa_id_from_phone((string) $o['phone']);
            $chat = $waId ? wa_chat_by_wa_id($waId) : null;
            if ($chat && wa_ready() && wa_window_open($chat)) {
                $text = '✅ تم استلام دفعتك ' . $fmt($amount) . ' ج.م لطلب ' . $num . '. شكرًا لك!'
                    . ($due > 0 ? "\n" . 'المتبقي: ' . $fmt($due) . ' ج.م' : "\n" . 'طلبك مدفوع بالكامل، وهنتواصل معاك بخصوص التنفيذ والتوصيل.')
                    . "\n\n" . 'Payment received: EGP ' . $fmt($amount) . ' for order ' . $num . '. Thank you!' . ($due > 0 ? ' Remaining: EGP ' . $fmt($due) . '.' : '');
                try { wa_send_text($chat, $text, null, false); } catch (Throwable $e) { ops_error('WhatsApp', 'The payment thank-you message could not be sent', $e); }
            }
            if (!function_exists('tg_ready') || !tg_ready()) return;
            // Telegram: the chat's person, else the order's rep, else the managers.
            $who = $chat && $chat['assigned_to'] ? (int) $chat['assigned_to'] : ($o['rep_id'] ? (int) $o['rep_id'] : 0);
            if ($who) { $u = db()->prepare('SELECT id, name, tg_chat_id FROM users WHERE id = ? AND active = 1 AND tg_chat_id IS NOT NULL'); $u->execute([$who]); $to = $u->fetchAll(); }
            else $to = tg_managers();
            $msg = '💳 <b>Payment received · تم الدفع</b>' . "\n" . tg_h((string) $o['customer']) . ' paid <b>EGP ' . $fmt($amount) . '</b> for ' . $num
                . "\n" . ($due > 0 ? 'Still due · المتبقي: EGP ' . $fmt($due) : '✓ Fully paid · مدفوع بالكامل');
            $button = $chat ? tg_open_button($chat) : ['Open order · افتح الطلب', rtrim((string) cfg('site_url'), '/') . '/admin/#orders'];
            foreach ($to as $user) tg_send_user($user, $msg, $button);
        } catch (Throwable $e) {
            error_log('[shop] payment received notice: ' . $e->getMessage());
        }
    });
}

// ---------- housekeeping ----------

// Once a day: delete videos older than the chosen number of days (0 = keep). The message stays, marked as removed.
function wa_cleanup(): void
{
    if (wa_setting('cleaned_on') === gmdate('Y-m-d')) return;
    wa_set_setting('cleaned_on', gmdate('Y-m-d'));
    $days = (int) wa_setting('video_days', 90);
    if ($days <= 0) return;
    $st = db()->prepare("SELECT id, media_path FROM wa_messages WHERE kind = 'video' AND media_path != '' AND created_at < datetime('now', ?) LIMIT 500");
    $st->execute(['-' . $days . ' days']);
    $clear = db()->prepare("UPDATE wa_messages SET media_path = '', media_size = 0, body = TRIM(body || ?) WHERE id = ?");
    foreach ($st->fetchAll() as $m) {
        @unlink(wa_media_dir() . '/' . $m['media_path']);
        $clear->execute(["\n(video removed after " . $days . ' days to save space)', $m['id']]);
    }
}

function wa_storage_bytes(): int
{
    return (int) db()->query("SELECT COALESCE(SUM(media_size), 0) FROM wa_messages WHERE media_path != ''")->fetchColumn();
}


// ---------- going live: what Settings → WhatsApp checks ----------
// Everything Meta must have in place for real customer messages to arrive here and replies to go out.
function wa_live_status(): array
{
    $out = ['number' => null, 'token' => null, 'wabas' => [], 'errors' => []];
    try {
        $out['number'] = wa_graph('GET', '/' . rawurlencode((string) wa_cfg('phone_number_id')) . '?fields=display_phone_number,verified_name,quality_rating,code_verification_status,name_status,status,platform_type,account_mode,throughput');
    } catch (Throwable $e) { $out['errors'][] = $e->getMessage(); }
    // The access key itself: does it expire, and which WhatsApp accounts it can manage.
    $appId = null;
    try {
        $t = wa_graph('GET', '/debug_token?input_token=' . rawurlencode((string) wa_cfg('token')))['data'] ?? [];
        $appId = isset($t['app_id']) ? (string) $t['app_id'] : null;
        $out['token'] = ['expires' => (int) ($t['expires_at'] ?? 0), 'valid' => !empty($t['is_valid']), 'scopes' => $t['scopes'] ?? []];
        foreach ((array) ($t['granular_scopes'] ?? []) as $g) {
            if (in_array($g['scope'] ?? '', ['whatsapp_business_management', 'whatsapp_business_messaging'], true)) foreach ((array) ($g['target_ids'] ?? []) as $id) $out['wabas'][(string) $id] = null;
        }
    } catch (Throwable $e) { $out['errors'][] = $e->getMessage(); }
    if (wa_cfg('waba_id')) $out['wabas'] = [(string) wa_cfg('waba_id') => null] + $out['wabas'];
    // Which WhatsApp account holds our number: that's the one Meta sends its messages for, so it's the one
    // that must be connected (adding a number can create a second account next to the test one).
    $out['owner'] = null;
    foreach (array_keys($out['wabas']) as $id) {
        try {
            foreach ((array) (wa_graph('GET', '/' . rawurlencode($id) . '/phone_numbers?fields=id,display_phone_number')['data'] ?? []) as $n) {
                if ((string) ($n['id'] ?? '') === (string) wa_cfg('phone_number_id')) { $out['owner'] = (string) $id; break 2; }
            }
        } catch (Throwable $e) { /* not allowed to read this account: skip */ }
    }
    // Is our app subscribed to each WhatsApp account (without it Meta sends no messages to the webhook)?
    foreach (array_keys($out['wabas']) as $id) {
        try {
            $apps = wa_graph('GET', '/' . rawurlencode($id) . '/subscribed_apps')['data'] ?? [];
            $ids = array_map(function ($a) { return (string) ($a['whatsapp_business_api_data']['id'] ?? $a['id'] ?? ''); }, $apps);
            $out['wabas'][$id] = $appId ? in_array($appId, $ids, true) : (bool) $apps;
        } catch (Throwable $e) { $out['wabas'][$id] = false; $out['errors'][] = $e->getMessage(); }
    }
    $out['lastWebhook'] = wa_setting('last_webhook', null);
    return $out;
}

// ---------- message templates ----------
// After 24 hours without a message from the customer, WhatsApp only allows templates: messages Meta has
// approved in advance, with blanks ({{1}}, {{2}}…) filled in when sent. Ours are defined here, in Arabic and
// English; Settings → WhatsApp submits them to Meta and shows each one's status. Meta charges per template
// message (utility ones less than marketing ones).
//
// vars: what fills each blank, in order: name (first name), order (order number), due (amount due),
// and for the button: pay (payment link) or track (Bosta tracking number). 'needs' = what the chat must have.

const WA_TEMPLATES = [
    'wts_follow_up' => [
        'category' => 'MARKETING', 'vars' => ['name'], 'needs' => '',
        'title' => 'Follow-up',
        'ar' => "أهلًا يا {{1}} 👋\nمعاك فريق Where To Spot. حبينا نطمن لو محتاج أي تفاصيل أو مساعدة في طلبك، إحنا موجودين هنا ونرد عليك بسرعة.",
        'en' => "Hi {{1}} 👋\nThis is the Where To Spot team. Just checking in: if you need any details or help with your order, we're right here and happy to help.",
    ],
    'wts_payment_reminder' => [
        'category' => 'UTILITY', 'vars' => ['name', 'order', 'due'], 'needs' => 'unpaid',
        'title' => 'Payment reminder',
        'ar' => "أهلًا يا {{1}}،\nطلبك رقم {{2}} بقيمة {{3}} ج.م لسه مستني الدفع. تقدر تدفع بالبطاقة أو المحفظة الإلكترونية من الزرار تحت، والدفع آمن عبر Paymob.",
        'en' => "Hi {{1}},\nYour order {{2}} for EGP {{3}} is still waiting for payment. You can pay by card or mobile wallet with the button below. Payments are secure through Paymob.",
        'button' => ['var' => 'pay', 'ar' => 'ادفع الآن', 'en' => 'Pay now', 'base' => '/api/pay.php?', 'example' => 'o=1001&k=0a1b2c3d4e5f6a7b8c9d'],
    ],
    'wts_order_shipped' => [
        'category' => 'UTILITY', 'vars' => ['name', 'order'], 'needs' => 'shipped',
        'title' => 'Order shipped',
        'ar' => "أهلًا يا {{1}}،\nطلبك رقم {{2}} اتشحن مع بوسطة 🚚 وهيوصلك خلال أيام قليلة. تقدر تتابع الشحنة من الزرار تحت.",
        'en' => "Hi {{1}},\nYour order {{2}} has shipped with Bosta 🚚 and will reach you in a few days. You can follow the shipment with the button below.",
        'button' => ['var' => 'track', 'ar' => 'تتبع الشحنة', 'en' => 'Track shipment', 'base' => 'https://bosta.co/tracking-shipments?shipment-number=', 'example' => '7234519820'],
    ],
    // Sent by themselves when Bosta says so (Settings → Order updates, api/order-updates.php), or from the inbox.
    'wts_out_for_delivery' => [
        'category' => 'UTILITY', 'vars' => ['name', 'order'], 'needs' => 'shipped',
        'title' => 'Out for delivery',
        'ar' => "أهلًا يا {{1}}،\nطلبك رقم {{2}} خرج مع المندوب للتوصيل النهارده 🛵 خلي موبايلك جنبك عشان المندوب يقدر يكلمك.",
        'en' => "Hi {{1}},\nYour order {{2}} is out for delivery today 🛵 Please keep your phone close so the courier can reach you.",
    ],
    'wts_delivery_failed' => [
        'category' => 'UTILITY', 'vars' => ['name', 'order'], 'needs' => 'shipped',
        'title' => 'Delivery attempt failed',
        'ar' => "أهلًا يا {{1}}،\nالمندوب حاول يوصل طلبك رقم {{2}} ومقدرش. رد على الرسالة دي بالوقت أو العنوان المناسب لك، وفريقنا هيرتب التوصيل تاني.",
        'en' => "Hi {{1}},\nThe courier tried to deliver your order {{2}} but couldn't. Reply to this message with a time or address that suits you, and our team will arrange delivery again.",
    ],
    // Automatic only (Settings → Automatic messages, api/automations.php); not offered in the inbox.
    'wts_cart_reminder' => [
        'category' => 'MARKETING', 'vars' => ['name'], 'needs' => '', 'auto' => true,
        'title' => 'Cart reminder',
        'ar' => "أهلًا يا {{1}} 👋\nطلبك في Where To Spot لسه ما كملش، والسلة زي ما سبتها. تقدر تكمله في دقيقة من الزرار تحت.",
        'en' => "Hi {{1}} 👋\nYour Where To Spot order isn't finished yet, and your cart is just as you left it. You can complete it in a minute with the button below.",
        'button' => ['var' => 'cart', 'ar' => 'كمّل طلبك', 'en' => 'Complete your order', 'base' => '/?restore=', 'example' => '0a1b2c3d4e5f6a7b8c9d0e1f'],
    ],
    'wts_reorder' => [
        'category' => 'MARKETING', 'vars' => ['name', 'product'], 'needs' => '', 'auto' => true,
        'title' => 'Reorder reminder',
        'ar' => "أهلًا يا {{1}} 👋\nقرّبت تخلص {{2}}؟ تقدر تطلبها تاني في دقيقة من الزرار تحت، وتوصلك خلال 2–5 أيام.",
        'en' => "Hi {{1}} 👋\nRunning low on {{2}}? You can order it again in a minute with the button below; it reaches you in 2–5 days.",
        'button' => ['var' => 'product', 'ar' => 'اطلب تاني', 'en' => 'Order again', 'base' => '/p/', 'example' => 'bonds-chrome'],
    ],
    'wts_order_delivered' => [
        'category' => 'UTILITY', 'vars' => ['name', 'order'], 'needs' => 'delivered',
        'title' => 'Order delivered',
        'ar' => "أهلًا يا {{1}}،\nطلبك رقم {{2}} اتسلم ✅ نتمنى يعجبك! لو عندك أي سؤال أو ملاحظة، رد على الرسالة دي وهنساعدك على طول.",
        'en' => "Hi {{1}},\nYour order {{2}} has been delivered ✅ We hope you love it! If you have any question or comment, just reply to this message and we'll help right away.",
    ],
];

// The WhatsApp account (WABA) that holds our number: from config, else found once and remembered.
function wa_waba_id(): string
{
    if (wa_cfg('waba_id')) return (string) wa_cfg('waba_id');
    $saved = wa_setting('waba_owner');
    if (is_array($saved) && ($saved['phone'] ?? '') === (string) wa_cfg('phone_number_id') && !empty($saved['id'])) return (string) $saved['id'];
    $owner = wa_live_status()['owner'] ?? null;
    if (!$owner) throw new ShopError('Couldn’t find the WhatsApp account of this number. Add \'waba_id\' to the whatsapp block in api/config.local.php.');
    wa_set_setting('waba_owner', ['id' => $owner, 'phone' => (string) wa_cfg('phone_number_id')]);
    return $owner;
}

function wa_template_button_url(array $b): string
{
    return strpos($b['base'], 'http') === 0 ? $b['base'] : rtrim((string) cfg('site_url'), '/') . $b['base'];
}

// Our templates with their status at Meta (one row per template and language).
function wa_template_status(): array
{
    $meta = [];
    $res = wa_graph('GET', '/' . rawurlencode(wa_waba_id()) . '/message_templates?fields=name,language,status,category,rejected_reason&limit=200');
    foreach ((array) ($res['data'] ?? []) as $t) $meta[$t['name'] . '|' . $t['language']] = $t;
    wa_set_setting('templates_seen', array_map(function ($t) { return ['status' => $t['status'] ?? '', 'category' => $t['category'] ?? '']; }, $meta));
    wa_set_setting('templates_seen_at', time());
    $rows = [];
    foreach (WA_TEMPLATES as $name => $t) foreach (['ar', 'en'] as $lang) {
        $m = $meta[$name . '|' . $lang] ?? null;
        $rows[] = ['name' => $name, 'title' => $t['title'], 'lang' => $lang, 'category' => $m['category'] ?? $t['category'],
            'status' => $m['status'] ?? 'NOT_SUBMITTED', 'reason' => ($m['rejected_reason'] ?? '') !== 'NONE' ? (string) ($m['rejected_reason'] ?? '') : '', 'text' => $t[$lang]];
    }
    return $rows;
}

// Submit the templates Meta doesn't have yet (both languages). Returns how many were sent and any errors.
function wa_templates_submit(): array
{
    $have = [];
    foreach (wa_template_status() as $r) if ($r['status'] !== 'NOT_SUBMITTED') $have[$r['name'] . '|' . $r['lang']] = true;
    $sent = 0; $errors = [];
    foreach (WA_TEMPLATES as $name => $t) foreach (['ar', 'en'] as $lang) {
        if (isset($have[$name . '|' . $lang])) continue;
        $examples = ['name' => $lang === 'ar' ? 'أحمد' : 'Ahmed', 'order' => 'WTS-1024', 'due' => '450', 'product' => $lang === 'ar' ? 'قهوة كروم بلند' : 'Chrome Coffee Blend'];
        $components = [['type' => 'BODY', 'text' => $t[$lang], 'example' => ['body_text' => [array_map(function ($v) use ($examples) { return $examples[$v]; }, $t['vars'])]]]];
        if (!empty($t['button'])) {
            $b = $t['button'];
            $components[] = ['type' => 'BUTTONS', 'buttons' => [['type' => 'URL', 'text' => $b[$lang], 'url' => wa_template_button_url($b) . '{{1}}', 'example' => [wa_template_button_url($b) . $b['example']]]]];
        }
        try {
            wa_graph('POST', '/' . rawurlencode(wa_waba_id()) . '/message_templates', ['name' => $name, 'language' => $lang, 'category' => $t['category'], 'components' => $components]);
            $sent++;
        } catch (Throwable $e) { $errors[] = $t['title'] . ' (' . $lang . '): ' . $e->getMessage(); }
    }
    return ['sent' => $sent, 'errors' => $errors];
}

// What fills the blanks for this chat, per template: ready to send, or why not (e.g. no unpaid order).
function wa_template_options(array $chat, string $lang): array
{
    // Meta's approval can arrive any time: check again when it's been 5 minutes and one isn't approved yet.
    $seen = (array) wa_setting('templates_seen', []);
    $pending = count(array_filter($seen, function ($t) { return ($t['status'] ?? '') === 'APPROVED'; })) < count(WA_TEMPLATES) * 2;
    if ($pending && (int) wa_setting('templates_seen_at', 0) < time() - 300) {
        try { wa_template_status(); $seen = (array) wa_setting('templates_seen', []); } catch (Throwable $e) { /* use what we know */ }
    }
    $lead = null;
    if ($chat['lead_id']) { $st = db()->prepare('SELECT name FROM leads WHERE id = ?'); $st->execute([(int) $chat['lead_id']]); $lead = $st->fetchColumn(); }
    $first = preg_split('/\s+/', trim((string) ($lead ?: $chat['name'])))[0] ?? '';
    $name = mb_strlen($first) > 1 && !preg_match('/\d/', $first) ? $first : ($lang === 'ar' ? 'حضرتك' : 'there');
    // This customer's orders (same phone number), newest first.
    $orders = [];
    if ($key = phone_key(wa_local_phone($chat['wa_id']))) {
        $st = db()->prepare("SELECT * FROM orders WHERE REPLACE(REPLACE(REPLACE(phone, ' ', ''), '-', ''), '+', '') LIKE ? ORDER BY id DESC LIMIT 20");
        $st->execute(['%' . $key]);
        $orders = $st->fetchAll();
    }
    $pick = function (string $needs) use ($orders) {
        foreach ($orders as $o) {
            // Online-payment orders not paid yet (a cash-on-delivery order isn't "waiting for payment").
            if ($needs === 'unpaid' && ($o['status'] === 'Awaiting payment' || ($o['payment'] !== 'cod' && in_array($o['status'], ['Pending', 'Confirmed'], true))) && pay_link_problem($o) === '') return $o;
            if ($needs === 'shipped' && $o['status'] === 'Shipped' && $o['tracking_number']) return $o;
            if ($needs === 'delivered' && $o['status'] === 'Delivered') return $o;
        }
        return null;
    };
    $out = [];
    foreach (WA_TEMPLATES as $tname => $t) {
        if (!empty($t['auto'])) continue;
        $status = $seen[$tname . '|' . $lang]['status'] ?? 'NOT_SUBMITTED';
        $o = $t['needs'] ? $pick($t['needs']) : null;
        $why = $status !== 'APPROVED' ? ($status === 'NOT_SUBMITTED' ? 'Not submitted to Meta yet (Settings → WhatsApp).' : 'Meta status: ' . strtolower(str_replace('_', ' ', $status)) . '.')
            : ($t['needs'] && !$o ? ['unpaid' => 'No unpaid online order for this customer.', 'shipped' => 'No shipped order with a tracking number.', 'delivered' => 'No delivered order.'][$t['needs']] : '');
        $vals = [];
        if ($o) $due = round((float) $o['total'] - order_paid((int) $o['id']), 2);
        foreach ($t['vars'] as $v) $vals[] = $v === 'name' ? $name : ($v === 'order' ? ($o ? order_number((int) $o['id']) : '') : ($o ? number_format($due, $due == floor($due) ? 0 : 2) : ''));
        $btn = null;
        if (!empty($t['button']) && $o) $btn = $t['button']['var'] === 'pay' ? 'o=' . (int) $o['id'] . '&k=' . pay_link_key((int) $o['id']) : (string) $o['tracking_number'];
        $text = $t[$lang];
        foreach ($vals as $i => $v) $text = str_replace('{{' . ($i + 1) . '}}', $v !== '' ? $v : '…', $text);
        $out[] = ['name' => $tname, 'title' => $t['title'], 'category' => $t['category'], 'ready' => $why === '', 'why' => $why, 'preview' => $text,
            'button' => !empty($t['button']) ? $t['button'][$lang] : '', 'orderId' => $o ? (int) $o['id'] : null, 'vals' => $vals, 'btn' => $btn];
    }
    return $out;
}

// Send one template to a chat (any time, even after 24 hours). Saved in the history with its text filled in.
function wa_send_template(array $chat, string $name, string $lang, int $userId): int
{
    if (!isset(WA_TEMPLATES[$name])) throw new ShopError('Unknown template.');
    if (sm_channel($chat) !== 'wa') throw new ShopError('Templates are for WhatsApp only.');
    $opt = null;
    foreach (wa_template_options($chat, $lang) as $o) if ($o['name'] === $name) $opt = $o;
    if (!$opt || !$opt['ready']) throw new ShopError($opt['why'] ?? 'This template can’t be sent.');
    return wa_send_template_filled($chat, $name, $lang, $opt['vals'], $opt['btn'], $userId);
}

// A template with its blanks already chosen (also for automatic order updates, $userId null).
function wa_send_template_filled(array $chat, string $name, string $lang, array $vals, ?string $btn, ?int $userId): int
{
    $t = WA_TEMPLATES[$name];
    $components = [['type' => 'body', 'parameters' => array_map(function ($v) { return ['type' => 'text', 'text' => (string) $v]; }, $vals)]];
    if ($btn !== null) $components[] = ['type' => 'button', 'sub_type' => 'url', 'index' => '0', 'parameters' => [['type' => 'text', 'text' => $btn]]];
    $text = $t[$lang];
    foreach ($vals as $i => $v) $text = str_replace('{{' . ($i + 1) . '}}', (string) $v, $text);
    $body = $text . (!empty($t['button']) ? "\n[" . $t['button'][$lang] . ']' : '');
    $id = wa_record_out($chat, '', 'template', $body, [], $userId, 'sending');
    wa_send_later($id, (int) $chat['id'], function () use ($chat, $name, $lang, $components) {
        return wa_graph('POST', '/' . wa_cfg('phone_number_id') . '/messages', ['messaging_product' => 'whatsapp', 'recipient_type' => 'individual', 'to' => $chat['wa_id'],
            'type' => 'template', 'template' => ['name' => $name, 'language' => ['code' => $lang], 'components' => $components]]);
    });
    return $id;
}
