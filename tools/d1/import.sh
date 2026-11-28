#!/bin/bash
# Loads a copy of the shop's SQLite database into the Cloudflare D1 database "shop" (same tables, same data).
# Replaces everything in D1: every existing table is dropped first.
# Usage: tools/d1/import.sh <shop.sqlite> [--local|--remote]   (default --local, which only touches wrangler's local copy)
set -euo pipefail
cd "$(dirname "$0")/../.."
SRC=$1; WHERE=${2:---local}
# Local only: WRANGLER_PERSIST=<dir> keeps the local copy there instead of .wrangler/state.
[ "$WHERE" = --local ] && [ -n "${WRANGLER_PERSIST:-}" ] && WHERE="--local --persist-to $WRANGLER_PERSIST"
WORK=$(mktemp -d); trap 'rm -rf "$WORK"' EXIT
# D1 doesn't accept transactions, PRAGMAs or writes to sqlite_sequence in an import file.
sqlite3 "$SRC" ".dump --newlines --nosys" | grep -vE '^(PRAGMA|BEGIN TRANSACTION;|COMMIT;)' | grep -vE '^(DELETE FROM|INSERT INTO) "?sqlite_sequence' > "$WORK/data.sql"
# Drop what's there now (tables created by an earlier import), newest first so tables that point to others go first.
npx wrangler d1 execute shop $WHERE --json --command "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'd1_%' ORDER BY rowid DESC" \
  | python3 -c 'import sys,json; d=json.load(sys.stdin); print("PRAGMA defer_foreign_keys = on;"); [print("DROP TABLE IF EXISTS \"" + r["name"] + "\";") for r in d[0]["results"]]' > "$WORK/drop.sql"
[ "$(wc -l < "$WORK/drop.sql")" -gt 1 ] && npx wrangler d1 execute shop $WHERE --file "$WORK/drop.sql" --yes >/dev/null
npx wrangler d1 execute shop $WHERE --file "$WORK/data.sql" --yes 2>&1 | { grep -E "rows|Executed|ERROR|error" || true; } | tail -3
npx wrangler d1 execute shop $WHERE --json --command "SELECT (SELECT count(*) FROM orders) AS orders, (SELECT count(*) FROM products) AS products, (SELECT count(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%') AS tables" | python3 -c 'import sys,json; print("D1 now:", json.load(sys.stdin)[0]["results"][0])'
