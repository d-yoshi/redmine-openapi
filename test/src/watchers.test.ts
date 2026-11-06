import { before, after, describe, test } from "node:test";
import assert from "node:assert/strict";

import { client, assertStatus, currentUserId } from "./helpers.js";

describe("Watchers", () => {
  let projectId: number;
  let issueId: number;

  // A 204 response does not confirm a watcher change; read the list back.
  const watcherIds = async () => {
    const response = await client.GET("/issues/{issue_id}.{format}", {
      params: {
        path: { format: "json", issue_id: issueId },
        query: { include: ["watchers"] },
      },
    });
    assertStatus(200, response);
    const watchers = response.data!.issue.watchers;
    assert(watchers, "Expected include=watchers to return a watchers array");
    return watchers.map((watcher) => watcher.id);
  };

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

    // Account preferences can add the author as a watcher automatically.
    const resetResponse = await client.DELETE(
      "/issues/{issue_id}/watchers/{user_id}.{format}",
      {
        params: {
          path: {
            format: "json",
            issue_id: issueId,
            user_id: await currentUserId(),
          },
        },
      }
    );
    assertStatus(204, resetResponse);
  });

  after(async () => {
    if (projectId) {
      const response = await client.DELETE("/projects/{project_id}.{format}", {
        params: { path: { format: "json", project_id: projectId } },
      });
      assertStatus(204, response);
    }
  });

  test("POST /issues/{issue_id}/watchers.json", async () => {
    const userId = await currentUserId();
    assert(
      !(await watcherIds()).includes(userId),
      "Expected the issue to have no watchers before the request"
    );

    const response = await client.POST(
      "/issues/{issue_id}/watchers.{format}",
      {
        params: { path: { format: "json", issue_id: issueId } },
        body: { user_id: userId },
      }
    );
    assertStatus(204, response);
    assert(
      (await watcherIds()).includes(userId),
      "Expected the user to have been added as a watcher"
    );
  });

  test("DELETE /issues/{issue_id}/watchers/{user_id}.json", async () => {
    const userId = await currentUserId();
    const response = await client.DELETE(
      "/issues/{issue_id}/watchers/{user_id}.{format}",
      {
        params: {
          path: { format: "json", issue_id: issueId, user_id: userId },
        },
      }
    );
    assertStatus(204, response);
    assert(
      !(await watcherIds()).includes(userId),
      "Expected the user to have been removed as a watcher"
    );
  });

  test("POST /issues/{issue_id}/watchers.json returns 403 for nonexistent issue", async () => {
    const response = await client.POST(
      "/issues/{issue_id}/watchers.{format}",
      {
        params: { path: { format: "json", issue_id: 999999 } },
        body: { user_id: await currentUserId() },
      }
    );
    assertStatus(403, response);
  });

  test("DELETE /issues/{issue_id}/watchers/{user_id}.json returns 404 for nonexistent user", async () => {
    const response = await client.DELETE(
      "/issues/{issue_id}/watchers/{user_id}.{format}",
      {
        params: {
          path: { format: "json", issue_id: issueId, user_id: 999999 },
        },
      }
    );
    assertStatus(404, response);
  });
});
