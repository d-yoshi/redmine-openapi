# Releasing

This guide is for maintainers with permission to push branches and run workflows in the upstream repository. See the [maintenance policy](maintenance-policy.md) for supported versions and backport criteria, and [Contributing](../CONTRIBUTING.md) for submitting changes through a pull request.

The workflow publishes a fixed specification commit from this repository. That commit's Redmine image pin identifies the version used for API tests. Release tooling runs from `main`; maintenance branches retain their own specification, tests, and dependencies.

## Prerequisites

Use a tooling checkout on `main` with `origin` pointing to the upstream repository. Use the Node.js version in [.tool-versions](../.tool-versions) and install dependencies with `npm ci`. For the CLI examples, authenticate GitHub CLI with the permissions to run workflows.

A repository administrator must configure Pages to use GitHub Actions, keep the `github-pages` environment available, and enable `Allow GitHub Actions to create and approve pull requests` for generated target proposals. Those PRs may need workflow approval before their checks run. Keep the legacy release workflow disabled.

## Versions and branches

Release tags use `<Redmine-version>-r<N>`. The target is an exact major/minor/patch version, and the revision starts at 1. Increment the revision by one for the same target; start again at 1 for a newer target. The publisher checks the transition against the nearest ancestor release tag, including tags whose publication failed. Keep published tags and assets unchanged.

The tag must equal `info.version` in [src/openapi.yaml](../src/openapi.yaml) and the generated bundle. The Redmine version in the tag must match [the image pin](../test/redmine/docker-compose.yaml) and `info.description`. Use complete tags as identifiers; SemVer parsers treat the revision suffix as a prerelease.

| Branch | Role |
| --- | --- |
| `main` | Standard-series development and integration, publication configuration, and shared release tools |
| `release/<planned-tag>` | Optional preparation branch for a standard release, merged into `main` before publication |
| `maintenance/<target-version>` | Continued work and pull requests for a maintained target |
| A separate branch from an older tag | An individually approved correction for another historical target |

Use ordinary maintenance branches retaining their source history, not orphan branches. Keep the current maintenance branch available for pull requests. Release an older specification from its own branch and port shared corrections separately to `main`.

## Prepare a release

Integrate standard changes into `main` and maintenance changes into `maintenance/<target-version>`. For maintenance, check out the branch in a separate clone or worktree. To start a new maintenance target, create a worktree from the previous maintained patch's verified release tag.

```sh
SOURCE_CHECKOUT='../redmine-openapi-maintenance'
MAINTENANCE_BRANCH='maintenance/<target-version>'
PREVIOUS_TAG='<previous-release-tag>'
git fetch origin --tags
git worktree add -b "$MAINTENANCE_BRANCH" "$SOURCE_CHECKOUT" "refs/tags/$PREVIOUS_TAG"
```

Maintenance branches have their own CI workflow. Apply the bundle consistency check on each active maintenance branch so its CI detects a stale bundle.

In the standard specification checkout, run `npm run release:prepare`. For maintenance, use the Node.js pin and lockfile in the maintenance checkout to install its dependencies, then run the preparation tool from `main` with `--source`.

```sh
SOURCE_CHECKOUT='../redmine-openapi-maintenance'
npm --prefix "$SOURCE_CHECKOUT" ci
npm run release:prepare -- --source "$SOURCE_CHECKOUT"
```

To update Redmine itself, review its released source, make the necessary specification and test changes, and append the new version to the preparation command. When running the command without `--source`, use `npm run release:prepare -- <target-version>`.

The preparation command fetches tags from `origin`, calculates the next tag from the specification checkout's ancestry, and updates `info.version`, `info.description`, and the Redmine image pin. It uses that checkout's dependencies to regenerate `openapi.yaml` and prints the planned tag. It leaves the changes for you to review and commit, and restores the release files if bundling fails.

For a pull request, include the metadata and bundle with the specification changes. Review the changes and merge after CI confirms the committed bundle matches a fresh build and the tests pass. If repository rules allow a direct push, merge locally, run the preparation command on the result, then commit and push the prepared files.

## Publish a release

After the merge or push, copy the full SHA of the resulting commit and the planned tag printed during preparation. Open **Actions → Publish release → Run workflow**, select `main`, and enter the SHA in `source_ref` and the planned tag in `tag`. The same workflow accepts commits from standard and maintenance branches. To start it from the CLI, use the following command.

```sh
SOURCE_SHA='<integrated-commit-sha>'
RELEASE_TAG='<prepared-release-tag>'
gh workflow run publish-release.yaml --ref main -f source_ref="$SOURCE_SHA" -f tag="$RELEASE_TAG"
```

The workflow checks the planned tag against `info.version` at that SHA. It uses the specification checkout's test scripts, lockfile, and Node.js pin to verify the bundle and run the API tests. After validation and artifact checks succeed, it creates the tag and publishes the assets. A tag that already exists must point to the same SHA.

Confirm that `Publish release assets` succeeds and the planned tag appears in Releases. For a revision of the selected standard target, check `Update Latest and Pages` as well. Review any pull request from `Propose publication target` to adopt a newer patch.

