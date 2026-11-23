#!/usr/bin/env bash
# Recreate a scratch database, apply every migration, run the behaviour tests.
set -euo pipefail
PSQL="psql -h ${PGHOST:-/tmp} -p ${PGPORT:-54329} -U postgres -v ON_ERROR_STOP=1 -q"
$PSQL -d postgres -c "drop database if exists unitos_test" -c "create database unitos_test"
$PSQL -d unitos_test -f "$(dirname "$0")/00_local_shim.sql"
for f in "$(dirname "$0")"/../migrations/*.sql; do echo "apply $(basename "$f")"; $PSQL -d unitos_test -f "$f"; done
$PSQL -d unitos_test -f "$(dirname "$0")/rls_and_rules.sql"
