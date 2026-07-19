import { before, after, describe, test } from "node:test";

import { client, assertStatus } from "./helpers.js";

describe("Versions", () => {
  const projectIdentifier = `ver-${Date.now()}`;
  let projectId: number;
  let versionId: number;

  before(async () => {
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
    projectId = projectResponse.data!.project.id;
  });

  after(async () => {
    if (projectId) {
      await client.DELETE("/projects/{project_id}.{format}", {
        params: { path: { format: "json", project_id: projectId } },
      });
    }
  });

  test("POST /projects/{project_id}/versions.json", async () => {
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
            custom_fields: [],
            custom_field_values: {},
          },
        },
      }
    );
    assertStatus(201, response);
    versionId = response.data!.version.id;
  });

  test("GET /versions/{version_id}.json", async () => {
    const response = await client.GET("/versions/{version_id}.{format}", {
      params: {
        path: { format: "json", version_id: versionId },
      },
    });
    assertStatus(200, response);
  });

  test("PUT /versions/{version_id}.json", async () => {
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
          custom_fields: [],
          custom_field_values: {},
        },
      },
    });
    assertStatus(204, response);
  });

  test("GET /projects/{project_id}/versions.json", async () => {
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

  test("POST /projects/{project_id}/versions.json returns 404 for nonexistent project", async () => {
    const response = await client.POST(
      "/projects/{project_id}/versions.{format}",
      {
        params: { path: { format: "json", project_id: "nonexistent-project" } },
        body: { version: { name: "missing" } },
      }
    );
    assertStatus(404, response);
  });

  test("POST /projects/{project_id}/versions.json returns 422 for invalid data", async () => {
    const response = await client.POST(
      "/projects/{project_id}/versions.{format}",
      {
        params: { path: { format: "json", project_id: projectIdentifier } },
        body: { version: { name: "" } },
      }
    );
    assertStatus(422, response);
  });

  test("GET /versions/{version_id}.json returns 404", async () => {
    const response = await client.GET("/versions/{version_id}.{format}", {
      params: { path: { format: "json", version_id: 999999 } },
    });
    assertStatus(404, response);
  });

  test("PUT /versions/{version_id}.json returns 404", async () => {
    const response = await client.PUT("/versions/{version_id}.{format}", {
      params: { path: { format: "json", version_id: 999999 } },
      body: { version: { name: "missing" } },
    });
    assertStatus(404, response);
  });

  test("PUT /versions/{version_id}.json returns 422 for invalid data", async () => {
    const response = await client.PUT("/versions/{version_id}.{format}", {
      params: { path: { format: "json", version_id: versionId } },
      body: { version: { name: "" } },
    });
    assertStatus(422, response);
  });

  test("DELETE /versions/{version_id}.json returns 404", async () => {
    const response = await client.DELETE("/versions/{version_id}.{format}", {
      params: { path: { format: "json", version_id: 999999 } },
    });
    assertStatus(404, response);
  });

  test("DELETE /versions/{version_id}.json returns 422 when not deletable", async () => {
    // A version with issues assigned to it cannot be deleted;
    // Redmine responds 422 with an empty body
    const versionResponse = await client.POST(
      "/projects/{project_id}/versions.{format}",
      {
        params: { path: { format: "json", project_id: projectIdentifier } },
        body: { version: { name: "v-in-use" } },
      }
    );
    assertStatus(201, versionResponse);
    const inUseVersionId = versionResponse.data!.version.id;

    const issueResponse = await client.POST("/issues.{format}", {
      params: { path: { format: "json" } },
      body: {
        issue: {
          project_id: projectId,
          subject: "issue on version",
          fixed_version_id: inUseVersionId,
        },
      },
    });
    assertStatus(201, issueResponse);
    const issueId = issueResponse.data!.issue.id;

    const response = await client.DELETE("/versions/{version_id}.{format}", {
      params: { path: { format: "json", version_id: inUseVersionId } },
    });
    assertStatus(422, response);

    await client.DELETE("/issues/{issue_id}.{format}", {
      params: { path: { format: "json", issue_id: issueId } },
    });
    await client.DELETE("/versions/{version_id}.{format}", {
      params: { path: { format: "json", version_id: inUseVersionId } },
    });
  });

  test("DELETE /versions/{version_id}.json", async () => {
    const response = await client.DELETE("/versions/{version_id}.{format}", {
      params: {
        path: { format: "json", version_id: versionId },
      },
    });
    assertStatus(204, response);
  });
});
