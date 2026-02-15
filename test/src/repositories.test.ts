import { before, after, describe, test } from "node:test";

import { client, assertStatus } from "./helpers.js";

describe("Repositories", async () => {
  const projectId = "repo-test";
  const repositoryId = "test-repo";
  const revision = process.env.REPO_REVISION;
  let issueId: number;

  before(async () => {
    if (!revision) {
      throw new Error("REPO_REVISION environment variable is not set");
    }
    const response = await client.POST("/issues.{format}", {
      params: { path: { format: "json" } },
      body: {
        issue: {
          project_id: projectId,
          subject: `Repo test issue ${Date.now()}`,
          tracker_id: 1,
        },
      },
    });
    assertStatus(201, response);
    issueId = response.data!.issue.id;
  });

  after(async () => {
    if (issueId) {
      await client.DELETE("/issues/{issue_id}.{format}", {
        params: { path: { format: "json", issue_id: issueId } },
      });
    }
  });

  test("POST /projects/{project_id}/repository/{repository_id}/revisions/{revision}/issues.json", async () => {
    const response = await client.POST(
      "/projects/{project_id}/repository/{repository_id}/revisions/{revision}/issues.{format}",
      {
        params: {
          path: {
            format: "json",
            project_id: projectId,
            repository_id: repositoryId,
            revision: revision!,
          },
        },
        body: { issue_id: issueId },
      }
    );
    assertStatus(204, response);
  });

  test("DELETE /projects/{project_id}/repository/{repository_id}/revisions/{revision}/issues/{issue_id}.json", async () => {
    const response = await client.DELETE(
      "/projects/{project_id}/repository/{repository_id}/revisions/{revision}/issues/{issue_id}.{format}",
      {
        params: {
          path: {
            format: "json",
            project_id: projectId,
            repository_id: repositoryId,
            revision: revision!,
            issue_id: issueId,
          },
        },
      }
    );
    assertStatus(204, response);
  });
});
