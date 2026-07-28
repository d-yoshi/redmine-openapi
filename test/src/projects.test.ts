import { before, after, describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  client,
  assertStatus,
  currentUserId,
  runCleanup,
  someTrackerId,
} from "./helpers.js";

describe("Projects", () => {
  let mainProjectId: number;
  let mainProjectIdentifier: string;
  let postProjectId: number;
  // Root projects: not reclaimed by deleting mainProjectId, so the hooks own
  // them — otherwise a failed assertion leaves them in the database that an
  // interrupted run hands to the next one.
  let sharedProjectId: number;
  let otherProjectId: number;

  before(async () => {
    const trackerId = await someTrackerId();
    mainProjectIdentifier = `proj-${Date.now()}`;
    const response = await client.POST("/projects.{format}", {
      params: { path: { format: "json" } },
      body: {
        project: {
          name: mainProjectIdentifier,
          identifier: mainProjectIdentifier,
          description: "description",
          homepage: "http://example.com",
          is_public: true,
          inherit_members: false,
          tracker_ids: [trackerId],
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
          default_assigned_to_id: await currentUserId(),
        },
      },
    });
    assertStatus(204, putResponse);

    // Fixture for the "not archivable" test: a project cannot be archived while
    // an issue from outside its tree is assigned to one of its shared versions
    const ts = Date.now();
    const sharedResponse = await client.POST("/projects.{format}", {
      params: { path: { format: "json" } },
      body: {
        project: { name: `arch-shared-${ts}`, identifier: `arch-shared-${ts}` },
      },
    });
    assertStatus(201, sharedResponse);
    sharedProjectId = sharedResponse.data!.project.id;

    const sharedVersionResponse = await client.POST(
      "/projects/{project_id}/versions.{format}",
      {
        params: { path: { format: "json", project_id: sharedProjectId } },
        body: { version: { name: "shared-version", sharing: "system" } },
      }
    );
    assertStatus(201, sharedVersionResponse);

    const otherResponse = await client.POST("/projects.{format}", {
      params: { path: { format: "json" } },
      body: {
        project: { name: `arch-other-${ts}`, identifier: `arch-other-${ts}` },
      },
    });
    assertStatus(201, otherResponse);
    otherProjectId = otherResponse.data!.project.id;

    const issueResponse = await client.POST("/issues.{format}", {
      params: { path: { format: "json" } },
      body: {
        issue: {
          project_id: otherProjectId,
          subject: "issue on shared version",
          fixed_version_id: sharedVersionResponse.data!.version.id,
        },
      },
    });
    assertStatus(201, issueResponse);
  });

  after(async () => {
    await runCleanup(
      [otherProjectId, sharedProjectId, mainProjectId].map((id) => async () => {
        if (!id) return;
        const response = await client.DELETE("/projects/{project_id}.{format}", {
          params: { path: { format: "json", project_id: id } },
        });
        assertStatus(204, response);
      })
    );
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
          tracker_ids: [await someTrackerId()],
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
          tracker_ids: [await someTrackerId()],
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

    // Project#identifier= is a no-op once the project is persisted
    // (identifier_frozen?): Redmine accepts the attribute and keeps the original
    const getResponse = await client.GET("/projects/{project_id}.{format}", {
      params: { path: { format: "json", project_id: mainProjectId } },
    });
    assertStatus(200, getResponse);
    assert.strictEqual(getResponse.data!.project.name, "proj-updated");
    assert.strictEqual(
      getResponse.data!.project.identifier,
      mainProjectIdentifier,
      "Redmine ignores identifier on update; the original must be unchanged"
    );
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
    // Pipe-delimited multiple values: status=1|5 returns both active and closed
    // projects. Scoped by id so the result cannot depend on unrelated projects,
    // or on where these two land in a paginated, name-ordered list.
    const response = await client.GET("/projects.{format}", {
      params: {
        path: { format: "json" },
        query: {
          status: "1|5",
          id: `${mainProjectId}|${postProjectId}`,
        },
      },
    });
    assertStatus(200, response);
    const statuses = new Set(response.data!.projects.map((p) => p.status));
    assert.deepStrictEqual(
      [...statuses].sort(),
      [1, 5],
      "Expected both the active and the closed project in the results"
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
    // The `before` fixture assigns an issue from outside this project's tree to
    // its system-shared version, which blocks archiving
    const response = await client.PUT(
      "/projects/{project_id}/archive.{format}",
      {
        params: { path: { format: "json", project_id: sharedProjectId } },
      }
    );
    assertStatus(422, response);
  });

  test("DELETE /projects/{project_id}.json", async () => {
    const response = await client.DELETE("/projects/{project_id}.{format}", {
      params: { path: { format: "json", project_id: postProjectId } },
    });
    assertStatus(204, response);
  });
});
