import { before, after, describe, test } from "node:test";
import assert from "node:assert/strict";

import { client, assertStatus } from "./helpers.js";

describe("Repositories", () => {
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

  test("GET /issues/{issue_id}.json with include=changesets returns the changeset", async () => {
    const response = await client.GET("/issues/{issue_id}.{format}", {
      params: {
        path: { format: "json", issue_id: issueId },
        query: { include: ["changesets"] },
      },
    });
    assertStatus(200, response);
    assert(
      response.data!.issue.changesets!.length > 0,
      "Expected the issue to have an associated changeset"
    );
  });

  test("POST .../revisions/{revision}/issues.json returns 404 for nonexistent revision", async () => {
    const response = await client.POST(
      "/projects/{project_id}/repository/{repository_id}/revisions/{revision}/issues.{format}",
      {
        params: {
          path: {
            format: "json",
            project_id: projectId,
            repository_id: repositoryId,
            revision: "deadbeef",
          },
        },
        body: { issue_id: issueId },
      }
    );
    assertStatus(404, response);
  });

  test("POST .../revisions/{revision}/issues.json returns 422 for nonexistent issue", async () => {
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
        body: { issue_id: 999999 },
      }
    );
    assertStatus(422, response);
  });

  test("DELETE .../revisions/{revision}/issues/{issue_id}.json returns 404 for nonexistent revision", async () => {
    const response = await client.DELETE(
      "/projects/{project_id}/repository/{repository_id}/revisions/{revision}/issues/{issue_id}.{format}",
      {
        params: {
          path: {
            format: "json",
            project_id: projectId,
            repository_id: repositoryId,
            revision: "deadbeef",
            issue_id: issueId,
          },
        },
      }
    );
    assertStatus(404, response);
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
