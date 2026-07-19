#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$SCRIPT_DIR/.."
REDMINE_ADMIN_LOGIN="admin"
REDMINE_ADMIN_PASSWORD="adminadmin"

if [ -z "$REDMINE_CONTAINER" ]; then
  REDMINE_DIR="$SCRIPT_DIR/redmine"

  cleanup() {
    echo "=== Cleaning up ==="
    docker compose -f "$REDMINE_DIR/docker-compose.yaml" down -v
  }
  trap cleanup EXIT

  echo "=== Starting Redmine ==="
  docker compose -f "$REDMINE_DIR/docker-compose.yaml" up -d

  REDMINE_PORT=$(docker compose -f "$REDMINE_DIR/docker-compose.yaml" port redmine 3000 | cut -d: -f2)
  REDMINE_URL="http://localhost:$REDMINE_PORT"
  REDMINE_CONTAINER=$(docker compose -f "$REDMINE_DIR/docker-compose.yaml" ps -q redmine)
else
  REDMINE_URL="${REDMINE_URL:-http://localhost:3000}"
fi

echo "  Redmine URL: $REDMINE_URL"

echo "=== Waiting for Redmine to be ready ==="
until curl -s "$REDMINE_URL" > /dev/null 2>&1; do
  echo "  Waiting..."
  sleep 2
done
echo "  Redmine is up!"

echo "=== Verifying Redmine version ==="
# The pinned version declared in docker-compose.yaml is the source of truth;
# README must state the same version, and the running container must match it
# (unless REDMINE_IMAGE overrides the image for canary runs).
PINNED_VERSION=$(grep -oE 'redmine:[0-9][0-9.]*' "$SCRIPT_DIR/redmine/docker-compose.yaml" | head -1 | cut -d: -f2)
README_VERSION=$(grep -oE 'Tested against: Redmine [0-9.]+' "$REPO_ROOT/README.md" | grep -oE '[0-9.]+$')
if [ "$README_VERSION" != "$PINNED_VERSION" ]; then
  echo "  README (Tested against: $README_VERSION) does not match docker-compose pin ($PINNED_VERSION)"
  exit 1
fi
ACTUAL_VERSION=$(docker exec "$REDMINE_CONTAINER" rails runner \
  'puts [Redmine::VERSION::MAJOR, Redmine::VERSION::MINOR, Redmine::VERSION::TINY].join(".")' 2>/dev/null | tr -d '\r' | tail -1)
echo "  Redmine version: $ACTUAL_VERSION"
if [ -n "$REDMINE_IMAGE" ]; then
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
    IssueQuery.create!(name: 'Seed Query', user_id: 1, visibility: Query::VISIBILITY_PUBLIC)
  end
  if Role.givable.count == 0
    Role.create!(name: 'Manager', permissions: Redmine::AccessControl.permissions.map(&:name))
    Role.create!(name: 'Developer', permissions: [:add_issues, :edit_issues, :view_issues, :manage_issue_relations, :add_issue_notes])
  end

  # Custom fields for testing various field types
  tracker = Tracker.first
  unless IssueCustomField.find_by(name: 'CF String')
    IssueCustomField.create!(name: 'CF String', field_format: 'string', is_for_all: true, tracker_ids: [tracker.id])
    IssueCustomField.create!(name: 'CF Text', field_format: 'text', is_for_all: true, tracker_ids: [tracker.id])
    IssueCustomField.create!(name: 'CF Int', field_format: 'int', is_for_all: true, tracker_ids: [tracker.id])
    IssueCustomField.create!(name: 'CF Float', field_format: 'float', is_for_all: true, tracker_ids: [tracker.id])
    IssueCustomField.create!(name: 'CF Date', field_format: 'date', is_for_all: true, tracker_ids: [tracker.id])
    IssueCustomField.create!(name: 'CF Bool', field_format: 'bool', is_for_all: true, tracker_ids: [tracker.id])
    IssueCustomField.create!(name: 'CF Link', field_format: 'link', is_for_all: true, tracker_ids: [tracker.id])
    IssueCustomField.create!(name: 'CF List', field_format: 'list', is_for_all: true, tracker_ids: [tracker.id],
      possible_values: ['Alpha', 'Bravo', 'Charlie'])
    IssueCustomField.create!(name: 'CF List Multi', field_format: 'list', multiple: true, is_for_all: true, tracker_ids: [tracker.id],
      possible_values: ['Red', 'Green', 'Blue'])
    IssueCustomField.create!(name: 'CF User', field_format: 'user', is_for_all: true, tracker_ids: [tracker.id])
    IssueCustomField.create!(name: 'CF Version', field_format: 'version', is_for_all: true, tracker_ids: [tracker.id])
    ProjectCustomField.create!(name: 'CF Project String', field_format: 'string', is_for_all: true)
    TimeEntryCustomField.create!(name: 'CF TimeEntry String', field_format: 'string', is_for_all: true)
    puts 'Custom fields created!'
  end

  puts 'Setup completed!'
RUBY

echo "=== Setting up Git repository ==="
docker exec -i "$REDMINE_CONTAINER" bash -c '
  which git > /dev/null 2>&1 || (apt-get update -qq && apt-get install -y -qq git > /dev/null 2>&1)
  git clone --bare https://github.com/d-yoshi/redmine-openapi.git /tmp/test-repo.git -q
'

REPO_REVISION=$(docker exec -i "$REDMINE_CONTAINER" rails runner - <<'RUBY' | tr -d '\r' | tail -1
  project = Project.create!(name: 'Repository Test', identifier: 'repo-test')
  project.enable_module!('repository')
  tracker = Tracker.first
  project.trackers << tracker unless project.trackers.include?(tracker)
  repo = Repository::Git.create!(
    project: project,
    url: '/tmp/test-repo.git',
    identifier: 'test-repo',
    is_default: true
  )
  repo.fetch_changesets
  puts repo.changesets.first.revision
RUBY
)
echo "  Revision: $REPO_REVISION"

if [ -z "$OPENAPI_PATH" ]; then
  OPENAPI_PATH="$SCRIPT_DIR/dist/openapi.strict.yaml"
  echo "=== Bundling OpenAPI spec (strict) ==="
  npx --yes @redocly/cli@latest bundle --config "$REPO_ROOT/redocly/redocly.yaml" strict -o "$OPENAPI_PATH"
fi

SCHEMA_PATH="${SCHEMA_PATH:-$SCRIPT_DIR/dist/openapi-typescript/schema.d.ts}"
if [ ! -f "$SCHEMA_PATH" ]; then
  echo "=== Generating OpenAPI TypeScript schema ==="
  npx --yes openapi-typescript@latest "$OPENAPI_PATH" -o "$SCHEMA_PATH"
fi

echo "=== Running tests ==="
REDMINE_URL="$REDMINE_URL" \
REDMINE_ADMIN_LOGIN="$REDMINE_ADMIN_LOGIN" \
REDMINE_ADMIN_PASSWORD="$REDMINE_ADMIN_PASSWORD" \
OPENAPI_PATH="$OPENAPI_PATH" \
REPO_REVISION="$REPO_REVISION" \
npx --yes tsx@latest --test --test-concurrency=1 "$SCRIPT_DIR/src/"*.test.ts

echo "=== Done ==="
