import { test } from "node:test";

import { client, assertStatus } from "./helpers.js";

test("Versions", async (t) => {
  const projectIdentifier = `ver-${Date.now()}`;
  const projectResponse = await client.POST("/projects.{format}", {
    params: { path: { format: "json" } },
    body: {
      project: {
        name: projectIdentifier,
        identifier: projectIdentifier,
        enabled_module_names: ["issue_tracking", "wiki"],
      },
    },
  });
  assertStatus(201, projectResponse);
  const projectId = projectResponse.data!.project.id;

  let versionId: number;

  await t.test("POST /projects/{project_id}/versions.json", async () => {
    const response = await client.POST(
      "/projects/{project_id}/versions.{format}",
      {
        params: {
          path: { format: "json", project_id: projectIdentifier },
        },
        body: {
          version: {
            name: "v1.0",
            description: "First release",
            status: "open",
            sharing: "none",
            due_date: "2026-12-31",
            wiki_page_title: "",
            default_project_version: false,
          },
        },
      }
    );
    assertStatus(201, response);
    versionId = response.data!.version.id;
  });

  await t.test("GET /versions/{version_id}.json", async () => {
    const response = await client.GET("/versions/{version_id}.{format}", {
      params: {
        path: { format: "json", version_id: versionId },
      },
    });
    assertStatus(200, response);
  });

  await t.test("PUT /versions/{version_id}.json", async () => {
    const response = await client.PUT("/versions/{version_id}.{format}", {
      params: {
        path: { format: "json", version_id: versionId },
      },
      body: {
        version: {
          name: "v1.0-updated",
          description: "Updated release",
          status: "closed",
          sharing: "descendants",
          due_date: "2027-01-31",
          wiki_page_title: "",
          default_project_version: true,
        },
      },
    });
    assertStatus(204, response);
  });

  await t.test("GET /projects/{project_id}/versions.json", async () => {
    const response = await client.GET(
      "/projects/{project_id}/versions.{format}",
      {
        params: {
          path: { format: "json", project_id: projectIdentifier },
        },
      }
    );
    assertStatus(200, response);
  });

  await t.test("DELETE /versions/{version_id}.json", async () => {
    const response = await client.DELETE("/versions/{version_id}.{format}", {
      params: {
        path: { format: "json", version_id: versionId },
      },
    });
    assertStatus(204, response);
  });

  await client.DELETE("/projects/{project_id}.{format}", {
    params: { path: { format: "json", project_id: projectId } },
  });
});
