#!/usr/bin/env bash
# Compiles the Spice sources in src/ to build/rack.wasm.
#
# The Spice driver picks `mold` as linker if it is installed, which cannot link WebAssembly. So only the compile step of
# the driver is used (it leaves one object file per module in its cache) and wasm-ld links them.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SPICE="${SPICE:-spice}"
WASM_LD="${WASM_LD:-$(command -v wasm-ld || ls /usr/bin/wasm-ld-* 2>/dev/null | head -1 || true)}"
OPT="${OPT:--O2}"
OUT="${1:-$ROOT/build/rack.wasm}"

[ -n "$WASM_LD" ] || { echo "wasm-ld not found (install lld)" >&2; exit 1; }

mkdir -p "$(dirname "$OUT")" "$ROOT/build"
cd "$ROOT/build"

# The failing link step prints the full linker command, which lists every object file of the build
LOG="$("$SPICE" build $OPT --no-entry --target-arch=wasm32 "$ROOT/src/main.spice" -o rack.wasm.tmp 2>&1 || true)"
if echo "$LOG" | grep -q -E "\[Error\|(Parser|Semantic|Compiler|Lexer)"; then
  echo "$LOG" >&2
  exit 1
fi
OBJECTS="$(echo "$LOG" | grep '^Linker command:' | grep -o '[^ ]*\.o' || true)"
[ -n "$OBJECTS" ] || { echo "Spice compilation failed:" >&2; echo "$LOG" >&2; exit 1; }

# Everything the host may call is a public `rack*` function of the Spice sources
EXPORTS="$(grep -rhoE 'public (f<[^>]+>|p) rack[A-Za-z0-9]+' "$ROOT/src" | awk '{print "--export=" $NF}' | tr '\n' ' ')"

# shellcheck disable=SC2086
"$WASM_LD" --no-entry --allow-undefined $EXPORTS -z stack-size=1048576 --export=__heap_base --gc-sections --strip-all \
  --initial-memory="${INITIAL_MEMORY:-268435456}" --max-memory="${INITIAL_MEMORY:-268435456}" \
  -o "$OUT" $OBJECTS
echo "Built $OUT ($(wc -c < "$OUT") bytes)"