## Publication target proposals

[release-targets.json](../.github/release-targets.json) on `main` selects one exact `standard` target and at most one older-series target under `maintenance`. Keep these selections while preparing a release for an unselected version.

After a successful publication, `Propose publication target` verifies the published manifest, specification commit SHA, and asset hashes. For a newer patch within an already selected series, it opens a configuration PR against `main`. A revision of an already selected target, an older patch, or a different series produces no proposal. Adopting a different series requires an explicit configuration change and a decision about the previous series.

Review and merge the generated PR to adopt the patch. The job does not edit the configuration on `main` directly. Retries reuse an existing PR, including a closed one. Before creating a PR, the job rejects unexpected changes on a reused proposal branch.

Proposal generation is separate from publishing and reconciliation. If it fails, the published Release remains available and reconciliation continues under the existing configuration. Resolve the reported cause and retry the failed job, or retry the existing tag as described below. No manual configuration commit is needed for the normal same-series patch proposal.

## Latest and Pages

`Update Latest and Pages` reconciles publication state with the current configuration: it selects the highest verified published revision for the standard target and updates GitHub Latest and GitHub Pages where needed. It refuses automatic downgrades. A newly published maintenance release does not replace the standard release.

Merging the target-selection PR triggers reconciliation. Without a verified release for the selected standard target, Latest and Pages remain unchanged. Publishing a release does not by itself select a different target.

## Workflows and assets

| Workflow | Responsibility |
| --- | --- |
| [CI](../.github/workflows/ci.yaml) | Build and lint the specification, check the committed bundle, run tooling and API tests, and show a specification diff |
| [Publish release](../.github/workflows/publish-release.yaml) | Resolve and validate the source, create or verify the tag, publish assets, propose a target update, and reconcile Latest and Pages |
| [Request release](../.github/workflows/request-release.yaml) | Support requests from manually pushed release tags |
| [Canary](../.github/workflows/canary.yaml) | Detect newer Redmine versions and test candidates using each target's published specification commit |
| [Legacy release](../.github/workflows/release.yaml) | Retired entry point; use the central publisher |

CI's specification comparison and central release validation use the same Docker image version and digest from [oasdiff-image.txt](../.github/oasdiff-image.txt). Update that file when changing oasdiff.

The publisher validates tag ordering using the revision rules above. The oasdiff commands disable `api-version-decreased` through [oasdiff-severity.txt](../.github/oasdiff-severity.txt).

The validation artifact records the specification commit SHA and asset hashes. Publication verifies the artifact's run identity and hashes before creating a tag or publishing assets. These checks also apply to retries.

| Release asset | Purpose |
| --- | --- |
| `openapi.yaml` | Distribution specification for API users and generators |
| `openapi.strict.yaml` | Specification retaining declared closed-object constraints; see [customization](customization.md) |
| `artifact.tar` | Built documentation site used for GitHub Pages |
| `notes.md` | Tested Redmine version, specification commit SHA, and generated specification change notes |
| `release-manifest.json` | Source and publisher provenance, validation run identifiers, and payload hashes |

`validation.json` is an intermediate manifest inside the validation job's Actions artifact, not another Release asset.

## Canary and new targets

Canary runs periodically and can be started manually on `main`. It tests a newer patch candidate with the currently selected target's published specification and tests. Another series is reported for a maintainer decision without API testing.

A successful candidate test does not change the publication targets. Review Redmine's source tag for that candidate and prepare the specification changes. Inspect the reported failure phase before concluding that an API changed. Manual runs default to summary-only reporting; enable `notify` to create or update issues.

Canary is not required after every release or target update. The publisher already validates the release; a Canary run without newer candidates does not retest the published version.

## Recovery and manual tags

To retry an existing tag, run `Publish release` on `main` with `tag` set and `source_ref` empty. This also applies to tags created by an earlier run.

```sh
RELEASE_TAG='<existing-release-tag>'
gh workflow run publish-release.yaml --ref main -f tag="$RELEASE_TAG"
```

An existing-tag retry uses the tagged SHA, even if a branch has advanced. Unpublished Drafts can be rebuilt when their source is verifiable. Resolve conflicting or unverifiable Drafts before retrying. The publisher verifies and reuses published Releases. Prepare another revision to publish a correction.

For Latest or Pages recovery only, leave both inputs empty:

```sh
gh workflow run publish-release.yaml --ref main
```

This performs reconciliation without another API test or a new individual Release. `bootstrap_latest=true` is only for an intentional initial selection when no Latest exists.

To publish from a manually pushed tag, ensure the prepared commit contains the `Request release` workflow. Fetch the prepared commit from the upstream repository, then tag its SHA.

```sh
SOURCE_SHA='<integrated-commit-sha>'
RELEASE_TAG='<prepared-release-tag>'
git fetch origin --tags
git tag "$RELEASE_TAG" "$SOURCE_SHA"
git push origin "refs/tags/$RELEASE_TAG"
```

Never move published tags or overwrite published assets. A failed run alone does not justify deleting its tag; revision checks account for existing ancestor tags whose publication failed.
