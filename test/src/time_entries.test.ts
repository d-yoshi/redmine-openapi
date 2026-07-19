import { before, after, describe, test } from "node:test";

import { client, assertStatus } from "./helpers.js";

describe("Time Entries", () => {
  let projectId: number;
  let issueId: number;
  let activityId: number;
  let timeEntryId: number;

  before(async () => {
    const projectName = `time-${Date.now()}`;
    const projectResponse = await client.POST("/projects.{format}", {
      params: { path: { format: "json" } },
      body: {
        project: {
          name: projectName,
          identifier: projectName,
          enabled_module_names: ["time_tracking", "issue_tracking"],
        },
      },
    });
    assertStatus(201, projectResponse);
    projectId = projectResponse.data!.project.id;

    const issueResponse = await client.POST("/issues.{format}", {
      params: { path: { format: "json" } },
      body: {
        issue: {
          project_id: projectId,
          tracker_id: 1,
          subject: "issue-1",
        },
      },
    });
    assertStatus(201, issueResponse);
    issueId = issueResponse.data!.issue.id;

    const activitiesResponse = await client.GET(
      "/enumerations/time_entry_activities.{format}",
      { params: { path: { format: "json" } } }
    );
    assertStatus(200, activitiesResponse);
    activityId = activitiesResponse.data!.time_entry_activities[0].id;
  });

  after(async () => {
    if (projectId) {
      await client.DELETE("/projects/{project_id}.{format}", {
        params: { path: { format: "json", project_id: projectId } },
      });
    }
  });

  test("POST /time_entries.json", async () => {
    const response = await client.POST("/time_entries.{format}", {
      params: { path: { format: "json" } },
      body: {
        time_entry: {
          issue_id: issueId,
          project_id: projectId,
          hours: 1.5,
          activity_id: activityId,
          comments: "entry-1",
          spent_on: new Date().toISOString().slice(0, 10),
          user_id: 1,
          custom_fields: [],
          custom_field_values: {},
        },
      },
    });
    assertStatus(201, response);
    timeEntryId = response.data!.time_entry.id;
  });

  test("GET /time_entries/{time_entry_id}.json", async () => {
    const response = await client.GET(
      "/time_entries/{time_entry_id}.{format}",
      {
        params: {
          path: { format: "json", time_entry_id: timeEntryId },
        },
      }
    );
    assertStatus(200, response);
  });

  test("PUT /time_entries/{time_entry_id}.json", async () => {
    const response = await client.PUT(
      "/time_entries/{time_entry_id}.{format}",
      {
        params: {
          path: { format: "json", time_entry_id: timeEntryId },
        },
        body: {
          time_entry: {
            issue_id: issueId,
            project_id: projectId,
            spent_on: new Date().toISOString().slice(0, 10),
            hours: 2.5,
            activity_id: activityId,
            comments: "entry-1-updated",
            user_id: 1,
            custom_fields: [],
            custom_field_values: {},
          },
        },
      }
    );
    assertStatus(204, response);
  });

  test("GET /time_entries.json", async () => {
    const response = await client.GET("/time_entries.{format}", {
      params: { path: { format: "json" } },
    });
    assertStatus(200, response);
  });

  test("GET /time_entries.json with filters", async () => {
    const response = await client.GET("/time_entries.{format}", {
      params: {
        path: { format: "json" },
        query: {
          "issue.parent_id": "*",
          "issue.subject": "issue-1",
          "user.group": "*",
          "user.role": "*",
          spent_on: ">=2020-01-01",
          activity_id: String(activityId),
          comments: "entry",
          hours: ">=0",
          sort: "spent_on:desc",
          offset: 0,
          limit: 25,
        },
      },
    });
    assertStatus(200, response);
  });

  test("POST /projects/{project_id}/time_entries.json", async () => {
    const response = await client.POST(
      "/projects/{project_id}/time_entries.{format}",
      {
        params: {
          path: { format: "json", project_id: projectId },
        },
        body: {
          time_entry: {
            issue_id: issueId,
            hours: 0.5,
            activity_id: activityId,
            comments: "project-scoped-entry",
            spent_on: new Date().toISOString().slice(0, 10),
            user_id: 1,
            custom_fields: [],
            custom_field_values: {},
          },
        },
      }
    );
    assertStatus(201, response);
  });

  test("GET /projects/{project_id}/time_entries.json with filters", async () => {
    const response = await client.GET(
      "/projects/{project_id}/time_entries.{format}",
      {
        params: {
          path: { format: "json", project_id: projectId },
          query: {
            spent_on: ">=2020-01-01",
            user_id: "1",
            activity_id: String(activityId),
            sort: "spent_on:desc",
            offset: 0,
            limit: 25,
          },
        },
      }
    );
    assertStatus(200, response);
  });

  test("POST /issues/{issue_id}/time_entries.json", async () => {
    const response = await client.POST(
      "/issues/{issue_id}/time_entries.{format}",
      {
        params: {
          path: { format: "json", issue_id: issueId },
        },
        body: {
          time_entry: {
            hours: 0.25,
            activity_id: activityId,
            project_id: projectId,
            comments: "issue-scoped-entry",
            spent_on: new Date().toISOString().slice(0, 10),
            user_id: 1,
            custom_fields: [],
            custom_field_values: {},
          },
        },
      }
    );
    assertStatus(201, response);
  });

  test("GET /time_entries.json with remaining filters", async () => {
    const response = await client.GET("/time_entries.{format}", {
      params: {
        path: { format: "json" },
        query: {
          project_id: String(projectId),
          subproject_id: "!*",
          issue_id: String(issueId),
          "issue.tracker_id": "1",
          "issue.status_id": "*",
          "issue.fixed_version_id": "!*",
          "issue.category_id": "!*",
          user_id: "me",
          author_id: "me",
          from: "2020-01-01",
          to: "2030-12-31",
        },
      },
    });
    assertStatus(200, response);
  });

  test("POST /time_entries.json returns 422 for invalid data", async () => {
    const response = await client.POST("/time_entries.{format}", {
      params: { path: { format: "json" } },
      body: { time_entry: { issue_id: issueId } as any },
    });
    assertStatus(422, response);
  });

  test("GET /time_entries/{time_entry_id}.json returns 404", async () => {
    const response = await client.GET(
      "/time_entries/{time_entry_id}.{format}",
      {
        params: { path: { format: "json", time_entry_id: 999999 } },
      }
    );
    assertStatus(404, response);
  });

  test("PUT /time_entries/{time_entry_id}.json returns 404", async () => {
    const response = await client.PUT(
      "/time_entries/{time_entry_id}.{format}",
      {
        params: { path: { format: "json", time_entry_id: 999999 } },
        body: { time_entry: { hours: 1 } },
      }
    );
    assertStatus(404, response);
  });

  test("PUT /time_entries/{time_entry_id}.json returns 422 for invalid data", async () => {
    const response = await client.PUT(
      "/time_entries/{time_entry_id}.{format}",
      {
        params: { path: { format: "json", time_entry_id: timeEntryId } },
        body: { time_entry: { spent_on: "invalid-date" } },
      }
    );
    assertStatus(422, response);
  });

  test("DELETE /time_entries/{time_entry_id}.json returns 404", async () => {
    const response = await client.DELETE(
      "/time_entries/{time_entry_id}.{format}",
      {
        params: { path: { format: "json", time_entry_id: 999999 } },
      }
    );
    assertStatus(404, response);
  });

  test("GET /projects/{project_id}/time_entries.json returns 404 for nonexistent project", async () => {
    const response = await client.GET(
      "/projects/{project_id}/time_entries.{format}",
      {
        params: { path: { format: "json", project_id: "nonexistent-project" } },
      }
    );
    assertStatus(404, response);
  });

  test("POST /projects/{project_id}/time_entries.json returns 404 for nonexistent project", async () => {
    const response = await client.POST(
      "/projects/{project_id}/time_entries.{format}",
      {
        params: { path: { format: "json", project_id: "nonexistent-project" } },
        body: { time_entry: { hours: 1, activity_id: activityId } },
      }
    );
    assertStatus(404, response);
  });

  test("POST /projects/{project_id}/time_entries.json returns 422 for invalid data", async () => {
    const response = await client.POST(
      "/projects/{project_id}/time_entries.{format}",
      {
        params: { path: { format: "json", project_id: projectId } },
        body: { time_entry: {} as any },
      }
    );
    assertStatus(422, response);
  });

  test("POST /issues/{issue_id}/time_entries.json returns 404 for nonexistent issue", async () => {
    const response = await client.POST(
      "/issues/{issue_id}/time_entries.{format}",
      {
        params: { path: { format: "json", issue_id: 999999 } },
        body: { time_entry: { hours: 1, activity_id: activityId } },
      }
    );
    assertStatus(404, response);
  });

  test("POST /issues/{issue_id}/time_entries.json returns 422 for invalid data", async () => {
    const response = await client.POST(
      "/issues/{issue_id}/time_entries.{format}",
      {
        params: { path: { format: "json", issue_id: issueId } },
        body: { time_entry: {} as any },
      }
    );
    assertStatus(422, response);
  });

  test("DELETE /time_entries/{time_entry_id}.json", async () => {
    const response = await client.DELETE(
      "/time_entries/{time_entry_id}.{format}",
      {
        params: {
          path: { format: "json", time_entry_id: timeEntryId },
        },
      }
    );
    assertStatus(204, response);
  });
});
