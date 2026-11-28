#!/bin/bash
# Reads against a local Worker (wrangler dev, local D1 from the same data copy PHP used), compared with the
# PHP snapshots in ../_shop-golden/php (record those the same day with record.sh). Faster than deploying.
# Usage: tools/golden/read-test-local.sh <source-data-dir> [compare options]
set -euo pipefail
cd "$(dirname "$0")/../.."
SRC=$1; shift
WORK=$(mktemp -d)
cleanup() { pkill -f -- "--port 8096" 2>/dev/null || true; pkill -f "entry=127.0.0.1:8096" 2>/dev/null || true; rm -rf "$WORK"; }
trap cleanup EXIT
tools/golden/prepare-data.sh "$SRC" "$WORK/data" >/dev/null
export WRANGLER_PERSIST="$WORK/state"
tools/d1/import.sh "$WORK/data/shop.sqlite" --local >/dev/null
npx wrangler dev --local --persist-to "$WORK/state" --port 8096 --ip 127.0.0.1 --show-interactive-dev-session=false >"$WORK/wrangler.log" 2>&1 &
for i in $(seq 90); do curl -sf -m 3 http://127.0.0.1:8096/__health >/dev/null && break; sleep 1; done
rm -rf ../_shop-golden/worker-local
node tools/golden/record.mjs http://127.0.0.1:8096 "$WORK/data/shop.sqlite" ../_shop-golden/worker-local | tail -1
cp "$WORK/wrangler.log" ../_shop-golden/wrangler-read.log
node tools/golden/compare.mjs ../_shop-golden/php ../_shop-golden/worker-local "$@"
