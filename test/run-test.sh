#!/bin/bash
# Integration test against a Redmine this script starts and destroys itself.
#
# The static half — shell lint, schema sync, the spec bundle, its generated types
# and the type check — lives in check.sh and runs first, so a mistake those can
# catch does not cost a container start and a full suite run.
#
# pipefail: values captured through pipes would otherwise mask a failing
# generator behind a succeeding tail/cut, turning setup failures into test ones.
# nounset: a mistyped variable would otherwise expand to an empty string.
set -e -u -o pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$SCRIPT_DIR/.."
REDMINE_ADMIN_LOGIN="admin"
REDMINE_ADMIN_PASSWORD="adminadmin"

# Pinned by the workspace root's package.json / package-lock.json
BIN="$REPO_ROOT/node_modules/.bin"

"$SCRIPT_DIR/check.sh"

# Produced by check.sh; fixed paths for the same reason they are fixed there.
OPENAPI_PATH="$SCRIPT_DIR/dist/openapi.strict.yaml"

# Setup below resets the admin password, enables the REST API and writes seed
# data, so this script only ever operates on a container it starts and destroys
# itself. There is deliberately no way to point it at an existing Redmine.
REDMINE_DIR="$SCRIPT_DIR/redmine"

cleanup() {
  echo "=== Cleaning up ==="
  docker compose -f "$REDMINE_DIR/docker-compose.yaml" down -v
}
trap cleanup EXIT

echo "=== Starting Redmine ==="
docker compose -f "$REDMINE_DIR/docker-compose.yaml" up -d

REDMINE_PORT=$(docker compose -f "$REDMINE_DIR/docker-compose.yaml" port redmine 3000 | cut -d: -f2)
if [ -z "$REDMINE_PORT" ]; then
  echo "  Could not read the published port of the redmine service"
  exit 1
fi
REDMINE_URL="http://localhost:$REDMINE_PORT"
REDMINE_CONTAINER=$(docker compose -f "$REDMINE_DIR/docker-compose.yaml" ps -q redmine)
if [ -z "$REDMINE_CONTAINER" ]; then
  echo "  Could not read the id of the redmine container"
  exit 1
fi

echo "  Redmine URL: $REDMINE_URL"

echo "=== Waiting for Redmine to be ready ==="
# Bounded: an unreachable Redmine would otherwise hold a CI runner until the
# platform's own job limit.
WAIT_TIMEOUT=300
WAITED=0
until curl -s "$REDMINE_URL" > /dev/null 2>&1; do
  if [ "$WAITED" -ge "$WAIT_TIMEOUT" ]; then
    echo "  Redmine did not answer at $REDMINE_URL within ${WAIT_TIMEOUT}s"
    docker compose -f "$REDMINE_DIR/docker-compose.yaml" logs --tail 50 redmine || true
    exit 1
  fi
  echo "  Waiting... (${WAITED}s)"
  sleep 2
  WAITED=$((WAITED + 2))
done
echo "  Redmine is up!"

echo "=== Verifying Redmine version ==="
# check.sh already confirmed the pin matches README; what is left is the third
# party, the container that is actually running (unless REDMINE_IMAGE overrides
# the image for canary runs). `|| true` keeps a failing grep or docker exec from
# aborting before the checks below can name the problem.
PINNED_VERSION=$( (grep -oE 'redmine:[0-9][0-9.]*' "$SCRIPT_DIR/redmine/docker-compose.yaml" | head -1 | cut -d: -f2) || true)
ACTUAL_VERSION=$( (docker exec "$REDMINE_CONTAINER" rails runner \
  'puts [Redmine::VERSION::MAJOR, Redmine::VERSION::MINOR, Redmine::VERSION::TINY].join(".")' 2>/dev/null | tr -d '\r' | tail -1) || true)
echo "  Redmine version: $ACTUAL_VERSION"
if [ -z "$ACTUAL_VERSION" ]; then
  echo "  Could not read the Redmine version from the running container"
  exit 1
fi
if [ -n "${REDMINE_IMAGE:-}" ]; then
  echo "  (image overridden via REDMINE_IMAGE=$REDMINE_IMAGE; skipping strict version match)"
elif [ "$ACTUAL_VERSION" != "$PINNED_VERSION" ]; then
  echo "  Running Redmine ($ACTUAL_VERSION) does not match the pinned version ($PINNED_VERSION)"
  exit 1
fi

