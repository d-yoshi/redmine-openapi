import { before, after, describe, test } from "node:test";

import { client, assertStatus } from "./helpers.js";

describe("Search", async () => {
  let projectId: number;
  let projectIdentifier: string;

  before(async () => {
    projectIdentifier = `search-${Date.now()}`;
    const projectResponse = await client.POST("/projects.{format}", {
      params: { path: { format: "json" } },
      body: {
        project: {
          name: projectIdentifier,
          identifier: projectIdentifier,
        },
      },
    });
    assertStatus(201, projectResponse);
    projectId = projectResponse.data!.project.id;
  });

  after(async () => {
    await client.DELETE("/projects/{project_id}.{format}", {
      params: { path: { format: "json", project_id: projectId } },
    });
  });

  test("GET /search.json", async () => {
    const response = await client.GET("/search.{format}", {
      params: {
        path: { format: "json" },
        query: { q: "test" },
      },
    });
    assertStatus(200, response);
  });

  test("GET /projects/{project_id}/search.json", async () => {
    const response = await client.GET(
      "/projects/{project_id}/search.{format}",
      {
        params: {
          path: { format: "json", project_id: projectId },
          query: { q: "test" },
        },
      }
    );
    assertStatus(200, response);
  });
});
