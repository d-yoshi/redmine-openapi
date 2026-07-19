import { before, after, describe, test } from "node:test";

import { client, assertStatus } from "./helpers.js";

describe("Issue Categories", () => {
  const projectIdentifier = `cat-${Date.now()}`;
  let projectId: number;
  let categoryId: number;

  before(async () => {
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
    if (projectId) {
      await client.DELETE("/projects/{project_id}.{format}", {
        params: { path: { format: "json", project_id: projectId } },
      });
    }
  });

  test("POST /projects/{project_id}/issue_categories.json", async () => {
    const response = await client.POST(
      "/projects/{project_id}/issue_categories.{format}",
      {
        params: {
          path: { format: "json", project_id: projectIdentifier },
        },
        body: {
          issue_category: {
            name: "category-1",
            assigned_to_id: 1,
          },
        },
      }
    );
    assertStatus(201, response);
    categoryId = response.data!.issue_category.id;
  });

  test("GET /issue_categories/{issue_category_id}.json", async () => {
    const response = await client.GET(
      "/issue_categories/{issue_category_id}.{format}",
      {
        params: {
          path: { format: "json", issue_category_id: categoryId },
        },
      }
    );
    assertStatus(200, response);
  });

  test("PUT /issue_categories/{issue_category_id}.json", async () => {
    const response = await client.PUT(
      "/issue_categories/{issue_category_id}.{format}",
      {
        params: {
          path: { format: "json", issue_category_id: categoryId },
        },
        body: {
          issue_category: {
            name: "category-updated",
            assigned_to_id: 1,
          },
        },
      }
    );
    assertStatus(204, response);
  });

  test("GET /projects/{project_id}/issue_categories.json", async () => {
    const response = await client.GET(
      "/projects/{project_id}/issue_categories.{format}",
      {
        params: {
          path: { format: "json", project_id: projectIdentifier },
        },
      }
    );
    assertStatus(200, response);
  });

  test("POST /projects/{project_id}/issue_categories.json returns 404 for nonexistent project", async () => {
    const response = await client.POST(
      "/projects/{project_id}/issue_categories.{format}",
      {
        params: { path: { format: "json", project_id: "nonexistent-project" } },
        body: { issue_category: { name: "missing" } },
      }
    );
    assertStatus(404, response);
  });

  test("POST /projects/{project_id}/issue_categories.json returns 422 for invalid data", async () => {
    const response = await client.POST(
      "/projects/{project_id}/issue_categories.{format}",
      {
        params: { path: { format: "json", project_id: projectIdentifier } },
        body: { issue_category: { name: "" } },
      }
    );
    assertStatus(422, response);
  });

  test("GET /projects/{project_id}/issue_categories.json returns 404 for nonexistent project", async () => {
    const response = await client.GET(
      "/projects/{project_id}/issue_categories.{format}",
      {
        params: { path: { format: "json", project_id: "nonexistent-project" } },
      }
    );
    assertStatus(404, response);
  });

  test("GET /issue_categories/{issue_category_id}.json returns 404", async () => {
    const response = await client.GET(
      "/issue_categories/{issue_category_id}.{format}",
      {
        params: { path: { format: "json", issue_category_id: 999999 } },
      }
    );
    assertStatus(404, response);
  });

  test("PUT /issue_categories/{issue_category_id}.json returns 404", async () => {
    const response = await client.PUT(
      "/issue_categories/{issue_category_id}.{format}",
      {
        params: { path: { format: "json", issue_category_id: 999999 } },
        body: { issue_category: { name: "missing" } },
      }
    );
    assertStatus(404, response);
  });

  test("PUT /issue_categories/{issue_category_id}.json returns 422 for invalid data", async () => {
    const response = await client.PUT(
      "/issue_categories/{issue_category_id}.{format}",
      {
        params: { path: { format: "json", issue_category_id: categoryId } },
        body: { issue_category: { name: "" } },
      }
    );
    assertStatus(422, response);
  });

  test("DELETE /issue_categories/{issue_category_id}.json returns 404", async () => {
    const response = await client.DELETE(
      "/issue_categories/{issue_category_id}.{format}",
      {
        params: { path: { format: "json", issue_category_id: 999999 } },
      }
    );
    assertStatus(404, response);
  });

  test("DELETE /issue_categories/{issue_category_id}.json with reassign_to_id", async () => {
    const otherResponse = await client.POST(
      "/projects/{project_id}/issue_categories.{format}",
      {
        params: { path: { format: "json", project_id: projectIdentifier } },
        body: { issue_category: { name: "category-other" } },
      }
    );
    assertStatus(201, otherResponse);
    const otherCategoryId = otherResponse.data!.issue_category.id;

    const response = await client.DELETE(
      "/issue_categories/{issue_category_id}.{format}",
      {
        params: {
          path: { format: "json", issue_category_id: categoryId },
          query: { reassign_to_id: otherCategoryId },
        },
      }
    );
    assertStatus(204, response);

    await client.DELETE(
      "/issue_categories/{issue_category_id}.{format}",
      {
        params: {
          path: { format: "json", issue_category_id: otherCategoryId },
        },
      }
    );
  });
});
