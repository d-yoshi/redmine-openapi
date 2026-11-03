# Maintenance Policy

This project maintains an OpenAPI specification for released Redmine APIs. We assess whether the specification expresses the API's observable formats, meanings, and conditions accurately. The test suite supports that assessment; its purpose is not to verify all of Redmine's business rules.

See [Contributing](../CONTRIBUTING.md) for submission and editing instructions, the [test guide](../test/README.md) for test design, and the [release guide](releasing.md) for versioning and publication procedures.

The Redmine image pin in a branch's [test configuration](../test/redmine/docker-compose.yaml) defines the exact target version for changes on that branch. Publication selections are recorded separately in [release-targets.json](../.github/release-targets.json) and can differ while a new target is in development.

## Scope of the specification

Include information that users need to construct API requests or interpret responses:

| Area | What we describe |
| --- | --- |
| Request format | Paths, methods, parameter names and types, required inputs, and serialization |
| Response format | Status codes, Content-Type, field types, required properties, `null`, and omission conditions |
| Request meaning | Filter expressions, operators, delimiters, special values, defaults, ordering, and pagination |
| Usage conditions | Permissions, settings, and request options that affect accepted inputs or returned fields |

Describe the stock Redmine API for the target version. Users can represent installation-specific types and plugin changes in a separate specification using the [customization guide](customization.md).

Investigating internal implementation is a way to establish API behavior. Changes to internal method names or call order alone do not require specification changes. Confirmed omissions and properties incorrectly marked optional are specification defects and should be corrected.

## Evidence and verification

Substantiate added or changed API claims using Redmine's source tag for the target version. Official API documentation and representative requests and responses provide additional evidence. Do not attribute unreleased Redmine development-branch behavior to a release.

Identify an existing test that exercises the statement being changed. Share representative tests when source inspection establishes common processing. Add tests for distinct interpretations, exceptions, or conditions that source inspection and existing cases do not resolve adequately. See the test guide for concrete case selection.

State changes in tests should expose the request or response behavior described by the specification. Creating fixtures, reading back an updated attribute, or arranging permissions can be necessary. Exhaustive workflow transitions, combinations of every setting, and checks of internal callbacks or database consistency are outside the suite's purpose.

A successful test run is evidence for the exercised cases. It does not prove every property is always present or that every documented parameter was interpreted.

## Request descriptions

For parameters that accept expressions, document the supported operators, delimiters, special values, their meanings, and applicable conditions. Use a few examples to show how those rules combine. Verify each documented capability in the selected release's processing for that parameter.

Tests should distinguish matching and nonmatching data where needed. A successful status or a valid response shape alone cannot show that Redmine honored a filter; unknown parameters can be ignored. Shared parser behavior can use representative tests, while parameter-specific behavior needs its own evidence.

## Required response properties

Mark a property as required when users can rely on its key being present in the applicable response under stock Redmine's normal operations. Consider each relevant response path, including list and detail representations.

Evidence can establish the guarantee through:

- Unconditional emission of the key by response rendering.
- Creation and update validation together with deletion, reassignment, or cascading deletion rules that preserve the referenced data.
- Retrieval or authorization rules that prevent records with missing related data from reaching that response.

A `nil` check in rendering does not by itself make a property optional. For example, creation may require an author and deletion may replace that author with an anonymous user. Inspect the complete guarantee rather than relying on the rendering statement alone. Indirect evidence can require more investigation, but does not change which guarantees belong in the specification.

If a valid response can omit the property because of permissions, settings, or request options, represent that optionality and explain the condition. Split schemas when their guarantees differ. If the evidence is insufficient, defer the required-property change and record the uncertainty in the pull request.

Judge key presence separately from a value's allowance for `null`. Also distinguish an optional parent object or array from required properties inside the objects it contains. Use populated objects and arrays in tests so their properties are actually checked.

## Maintained versions and backports

A series is a major/minor pair. Routine maintenance covers the standard series and the series it replaced. Maintainers select one exact patch version for the standard target and at most one for the maintenance target. The standard target supplies GitHub Latest and the API reference on GitHub Pages; the maintenance target supplies releases for the preceding series. The current selections are recorded in [release-targets.json](../.github/release-targets.json). Each specification release identifies the exact Redmine version used for its tests.

Publishing a newer patch does not itself change those selections. After verifying the published assets, automation proposes a configuration PR for a newer patch within a selected series. Maintainers review and merge it to adopt that target. A change of series requires an explicit configuration decision. See the release guide for the commands and recovery steps.

When maintainers adopt a new standard series, the previous standard series becomes the routine maintenance series; the previously maintained older series moves to case-by-case maintenance. Other patch versions in a maintained series are also handled individually, based on reported impact, available evidence, and verification effort. Published tags and assets remain available.

Correct errors in types, required properties, return conditions, and parameter meaning in maintained older versions when the same error exists there. Confirm the correction against each target's released source and relevant tests. Keep behavior introduced by a newer Redmine release specific to that release. Editorial changes can be grouped with other work.

Maintainers choose backport targets and communicate compatibility impact. A corrected schema can still require users to change generated clients or validators. Correcting one patch version does not establish that every release in its series has been corrected.

## Where to record information

| Location | Information |
| --- | --- |
| OpenAPI schemas and descriptions | API formats, meanings, conditions, and examples needed by users |
| Test names and assertions | The statement being checked and the relevant observations |
| Code comments | Constraints or workarounds that are not apparent from the code |
| Pull requests and issues | Released source references, reasoning, investigation, and remaining uncertainty |
| This policy and the test guide | Lasting maintenance rules and verification limits |

Keep detailed Redmine implementation traces in the pull request rather than repeating them in comments. Apply these criteria to new and changed statements, correct confirmed defects first, and investigate remaining areas according to user impact.
