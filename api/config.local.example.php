<?php
// Copy this file to api/config.local.php ON THE SERVER (cPanel → File Manager) and fill it in.
// config.local.php is never committed to git and cannot be opened from the web.
return [
    // Send order alerts through a real mailbox for reliable delivery (recommended).
    // Create it in cPanel → Email Accounts, e.g. orders@wheretospot.com.
    'smtp' => [
        'host' => 'mail.wheretospot.com',   // cPanel → Email Accounts → Connect Devices shows the exact server
        'port' => 465,                      // 465 = SSL, 587 = STARTTLS
        'user' => 'orders@wheretospot.com',
        'pass' => 'the-mailbox-password',
    ],
    // Extra addresses that always get new-order alerts (team members opt in from Dashboard → Team).
    'alert_emails' => ['info@wheretospot.com'],
];
