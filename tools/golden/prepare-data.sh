#!/bin/bash
# Makes a throwaway data folder for recording: a copy of the shop database (+ Bosta area files),
# schema version set, and a local-only owner account (golden@example.test / golden-local) for the admin reads.
# Usage: prepare-data.sh <source-data-dir> <target-dir>
set -euo pipefail
SRC=$1; DST=$2
rm -rf "$DST"; mkdir -p "$DST"; chmod 700 "$DST"
cp "$SRC"/shop.sqlite "$DST"/ ; cp "$SRC"/*.json "$DST"/ 2>/dev/null || true
HASH=$(php -r 'echo password_hash("golden-local", PASSWORD_DEFAULT);')
sqlite3 "$DST/shop.sqlite" "PRAGMA user_version=61;
INSERT INTO users (name, email, password_hash, role, active, created_at) VALUES ('Golden Recorder', 'golden@example.test', '$HASH', 'owner', 1, datetime('now'));"
echo "$DST ready"
