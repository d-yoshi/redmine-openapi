#!/bin/bash
# Static checks shared by local runs and CI; no Redmine container required.
set -e -u -o pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$SCRIPT_DIR/.."

# Use local tools to avoid falling back to the registry.
BIN="$REPO_ROOT/node_modules/.bin"

# Keep SCHEMA_PATH in sync with the generated-schema import in helpers.ts.
OPENAPI_PATH="$SCRIPT_DIR/dist/openapi.strict.yaml"
SCHEMA_PATH="$SCRIPT_DIR/dist/openapi-typescript/schema.d.ts"

if [ ! -x "$BIN/redocly" ] || [ ! -x "$BIN/openapi-typescript" ]; then
  echo "Dependencies are not installed. Run 'npm ci' in $REPO_ROOT first."
  exit 1
fi

echo "=== Linting shell scripts ==="
if command -v shellcheck > /dev/null 2>&1; then
  shellcheck -x -P SCRIPTDIR "$SCRIPT_DIR/check.sh" "$SCRIPT_DIR/run-test.sh"
  echo "  shellcheck: clean"
elif [ -n "${CI:-}" ]; then
  echo "  shellcheck is not installed on this CI runner"
  exit 1
else
  echo "  shellcheck is not installed; skipping (CI enforces it)"
fi

echo "=== Testing validation tools ==="
node --test "$SCRIPT_DIR/"*.test.mjs

echo "=== Checking summary/detail schema sync ==="
node "$SCRIPT_DIR/check-summary-detail-sync.mjs"

echo "=== Checking the documented Redmine version ==="
# `|| true` keeps a pattern that stops matching from aborting before the checks.
PINNED_VERSION=$( (grep -oE 'redmine:[0-9][0-9.]*' "$SCRIPT_DIR/redmine/docker-compose.yaml" | head -1 | cut -d: -f2) || true)
README_VERSION=$( (grep -oE 'Tested against: Redmine [0-9.]+' "$REPO_ROOT/README.md" | grep -oE '[0-9.]+$') || true)
if [ -z "$PINNED_VERSION" ]; then
  echo "  Could not read the pinned Redmine version from redmine/docker-compose.yaml"
  exit 1
fi
if [ "$README_VERSION" != "$PINNED_VERSION" ]; then
  echo "  README (Tested against: $README_VERSION) does not match docker-compose pin ($PINNED_VERSION)"
  exit 1
fi
echo "  Pinned and documented: $PINNED_VERSION"

echo "=== Bundling OpenAPI spec (strict) ==="
"$BIN/redocly" bundle --config "$REPO_ROOT/redocly/redocly.yaml" strict -o "$OPENAPI_PATH"

echo "=== Linting the bundled spec ==="
"$BIN/redocly" lint --config "$REPO_ROOT/redocly/redocly.yaml" "$OPENAPI_PATH"

echo "=== Generating OpenAPI TypeScript schema ==="
# Always regenerate so request types and response validation use the same spec.
"$BIN/openapi-typescript" "$OPENAPI_PATH" -o "$SCHEMA_PATH"

echo "=== Type checking the tests ==="
# The test workspace uses TypeScript 7; the generator still requires TypeScript 5.
npm --prefix "$REPO_ROOT" run --workspace test typecheck

echo "=== Static checks passed ==="
