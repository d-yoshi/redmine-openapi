# Unofficial OpenAPI specification for the Redmine API

[![CI](https://github.com/d-yoshi/redmine-openapi/actions/workflows/ci.yaml/badge.svg)](https://github.com/d-yoshi/redmine-openapi/actions/workflows/ci.yaml)

An OpenAPI 3.0.3 specification for the Redmine API, built from the official docs and source code, and tested against a running Redmine instance.

**Tested against: Redmine 6.1.3**

## Documentation

Browse the rendered API reference at https://d-yoshi.github.io/redmine-openapi/

## Download

Latest release:

```text
https://github.com/d-yoshi/redmine-openapi/releases/latest/download/openapi.yaml
```

Specific version:

```text
https://github.com/d-yoshi/redmine-openapi/releases/download/<tag>/openapi.yaml
```

Release tags are `<spec-version>+redmine.<x.y.z>`, where the build metadata is the Redmine version the release was verified against (older tags predate this format). If you run an older Redmine, pick the release whose notes match your version — the notes of each [release](https://github.com/d-yoshi/redmine-openapi/releases) state the verified Redmine version.

You can also check out a release tag with git, or fetch `openapi.yaml` from a tag via a raw URL.

> [!NOTE]
> `openapi.yaml` on the `main` branch may contain unreleased changes beyond its declared `info.version`. Use a release for a stable reference.

## Reference

- [Redmine API Official Developer Guide](https://www.redmine.org/projects/redmine/wiki/Rest_api)
