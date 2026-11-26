# Unofficial OpenAPI specification for the Redmine API

[![Maintenance CI](https://github.com/d-yoshi/redmine-openapi/actions/workflows/ci.yaml/badge.svg?branch=maintenance%2F6.1.6)](https://github.com/d-yoshi/redmine-openapi/actions/workflows/ci.yaml?query=branch%3Amaintenance%2F6.1.6)

An OpenAPI 3.0.3 specification for the Redmine API, built from the official docs and source code, and tested against a running Redmine instance.

## Documentation

The [API reference](https://d-yoshi.github.io/redmine-openapi/) and [GitHub Latest](https://github.com/d-yoshi/redmine-openapi/releases/latest) follow the standard release. The [maintenance policy](https://github.com/d-yoshi/redmine-openapi/blob/main/docs/maintenance-policy.md) explains how the standard and maintenance targets are selected.

## Download

Choose a [release](https://github.com/d-yoshi/redmine-openapi/releases) that matches your exact Redmine version and pin its full tag. Current tags use `<Redmine-version>-r<N>`, where `-rN` identifies the specification revision.

Check the release's **Assets** for the available variants. Use `openapi.yaml` for general use, including client generation. When available, `openapi.strict.yaml` can check for undeclared response properties. The [customization guide](https://github.com/d-yoshi/redmine-openapi/blob/main/docs/customization.md) explains how to use each asset.

To download the distribution specification, replace `<tag>` in this URL with the full release tag.

```text
https://github.com/d-yoshi/redmine-openapi/releases/download/<tag>/openapi.yaml
```

See the [download guide](https://github.com/d-yoshi/redmine-openapi/blob/main/README.md#download) for retired tag formats and compatibility information.

## Reference

- [Redmine API Official Developer Guide](https://www.redmine.org/projects/redmine/wiki/Rest_api)
