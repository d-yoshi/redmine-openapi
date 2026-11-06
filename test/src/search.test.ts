import { before, after, describe, test } from "node:test";
import assert from "node:assert/strict";

import { client, assertStatus } from "./helpers.js";

describe("Search", () => {
  let projectId: number;
  let projectIdentifier: string;
  let token: string;
  let secondToken: string;
  let issueId: number;
  let partialMatchId: number;
  let descriptionMatchId: number;

  before(async () => {
    const ts = Date.now();
    projectIdentifier = `search-${ts}`;
    token = `searchtoken${ts}`;
    secondToken = `searchother${ts}`;

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

    const createIssue = async (subject: string, description = "") => {
      const response = await client.POST("/issues.{format}", {
        params: { path: { format: "json" } },
        body: { issue: { project_id: projectId, subject, description } },
      });
      assertStatus(201, response);
      return response.data!.issue.id;
    };
    issueId = await createIssue(`issue ${token} ${secondToken}`);
    partialMatchId = await createIssue(`issue ${token}`);
    descriptionMatchId = await createIssue("Description-only match", `${token} ${secondToken}`);
  });

  const assertIssueResults = (
    results: { id: number; type: string }[],
    expectedIds: readonly number[],
    message?: string
  ) => {
    assert.deepStrictEqual(
      new Set(results.map((result) => `${result.type}:${result.id}`)),
      new Set(expectedIds.map((id) => `issue:${id}`)),
      message
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
    assertIssueResults(response.data!.results, [issueId, partialMatchId, descriptionMatchId]);
  });

  test("GET /search.json distinguishes omitted, empty, and nonempty all_words values", async () => {
    for (const [allWords, expectedIds] of [
      [undefined, [issueId]],
      ["", [issueId, partialMatchId]],
      ["0", [issueId]],
    ] as const) {
      const response = await client.GET("/search.{format}", {
        params: {
          path: { format: "json" },
          query: { q: `${token} ${secondToken}`, titles_only: "1", all_words: allWords },
        },
      });
      assertStatus(200, response);
      assertIssueResults(response.data!.results, expectedIds, `all_words=${JSON.stringify(allWords)}`);
    }
  });

  test("GET /search.json distinguishes omitted, empty, and nonempty titles_only values", async () => {
    for (const [titlesOnly, expectedIds] of [
      [undefined, [issueId, partialMatchId, descriptionMatchId]],
      ["", [issueId, partialMatchId, descriptionMatchId]],
      ["0", [issueId, partialMatchId]],
    ] as const) {
      const response = await client.GET("/search.{format}", {
        params: {
          path: { format: "json" },
          query: { q: token, titles_only: titlesOnly },
        },
      });
      assertStatus(200, response);
      assertIssueResults(response.data!.results, expectedIds, `titles_only=${JSON.stringify(titlesOnly)}`);
    }
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
    assertIssueResults(response.data!.results, [issueId, partialMatchId]);
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
    assertIssueResults(response.data!.results, [issueId, partialMatchId]);
  });
});
