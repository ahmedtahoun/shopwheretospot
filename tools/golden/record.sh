#!/bin/bash
# Records golden snapshots from the PHP shop running locally on a COPY of the data. Never touches the live shop.
# Usage: tools/golden/record.sh <source-data-dir> [out-dir]
set -euo pipefail
cd "$(dirname "$0")/../.."
SRC=$1; OUT=${2:-../_shop-golden/php}
WORK=$(mktemp -d)
cleanup() { kill $PHP 2>/dev/null || true; rm -rf "$WORK" api/config.local.php; for f in index.html sitemap.xml llms.txt; do git checkout -q -- "$f" 2>/dev/null || true; done; }
trap cleanup EXIT
[ -e api/config.local.php ] && { echo "api/config.local.php exists here; refusing to overwrite it"; exit 1; }
# Local-only settings: the shop's own address is localhost, so it never pings IndexNow or other outside services
# with live URLs, and no keys are set, so Paymob, Bosta, WhatsApp, Meta, Telegram and Claude stay off.
printf '<?php return [\x27site_url\x27 => \x27http://localhost:8099\x27];\n' > api/config.local.php
tools/golden/prepare-data.sh "$SRC" "$WORK/data" >/dev/null
# The shop rewrites sitemap.xml, llms.txt and the homepage catalogue from the database now and then; do it now so
# the snapshot matches the data (the Worker builds them on each request).
WTS_DATA_DIR="$WORK/data" php -d display_errors=0 -r 'require "api/bootstrap.php"; seo_publish();'
printf '#!/bin/sh\ncat > /dev/null\n' > "$WORK/sendmail"; chmod +x "$WORK/sendmail"   # emails go nowhere
WTS_DATA_DIR="$WORK/data" php -d sendmail_path="$WORK/sendmail" -d display_errors=0 -S 127.0.0.1:8099 -t . ../.claude/router.php >"$WORK/php.log" 2>&1 &
PHP=$!; sleep 1.5
rm -rf "$OUT"; node tools/golden/record.mjs http://127.0.0.1:8099 "$WORK/data/shop.sqlite" "$OUT"
