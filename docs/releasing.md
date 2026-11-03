# Releasing

This guide is for maintainers with permission to push branches and run workflows in the upstream repository. See the [maintenance policy](maintenance-policy.md) for supported versions and backport criteria, and [Contributing](../CONTRIBUTING.md) for submitting changes through a pull request.

The workflow publishes a fixed specification commit from this repository. That commit's Redmine image pin identifies the version used for API tests. Release tooling runs from `main`; maintenance branches retain their own specification, tests, and dependencies.

## Prerequisites

Run the examples from a tooling checkout on `main`, with `origin` pointing to the upstream repository and GitHub CLI authenticated with the required write permissions. Use the Node.js version in [.tool-versions](../.tool-versions) and install dependencies:

```sh
npm ci
```

A repository administrator must configure Pages to use GitHub Actions, keep the `github-pages` environment available, and enable `Allow GitHub Actions to create and approve pull requests` for generated target proposals. Those PRs may need workflow approval before their checks run; adoption of a publication target requires a reviewed merge.

CI grants write permissions only to its generated-bundle job; repository rules must permit that commit. Keep the legacy release workflow disabled. These are one-time settings, separate from the steps for each release.

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

## Prepare release metadata

From the tooling checkout on `main`, prepare another revision for the current image pin:

```sh
npm run release:prepare
```

To prepare a newer Redmine target:

```sh
REDMINE_VERSION='<target-version>'
npm run release:prepare -- "$REDMINE_VERSION"
```

The command fetches tags from `origin`, calculates the next revision from the specification checkout's ancestry, updates `info.version`, `info.description`, and the Redmine image pin, then regenerates `openapi.yaml`. It preserves unrelated edits and restores the release files if bundling fails. It leaves the result uncommitted and creates no release tag. Inspect the diff and commit it with the specification changes.

When preparing a new target, review Redmine's source tag for that version and make any needed specification and test corrections. Run the relevant checks; `./test/run-test.sh` includes static checks, API tests, and coverage checks.

CI also builds and lints the bundle. Its `commit-bundle` job can update the committed bundle after successful branch checks. Wait for that job before publishing. Documentation-only commits can be outside CI's path filters; inspect the successful checks for the relevant specification and tooling changes.

## Publish a standard release

Complete review, merge the prepared changes into `main`, and wait for relevant CI and bundle updates. Run `Publish release` on `main` with `source_ref` selecting the specification commit:

```sh
gh workflow run publish-release.yaml --ref main -f source_ref=main
```

The workflow resolves `source_ref` to a fixed SHA and reads `info.version` from that specification commit. The validation job tests the commit without publication write permissions. After validation and artifact checks succeed, the publisher creates the tag and publishes the release. A pre-existing tag must identify the same SHA; it is never moved.

A `GITHUB_TOKEN`-created tag does not trigger the tag-push workflow, so this workflow proceeds directly to publication. Confirm `Publish release assets` and `Update Latest and Pages` succeed, and review any proposal from `Propose publication target`.

## Publish a maintenance release

Use an existing maintenance checkout with the appropriate history. If a new target branch is needed, start from the most recent appropriate release tag, normally the preceding maintained patch's release. From the tooling checkout on `main`, one way to create it is:

```sh
SOURCE_CHECKOUT='../redmine-openapi-maintenance'
MAINTENANCE_BRANCH='maintenance/<target-version>'
PREVIOUS_TAG='<previous-release-tag>'
git fetch origin --tags
git worktree add -b "$MAINTENANCE_BRANCH" "$SOURCE_CHECKOUT" "refs/tags/$PREVIOUS_TAG"
```

For an existing branch, check it out in a separate clone or worktree instead of creating it again. Make the changes there and install that checkout's dependencies. Invoke the preparation tool from `main` with `--source`; this avoids copying the publishing tools into older branches:

```sh
SOURCE_CHECKOUT='../redmine-openapi-maintenance'
REDMINE_VERSION='<target-version>'
npm --prefix "$SOURCE_CHECKOUT" ci
npm run release:prepare -- --source "$SOURCE_CHECKOUT" "$REDMINE_VERSION"
```

Omit the version argument when preparing another revision for its current pin. Review, test, and commit the changes in the maintenance checkout, then push its branch:

```sh
SOURCE_CHECKOUT='../redmine-openapi-maintenance'
MAINTENANCE_BRANCH='maintenance/<target-version>'
git -C "$SOURCE_CHECKOUT" push -u origin "$MAINTENANCE_BRANCH"
```

After CI and any bundle update finish, publish from the tooling checkout on `main`:

```sh
MAINTENANCE_BRANCH='maintenance/<target-version>'
gh workflow run publish-release.yaml --ref main -f source_ref="$MAINTENANCE_BRANCH"
```

The maintenance checkout must include the test entry points, a lockfile, a Node.js pin, and a committed bundle matching its specification source. The central workflow uses that checkout's tests, lockfile, and Node.js version. For manual tag pushes, ensure the maintenance branch contains `Request release` and leave the repository's legacy release workflow disabled.

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
| [CI](../.github/workflows/ci.yaml) | Build and lint the specification, check tooling and API tests, show a specification diff, and update the generated bundle |
| [Publish release](../.github/workflows/publish-release.yaml) | Resolve and validate the source, create or verify the tag, publish assets, propose a target update, and reconcile Latest and Pages |
| [Request release](../.github/workflows/request-release.yaml) | Support requests from manually pushed release tags |
| [Canary](../.github/workflows/canary.yaml) | Detect newer Redmine versions and test candidates using each target's published specification commit |
| [Legacy release](../.github/workflows/release.yaml) | Retired entry point; use the central publisher |

CI's specification comparison and central release validation use the same Docker image version and digest from [oasdiff-image.txt](../.github/oasdiff-image.txt). Update that file when changing oasdiff.

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

Run `Publish release` on `main`; `source_ref` selects the specification commit separately. To retry an existing tag, including a tag created by an earlier run:

```sh
RELEASE_TAG='<existing-release-tag>'
gh workflow run publish-release.yaml --ref main -f tag="$RELEASE_TAG"
```

`source_ref` and `tag` are mutually exclusive. An existing-tag retry uses the tagged SHA, even if a branch has advanced. Unpublished Drafts can be rebuilt when their source is verifiable. Resolve conflicting or unverifiable Drafts before retrying. Published Releases are verified and reused; corrections require another revision.

For Latest or Pages recovery only, leave both inputs empty:

```sh
gh workflow run publish-release.yaml --ref main
```

This performs reconciliation without another API test or a new individual Release. `bootstrap_latest=true` is only for an intentional initial selection when no Latest exists.

Manual tagging is an alternative after the source is prepared and verified. For a standard release, fetch the final commit before tagging; for a maintenance release, use its remote branch instead of `origin/main`:

```sh
RELEASE_TAG='<prepared-release-tag>'
git fetch origin --tags
git tag "$RELEASE_TAG" origin/main
git push origin "refs/tags/$RELEASE_TAG"
```

Never move published tags or overwrite published assets. A failed run alone does not justify deleting its tag; revision checks account for existing ancestor tags whose publication failed.
