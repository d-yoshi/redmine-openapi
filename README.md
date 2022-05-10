# Redmine OpenAPI Specification

## Overview

```
Redmine: 5.0.0
OpenAPI: 3.0.3
```

These yaml files are created by my human scraping and experimentation with Redmine 5.0 in my local environment.

You can feel the warmth of manual labor.

| Resource            | State of progress |
| ------------------- | ----------------- |
| Issues              | **Done**          |
| Projects            | **Done**          |
| Project Memberships | **Done**          |
| Users               | **Done**          |
| Time Entries        | **Done**          |
| News                | Todo              |
| Issue Relations     | Todo              |
| Versions            | Todo              |
| Wiki Pages          | Todo              |
| Queries             | Todo              |
| Attachements        | **Done**          |
| Issue Statuses      | **Done**          |
| Trackers            | **Done**          |
| Enumerations        | Todo              |
| Issue Categories    | **Done**          |
| Roles               | **Done**          |
| Groups              | **Done**          |
| Custom Fields       | **Done**          |
| Search              | Todo              |
| Files               | Todo              |
| My account          | **Done**          |
| Journals            | Todo              |

## How to bundle into one YAML file

To bundle files in the src directory, execute the following command.

```
docker run --rm -v $(pwd):/workspace jeanberu/swagger-cli  swagger-cli bundle -o workspace/openapi.yml -t yaml workspace/src/openapi.yml
```
