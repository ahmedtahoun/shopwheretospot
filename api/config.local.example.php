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
    // Paymob online payments (cards + mobile wallets). All values: Paymob dashboard → Settings → Account Info
    // (Secret Key, Public Key, HMAC) and Developers → Payment Integrations (the integration IDs).
    // Start with the TEST keys and test integration IDs; switch all of them to LIVE together.
    'paymob' => [
        'secret_key' => 'egy_sk_test_…',
        'public_key' => 'egy_pk_test_…',
        'hmac_secret' => '…',
        'card_integration_id' => 0,     // "Online Card" integration ID
        'wallet_integration_id' => 0,   // "Mobile Wallet" integration ID (0 = don't offer wallets)
    ],
    // WhatsApp Business (Meta Cloud API) — the inbox in the dashboard. From Meta for Developers → your app:
    //   token:            a permanent System User access token (Business settings → System users → Generate token,
    //                     with whatsapp_business_messaging + whatsapp_business_management)
    //   phone_number_id:  WhatsApp → API Setup → "Phone number ID" (not the phone number itself)
    //   app_secret:       App settings → Basic → App secret (checks that incoming messages really come from Meta)
    //   verify_token:     any long random text you choose; paste the same text in WhatsApp → Configuration → Webhook
    // Webhook address: https://shop.wheretospot.com/api/whatsapp-webhook.php (subscribe to "messages").
    'whatsapp' => [
        'token' => 'EAAG…',
        'phone_number_id' => '123456789012345',
        'app_secret' => '…',
        'verify_token' => 'choose-a-long-random-text',
        'graph_version' => 'v23.0',
        // 'waba_id' => '…',  // optional: WhatsApp Manager → Account tools → WhatsApp account ID (found automatically from the token when left out)
    ],
    // Telegram alerts: a ping on the team's phones when a WhatsApp customer is waiting. In Telegram, message
    // @BotFather → /newbot → choose a name (e.g. Where To Spot Alerts) → copy the token it gives you here.
    // Each person then taps "Connect Telegram" in the dashboard's WhatsApp inbox. Nothing else to set up.
    'telegram' => [
        'bot_token' => '123456789:AA…',
    ],
    // Optional: business search in the free review-link tool (google-review-link.html). Google Cloud console →
    // enable "Places API (New)" → Credentials → API key, restricted to Places API (New). Without it, visitors paste a link.
    // 'google_places_key' => 'AIza…',
    // Extra addresses that always get new-order alerts (team members opt in from Dashboard → Team).
    'alert_emails' => ['info@wheretospot.com'],
];
