import { before, after, describe, test } from "node:test";
import assert from "node:assert/strict";

import { client, assertStatus } from "./helpers.js";

describe("Projects", () => {
  let mainProjectId: number;
  let postProjectId: number;

  before(async () => {
    const projectName = `proj-${Date.now()}`;
    const response = await client.POST("/projects.{format}", {
      params: { path: { format: "json" } },
      body: {
        project: {
          name: projectName,
          identifier: projectName,
          description: "description",
          homepage: "http://example.com",
          is_public: true,
          inherit_members: false,
          tracker_ids: [1],
          enabled_module_names: ["issue_tracking", "time_tracking"],
        },
      },
    });
    assertStatus(201, response);
    mainProjectId = response.data!.project.id;

    const categoryResponse = await client.POST(
      "/projects/{project_id}/issue_categories.{format}",
      {
        params: { path: { format: "json", project_id: mainProjectId } },
        body: { issue_category: { name: "category-1" } },
      }
    );
    assertStatus(201, categoryResponse);

    const versionResponse = await client.POST(
      "/projects/{project_id}/versions.{format}",
      {
        params: { path: { format: "json", project_id: mainProjectId } },
        body: { version: { name: "v1.0" } },
      }
    );
    assertStatus(201, versionResponse);
    const versionId = versionResponse.data!.version.id;

    const putResponse = await client.PUT("/projects/{project_id}.{format}", {
      params: { path: { format: "json", project_id: mainProjectId } },
      body: {
        project: {
          default_version_id: versionId,
          default_assigned_to_id: 1,
        },
      },
    });
    assertStatus(204, putResponse);
  });

  after(async () => {
    if (mainProjectId) {
      await client.DELETE("/projects/{project_id}.{format}", {
        params: { path: { format: "json", project_id: mainProjectId } },
      });
    }
  });

  test("POST /projects.json", async () => {
    const projectName = `proj-post-${Date.now()}`;
    const response = await client.POST("/projects.{format}", {
      params: { path: { format: "json" } },
      body: {
        project: {
          name: projectName,
          identifier: projectName,
          description: "description",
          homepage: "http://example.com/post",
          is_public: false,
          parent_id: mainProjectId,
          inherit_members: true,
          tracker_ids: [1],
          enabled_module_names: ["issue_tracking"],
          issue_custom_field_ids: [],
          default_issue_query_id: null,
          custom_fields: [],
          custom_field_values: {},
        },
      },
    });
    assertStatus(201, response);
    postProjectId = response.data!.project.id;
  });

  test("GET /projects/{project_id}.json with all includes", async () => {
    const response = await client.GET("/projects/{project_id}.{format}", {
      params: {
        path: { format: "json", project_id: mainProjectId },
        query: {
          include: [
            "trackers",
            "issue_categories",
            "time_entry_activities",
            "enabled_modules",
            "issue_custom_fields",
          ],
        },
      },
    });
    assertStatus(200, response);
  });

  test("PUT /projects/{project_id}.json", async () => {
    const response = await client.PUT("/projects/{project_id}.{format}", {
      params: { path: { format: "json", project_id: mainProjectId } },
      body: {
        project: {
          name: "proj-updated",
          description: "updated",
          homepage: "http://example.com/updated",
          is_public: true,
          inherit_members: false,
          tracker_ids: [1],
          enabled_module_names: ["issue_tracking", "time_tracking"],
          issue_custom_field_ids: [],
          identifier: "proj-updated",
          parent_id: null,
          default_issue_query_id: null,
          custom_fields: [],
          custom_field_values: {},
        },
      },
    });
    assertStatus(204, response);
  });

  test("GET /projects.json with filters", async () => {
    const response = await client.GET("/projects.{format}", {
      params: {
        path: { format: "json" },
        query: {
          status: "1",
          is_public: "1",
          offset: 0,
          limit: 25,
        },
      },
    });
    assertStatus(200, response);
  });

  test("GET /projects.json with all includes", async () => {
    const response = await client.GET("/projects.{format}", {
      params: {
        path: { format: "json" },
        query: {
          include: [
            "trackers",
            "issue_categories",
            "time_entry_activities",
            "enabled_modules",
            "issue_custom_fields",
          ],
        },
      },
    });
    assertStatus(200, response);
  });

  test("PUT /projects/{project_id}/close.json", async () => {
    const response = await client.PUT(
      "/projects/{project_id}/close.{format}",
      {
        params: {
          path: { format: "json", project_id: postProjectId },
        },
      }
    );
    assertStatus(204, response);
  });

  test("GET /projects.json with multiple status values", async () => {
    // Pipe-delimited multiple values: status=1|5 returns both active and closed projects
    const response = await client.GET("/projects.{format}", {
      params: {
        path: { format: "json" },
        query: {
          status: "1|5",
          limit: 25,
        },
      },
    });
    assertStatus(200, response);
    const projects = response.data!.projects;
    const statuses = new Set(projects.map((p) => p.status));
    assert(
      statuses.has(5),
      `Expected closed projects (status=5) in results, got statuses: ${[...statuses]}`
    );
  });

  test("PUT /projects/{project_id}/reopen.json", async () => {
    const response = await client.PUT(
      "/projects/{project_id}/reopen.{format}",
      {
        params: {
          path: { format: "json", project_id: postProjectId },
        },
      }
    );
    assertStatus(204, response);
  });

  test("PUT /projects/{project_id}/archive.json", async () => {
    const response = await client.PUT(
      "/projects/{project_id}/archive.{format}",
      {
        params: {
          path: { format: "json", project_id: postProjectId },
        },
      }
    );
    assertStatus(204, response);
  });

  test("PUT /projects/{project_id}/unarchive.json", async () => {
    const response = await client.PUT(
      "/projects/{project_id}/unarchive.{format}",
      {
        params: {
          path: { format: "json", project_id: postProjectId },
        },
      }
    );
    assertStatus(204, response);
  });

  test("GET /projects.json with remaining filters", async () => {
    const response = await client.GET("/projects.{format}", {
      params: {
        path: { format: "json" },
        query: {
          id: String(mainProjectId),
          name: "~proj",
          description: "~",
          parent_id: "!*",
          created_on: ">=2020-01-01",
          updated_on: ">=2020-01-01",
        },
      },
    });
    assertStatus(200, response);
  });

  test("POST /projects.json returns 422 for invalid data", async () => {
    const response = await client.POST("/projects.{format}", {
      params: { path: { format: "json" } },
      body: {
        project: { name: "invalid-identifier", identifier: "INVALID IDENTIFIER" },
      },
    });
    assertStatus(422, response);
  });

  test("GET /projects/{project_id}.json returns 404", async () => {
    const response = await client.GET("/projects/{project_id}.{format}", {
      params: { path: { format: "json", project_id: 999999 } },
    });
    assertStatus(404, response);
  });

  test("PUT /projects/{project_id}.json returns 404", async () => {
    const response = await client.PUT("/projects/{project_id}.{format}", {
      params: { path: { format: "json", project_id: 999999 } },
      body: { project: { name: "missing" } },
    });
    assertStatus(404, response);
  });

  test("PUT /projects/{project_id}.json returns 422 for invalid data", async () => {
    const response = await client.PUT("/projects/{project_id}.{format}", {
      params: { path: { format: "json", project_id: mainProjectId } },
      body: { project: { name: "" } },
    });
    assertStatus(422, response);
  });

  test("DELETE /projects/{project_id}.json returns 404", async () => {
    const response = await client.DELETE("/projects/{project_id}.{format}", {
      params: { path: { format: "json", project_id: 999999 } },
    });
    assertStatus(404, response);
  });

  test("PUT /projects/{project_id}/close.json returns 404", async () => {
    const response = await client.PUT("/projects/{project_id}/close.{format}", {
      params: { path: { format: "json", project_id: 999999 } },
    });
    assertStatus(404, response);
  });

  test("PUT /projects/{project_id}/reopen.json returns 404", async () => {
    const response = await client.PUT(
      "/projects/{project_id}/reopen.{format}",
      {
        params: { path: { format: "json", project_id: 999999 } },
      }
    );
    assertStatus(404, response);
  });

  test("PUT /projects/{project_id}/archive.json returns 404", async () => {
    const response = await client.PUT(
      "/projects/{project_id}/archive.{format}",
      {
        params: { path: { format: "json", project_id: 999999 } },
      }
    );
    assertStatus(404, response);
  });

  test("PUT /projects/{project_id}/unarchive.json returns 404", async () => {
    const response = await client.PUT(
      "/projects/{project_id}/unarchive.{format}",
      {
        params: { path: { format: "json", project_id: 999999 } },
      }
    );
    assertStatus(404, response);
  });

  test("PUT /projects/{project_id}/archive.json returns 422 when not archivable", async () => {
    // A project cannot be archived while an issue of a project outside its
    // tree is assigned to one of its versions (system-wide sharing)
    const ts = Date.now();
    const sharedResponse = await client.POST("/projects.{format}", {
      params: { path: { format: "json" } },
      body: {
        project: { name: `arch-shared-${ts}`, identifier: `arch-shared-${ts}` },
      },
    });
    assertStatus(201, sharedResponse);
    const sharedProjectId = sharedResponse.data!.project.id;

    const versionResponse = await client.POST(
      "/projects/{project_id}/versions.{format}",
      {
        params: { path: { format: "json", project_id: sharedProjectId } },
        body: { version: { name: "shared-version", sharing: "system" } },
      }
    );
    assertStatus(201, versionResponse);
    const sharedVersionId = versionResponse.data!.version.id;

    const otherResponse = await client.POST("/projects.{format}", {
      params: { path: { format: "json" } },
      body: {
        project: { name: `arch-other-${ts}`, identifier: `arch-other-${ts}` },
      },
    });
    assertStatus(201, otherResponse);
    const otherProjectId = otherResponse.data!.project.id;

    const issueResponse = await client.POST("/issues.{format}", {
      params: { path: { format: "json" } },
      body: {
        issue: {
          project_id: otherProjectId,
          subject: "issue on shared version",
          fixed_version_id: sharedVersionId,
        },
      },
    });
    assertStatus(201, issueResponse);

    const response = await client.PUT(
      "/projects/{project_id}/archive.{format}",
      {
        params: { path: { format: "json", project_id: sharedProjectId } },
      }
    );
    assertStatus(422, response);

    await client.DELETE("/projects/{project_id}.{format}", {
      params: { path: { format: "json", project_id: otherProjectId } },
    });
    await client.DELETE("/projects/{project_id}.{format}", {
      params: { path: { format: "json", project_id: sharedProjectId } },
    });
  });

  test("DELETE /projects/{project_id}.json", async () => {
    const response = await client.DELETE("/projects/{project_id}.{format}", {
      params: { path: { format: "json", project_id: postProjectId } },
    });
    assertStatus(204, response);
  });
});
