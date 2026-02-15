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
  if Role.givable.count == 0
    Role.create!(name: 'Manager', permissions: Redmine::AccessControl.permissions.map(&:name))
    Role.create!(name: 'Developer', permissions: [:add_issues, :edit_issues, :view_issues, :manage_issue_relations, :add_issue_notes])
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
  OPENAPI_PATH="$REPO_ROOT/openapi.yaml"
  echo "=== Bundling OpenAPI spec ==="
  npx --yes @redocly/cli@latest bundle --config "$REPO_ROOT/redocly/redocly.yaml" "$REPO_ROOT/src/openapi.yaml" -o "$OPENAPI_PATH"
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
