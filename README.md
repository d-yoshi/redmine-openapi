# Unofficial OpenAPI specification for the Redmine API

[![CI](https://github.com/d-yoshi/redmine-openapi/actions/workflows/ci.yaml/badge.svg)](https://github.com/d-yoshi/redmine-openapi/actions/workflows/ci.yaml)
[![Latest release](https://img.shields.io/github/v/release/d-yoshi/redmine-openapi?label=Latest%20release)](https://github.com/d-yoshi/redmine-openapi/releases/latest)

An OpenAPI 3.0.3 specification for the Redmine API, built from the official docs and source code, and tested against a running Redmine instance.

## Documentation

Browse the [API reference](https://d-yoshi.github.io/redmine-openapi/) for endpoint and schema details.

See the [maintenance policy](docs/maintenance-policy.md) for maintained versions and backport criteria, and the [guide index](docs/README.md) for customization, testing, and release procedures.

## Download

Releases include two specification variants:

| Asset | Use |
| --- | --- |
| `openapi.yaml` | General use, including client generation. |
| `openapi.strict.yaml` | Response validation, including checks for undeclared properties. |

See the [customization guide](docs/customization.md) for details on choosing a variant and adapting the specification for your Redmine installation or code generator.

Latest release:

```text
https://github.com/d-yoshi/redmine-openapi/releases/latest/download/openapi.yaml
```

Specific version:

```text
https://github.com/d-yoshi/redmine-openapi/releases/download/<tag>/openapi.yaml
```

Choose a release matching your Redmine version. Release tags use `<Redmine-version>-r<N>` (for example, `6.1.3-r2`): the exact Redmine version followed by the specification revision for that version. Revisions start at `-r1`.

For tags in retired formats, such as `2.0.1+redmine.6.1.3`, check the [release notes](https://github.com/d-yoshi/redmine-openapi/releases) for the verified Redmine version. Revisions can contain breaking corrections; release notes flag those changes and include a generated changelog.

Pin complete tags. SemVer parsers treat `-rN` as a prerelease suffix and can order revisions differently from their numeric order. Choose package versions for generated clients separately from the specification's `info.version`.

You can also check out a release tag with git, or fetch `openapi.yaml` from a tag via a raw URL.

## Reference

- [Redmine API Official Developer Guide](https://www.redmine.org/projects/redmine/wiki/Rest_api)
