# Unofficial OpenAPI specification for the Redmine API

[![CI](https://github.com/d-yoshi/redmine-openapi/actions/workflows/ci.yaml/badge.svg)](https://github.com/d-yoshi/redmine-openapi/actions/workflows/ci.yaml)
[![Latest release](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fapi.github.com%2Frepos%2Fd-yoshi%2Fredmine-openapi%2Freleases%2Flatest&query=%24.tag_name&label=Latest%20release)](https://github.com/d-yoshi/redmine-openapi/releases/latest)

An OpenAPI 3.0.3 specification for the Redmine API, built from the official docs and source code, and tested against a running Redmine instance.

## Documentation

Browse the [API reference](https://d-yoshi.github.io/redmine-openapi/) for the standard release.

See the [maintenance policy](docs/maintenance-policy.md) for maintained versions and backport criteria, and the [guide index](docs/README.md) for customization, testing, and release procedures.

## Download

Choose a [release](https://github.com/d-yoshi/redmine-openapi/releases) that matches your exact Redmine version and pin its full tag. Current tags use `<Redmine-version>-r<N>`, such as `6.1.3-r2`. The revision number starts at 1 for each Redmine version.

Check the release's **Assets** for the available variants.

| Asset | Use |
| --- | --- |
| `openapi.yaml` | General use, including client generation. |
| `openapi.strict.yaml` | Response validation, including checks for undeclared properties. |

See the [customization guide](docs/customization.md) for details on choosing a variant and adapting the specification for your Redmine installation or code generator.

For a specific release, replace `<tag>` in this URL with the full release tag.

```text
https://github.com/d-yoshi/redmine-openapi/releases/download/<tag>/openapi.yaml
```

This URL downloads the standard release selected as GitHub Latest.

```text
https://github.com/d-yoshi/redmine-openapi/releases/latest/download/openapi.yaml
```

For releases with retired tag formats, check the Redmine version recorded in the release notes. If CI used a rolling Redmine image, the notes give an estimated patch version. Current release notes flag breaking corrections and include a generated changelog when there is a previous release to compare.

SemVer parsers treat `-rN` as a prerelease suffix and can order revisions differently from their numeric order. Choose package versions for generated clients separately from the specification's `info.version`.

You can also check out a release tag with git, or fetch `openapi.yaml` from a tag via a raw URL.

## Reference

- [Redmine API Official Developer Guide](https://www.redmine.org/projects/redmine/wiki/Rest_api)
