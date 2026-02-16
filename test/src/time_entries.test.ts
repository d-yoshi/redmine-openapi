import { test } from "node:test";

import { client, assertStatus } from "./helpers.js";

test("Time Entries", async (t) => {
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
  const projectId = projectResponse.data!.project.id;

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
  const issueId = issueResponse.data!.issue.id;

  const activitiesResponse = await client.GET(
    "/enumerations/time_entry_activities.{format}",
    { params: { path: { format: "json" } } }
  );
  assertStatus(200, activitiesResponse);
  const activityId = activitiesResponse.data!.time_entry_activities[0].id;

  let timeEntryId: number;

  await t.test("POST /time_entries.json", async () => {
    const response = await client.POST("/time_entries.{format}", {
      params: { path: { format: "json" } },
      body: {
        time_entry: {
          issue_id: issueId,
          hours: 1.5,
          activity_id: activityId,
          comments: "entry-1",
          spent_on: new Date().toISOString().slice(0, 10),
          user_id: 1,
        },
      },
    });
    assertStatus(201, response);
    timeEntryId = response.data!.time_entry.id;
  });

  await t.test("GET /time_entries/{time_entry_id}.json", async () => {
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

  await t.test("PUT /time_entries/{time_entry_id}.json", async () => {
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
          },
        },
      }
    );
    assertStatus(204, response);
  });

  await t.test("GET /time_entries.json", async () => {
    const response = await client.GET("/time_entries.{format}", {
      params: { path: { format: "json" } },
    });
    assertStatus(200, response);
  });

  await t.test("GET /time_entries.json with filters", async () => {
    const response = await client.GET("/time_entries.{format}", {
      params: {
        path: { format: "json" },
        query: {
          "issue.parent_id": ["*"],
          "issue.subject": "issue-1",
          "user.group": ["*"],
          "user.role": ["*"],
        },
      },
    });
    assertStatus(200, response);
  });

  await t.test("POST /projects/{project_id}/time_entries.json", async () => {
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
          },
        },
      }
    );
    assertStatus(201, response);
  });

  await t.test("GET /projects/{project_id}/time_entries.json", async () => {
    const response = await client.GET(
      "/projects/{project_id}/time_entries.{format}",
      {
        params: {
          path: { format: "json", project_id: projectId },
        },
      }
    );
    assertStatus(200, response);
  });

  await t.test("POST /issues/{issue_id}/time_entries.json", async () => {
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
            comments: "issue-scoped-entry",
            spent_on: new Date().toISOString().slice(0, 10),
            user_id: 1,
          },
        },
      }
    );
    assertStatus(201, response);
  });

  await t.test("DELETE /time_entries/{time_entry_id}.json", async () => {
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

  await client.DELETE("/projects/{project_id}.{format}", {
    params: { path: { format: "json", project_id: projectId } },
  });
});
