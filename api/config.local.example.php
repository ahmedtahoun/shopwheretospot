<?php
// Copy this file to api/config.local.php ON THE SERVER (cPanel → File Manager) and fill it in.
// config.local.php is never committed to git and cannot be opened from the web.
return [
    // Send order alerts through a real mailbox for reliable delivery (recommended).
    // Create it in cPanel → Email Accounts, e.g. orders@wheretospot.com.
    'smtp' => [
        'host' => 'serverXXX.web-hosting.com', // exact name: cPanel → Email Accounts → Connect Devices → Outgoing Server
        'port' => 465,                      // 465 = SSL, 587 = STARTTLS
        'user' => 'orders@wheretospot.com',
        'pass' => 'the-mailbox-password',
    ],
    // Bosta shipping. Create the key in Bosta → Settings → API Integration with "Read/Write" access
    // ("Full access" is only needed to cancel shipments from the dashboard).
    'bosta' => [
        'api_key' => 'paste-your-bosta-api-key-here',
        'business_location_id' => '',   // optional: default pickup location id (leave empty to use Bosta's default)
        'default_size' => 'SMALL',      // SMALL, MEDIUM or LARGE
        'awb_size' => 'A6',             // waybill paper: A6 (label printer) or A4
        'awb_lang' => 'ar',             // ar or en
    ],
    // Extra addresses that always get new-order alerts (team members opt in from Dashboard → Team).
    'alert_emails' => ['info@wheretospot.com'],
];
