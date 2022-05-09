# Redmine OpenAPI Specification

## Overview

```
Redmine: 5.0.0
OpenAPI: 3.0.3
```

These yaml files are created by my human scraping and experimentation with Redmine 5.0 in my local environment.

You can feel the warmth of manual labor.

Resource | State of progress
-- | --
Issues | **Done**
Projects | **Done**
Project Memberships | **Done**
Users | **Done**
Time Entries | In Progress
News | Todo
Issue Relations | Todo
Versions | Todo
Wiki Pages | Todo
Queries | Todo
Attachements | Todo
Issue Statuses | **Done**
Trackers | Todo
Enumerations | Todo
Issue Categories | Todo
Roles | Todo
Groups | Todo
Custom Fields | Todo
Search | Todo
Files | Todo
My account | Todo
Journals | Todo

## How to bundle into one YAML file

```
docker run --rm -v $(PWD)/:/workspace/ jeanberu/swagger-cli swagger-cli bundle -o workspace/dist/openapi.yml -t yaml workspace/openapi.yml
```