#!/bin/bash
# Everything that can be verified without a running Redmine: shell lint, schema
# consistency, the spec bundle the tests validate against, its generated types,
# and the type check of the tests themselves.
#
# Split out of run-test.sh so this loop costs seconds instead of a container
# start, and so a local run gates on the same things CI does. run-test.sh calls
# this first; run it directly while editing schemas or tests.
#
# Requires `npm ci` at the repository root (npm workspaces).
set -e -u -o pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$SCRIPT_DIR/.."

# Every tool is a devDependency of the workspace root, so versions come from
# package.json and package-lock.json. Called by path rather than through npx so
# resolution cannot fall back to the registry.
BIN="$REPO_ROOT/node_modules/.bin"

# Fixed paths: helpers.ts imports the generated schema from this exact location,
# so neither is configurable.
OPENAPI_PATH="$SCRIPT_DIR/dist/openapi.strict.yaml"
SCHEMA_PATH="$SCRIPT_DIR/dist/openapi-typescript/schema.d.ts"

# Named here rather than left to a bare "command not found" or
# ERR_MODULE_NOT_FOUND further down
if [ ! -x "$BIN/redocly" ] || [ ! -x "$BIN/tsc" ]; then
  echo "Dependencies are not installed. Run 'npm ci' in $REPO_ROOT first."
  exit 1
fi

echo "=== Linting shell scripts ==="
if command -v shellcheck > /dev/null 2>&1; then
  # -P SCRIPTDIR resolves `source=` directives relative to the script being
  # checked. Without it shellcheck resolves them against the caller's working
  # directory, so this step would fail for anyone not standing in test/.
  shellcheck -x -P SCRIPTDIR "$SCRIPT_DIR/check.sh" "$SCRIPT_DIR/run-test.sh"
  echo "  shellcheck: clean"
elif [ -n "${CI:-}" ]; then
  # Skipping is fine on a developer machine, but on CI it would mean the gate
  # quietly stopped running
  echo "  shellcheck is not installed on this CI runner"
  exit 1
else
  echo "  shellcheck is not installed; skipping (CI enforces it)"
fi

echo "=== Checking summary/detail schema sync ==="
node "$SCRIPT_DIR/check-summary-detail-sync.mjs"

echo "=== Checking the documented Redmine version ==="
# The pin in docker-compose.yaml is the source of truth; README must agree.
# run-test.sh checks the third party — the running container — separately.
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
# The strict bundle is what the tests validate responses against. CI lints the
# dist bundle separately, because that is the document that gets published.
"$BIN/redocly" lint --config "$REPO_ROOT/redocly/redocly.yaml" "$OPENAPI_PATH"

echo "=== Generating OpenAPI TypeScript schema ==="
# Always regenerated: a timestamp or hash comparison would only be a proxy for
# "was this generated from the spec we are about to test against", and getting it
# wrong types the tests against a different spec than the one they validate
# responses with. Regenerating unconditionally removes that state entirely.
"$BIN/openapi-typescript" "$OPENAPI_PATH" -o "$SCHEMA_PATH"

echo "=== Type checking the tests ==="
# Checks test/src against the generated types, so a request naming a parameter,
# enum value or body field the spec does not declare fails here rather than
# silently passing at runtime.
"$BIN/tsc" --noEmit -p "$SCRIPT_DIR/tsconfig.json"

echo "=== Static checks passed ==="
