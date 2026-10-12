#!/usr/bin/env bash
# Runs the Spice unit tests (native) and, if a throw-away MySQL database is configured, the end-to-end tests.
#   E2E_DB_HOST/E2E_DB_PORT/E2E_DB_USER/E2E_DB_PASSWORD/E2E_DB_NAME  (the name must end in "_test"; all tables in it are dropped!)
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SPICE="${SPICE:-spice}"
"$SPICE" test "$ROOT/src/tests.spice"
"$ROOT/scripts/build-wasm.sh"
(cd "$ROOT/host" && npm test)
