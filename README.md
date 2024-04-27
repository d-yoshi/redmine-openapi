[![Redoc](https://github.com/d-yoshi/redmine-openapi/actions/workflows/redoc.yml/badge.svg)](https://github.com/d-yoshi/redmine-openapi/actions/workflows/redoc.yml)

# Redmine OpenAPI Specification

## Overview

```
Redmine: 5.0.0
OpenAPI: 3.0.3
```

These yaml files are created by my human scraping and experimentation with Redmine 5.0.0 in my local environment.

## Redoc

https://d-yoshi.github.io/redmine-openapi/

## Implementation Status

| Resource            | Status   |
| ------------------- | -------- |
| Issues              | **Done** |
| Projects            | **Done** |
| Project Memberships | **Done** |
| Users               | **Done** |
| Time Entries        | **Done** |
| News                | **Done** |
| Issue Relations     | **Done** |
| Versions            | **Done** |
| Wiki Pages          | **Done** |
| Queries             | **Done** |
| Attachements        | **Done** |
| Issue Statuses      | **Done** |
| Trackers            | **Done** |
| Enumerations        | **Done** |
| Issue Categories    | **Done** |
| Roles               | **Done** |
| Groups              | **Done** |
| Custom Fields       | **Done** |
| Search              | **Done** |
| Files               | **Done** |
| My Account          | **Done** |
| Journals            | **Done** |

## How to bundle into one YAML file

To bundle files in the src directory, execute the following command.

```
npx @redocly/cli bundle src/openapi.yml -o openapi.yml
```

## Reference

[Redmine API Official Developer Guide](https://www.redmine.org/projects/redmine/wiki/Rest_api)
