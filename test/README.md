# Test Guide

The tests assess whether this OpenAPI specification accurately describes Redmine's released API behavior and responses. Use Redmine's source tag matching the branch's image pin and actual responses to investigate discrepancies, then correct missing fields, inaccurate descriptions, or excessive constraints in `src/`.

See [Contributing](https://github.com/d-yoshi/redmine-openapi/blob/main/CONTRIBUTING.md) for installation and editing, the [maintenance policy](https://github.com/d-yoshi/redmine-openapi/blob/main/docs/maintenance-policy.md) for evidence requirements, and the [release guide](https://github.com/d-yoshi/redmine-openapi/blob/main/docs/releasing.md) for changing targets and publishing. Run commands from the repository root.

For static checks:

```sh
./test/check.sh
```

For API tests, including those static checks:

```sh
./test/run-test.sh
```

Normal test output reports case durations. Use `time ./test/run-test.sh` to include setup and cleanup in the elapsed time.

`run-test.sh` starts its own Redmine container, enables the REST API, loads fixtures, runs tests and coverage checks, and destroys the container. It does not accept an existing Redmine instance. By default, each run uses a separate Compose project and an automatically assigned host port. It compares the image pin with the running version. With a Canary `REDMINE_IMAGE` override, the runner skips that pin comparison; Canary independently checks the actual candidate version.

Setup includes LDAP configuration and a user for `auth_source` metadata. Tests authenticate as a Redmine administrator using Basic authentication without contacting an LDAP server. News comments are seeded because the API cannot create them; [news.test.ts](src/news.test.ts) checks empty and populated comment arrays. A Git repository is created inside the container with a fixed file, author, timestamp, and message, then imported into Redmine for repository API tests.

## File organization

API tests live in `test/src/`, organized by resource. Tests of validation tools live in `test/*.test.mjs` and run through `check.sh`. Release automation and its tests are maintained on `main`.

- Put basic endpoint tests in `<resource>.test.ts`, such as [issues.test.ts](src/issues.test.ts).
- Use `<resource>.<concern>.test.ts` for a feature needing independent setup, such as [issues.visibility.test.ts](src/issues.visibility.test.ts) or [issues.default_assignment.test.ts](src/issues.default_assignment.test.ts). Short cases can stay in the existing file.
- Group behavior shared across endpoints by the resource being checked. Membership visibility across groups, users, and the current user lives in [memberships.visibility.test.ts](src/memberships.visibility.test.ts).
- Each suite owns its data and cleanup. Avoid mutable IDs shared between files or dependencies on file execution order. Prepare independent cases in hooks; related CRUD operations can form a scenario within a suite. Shared API operations and fixture lookups belong in [helpers.ts](src/helpers.ts).

## Choose cases

First identify the condition in Redmine's implementation behind the changed OpenAPI statement and the data needed to observe it. Use the target version's Redmine source tag to establish the claim, then reuse cases that exercise it. Before sharing representative tests, confirm that the affected parameters or fields use common processing, including filter registration, types, operators, and special-value expansion.

Add cases for distinct interpretations or exceptions and when source inspection and existing tests do not adequately establish a condition. Derive expectations from the released implementation and responses. Test names and assertions should identify the statement being checked.

| Statement | Data and observations |
| --- | --- |
| Array item schemas | Ensure the created object appears in the list so actual elements are validated |
| `required`, optional properties, and `nullable` | Check populated objects or arrays, key presence, and allowance for `null` separately; exercise normal omission or null conditions when relevant. See [issues.filters.test.ts](src/issues.filters.test.ts) |
| Include structure and conditions | Arrange data, check content when included and absence when not requested, and follow source behavior for empty arrays or permission-based omissions. See [issues.test.ts](src/issues.test.ts) and [memberships.visibility.test.ts](src/memberships.visibility.test.ts) |
| Status and error structure | Arrange the smallest setup that produces the response; state changes serve to expose that branch |
| Request attributes and descriptions | Inspect how Redmine handles the attribute in addition to type checking. Read back relevant values when a 204 or acceptance of unknown attributes would not establish the documented effect. See [versions.test.ts](src/versions.test.ts) |
| Filter formats and special values | Use a small set of matching and nonmatching records. Check representative multiple values, negation, substring matching, dates, and `me`. Separately handled shortcuts such as `from` and `to` need one-sided, combined, and boundary cases. See [issues.filters.test.ts](src/issues.filters.test.ts) and [time_entries.filters.test.ts](src/time_entries.filters.test.ts) |
| Pagination and `nometa` | Control ordering and records; assert IDs, pagination values, and metadata omission for both the `nometa` query parameter and `X-Redmine-Nometa`. See [issues.test.ts](src/issues.test.ts) |
| Content-Type | Shared middleware compares actual media types with declarations, including binary content and wildcard media types such as `*/*` |

Keep state creation and modification relevant to response formats, statuses, accepted inputs, or `description` statements. Exhaustive state transitions and Redmine's internal consistency are outside this suite's purpose. For attributes that the API cannot expose, distinguish acceptance checks from source evidence and document the limit below.

## Write tests

- Exercise new fields and includes with populated data. Assert the presence and values needed to prevent an empty array or absent optional property from leaving a claim unchecked.
- For request effects, send a representative changed value and read back relevant attributes. A 204 alone cannot distinguish an applied value from an ignored input.
- For replacement inputs such as `group_ids` and `user_ids`, send a set different from the current one and check the complete result, including removal of old entries. See [users.test.ts](src/users.test.ts) and [groups.test.ts](src/groups.test.ts).
- For string flags, distinguish omitted, empty, and nonempty values using data that changes the result. See [search.test.ts](src/search.test.ts).
- Match assertions to the documented guarantee. For required user references after deletion, check presence and structure. Assert the replacement identity only if the specification promises it.
- Resolve fixture-dependent IDs through [helpers.ts](src/helpers.ts). Values fixed by the specification, such as project-status values, can be used directly.
- Own users, groups, and other data not removed with a project in `before` and `after` hooks. Use `runCleanup` so one failed deletion does not prevent the rest.
- Avoid casting entire requests to `as any`. For an intentionally missing required input, place a justified `@ts-expect-error` only on that input; an accidentally optional declaration then causes an unused-directive failure.
- Pass dynamic `cf_<id>` filters as ``cf_x: { [`cf_${cfId}`]: "value" }``. The client's OpenAPI `form`/`explode: true` serialization sends `cf_<id>=value`, while values remain type-checked strings. No cast is needed. Confirm filter enablement, visibility, and IDs using released source and requests. See [issues.filters.test.ts](src/issues.filters.test.ts).
- Avoid `@ts-ignore`, `@ts-nocheck`, and file-wide lint suppression. Limit type assertions to unavoidable generated-type or library boundaries, and explain the local reason. The binary upload in [attachments.test.ts](src/attachments.test.ts), for example, limits its cast to the `Buffer` because its generated input type is `string`.
- Use a disposable user for account changes, as in [my_account.test.ts](src/my_account.test.ts). `createTestClient(login)` in the helpers sends `X-Redmine-Switch-User` as a Redmine administrator and uses the same response validation and observation log.
- For binary responses, verify the declared representation, such as media type, without expanding the test into file-byte equality or image-processing correctness. Keep redirects observable and use conditional requests to check a declared 304 response.
- Use `serializeRepeatedArrays` from the helpers for repeated bracketed query keys such as `ids[]=1&ids[]=2`. Keep comma-separated options such as `include` on the default serializer. Explicit Query filters need nested keys such as `op[field]` and `v[field][]`; see [queries.filters.test.ts](src/queries.filters.test.ts) for a typed serializer and matching-data checks.

For API test or schema changes, run `./test/run-test.sh`, which includes static checks. Use `./test/check.sh` for changes that only need static or tool checks. Review the statement being checked, observable data, type exceptions, and cleanup.

## Automated checks and their limits

| Check | Implementation | What it establishes |
| --- | --- | --- |
| Static checks | [check.sh](check.sh) | ShellCheck, tool regression tests, summary/detail synchronization, presence of the Redmine image pin, strict bundle and lint, generated TypeScript, and test type checking |
| Actual responses | [src/helpers.ts](src/helpers.ts), [src/response-validator.ts](src/response-validator.ts) | Declared status and Content-Type, JSON bodies matching strict schemas including calendar dates and timestamps, and empty bodies when content is not declared |
| API coverage | [check-api-coverage.mjs](check-api-coverage.mjs) | Whether declared operations, responses, and query parameter names were observed in actual requests |

`check.sh` skips ShellCheck locally when it is not installed and fails in CI if it is missing. `run-test.sh` runs `check.sh` before starting Redmine.

An always-present property incorrectly declared optional still passes response validation. Use source inspection to establish requiredness, including creation, update, deletion, retrieval, and authorization. Distinguish an optional `parent` object from its `id`, which can be required when that object is present.

The summary/detail checker compares shared field shapes. Required lists and property descriptions can differ to reflect each response's guarantees and rendering conditions.

Query-parameter coverage checks whether each declared parameter was used for each operation. Global and project-scoped issue and time-entry lists share observations where they use the same Query class. Global and project-scoped issue creation share copy-option observations; single and batch issue deletion share observations for time-entry handling.

Observations for pagination parameters `offset`, `limit`, `page`, and `nometa`, and explicit filters `f[]`, `op`, and `v`, are shared only when the operations reference common definitions. Sending an undeclared parameter does not satisfy coverage for another endpoint. `cf_x` represents concrete custom-field filter names, including associated fields such as `issue.cf_12`.

Coverage does not establish all operator/value combinations or filtering effects; inspect each filter's existence and processing as described in Contributing.

Each declared HTTP method alias needs a successful API request in the tests. The checker shares response-status observations only between pairs listed in `METHOD_ALIASES`, and requires their parameter, request-body, response, and security definitions to match. Source inspection must also establish that both methods use the same Redmine controller action. Use representative tests for shared input behavior, and check the observable effect of each update in alias tests.

Automatically injected 401, 403, and 412 responses are excluded from coverage requirements. Some tests exercise 403, but the coverage checker would not detect removal of those tests. The checker's `UNREACHABLE` entries record unreachable responses and their reasons. The checker fails if an entry no longer corresponds to a declared response or if a test reaches it. Read test and coverage counts from execution output rather than maintaining another count.

## Coverage scope and exclusions

| Area | Current limits and reasons |
| --- | --- |
| XML and JSONP responses | Outside the specification's JSON and binary scope. JSONP parameters `callback` and `jsonp` are mentioned in `info.description` but are not declared on individual operations |
| OAuth-specific behavior | The Basic-authentication suite does not check omitted `api_key` values or account-update 403 responses under OAuth; OAuth application setup is needed |
| Authentication | The default client uses administrator Basic credentials. Selected anonymous-access cases use `createTestClient(undefined, { anonymous: true })`; they do not cover every installation setting, role or authentication mode. The specification does not declare `WWW-Authenticate`, whose value depends on authentication mode |
| Issue `allowed_statuses` | Setup does not create workflows, so a nonempty result is not guaranteed. The array is checked, and items share the issue-status schema; business rules for transitions are not tested |
| Unreadable `PUT /my/account` attributes | `GET /my/account` does not return `pref` and some other values. Acceptance is checked with a disposable user; the shared administrator is not modified |
| Invalid project/time-entry list filters | The specification does not promise a 422 for invalid filter values in these lists, and tests do not impose that guarantee |
| Filter semantics | Representative multiple values, negation, date comparisons, and `me` are tested, rather than every filter/operator/value combination. Unknown names can return 200, so source verification remains necessary |

## API-specific decisions and undeclared attributes

These decisions describe the current specification. Recheck the relevant released source when changing the target Redmine version.

| Area | Decision and references |
| --- | --- |
| Wiki creation without `text` | Can create an incomplete page without content. Do not widen the schema to accommodate that state or create it in tests. Test 422 using an invalid parent instead |
| Membership updates with empty `role_ids` | If an update leaves no roles, Redmine deletes the membership and returns 422. An empty array does not remove inherited roles or roles the current user cannot manage. See the [shared request body](../src/components/request_bodies/update_membership.yaml) and [memberships.test.ts](src/memberships.test.ts) |
| Attachment errors and caching | Download routes with a filename return HTML errors; the filename-free JSON route returns empty API error bodies. Thumbnail error representations depend on `Accept`. Tests check empty API error bodies, HTML error pages, sign-in redirects, and ETag-based 304 responses. See [attachments.test.ts](src/attachments.test.ts) |
| News summaries | Lists retain a null `summary`; details omit it when blank. The synchronization checker preserves this response-specific nullability difference |
| Wiki start page | `GET /projects/{project_id}/wiki.json` exposes the configured start page. Tests read it after `is_start_page` updates |
| Redirects from old wiki titles | Tests use `redirect_existing_links: "0"` for an old-title 404 and `"1"` for a 302. Redirect tests check `Location` for page reads, historical reads, start-page reads and deletion without following it. Renaming with `is_start_page: false` can keep the configured start-page title pointing to the old-title redirect. See [wiki_pages.test.ts](src/wiki_pages.test.ts) |
| Issue `lock_version` | Undeclared because the API does not expose the optimistic-lock value needed to test it |
| Issue-update `watcher_user_ids` | Undeclared for PUT and PATCH because it is accepted only during creation |
| Issue-creation `notes` | Undeclared because the creation path does not record it as a journal |
| Wiki `parent_id` and `wiki_id` | Undeclared because the API does not expose the internal IDs; use `parent_title` for hierarchy |

Tests for descendant issue visibility, membership visibility, default assignees, and journal structure and visibility live in [issues.visibility.test.ts](src/issues.visibility.test.ts), [memberships.visibility.test.ts](src/memberships.visibility.test.ts), [issues.default_assignment.test.ts](src/issues.default_assignment.test.ts), and [journals.test.ts](src/journals.test.ts).

## Version-specific checks

The image pin selects Redmine 6.1.6 for this branch. Duration request fields accept numeric hours and supported time strings, while duration filters use decimal hours. Group-user removal succeeds for an existing user who is not a member. Do not import newer notification values, custom-field metadata, Wiki response fields, or API operations without checking the target release's source.
