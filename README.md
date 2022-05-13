[![Redoc](https://github.com/d-yoshi/redmine-openapi/actions/workflows/redoc.yml/badge.svg)](https://github.com/d-yoshi/redmine-openapi/actions/workflows/redoc.yml)

# Redmine OpenAPI Specification

## Overview

```
Redmine: 5.0.0
OpenAPI: 3.0.3
```

These yaml files are created by my human scraping and experimentation with Redmine 5.0.0 in my local environment.

You can feel the warmth of manual labor.

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
| News                | Todo     |
| Issue Relations     | Todo     |
| Versions            | Todo     |
| Wiki Pages          | Todo     |
| Queries             | Todo     |
| Attachements        | **Done** |
| Issue Statuses      | **Done** |
| Trackers            | **Done** |
| Enumerations        | **Done** |
| Issue Categories    | **Done** |
| Roles               | **Done** |
| Groups              | **Done** |
| Custom Fields       | **Done** |
| Search              | **Done** |
| Files               | Todo     |
| My Account          | **Done** |
| Journals            | Todo     |

## How to bundle into one YAML file

To bundle files in the src directory, execute the following command.

```
docker run --rm -v $(pwd):/workspace jeanberu/swagger-cli:4.0.4 swagger-cli bundle -o workspace/openapi.yml -t yaml workspace/src/openapi.yml
```

## Reference

[Redmine API Official Developer Guide](https://www.redmine.org/projects/redmine/wiki/Rest_api)
