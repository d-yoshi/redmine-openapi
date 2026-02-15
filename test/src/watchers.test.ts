import { before, after, describe, test } from "node:test";

import { client, assertStatus } from "./helpers.js";

describe("Watchers", async () => {
  let projectId: number;
  let issueId: number;

  before(async () => {
    const projectName = `watcher-${Date.now()}`;
    const projectResponse = await client.POST("/projects.{format}", {
      params: { path: { format: "json" } },
      body: {
        project: { name: projectName, identifier: projectName },
      },
    });
    assertStatus(201, projectResponse);
    projectId = projectResponse.data!.project.id;

    const issueResponse = await client.POST("/issues.{format}", {
      params: { path: { format: "json" } },
      body: {
        issue: { project_id: projectId, subject: "watcher-test" },
      },
    });
    assertStatus(201, issueResponse);
    issueId = issueResponse.data!.issue.id;
  });

  after(async () => {
    await client.DELETE("/projects/{project_id}.{format}", {
      params: { path: { format: "json", project_id: projectId } },
    });
  });

  test("POST /issues/{issue_id}/watchers.json", async () => {
    const response = await client.POST(
      "/issues/{issue_id}/watchers.{format}",
      {
        params: { path: { format: "json", issue_id: issueId } },
        body: { user_id: 1 },
      }
    );
    assertStatus(204, response);
  });

  test("DELETE /issues/{issue_id}/watchers/{user_id}.json", async () => {
    const response = await client.DELETE(
      "/issues/{issue_id}/watchers/{user_id}.{format}",
      {
        params: {
          path: { format: "json", issue_id: issueId, user_id: 1 },
        },
      }
    );
    assertStatus(204, response);
  });
});
