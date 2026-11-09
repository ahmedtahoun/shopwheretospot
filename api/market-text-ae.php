<?php
// The UAE shop's wording (api/market-pages.php). Egypt's pages are the base; this says what changes for the UAE.
// The company and its address stay what they are (Where To Spot, Giza, Egypt); the shop sells partner brands'
// products in AED, delivered across the UAE by the brands. Delivery times aren't promised until agreed with them.
// Arabic for the new English labels the shop shows through i18n.js is in i18n.js ("UAE shop" section).

declare(strict_types=1);

return [
    // Sections that are about the Egypt studio and its services (taken out of the page, so search engines
    // don't index them for the UAE): the four "doors" (business / cafés / coffee / beauty), the studio's
    // hero, services, "one team" and client logos. Links to Egypt-only pages go from every page.
    'remove' => [
        'index' => ['<div class="doors-wrap">', '<header id="intro"', '<section id="services"', '<section id="about"', '<section class="clients"'],
        '*' => ['<a(?: class="link")? href="plans\.html"', '<a(?: class="link")? href="google-review-link\.html"'],
    ],

    // Egypt-only payment badges (Meeza cards, Egyptian mobile wallets), and the website chat assistant (chat.js),
    // whose answers are Egypt's (governorates, EGP prices, services); UAE customers use WhatsApp until it has its own.
    'drop' => ['<img src="images/pay/(?:meeza|wallet)\.svg"[^>]*>', '<script src="(?:\./|/)?chat\.js"[^>]*></script>\n?', '<a href="#chat" class="btn btn-accent">Chat with us</a>\s*'],

    'replace' => [
        // Home page: bar, cart, checkout, footer
        'Free delivery across Egypt on orders over' => 'Free delivery across the UAE on orders over',
        '· All prices in Egyptian Pounds (EGP)' => '· All prices in UAE Dirhams (AED)',
        'Total (EGP)' => 'Total (AED)',
        'Delivery across Egypt in 2–5 days' => 'Delivered across the UAE by the brand',
        'Marketing, products and production for businesses in Egypt. All prices in Egyptian Pounds (EGP).' => 'Chef tools and kitchen essentials from trusted brands, delivered across the UAE. All prices in UAE Dirhams (AED).',
        'Cash on delivery · Delivery across Egypt · 14-day returns' => 'Cash on delivery · Delivery across the UAE · 7-day returns',
        'anywhere in Egypt' => 'anywhere in the UAE',
        'Or choose from the list of governorates →' => 'Or choose from the list of emirates →',
        'Choose a governorate first' => 'Choose an emirate first',
        'Choose your governorate' => 'Choose your emirate',
        'Governorate' => 'Emirate',
        'Type your area — e.g. Nasr City or مدينة نصر' => 'Type your area — e.g. Dubai Marina or دبي مارينا',

        // Checkout and account: UAE phone code (+971) and country by default
        "form: { name: '', email: '', phone: '', phoneCc: '+20', address: '', city: 'Cairo', country: 'Egypt', payment: 'cod' }" => "form: { name: '', email: '', phone: '', phoneCc: '+971', address: '', city: '', country: 'United Arab Emirates', payment: 'cod' }",
        "acctForm: { name: '', phone: '', phoneCc: '+20', address: '' }" => "acctForm: { name: '', phone: '', phoneCc: '+971', address: '' }",
        "if (raw.charAt(0) !== '+') return { phoneCc: '+20', phone: raw };" => "if (raw.charAt(0) !== '+') return { phoneCc: '+971', phone: raw };",
        "if (!hit) return { phoneCc: '+20', phone: raw };" => "if (!hit) return { phoneCc: '+971', phone: raw };",
        "if ((cc || '+20') === '+20')" => "if ((cc || '+971') === '+20')",
        // "Ordering for a team" form: the shop's categories, without Egypt's studio services
        "...this.customServices.map(cs => ({ value: cs.name, label: cs.name })), { value: 'services', label: 'Marketing plans / other' }]" => "{ value: 'services', label: 'Other' }]",

        // Product page
        'Original products, supplied directly by the brand. Delivered across Egypt by Where To Spot, with cash on delivery.' => 'Original products, supplied and delivered directly by the brand, with cash on delivery across the UAE.',
        'Price in Egyptian Pounds (EGP) · pay online by card or wallet, or cash on delivery' => 'Price in UAE Dirhams (AED) · pay online by card, or cash on delivery',
        'Delivery across Egypt: 1–3 business days in Cairo & Giza, 3–7 elsewhere —' => 'Delivered across the UAE by the brand —',
        ', delivered across Egypt in 2–5 days with cash on delivery.' => ', delivered across the UAE with cash on delivery.',
        '، توصيل لكل مصر خلال 2–5 أيام والدفع عند الاستلام.' => '، توصيل لكل الإمارات والدفع عند الاستلام.',
        'Delivery across Egypt in 2–5 days · cash on delivery, card or mobile wallet · 14-day returns.' => 'Delivery across the UAE · cash on delivery or card · 7-day returns.',
        'توصيل لكل مصر خلال 2–5 أيام · الدفع عند الاستلام أو بالبطاقة أو المحفظة · استرجاع خلال 14 يوم.' => 'توصيل لكل الإمارات · الدفع عند الاستلام أو بالبطاقة · استرجاع خلال 7 أيام.',

        // Category and brand pages
        'All prices in Egyptian Pounds (EGP) · Delivery across Egypt · Cash on delivery' => 'All prices in UAE Dirhams (AED) · Delivery across the UAE · Cash on delivery',
        'كل الأسعار بالجنيه المصري · توصيل لكل مصر · الدفع عند الاستلام' => 'كل الأسعار بالدرهم الإماراتي · توصيل لكل الإمارات · الدفع عند الاستلام',
        'توصيل لكل مصر خلال 2–5 أيام' => 'توصيل لكل الإمارات',
        'Delivery across Egypt takes 2–5 working days, with cash on delivery, card or mobile wallet.' => 'The brand delivers across the UAE, with cash on delivery or card.',
        'التوصيل لكل مصر خلال 2–5 أيام عمل، والدفع عند الاستلام أو بالبطاقة أو المحفظة.' => 'العلامة بتوصّل لكل الإمارات، والدفع عند الاستلام أو بالبطاقة.',

        // llms.txt (what AI tools read about the shop)
        '> Online shop and marketing studio in Egypt (6th of October City, Giza). Sells NFC Google-review cards and stands, acrylic display stands, Korean skincare, specialty coffee from partner roasters, and monthly lead-generation marketing plans. All prices are in Egyptian Pounds (EGP). Delivery across Egypt in 2–5 days; cash on delivery, cards and mobile wallets accepted; 14-day returns.'
            => '> The UAE online shop of Where To Spot (a marketing studio based in Giza, Egypt). Sells chef tools and kitchen essentials from partner brands: plating tweezers, quenelle and saucier spoons, chef knives and complete sets. All prices are in UAE Dirhams (AED). Delivered across the UAE by the brands; cash on delivery or card; 7-day returns.',

        // Search descriptions (api/seo-lib.php)
        'Cash on delivery & 2–5 day delivery across Egypt.' => 'Cash on delivery & delivery across the UAE.',
        'الدفع عند الاستلام وتوصيل لكل مصر خلال 2–5 أيام.' => 'الدفع عند الاستلام وتوصيل لكل الإمارات.',
        'Cash on delivery in Egypt.' => 'Cash on delivery across the UAE.',
        'الدفع عند الاستلام في كل مصر.' => 'الدفع عند الاستلام في كل الإمارات.',
    ],

    // Patterns: llms.txt's line about the Egypt-only free Google review tool.
    'replace_re' => ['~^- Free tool: Google review link[^\n]*\n~m' => ''],

    // Search titles and descriptions per page.
    'pages' => [
        'index' => [
            'en' => ['Chef Tools & Plating Tools in Dubai & the UAE | Where To Spot',
                'Plating tweezers, quenelle spoons, chef knives and complete sets from trusted brands. Prices in AED, delivered across the UAE, cash on delivery.'],
            'ar' => ['أدوات الشيف وأدوات التقديم في دبي والإمارات | Where To Spot',
                'ملاقط تقديم وملاعق كينيل وسكاكين شيف وأطقم كاملة من علامات موثوقة. الأسعار بالدرهم، توصيل لكل الإمارات والدفع عند الاستلام.'],
        ],
        'shipping-policy' => [
            'en' => ['Delivery & shipping (UAE) — Where To Spot', 'Delivery across the UAE by our partner brands: AED 25, free on orders over AED 250, cash on delivery or card.'],
            'ar' => ['التوصيل والشحن (الإمارات) — Where To Spot', 'التوصيل لكل الإمارات عن طريق العلامات الشريكة: 25 درهم، ومجاني للطلبات فوق 250 درهم، والدفع عند الاستلام أو بالبطاقة.'],
        ],
        'refund-policy' => [
            'en' => ['Returns & refunds (UAE) — Where To Spot', 'Return unused items within 7 days of delivery in their original packaging. Report a damaged or wrong item straight away.'],
            'ar' => ['الاسترجاع والاسترداد (الإمارات) — Where To Spot', 'ترجّع المنتجات غير المستخدمة خلال 7 أيام من الاستلام في تغليفها الأصلي. بلّغنا فورًا عن أي منتج تالف أو غلط.'],
        ],
    ],

    // Pages written for the UAE (markets/ae/<name>.html) instead of Egypt's.
    'files' => ['shipping-policy', 'refund-policy'],
];
