<?php
// The wording of another market's shop (api/market.php). The pages are Egypt's (index.html, the product and
// category pages, …); outside Egypt they're served through this layer, which uses api/market-text-<code>.php:
//  - 'remove':  sections that only make sense in Egypt (taken out of the HTML, so search engines don't see them)
//  - 'replace': phrases, in order (English, Arabic, and the shop's own address instead of shop.wheretospot.com)
//  - 'pages':   each page's title and description for search results, per language
//  - 'files':   pages written for that market (its policies), in markets/<code>/
// In Egypt nothing here runs: the pages are served exactly as they are.

declare(strict_types=1);

function market_text_cfg(): array
{
    static $cfg = null;
    if ($cfg === null) {
        $file = __DIR__ . '/market-text-' . strtolower((string) market('code')) . '.php';
        $cfg = !market_is('EG') && is_file($file) ? (array) require $file : [];
    }
    return $cfg;
}

// Phrases in a piece of text (a page, a description, an email). Egypt: unchanged.
function market_text(string $s): string
{
    $cfg = market_text_cfg();
    if (!$cfg) return $s;
    $pairs = $cfg['replace'] ?? [];
    // The shop's own address in every link (canonical, alternates, share links, structured data).
    $own = rtrim((string) cfg('site_url'), '/');
    if ($own !== '' && $own !== 'https://shop.wheretospot.com') $pairs = array_merge(['https://shop.wheretospot.com' => $own, 'shop.wheretospot.com' => preg_replace('#^https?://#', '', $own)], $pairs);
    $s = strtr($s, $pairs);
    // Whole lines or passages that differ in each copy (e.g. a link with the shop's address in it): patterns.
    foreach ($cfg['replace_re'] ?? [] as $re => $with) $s = preg_replace($re, $with, $s) ?? $s;
    return $s;
}

// Take out an element and everything inside it: the first opening tag matching $openRe (e.g. '<header id="intro"'),
// up to its own closing tag (nested tags of the same name are counted). The page is left as it is if it isn't found.
function html_remove_element(string $html, string $openRe): string
{
    if (!preg_match('~' . $openRe . '~', $html, $m, PREG_OFFSET_CAPTURE)) return $html;
    $start = $m[0][1];
    if (!preg_match('~^<([a-zA-Z][\w-]*)~', substr($html, $start, 64), $t)) return $html;
    $tag = strtolower($t[1]);
    $depth = 0;
    $pos = $start;
    while (preg_match('~<(/?)' . preg_quote($tag, '~') . '\b[^>]*>~i', $html, $x, PREG_OFFSET_CAPTURE, $pos)) {
        $depth += $x[1][0] === '/' ? -1 : 1;
        $pos = $x[0][1] + strlen($x[0][0]);
        if ($depth === 0) return substr($html, 0, $start) . substr($html, $pos);
    }
    return $html; // unbalanced: leave it rather than cut the page short
}

// A whole page for another market: Egypt-only sections out, the market's phrases in, its own title and description.
function market_page(string $html, string $key, bool $ar): string
{
    $cfg = market_text_cfg();
    if (!$cfg) return $html;
    // Every match of each pattern (a link can be in the menu and the footer); at most 20 per pattern.
    foreach (array_merge($cfg['remove'][$key] ?? [], $cfg['remove']['*'] ?? []) as $re) {
        for ($i = 0; $i < 20; $i++) { $next = html_remove_element($html, $re); if ($next === $html) break; $html = $next; }
    }
    // Single tags (an image, a badge) that have no closing tag to cut to.
    foreach ($cfg['drop'] ?? [] as $re) $html = preg_replace('~' . $re . '~', '', $html) ?? $html;
    $html = market_text($html);
    $meta = $cfg['pages'][$key][$ar ? 'ar' : 'en'] ?? null;
    if ($meta) {
        $e = function ($s) { return htmlspecialchars($s, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'); };
        $set = function (string $h, string $re, string $with): string { return preg_replace_callback($re, function () use ($with) { return $with; }, $h, 1) ?? $h; };
        $html = $set($html, '/<title>.*?<\/title>/s', '<title>' . $e($meta[0]) . '</title>');
        foreach (['name="description"', 'property="og:description"', 'name="twitter:description"'] as $m) $html = $set($html, '/<meta ' . preg_quote($m, '/') . ' content="[^"]*">/', '<meta ' . $m . ' content="' . $e($meta[1]) . '">');
        foreach (['property="og:title"', 'name="twitter:title"'] as $m) $html = $set($html, '/<meta ' . preg_quote($m, '/') . ' content="[^"]*">/', '<meta ' . $m . ' content="' . $e($meta[0]) . '">');
    }
    return $html;
}

// A page written for this market (markets/<code>/<name>.html), if there is one.
function market_file(string $name): ?string
{
    $cfg = market_text_cfg();
    if (!in_array($name, $cfg['files'] ?? [], true)) return null;
    $file = dirname(__DIR__) . '/markets/' . strtolower((string) market('code')) . '/' . $name . '.html';
    return is_file($file) ? $file : null;
}

// For server-made pages (product, category): their whole output goes through the market's wording.
function market_buffer_page(string $key, bool $ar): void
{
    if (!market_text_cfg()) return;
    ob_start(function ($html) use ($key, $ar) { return market_page((string) $html, $key, $ar); });
}
