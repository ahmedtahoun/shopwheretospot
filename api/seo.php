<?php
// Machine-readable shop data: ?f=sitemap (XML sitemap), ?f=feed (Google Merchant product feed), ?f=llms (llms.txt).
declare(strict_types=1);
require __DIR__ . '/bootstrap.php';

$f = (string) ($_GET['f'] ?? 'sitemap');
header('Cache-Control: public, max-age=900');
if ($f === 'feed') { header('Content-Type: application/rss+xml; charset=utf-8'); echo seo_feed(); }
elseif ($f === 'llms') { header('Content-Type: text/plain; charset=utf-8'); echo seo_llms(); }
else { header('Content-Type: application/xml; charset=utf-8'); echo seo_sitemap(); }
// Refresh the copies at the site root (/sitemap.xml, /llms.txt) now and then.
$root = dirname(__DIR__);
if (!is_file($root . '/llms.txt') || filemtime($root . '/llms.txt') < time() - 3600) seo_publish();