echo "=== Setting up Redmine ==="
docker exec -i "$REDMINE_CONTAINER" rails runner - <<RUBY
  admin = User.find_by(login: '$REDMINE_ADMIN_LOGIN')
  admin.password = '$REDMINE_ADMIN_PASSWORD'
  admin.password_confirmation = '$REDMINE_ADMIN_PASSWORD'
  admin.must_change_passwd = false
  admin.save!

  Setting.rest_api_enabled = '1'

  if IssueStatus.count == 0
    IssueStatus.create!(name: 'New')
  end
  if IssuePriority.count == 0
    IssuePriority.create!(name: 'Normal', is_default: true)
  end
  if Tracker.count == 0
    Tracker.create!(name: 'Bug', default_status: IssueStatus.first)
  end
  if TimeEntryActivity.count == 0
    TimeEntryActivity.create!(name: 'Development', is_default: true)
  end
  if DocumentCategory.count == 0
    DocumentCategory.create!(name: 'Documentation')
  end
  # Saved query so that GET /queries returns a non-empty list and
  # the query_id filter can be exercised
  unless IssueQuery.find_by(name: 'Seed Query')
    IssueQuery.create!(name: 'Seed Query', user_id: admin.id, visibility: Query::VISIBILITY_PUBLIC)
  end
  if Role.givable.count == 0
    Role.create!(name: 'Manager', permissions: Redmine::AccessControl.permissions.map(&:name))
    Role.create!(name: 'Developer', permissions: [:add_issues, :edit_issues, :view_issues, :manage_issue_relations, :add_issue_notes])
  end

  # Enabled for every tracker so the tests need not assume a particular id.
  tracker_ids = Tracker.ids
  unless IssueCustomField.find_by(name: 'CF String')
    IssueCustomField.create!(name: 'CF String', field_format: 'string', is_for_all: true, tracker_ids: tracker_ids)
    IssueCustomField.create!(name: 'CF Text', field_format: 'text', is_for_all: true, tracker_ids: tracker_ids)
    IssueCustomField.create!(name: 'CF Int', field_format: 'int', is_for_all: true, tracker_ids: tracker_ids)
    IssueCustomField.create!(name: 'CF Float', field_format: 'float', is_for_all: true, tracker_ids: tracker_ids)
    IssueCustomField.create!(name: 'CF Date', field_format: 'date', is_for_all: true, tracker_ids: tracker_ids)
    IssueCustomField.create!(name: 'CF Bool', field_format: 'bool', is_for_all: true, tracker_ids: tracker_ids)
    IssueCustomField.create!(name: 'CF Link', field_format: 'link', is_for_all: true, tracker_ids: tracker_ids)
    IssueCustomField.create!(name: 'CF List', field_format: 'list', is_for_all: true, tracker_ids: tracker_ids,
      possible_values: ['Alpha', 'Bravo', 'Charlie'])
    IssueCustomField.create!(name: 'CF List Multi', field_format: 'list', multiple: true, is_for_all: true, tracker_ids: tracker_ids,
      possible_values: ['Red', 'Green', 'Blue'])
    IssueCustomField.create!(name: 'CF User', field_format: 'user', is_for_all: true, tracker_ids: tracker_ids)
    IssueCustomField.create!(name: 'CF Version', field_format: 'version', is_for_all: true, tracker_ids: tracker_ids)
    ProjectCustomField.create!(name: 'CF Project String', field_format: 'string', is_for_all: true)
    TimeEntryCustomField.create!(name: 'CF TimeEntry String', field_format: 'string', is_for_all: true)
    puts 'Custom fields created!'
  end
  unless IssueCustomField.find_by(name: 'CF Date Offset')
    IssueCustomField.create!(name: 'CF Date Offset', field_format: 'date', is_for_all: true, tracker_ids: tracker_ids,
      default_value_mode: 'date_offset', default_value: '5')
    puts 'Date offset custom field created!'
  end

  puts 'Setup completed!'
RUBY

# Kept idempotent: `docker compose up -d` reuses a container that an interrupted
# run left behind, so this may run against a database that already has the data.
echo "=== Setting up Git repository ==="
docker exec -i "$REDMINE_CONTAINER" bash -c '
  which git > /dev/null 2>&1 || (apt-get update -qq && apt-get install -y -qq git > /dev/null 2>&1)
  [ -d /tmp/test-repo.git ] ||
    git clone --bare https://github.com/d-yoshi/redmine-openapi.git /tmp/test-repo.git -q
'

REPO_REVISION=$(docker exec -i "$REDMINE_CONTAINER" rails runner - <<'RUBY' | tr -d '\r' | tail -1
  project = Project.find_by(identifier: 'repo-test') ||
            Project.create!(name: 'Repository Test', identifier: 'repo-test')
  project.enable_module!('repository')
  project.trackers = Tracker.all
  repo = project.repository ||
         Repository::Git.create!(
           project: project,
           url: '/tmp/test-repo.git',
           identifier: 'test-repo',
           is_default: true
         )
  repo.fetch_changesets
  changeset = repo.changesets.first
  raise 'no changesets were fetched from the test repository' if changeset.nil?
  puts changeset.revision
RUBY
)
echo "  Revision: $REPO_REVISION"
if [ -z "$REPO_REVISION" ]; then
  echo "  Could not determine a changeset revision for the repository fixture"
  exit 1
fi

OBSERVED_LOG="$SCRIPT_DIR/dist/observed.txt"
: > "$OBSERVED_LOG"

echo "=== Running tests ==="
REDMINE_URL="$REDMINE_URL" \
REDMINE_ADMIN_LOGIN="$REDMINE_ADMIN_LOGIN" \
REDMINE_ADMIN_PASSWORD="$REDMINE_ADMIN_PASSWORD" \
OPENAPI_PATH="$OPENAPI_PATH" \
REPO_REVISION="$REPO_REVISION" \
OBSERVED_LOG="$OBSERVED_LOG" \
"$BIN/tsx" --test --test-concurrency=1 "$SCRIPT_DIR/src/"*.test.ts

echo "=== Checking API coverage ==="
node "$SCRIPT_DIR/check-api-coverage.mjs" "$OPENAPI_PATH" "$OBSERVED_LOG"

echo "=== Done ==="
