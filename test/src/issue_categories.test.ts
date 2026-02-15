import { test } from "node:test";

import { client, assertStatus } from "./helpers.js";

test("Issue Categories", async (t) => {
  const projectIdentifier = `cat-${Date.now()}`;
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
  const projectId = projectResponse.data!.project.id;

  let categoryId: number;

  await t.test("POST /projects/{project_id}/issue_categories.json", async () => {
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

  await t.test("GET /issue_categories/{issue_category_id}.json", async () => {
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

  await t.test("PUT /issue_categories/{issue_category_id}.json", async () => {
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

  await t.test("GET /projects/{project_id}/issue_categories.json", async () => {
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

  await t.test("DELETE /issue_categories/{issue_category_id}.json", async () => {
    const response = await client.DELETE(
      "/issue_categories/{issue_category_id}.{format}",
      {
        params: {
          path: { format: "json", issue_category_id: categoryId },
        },
      }
    );
    assertStatus(204, response);
  });

  await client.DELETE("/projects/{project_id}.{format}", {
    params: { path: { format: "json", project_id: projectId } },
  });
});
