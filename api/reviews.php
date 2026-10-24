<?php
// Product reviews, from verified buyers only. A shop customer (email code sign-in, api/customers.php)
// can review a product once one of their orders containing it has been delivered; one review per
// customer and product, editable. The team can hide or delete reviews (dashboard → Products → Reviews).
// Published reviews show on the product page and in its Google data (star rating).

function reviews_migrate(PDO $pdo): void
{
    $pdo->exec("CREATE TABLE IF NOT EXISTS product_reviews (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id TEXT NOT NULL,
        customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
        order_id INTEGER,
        name TEXT NOT NULL,
        rating INTEGER NOT NULL,
        text TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'published',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (customer_id, product_id)
    )");
    $pdo->exec('CREATE INDEX IF NOT EXISTS idx_reviews_product ON product_reviews(product_id, status)');
}

// A delivered order of this customer (by account or by the email they ordered with) that contains the product.
function review_order(array $c, string $productId): ?int
{
    $st = db()->prepare("SELECT id FROM orders WHERE status = 'Delivered' AND (customer_id = ? OR email = ? COLLATE NOCASE) AND items LIKE ? ORDER BY id DESC LIMIT 1");
    $st->execute([(int) $c['id'], (string) $c['email'], '%"id":"' . str_replace(['%', '_'], ['\%', '\_'], $productId) . '"%']);
    $id = $st->fetchColumn();
    return $id ? (int) $id : null;
}

// "Ahmed T." from the name the customer gave.
function review_display_name(string $name): string
{
    $parts = preg_split('/\s+/u', trim($name)) ?: [];
    if (!$parts || $parts[0] === '') return 'Customer';
    return $parts[0] . (count($parts) > 1 ? ' ' . mb_substr($parts[count($parts) - 1], 0, 1) . '.' : '');
}

function reviews_for(string $productId, int $limit = 50): array
{
    $st = db()->prepare("SELECT * FROM product_reviews WHERE product_id = ? AND status = 'published' ORDER BY id DESC LIMIT " . (int) $limit);
    $st->execute([$productId]);
    return array_map(function ($r) {
        return ['id' => (int) $r['id'], 'name' => review_display_name($r['name']), 'rating' => (int) $r['rating'], 'text' => $r['text'], 'date' => substr($r['created_at'], 0, 10), 'verified' => true];
    }, $st->fetchAll());
}

function review_stats(string $productId): array
{
    $st = db()->prepare("SELECT COUNT(*), AVG(rating) FROM product_reviews WHERE product_id = ? AND status = 'published'");
    $st->execute([$productId]);
    [$n, $avg] = $st->fetch(PDO::FETCH_NUM);
    return ['count' => (int) $n, 'avg' => $n ? round((float) $avg, 1) : 0];
}

// What the product page needs: the reviews, and whether this visitor can write one (and why not).
function review_status(?array $c, string $productId): array
{
    $me = ['signedIn' => (bool) $c, 'email' => $c ? $c['email'] : null, 'canReview' => false, 'mine' => null, 'name' => $c ? (string) $c['name'] : ''];
    if ($c) {
        $me['canReview'] = review_order($c, $productId) !== null;
        $st = db()->prepare('SELECT rating, text, name, status FROM product_reviews WHERE customer_id = ? AND product_id = ?');
        $st->execute([(int) $c['id'], $productId]);
        if ($r = $st->fetch()) $me['mine'] = ['rating' => (int) $r['rating'], 'text' => $r['text'], 'name' => $r['name'], 'hidden' => $r['status'] !== 'published'];
    }
    return ['reviews' => reviews_for($productId), 'stats' => review_stats($productId), 'me' => $me];
}

function review_save(array $c, string $productId, array $in): void
{
    $order = review_order($c, $productId);
    if (!$order) throw new ShopError('Only customers who received this product can review it.', 403);
    $rating = max(1, min(5, (int) ($in['rating'] ?? 0)));
    $text = trim(str_in($in['text'] ?? '', 1500));
    $name = trim(str_in($in['name'] ?? '', 60)) ?: (string) $c['name'];
    if ($name === '') throw new ShopError('Please write your name.');
    if (mb_strlen($text) < 3) throw new ShopError('Please write a few words about the product.');
    $st = db()->prepare('SELECT id FROM product_reviews WHERE customer_id = ? AND product_id = ?');
    $st->execute([(int) $c['id'], $productId]);
    if ($id = $st->fetchColumn()) {
        // Editing keeps a hidden review hidden (the team decided).
        db()->prepare("UPDATE product_reviews SET name = ?, rating = ?, text = ?, order_id = ?, updated_at = datetime('now') WHERE id = ?")->execute([$name, $rating, $text, $order, $id]);
    } else {
        db()->prepare('INSERT INTO product_reviews (product_id, customer_id, order_id, name, rating, text) VALUES (?, ?, ?, ?, ?, ?)')->execute([$productId, (int) $c['id'], $order, $name, $rating, $text]);
        log_activity(null, 'New product review', $productId . ' · ' . str_repeat('★', $rating) . ' · ' . $name);
    }
    if (function_exists('seo_indexnow_product')) seo_indexnow_product($productId);
}
