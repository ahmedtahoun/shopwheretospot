<?php
// Email alerts for new orders and leads. No external service needed:
//  - If 'smtp' is set in config.local.php, mail is sent through that mailbox (best delivery).
//  - Otherwise PHP's built-in mail() is used (works on cPanel, but may land in spam without SPF).

function send_mail(array $to, string $subject, string $html, string $text): bool
{
    $to = array_values(array_unique(array_filter($to, function ($e) { return filter_var($e, FILTER_VALIDATE_EMAIL); })));
    if (!$to) return false;
    $smtp = cfg('smtp');
    $fromEmail = $smtp['user'] ?? cfg('mail_from');
    $fromName = cfg('mail_from_name');
    $boundary = 'b' . bin2hex(random_bytes(8));
    $encSubject = '=?UTF-8?B?' . base64_encode($subject) . '?=';
    $headers = [
        'From: =?UTF-8?B?' . base64_encode($fromName) . '?= <' . $fromEmail . '>',
        'Reply-To: ' . cfg('reply_to'),
        'MIME-Version: 1.0',
        'Content-Type: multipart/alternative; boundary="' . $boundary . '"',
        'X-Mailer: WTS-Shop',
    ];
    $body = "--$boundary\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n" . chunk_split(base64_encode($text))
        . "--$boundary\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n" . chunk_split(base64_encode($html))
        . "--$boundary--\r\n";

    try {
        if ($smtp && !empty($smtp['host'])) {
            return smtp_send($smtp, $fromEmail, $to, array_merge([
                'To: ' . implode(', ', $to), 'Subject: ' . $encSubject, 'Date: ' . date('r'),
                'Message-ID: <' . bin2hex(random_bytes(12)) . '@' . substr(strrchr($fromEmail, '@'), 1) . '>',
            ], $headers), $body);
        }
        return mail(implode(', ', $to), $encSubject, $body, implode("\r\n", $headers), '-f' . $fromEmail);
    } catch (Throwable $e) {
        error_log('[shop mail] to ' . implode(', ', $to) . ': ' . $e->getMessage());
        return false;
    }
}

// Minimal SMTP client (SSL on 465 or STARTTLS on 587) with AUTH LOGIN — enough for a cPanel mailbox.
function smtp_send(array $c, string $from, array $to, array $headers, string $body): bool
{
    $port = (int) ($c['port'] ?? 465);
    $host = ($port === 465 ? 'ssl://' : 'tcp://') . $c['host'];
    $fp = @stream_socket_client($host . ':' . $port, $errno, $errstr, 15);
    if (!$fp) throw new RuntimeException("SMTP connect failed: $errstr");
    stream_set_timeout($fp, 15);
    $read = function () use ($fp) {
        $out = '';
        while (($line = fgets($fp, 515)) !== false) { $out .= $line; if (isset($line[3]) && $line[3] === ' ') break; }
        return $out;
    };
    $cmd = function (string $line, array $ok) use ($fp, $read) {
        if ($line !== '') fwrite($fp, $line . "\r\n");
        $res = $read();
        if (!in_array((int) substr($res, 0, 3), $ok, true)) throw new RuntimeException('SMTP error after "' . explode(' ', $line)[0] . '": ' . trim($res));
        return $res;
    };
    $cmd('', [220]);
    $helo = $_SERVER['SERVER_NAME'] ?? 'localhost';
    $cmd('EHLO ' . $helo, [250]);
    if ($port !== 465) {
        $cmd('STARTTLS', [220]);
        if (!stream_socket_enable_crypto($fp, true, STREAM_CRYPTO_METHOD_TLS_CLIENT)) throw new RuntimeException('STARTTLS failed');
        $cmd('EHLO ' . $helo, [250]);
    }
    $cmd('AUTH LOGIN', [334]);
    $cmd(base64_encode($c['user']), [334]);
    $cmd(base64_encode($c['pass']), [235]);
    $cmd('MAIL FROM:<' . $from . '>', [250]);
    foreach ($to as $r) $cmd('RCPT TO:<' . $r . '>', [250, 251]);
    $cmd('DATA', [354]);
    $data = implode("\r\n", $headers) . "\r\n\r\n" . $body;
    $data = preg_replace('/^\./m', '..', $data); // dot-stuffing
    $cmd($data . "\r\n.", [250]);
    $cmd('QUIT', [221]);
    fclose($fp);
    return true;
}

// Team members who ticked "Email me new orders", plus any fixed addresses from config.
function alert_recipients(): array
{
    $emails = db()->query('SELECT email FROM users WHERE active = 1 AND notify = 1')->fetchAll(PDO::FETCH_COLUMN);
    return array_merge($emails, (array) cfg('alert_emails'));
}

function h($v): string
{
    return htmlspecialchars((string) $v, ENT_QUOTES, 'UTF-8');
}

function wa_link(string $phone): string
{
    $digits = preg_replace('/\D/', '', $phone);
    if (strpos($digits, '0') === 0) $digits = '20' . substr($digits, 1); // Egyptian local 01x… → 201x…
    return 'https://wa.me/' . $digits;
}

function email_shell(string $title, string $inner): string
{
    return '<!DOCTYPE html><html><body style="margin:0;background:#F7F3ED;font-family:Arial,Helvetica,sans-serif;color:#22201D">'
        . '<div style="max-width:560px;margin:0 auto;padding:24px 16px"><div style="background:#fff;border:1px solid #DDD6CC;border-radius:14px;padding:24px">'
        . '<div style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#A8552F;font-weight:bold">Where To Spot shop</div>'
        . '<h1 style="font-size:22px;margin:6px 0 16px">' . h($title) . '</h1>' . $inner
        . '</div><p style="font-size:12px;color:#8A8478;text-align:center">Sent automatically by your shop. Change who receives these in Dashboard → Team.</p></div></body></html>';
}

