#!/bin/bash
# Write tests: runs tools/golden/scenario.mjs against the PHP shop and against the Worker (wrangler dev, local D1),
# each on a fresh copy of the same data, with every outside service replaced by tools/golden/mock.mjs. Then compares.
# Never touches the live shop or the Cloudflare database (only wrangler's local copy).
# Usage: tools/golden/write-test.sh <source-data-dir> [out-dir]
set -euo pipefail
cd "$(dirname "$0")/../.."
SRC=$1; OUT=${2:-../_shop-golden/writes}
WORK=$(mktemp -d); mkdir -p "$OUT"
cleanup() { pkill -f -- "--port 8097" 2>/dev/null || true; pkill -f "entry=127.0.0.1:8097" 2>/dev/null || true; kill ${PHP:-} ${WR:-} ${MOCK:-} 2>/dev/null || true; rm -rf "$WORK" api/config.local.php; for f in index.html; do git checkout -q -- "$f" 2>/dev/null || true; done; }
trap cleanup EXIT
[ -e api/config.local.php ] && { echo "api/config.local.php exists here; refusing to overwrite it"; exit 1; }
M=http://127.0.0.1:8098
node tools/golden/mock.mjs 8098 >"$WORK/mock.log" 2>&1 & MOCK=$!

# ---- PHP ----
cat > api/config.local.php <<PHPCFG
<?php return ['site_url' => 'http://localhost:8099',
  'meta' => ['pixel_id' => '123456789', 'capi_token' => 'mock-capi', 'graph_url' => '$M'],
  'bosta' => ['api_key' => 'mock-bosta', 'base_url' => '$M/bosta', 'business_location_id' => 'loc1'],
  'paymob' => ['base_url' => '$M', 'secret_key' => 'egy_sk_mock', 'public_key' => 'egy_pk_mock', 'hmac_secret' => 'mock-hmac', 'card_integration_id' => 111, 'wallet_integration_id' => 222]];
PHPCFG
tools/golden/prepare-data.sh "$SRC" "$WORK/data" >/dev/null
cp "$WORK/data/shop.sqlite" "$WORK/start.sqlite"
printf 'mock-bosta-secret' > "$WORK/data/bosta-webhook-secret.txt"
touch "$WORK/data/bosta-sync.txt"   # the PHP shop syncs Bosta at most every 2 hours: not during the test
printf '#!/bin/sh\nexec node %s\n' "$PWD/tools/golden/sendmail-stub.mjs" > "$WORK/sendmail"; chmod +x "$WORK/sendmail"
WTS_DATA_DIR="$WORK/data" php -d sendmail_path="$WORK/sendmail" -d display_errors=0 -S 127.0.0.1:8099 -t . ../.claude/router.php >"$WORK/php.log" 2>&1 & PHP=$!
sleep 1.5
curl -s -X POST $M/__reset >/dev/null
node tools/golden/scenario.mjs http://127.0.0.1:8099 "$WORK/data/shop.sqlite" "$OUT/php.json"
kill $PHP; PHP=

# ---- Worker (local) ----
# The PHP copy has Bosta's pickup locations cached in a file; the Worker keeps that cache in kv.
[ -f "$WORK/data/bosta-locations.json" ] && sqlite3 "$WORK/start.sqlite" "INSERT OR REPLACE INTO kv (key, value) VALUES ('bosta.locations', json_object('at', CAST(strftime('%s','now') AS INTEGER), 'data', json(readfile('$WORK/data/bosta-locations.json'))))"
export WRANGLER_PERSIST="$WORK/state"
tools/d1/import.sh "$WORK/start.sqlite" --local >/dev/null
npx wrangler dev --local --persist-to "$WORK/state" --port 8097 --ip 127.0.0.1 --show-interactive-dev-session=false \
  --var SITE_URL:http://localhost:8097 --var STAGING:1 --var MAIL_CAPTURE_URL:$M/__mail \
  --var META_PIXEL_ID:123456789 --var META_CAPI_TOKEN:mock-capi --var META_GRAPH_URL:$M \
  --var PAYMOB_BASE_URL:$M --var PAYMOB_SECRET_KEY:egy_sk_mock --var PAYMOB_PUBLIC_KEY:egy_pk_mock --var PAYMOB_HMAC_SECRET:mock-hmac \
  --var BOSTA_API_KEY:mock-bosta --var BOSTA_BASE_URL:$M/bosta --var BOSTA_LOCATION_ID:loc1 --var BOSTA_WEBHOOK_SECRET:mock-bosta-secret \
  --var PAYMOB_CARD_INTEGRATION_ID:111 --var PAYMOB_WALLET_INTEGRATION_ID:222 >"$WORK/wrangler.log" 2>&1 & WR=$!
for i in $(seq 90); do curl -sf -m 3 http://127.0.0.1:8097/__health >/dev/null && break; sleep 1; done
curl -s -X POST $M/__reset >/dev/null
DB=$(ls -t "$WORK"/state/v3/d1/miniflare-D1DatabaseObject/*.sqlite | head -1)
node tools/golden/scenario.mjs http://127.0.0.1:8097 "$DB" "$OUT/worker.json"
cp "$WORK/wrangler.log" "$OUT/wrangler.log"; cp "$WORK/php.log" "$OUT/php.log"
node tools/golden/compare-writes.mjs "$OUT/php.json" "$OUT/worker.json"
