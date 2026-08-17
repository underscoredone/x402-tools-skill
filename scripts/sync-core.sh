#!/usr/bin/env bash
#
# Rebuild the bundled engine from x402-core.
#
# The skill must run with nothing installed, so it carries a committed single-file build
# of the core instead of an npm dependency. Run this after any change to x402-core, and
# commit the result — otherwise the skill and the hosted MCP quietly drift apart.
#
# Usage:  ./scripts/sync-core.sh [path-to-x402-core]

set -euo pipefail

CORE="${1:-../x402-tools/core}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ ! -f "$CORE/src/index.js" ]; then
  echo "Cannot find x402-core at: $CORE" >&2
  echo "Pass its path: ./scripts/sync-core.sh ../x402-tools/core" >&2
  exit 1
fi

echo "Building bundle from $CORE ..."
npx --yes esbuild@0.24 "$CORE/src/index.js" \
  --bundle \
  --format=esm \
  --platform=neutral \
  --outfile="$HERE/lib/x402-core.bundle.js"

echo "Checking the bundle actually runs ..."
node "$HERE/scripts/x402.mjs" decode "$(printf '{"x402Version":2}' | base64)" > /dev/null

echo "Done. Commit lib/x402-core.bundle.js."