function btn(string $href, string $label, string $bg = '#A8552F'): string
{
    return '<a href="' . h($href) . '" style="display:inline-block;background:' . $bg . ';color:#fff;text-decoration:none;padding:10px 16px;border-radius:999px;font-weight:bold;font-size:14px;margin:4px 6px 4px 0">' . h($label) . '</a>';
}

function notify_new_order(string $number, array $o, array $lines): void
{
    $to = alert_recipients();
    if (!$to) return;
    $egp = function ($n) { return 'EGP ' . number_format((float) $n); };
    $rows = '';
    $textItems = '';
    foreach ($lines as $l) {
        $rows .= '<tr><td style="padding:6px 0;border-bottom:1px solid #EFEAE3">' . (int) $l['qty'] . '× ' . h($l['name']) . '</td><td style="padding:6px 0;border-bottom:1px solid #EFEAE3;text-align:right">' . $egp(($l['total'] ?? $l['qty'] * $l['price'])) . '</td></tr>';
        $textItems .= '- ' . $l['qty'] . 'x ' . $l['name'] . ' — ' . $egp(($l['total'] ?? $l['qty'] * $l['price'])) . "\n";
    }
    $sum = function ($label, $v, $bold = false) { return '<tr><td style="padding:4px 0;color:#6B6660">' . ($bold ? '<b style="color:#22201D">' . $label . '</b>' : $label) . '</td><td style="padding:4px 0;text-align:right">' . ($bold ? '<b>' . $v . '</b>' : $v) . '</td></tr>'; };
    $admin = rtrim(cfg('site_url'), '/') . '/admin/#orders';
    $html = email_shell('New order ' . $number . ' — ' . $egp($o['total']),
        '<p style="margin:0 0 4px"><b>' . h($o['name']) . '</b></p>'
        . '<p style="margin:0 0 4px"><a href="tel:' . h($o['phone']) . '" style="color:#22201D">' . h($o['phone']) . '</a> · ' . h($o['email']) . '</p>'
        . '<p style="margin:0 0 16px;color:#6B6660">' . h($o['address'] ?: '—') . ($o['city'] ? ', ' . h($o['city']) : '') . '</p>'
        . '<table style="width:100%;border-collapse:collapse;font-size:14px">' . $rows
        . $sum('Subtotal', $egp($o['subtotal']))
        . ($o['discount'] ? $sum('Promo ' . h($o['promo']), '−' . $egp($o['discount'])) : '')
        . $sum('Delivery', $o['shipping'] ? $egp($o['shipping']) : 'Free')
        . $sum('Total', $egp($o['total']), true) . '</table>'
        . '<p style="color:#6B6660;font-size:13px">' . h($o['payment'] ?? 'Cash on delivery') . ' · Source: ' . h($o['source'] ?? 'Website')
        . (!empty($o['rep']) ? ' · Sales: ' . h($o['rep']) : '') . '</p>'
        . '<p style="margin:18px 0 0">' . btn(wa_link($o['phone']), 'WhatsApp customer', '#1F7A4D') . btn($admin, 'Open in dashboard', '#22201D') . '</p>');
    $text = "New order $number — " . $egp($o['total']) . "\n\n"
        . $o['name'] . "\n" . $o['phone'] . ' · ' . $o['email'] . "\n" . $o['address'] . ', ' . $o['city'] . "\n\n"
        . $textItems . "\nDelivery: " . ($o['shipping'] ? $egp($o['shipping']) : 'Free') . "\nTotal: " . $egp($o['total']) . ' (' . ($o['payment'] ?? 'Cash on delivery') . ")\n"
        . 'Source: ' . ($o['source'] ?? 'Website') . (!empty($o['rep']) ? ' · Sales: ' . $o['rep'] : '') . "\n\n"
        . 'WhatsApp: ' . wa_link($o['phone']) . "\nDashboard: $admin\n";
    foreach (array_unique($to) as $r) send_mail([$r], 'New order ' . $number . ' · ' . $egp($o['total']) . ' · ' . $o['name'], $html, $text);
}

function notify_new_lead(array $l): void
{
    $to = alert_recipients();
    if (!$to) return;
    $admin = rtrim(cfg('site_url'), '/') . '/admin/#leads';
    $contact = $l['contact'];
    $isEmail = filter_var($contact, FILTER_VALIDATE_EMAIL);
    $action = $isEmail ? btn('mailto:' . $contact, 'Email them') : btn(wa_link($contact), 'WhatsApp them', '#1F7A4D');
    $html = email_shell('New bulk / corporate enquiry',
        '<p style="margin:0 0 4px"><b>' . h($l['name']) . '</b></p><p style="margin:0 0 4px">' . h($contact) . '</p>'
        . '<p style="margin:0 0 16px;color:#6B6660">Interested in: ' . h($l['cat'] ?: '—') . '</p>'
        . '<p>' . $action . btn($admin, 'Open leads', '#22201D') . '</p>');
    $text = "New enquiry\n\n" . $l['name'] . "\n" . $contact . "\nInterested in: " . $l['cat'] . "\n\nDashboard: $admin\n";
    foreach (array_unique($to) as $r) send_mail([$r], 'New enquiry · ' . $l['name'], $html, $text);
}
