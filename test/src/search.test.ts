import { before, after, describe, test } from "node:test";
import assert from "node:assert/strict";

import { client, assertStatus } from "./helpers.js";

describe("Search", () => {
  let projectId: number;
  let projectIdentifier: string;
  // A token that exists nowhere else, so the searches below cannot depend on
  // leftover data from other suites — and an empty `results` array would validate
  // nothing about the result item schema.
  let token: string;
  let issueId: number;

  before(async () => {
    const ts = Date.now();
    projectIdentifier = `search-${ts}`;
    token = `searchtoken${ts}`;

    const projectResponse = await client.POST("/projects.{format}", {
      params: { path: { format: "json" } },
      body: {
        project: {
          name: projectIdentifier,
          identifier: projectIdentifier,
          enabled_module_names: ["issue_tracking"],
        },
      },
    });
    assertStatus(201, projectResponse);
    projectId = projectResponse.data!.project.id;

    const issueResponse = await client.POST("/issues.{format}", {
      params: { path: { format: "json" } },
      body: {
        issue: { project_id: projectId, subject: `issue ${token}` },
      },
    });
    assertStatus(201, issueResponse);
    issueId = issueResponse.data!.issue.id;
  });

  // Identity rather than a count: "some result came back" would not show that the
  // seeded issue is what matched, and "exactly one" would assert a property of
  // this fixture rather than of the API.
  const assertFoundSeededIssue = (
    results: { id: number; type: string }[]
  ) => {
    assert(
      results.some((result) => result.type === "issue" && result.id === issueId),
      `Expected the seeded issue ${issueId} among the results, got: ${JSON.stringify(
        results.map((result) => [result.type, result.id])
      )}`
    );
  };

  after(async () => {
    if (projectId) {
      const response = await client.DELETE("/projects/{project_id}.{format}", {
        params: { path: { format: "json", project_id: projectId } },
      });
      assertStatus(204, response);
    }
  });

  test("GET /search.json", async () => {
    const response = await client.GET("/search.{format}", {
      params: {
        path: { format: "json" },
        query: { q: token },
      },
    });
    assertStatus(200, response);
    assertFoundSeededIssue(response.data!.results);
  });

  test("GET /search.json with all params", async () => {
    const response = await client.GET("/search.{format}", {
      params: {
        path: { format: "json" },
        query: {
          q: token,
          scope: "all",
          all_words: "1",
          titles_only: "1",
          issues: 1,
          news: 1,
          wiki_pages: 1,
          projects: 1,
          documents: 1,
          changesets: 1,
          messages: 1,
          open_issues: "1",
          attachments: "1",
          offset: 0,
          limit: 25,
        },
      },
    });
    assertStatus(200, response);
    assertFoundSeededIssue(response.data!.results);
  });

  test("GET /projects/{project_id}/search.json returns 404 for nonexistent project", async () => {
    const response = await client.GET(
      "/projects/{project_id}/search.{format}",
      {
        params: {
          path: { format: "json", project_id: "nonexistent-project" },
          query: { q: token },
        },
      }
    );
    assertStatus(404, response);
  });

  test("GET /projects/{project_id}/search.json with all params", async () => {
    const response = await client.GET(
      "/projects/{project_id}/search.{format}",
      {
        params: {
          path: { format: "json", project_id: projectId },
          query: {
            q: token,
            scope: "subprojects",
            all_words: "1",
            titles_only: "1",
            issues: 1,
            news: 1,
            wiki_pages: 1,
            documents: 1,
            changesets: 1,
            messages: 1,
            open_issues: "1",
            attachments: "1",
            offset: 0,
            limit: 25,
          },
        },
      }
    );
    assertStatus(200, response);
    assertFoundSeededIssue(response.data!.results);
  });
});
