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
    curl_setopt_array($ch, [CURLOPT_CUSTOMREQUEST => $method, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 40, CURLOPT_CONNECTTIMEOUT => 8, CURLOPT_HTTPHEADER => $headers]);
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
                    error_log('[shop] whatsapp message failed: ' . $e->getMessage());
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
    db()->prepare("UPDATE wa_chats SET unread = unread + 1, last_in_at = ?, last_at = ?, last_text = ?, last_dir = 'in', first_in_at = COALESCE(first_in_at, ?), waiting_since = COALESCE(waiting_since, ?) WHERE id = ?")
        ->execute([$at, $at, mb_substr($preview, 0, 200), $at, $at, $chat['id']]);
    // A ping on the phone of whoever has the chat (api/telegram.php); never holds up saving the message.
    try { tg_alert_message(wa_chat_by_wa_id($from), !empty($chat['waiting_since'])); }
    catch (Throwable $e) { error_log('[shop] telegram alert: ' . $e->getMessage()); }
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

function wa_record_out(array $chat, string $wamid, string $kind, string $body, array $media, int $userId): int
{
    db()->prepare("INSERT INTO wa_messages (chat_id, wamid, dir, kind, body, media_path, media_mime, media_name, media_size, status, user_id, created_at) VALUES (?, ?, 'out', ?, ?, ?, ?, ?, ?, 'sent', ?, datetime('now'))")
        ->execute([$chat['id'], $wamid, $kind, $body, $media['path'] ?? '', $media['mime'] ?? '', $media['name'] ?? '', $media['size'] ?? 0, $userId]);
    $id = (int) db()->lastInsertId();
    $preview = $body !== '' ? $body : ['image' => '📷 Photo', 'video' => '🎥 Video', 'audio' => '🎤 Voice message', 'document' => '📄 ' . ($media['name'] ?? 'Document')][$kind] ?? '';
    // The customer got an answer: no longer waiting, and the first answer time is kept for the reports.
    db()->prepare("UPDATE wa_chats SET last_out_at = datetime('now'), last_at = datetime('now'), last_text = ?, last_dir = 'out', waiting_since = NULL,
        first_reply_at = COALESCE(first_reply_at, CASE WHEN first_in_at IS NOT NULL THEN datetime('now') END), first_reply_by = COALESCE(first_reply_by, ?) WHERE id = ?")
        ->execute([mb_substr($preview, 0, 200), $userId, $chat['id']]);
    return $id;
}

function wa_send_text(array $chat, string $text, int $userId): int
{
    $text = trim($text);
    if ($text === '') throw new ShopError('Write a message first.');
    if (!wa_window_open($chat)) throw new ShopError(wa_error_text(['code' => 131047]));
    $r = wa_graph('POST', '/' . wa_cfg('phone_number_id') . '/messages', ['messaging_product' => 'whatsapp', 'recipient_type' => 'individual',
        'to' => $chat['wa_id'], 'type' => 'text', 'text' => ['body' => mb_substr($text, 0, 4096), 'preview_url' => true]]);
    return wa_record_out($chat, (string) ($r['messages'][0]['id'] ?? ''), 'text', $text, [], $userId);
}

// Send a file the team uploaded (or a document made by the dashboard, e.g. a quote PDF).
function wa_send_file(array $chat, string $tmpPath, string $name, string $caption, int $userId): int
{
    if (!wa_window_open($chat)) throw new ShopError(wa_error_text(['code' => 131047]));
    $mime = (new finfo(FILEINFO_MIME_TYPE))->file($tmpPath) ?: 'application/octet-stream';
    if ($mime === 'audio/x-m4a') $mime = 'audio/mp4';
    $kind = null;
    foreach (WA_SEND_TYPES as $k => [$types, $max]) if (in_array($mime, $types, true)) { $kind = $k; break; }
    if (!$kind) throw new ShopError('WhatsApp can’t send this kind of file (' . $mime . '). Photos must be JPG or PNG; videos MP4.');
    $size = filesize($tmpPath);
    if ($size > WA_SEND_TYPES[$kind][1]) throw new ShopError('This file is too large for WhatsApp (max ' . (WA_SEND_TYPES[$kind][1] >> 20) . ' MB for this type).');
    // Keep our own copy for the chat history.
    $ext = strtolower(pathinfo($name, PATHINFO_EXTENSION) ?: 'bin');
    $ext = preg_replace('/[^a-z0-9]/', '', $ext) ?: 'bin';
    $rel = date('Y-m') . '/out-' . $kind . '-' . bin2hex(random_bytes(8)) . '.' . $ext;
    $path = wa_media_dir() . '/' . $rel;
    if (!is_dir(dirname($path))) mkdir(dirname($path), 0750, true);
    if (!copy($tmpPath, $path)) throw new ShopError('Could not save the file.');
    try {
        $up = wa_graph('POST', '/' . wa_cfg('phone_number_id') . '/media', ['messaging_product' => 'whatsapp', 'type' => $mime, 'file' => new CURLFile($path, $mime, $name)], true);
        $obj = ['id' => (string) $up['id']];
        if ($caption !== '' && $kind !== 'audio') $obj['caption'] = mb_substr($caption, 0, 1024);
        if ($kind === 'document') $obj['filename'] = mb_substr($name, 0, 240);
        $r = wa_graph('POST', '/' . wa_cfg('phone_number_id') . '/messages', ['messaging_product' => 'whatsapp', 'recipient_type' => 'individual', 'to' => $chat['wa_id'], 'type' => $kind, $kind => $obj]);
    } catch (Throwable $e) { @unlink($path); throw $e; }
    return wa_record_out($chat, (string) ($r['messages'][0]['id'] ?? ''), $kind, $caption, ['path' => $rel, 'mime' => $mime, 'name' => $name, 'size' => $size], $userId);
}

// Blue ticks for the customer once the team opens the chat.
function wa_mark_read(array $chat): void
{
    $st = db()->prepare("SELECT wamid FROM wa_messages WHERE chat_id = ? AND dir = 'in' AND kind != 'reaction' ORDER BY id DESC LIMIT 1");
    $st->execute([$chat['id']]);
    $wamid = $st->fetchColumn();
    db()->prepare('UPDATE wa_chats SET unread = 0 WHERE id = ?')->execute([$chat['id']]);
    if ($wamid && wa_ready()) {
        try { wa_graph('POST', '/' . wa_cfg('phone_number_id') . '/messages', ['messaging_product' => 'whatsapp', 'status' => 'read', 'message_id' => $wamid]); }
        catch (Throwable $e) { /* not important enough to bother the team */ }
    }
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
