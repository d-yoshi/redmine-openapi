# Contributing

This project describes released Redmine APIs in OpenAPI. Contributions can correct schemas, clarify request parameters, improve examples or tests, and report differences between the specification and Redmine's API behavior.

The [maintenance policy](docs/maintenance-policy.md) defines what the specification covers and how we establish its accuracy. The [test guide](test/README.md) explains test design, and the [release guide](docs/releasing.md) covers maintainer operations.

## Report a discrepancy

Include the exact Redmine version, the specification release tag, the endpoint and HTTP method, a minimal request, the observed response, and the difference you expected the specification to express. Mention relevant permissions, settings, or plugins. Remove credentials and personal data from examples.

A reproducible report is useful even without a patch or source analysis. Small corrections can be submitted directly as a pull request. Discuss substantial additions, changes to the supported series, or uncertain API behavior in an issue first.

## Choose a target branch

Open pull requests for standard-series development against `main`. For a maintained older version, select its existing `maintenance/<target-version>` branch as the pull request's base. Ask a maintainer to create the upstream branch if it does not exist, or to choose the base if you are unsure.

Check the Redmine image pin in [test/redmine/docker-compose.yaml](test/redmine/docker-compose.yaml) on the selected base branch. That exact Redmine version is the reference for your change. The [publication targets](.github/release-targets.json) select published releases and can differ from a branch's development target. Reports from other versions are welcome; identify the version so maintainers can determine the appropriate base branch.

Maintainers decide which other versions need the correction, create upstream maintenance branches, and handle merging and publication. Contributors do not need to change release metadata or create release tags. Repository settings require administrator permissions; release operations are described in the release guide.

## Set up the environment

For a contribution without write access to the upstream repository, fork it and create a working branch based on the selected upstream branch. Make your changes in that working branch and submit a pull request to the base chosen above.

Use the Node.js version in [.tool-versions](.tool-versions) from that checkout. Install the npm workspace dependencies from the repository root:

```sh
npm ci
```

Docker and Docker Compose are needed for API tests. ShellCheck is optional locally; CI requires it. A report or pull request can still be submitted if some checks cannot be run locally. State what you ran and what remains unverified so the missing checks can be coordinated with maintainers.

## Edit and substantiate the specification

Edit `src/` for OpenAPI changes and `test/src/` for API tests. The root `openapi.yaml` is generated; use `npm run bundle` to update it.

Confirm behavior in Redmine's source tag matching the branch's image pin. Redmine development branches can contain behavior that has not been released. An adjacent checkout at `../redmine` is one possible layout, not a required location.

| Subject | Useful Redmine source locations |
| --- | --- |
| Routes and API-enabled actions | `config/routes.rb`, controllers and `accept_api_auth` |
| Response fields and includes | `app/views/**/*.api.rsb`, API rendering helpers |
| Accepted attributes and validation | Models, `safe_attributes`, validators |
| Column types | Database migrations |
| Filters and special values | The relevant Query class and controller parameter handling |

Follow these schema conventions:

- Use `*.summary.yaml` for list representations and `*.yaml` for detail representations. Check both when changing a shared field.
- Declare `additionalProperties: false` on response object schemas. The strict bundle retains it; the distribution bundle removes it.
- Assess required properties, `null`, and omission conditions separately, using the maintenance policy's evidence requirements.
- The build plugin injects 401, 403, and 412 responses. Do not duplicate those declarations in individual paths.
- Filters that accept expressions such as `1|5`, `!1`, or `>=2024-01-01` use `type: string`, including ID filters. Verify the parser for the specific parameter. Parameters such as `include`, pagination, and search flags can use different parsing rules.

The OpenAPI schemas and descriptions are the source for API-facing formats, operators, conditions, and examples. Keep investigation details and links to released Redmine code in the pull request. Use code comments for constraints or workarounds that are not apparent from the code.

## Verify the change

Run commands from the repository root:

| Command | Purpose |
| --- | --- |
| `./test/check.sh` | Tool tests, schema checks, strict bundling and linting, TypeScript generation and type checking; no Docker required |
| `./test/run-test.sh` | The static checks above, then API tests and coverage checks in a disposable Redmine container |
| `npm run bundle` | Regenerate the distribution bundle |
| `npm run lint` | Lint the distribution bundle |

`run-test.sh` includes `check.sh`, so running both is not necessary for every change. For wording-only documentation changes, review the text, links, and examples; API integration tests are not routinely required.

For API claims, identify an existing test that exercises the changed statement or add a case when needed. Empty arrays and absent optional fields may leave a schema untested. A 200 response alone cannot establish that a filter expression had the documented effect. See the test guide for case selection and known coverage limits.

You may submit source changes without committing the generated bundle. Review the generated diff when possible. Upstream CI uploads the bundle for review when it runs on your pull request. For pushes to upstream branches, successful CI can also commit the generated bundle. Maintainers ensure that bundle is current before publication; the upstream job cannot push an update to your fork.

## Describe the pull request

Explain the discrepancy and resulting behavior, the exact Redmine version, the evidence, and the validation performed. Link to the relevant files at Redmine's released source tag and identify the existing or added tests. State any conditions you have not confirmed. For a required property, explain why normal API responses cannot omit it; one response containing the property is not sufficient evidence.

Maintainers review the evidence and wording, coordinate outstanding checks, and assess backports and release impact. Workflow approval may be needed for fork pull requests. Documentation-only changes may not trigger CI because of its path filters.

When a guide has translations, keep them aligned and identify any remaining translation work.
