<?php
// Delivery areas for the UAE shop (api/market.php → market_areas): the 7 emirates and their main areas, in English
// and Arabic, in the same shape as Bosta's list for Egypt, so the checkout's area search, the area list and the
// order checks work unchanged. "Other area" in each emirate means the customer's address says where.

declare(strict_types=1);

return (function (): array {
    $emirates = [
        ['dxb', 'Dubai', 'دبي', [
            ['downtown', 'Downtown Dubai', 'وسط مدينة دبي'], ['business-bay', 'Business Bay', 'الخليج التجاري'],
            ['difc', 'DIFC', 'مركز دبي المالي العالمي'], ['szr', 'Sheikh Zayed Road & Trade Centre', 'شارع الشيخ زايد والمركز التجاري'],
            ['marina', 'Dubai Marina', 'دبي مارينا'], ['jbr', 'JBR (Jumeirah Beach Residence)', 'جميرا بيتش ريزيدنس'],
            ['jlt', 'JLT (Jumeirah Lake Towers)', 'أبراج بحيرات جميرا'], ['palm', 'Palm Jumeirah', 'نخلة جميرا'],
            ['jumeirah', 'Jumeirah', 'جميرا'], ['umm-suqeim', 'Umm Suqeim', 'أم سقيم'], ['satwa', 'Al Satwa', 'السطوة'],
            ['barsha', 'Al Barsha', 'البرشاء'], ['quoz', 'Al Quoz', 'القوز'], ['sufouh', 'Al Sufouh, Internet & Media City', 'الصفوح ومدينة دبي للإنترنت والإعلام'],
            ['hills', 'Dubai Hills Estate', 'دبي هيلز'], ['jvc', 'JVC (Jumeirah Village Circle)', 'قرية جميرا الدائرية'],
            ['ranches', 'Arabian Ranches', 'المرابع العربية'], ['damac-hills', 'Damac Hills', 'داماك هيلز'], ['town-square', 'Town Square', 'تاون سكوير'],
            ['motor-city', 'Motor City', 'موتور سيتي'], ['sports-city', 'Dubai Sports City', 'مدينة دبي الرياضية'],
            ['furjan', 'Al Furjan', 'الفرجان'], ['discovery', 'Discovery Gardens', 'ديسكفري جاردنز'], ['jebel-ali', 'Jebel Ali', 'جبل علي'],
            ['dip', 'Dubai Investments Park', 'مجمع دبي للاستثمار'], ['south', 'Dubai South', 'دبي الجنوب'],
            ['bur-dubai', 'Bur Dubai', 'بر دبي'], ['karama', 'Al Karama', 'الكرامة'], ['oud-metha', 'Oud Metha', 'عود ميثاء'],
            ['jaddaf', 'Al Jaddaf', 'الجداف'], ['deira', 'Deira', 'ديرة'], ['garhoud', 'Al Garhoud', 'القرهود'],
            ['festival-city', 'Dubai Festival City', 'دبي فستيفال سيتي'], ['meydan', 'Meydan & Nad Al Sheba', 'ميدان وند الشبا'],
            ['qusais', 'Al Qusais', 'القصيص'], ['nahda', 'Al Nahda (Dubai)', 'النهدة (دبي)'], ['mirdif', 'Mirdif', 'مردف'],
            ['warqa', 'Al Warqa', 'الورقاء'], ['silicon-oasis', 'Dubai Silicon Oasis', 'واحة دبي للسيليكون'],
            ['international-city', 'International City', 'المدينة العالمية'],
        ]],
        ['auh', 'Abu Dhabi', 'أبوظبي', [
            ['corniche', 'Corniche & Al Khalidiyah', 'الكورنيش والخالدية'], ['zahiyah', 'Al Zahiyah (Tourist Club)', 'الزاهية (النادي السياحي)'],
            ['bateen', 'Al Bateen', 'البطين'], ['mushrif', 'Al Mushrif', 'المشرف'], ['nahyan', 'Al Nahyan', 'آل نهيان'],
            ['reem', 'Al Reem Island', 'جزيرة الريم'], ['maryah', 'Al Maryah Island', 'جزيرة الماريه'],
            ['saadiyat', 'Saadiyat Island', 'جزيرة السعديات'], ['yas', 'Yas Island', 'جزيرة ياس'], ['raha', 'Al Raha Beach', 'شاطئ الراحة'],
            ['khalifa-city', 'Khalifa City', 'مدينة خليفة'], ['mbz', 'Mohammed Bin Zayed City', 'مدينة محمد بن زايد'],
            ['shakhbout', 'Shakhbout City', 'مدينة شخبوط'], ['shamkha', 'Al Shamkha', 'الشامخة'], ['musaffah', 'Musaffah', 'مصفح'],
            ['al-ain', 'Al Ain', 'العين'],
        ]],
        ['shj', 'Sharjah', 'الشارقة', [
            ['majaz', 'Al Majaz', 'المجاز'], ['taawun', 'Al Taawun', 'التعاون'], ['khan', 'Al Khan', 'الخان'],
            ['nahda', 'Al Nahda (Sharjah)', 'النهدة (الشارقة)'], ['qasimia', 'Al Qasimia', 'القاسمية'], ['rolla', 'Al Rolla', 'الرولة'],
            ['muwaileh', 'Muwaileh', 'مويلح'], ['university-city', 'University City', 'المدينة الجامعية'], ['aljada', 'Aljada', 'الجادة'],
            ['industrial', 'Industrial Area', 'المنطقة الصناعية'], ['khor-fakkan', 'Khor Fakkan', 'خورفكان'], ['kalba', 'Kalba', 'كلباء'],
        ]],
        ['ajm', 'Ajman', 'عجمان', [
            ['nuaimiya', 'Al Nuaimiya', 'النعيمية'], ['rashidiya', 'Al Rashidiya', 'الراشدية'], ['jurf', 'Al Jurf', 'الجرف'],
            ['rawda', 'Al Rawda', 'الروضة'], ['hamidiya', 'Al Hamidiya', 'الحميدية'], ['corniche', 'Ajman Corniche', 'كورنيش عجمان'],
        ]],
        ['rak', 'Ras Al Khaimah', 'رأس الخيمة', [
            ['nakheel', 'Al Nakheel', 'النخيل'], ['dhait', 'Al Dhait', 'الظيت'], ['khuzam', 'Khuzam', 'خزام'],
            ['hamra', 'Al Hamra Village', 'قرية الحمرا'], ['mina-al-arab', 'Mina Al Arab', 'ميناء العرب'], ['marjan', 'Al Marjan Island', 'جزيرة المرجان'],
        ]],
        ['uaq', 'Umm Al Quwain', 'أم القيوين', [
            ['city', 'Umm Al Quwain city', 'مدينة أم القيوين'], ['salama', 'Al Salama', 'السلامة'],
        ]],
        ['fuj', 'Fujairah', 'الفجيرة', [
            ['city', 'Fujairah city', 'مدينة الفجيرة'], ['faseel', 'Al Faseel', 'الفصيل'], ['dibba', 'Dibba', 'دبا'],
        ]],
    ];
    $out = [];
    foreach ($emirates as [$cid, $name, $ar, $areas]) {
        $areas[] = ['other', 'Other area in ' . $name, 'منطقة أخرى في ' . $ar];
        $out[] = ['id' => 'ae-' . $cid, 'name' => $name, 'ar' => $ar, 'districts' => array_map(function ($a) use ($cid) {
            return ['id' => 'ae-' . $cid . '-' . $a[0], 'name' => $a[1], 'ar' => $a[2], 'zoneId' => '', 'zone' => '', 'zoneAr' => ''];
        }, $areas)];
    }
    return $out;
})();
