import { test } from "node:test";

import { client, assertStatus } from "./helpers.js";

test("Projects", async (t) => {
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
  const mainProjectId = response.data!.project.id;

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

  let postProjectId: number;

  await t.test("POST /projects.json", async () => {
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

  await t.test("GET /projects/{project_id}.json with all includes", async () => {
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

  await t.test("PUT /projects/{project_id}.json", async () => {
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

  await t.test("GET /projects.json with filters", async () => {
    const response = await client.GET("/projects.{format}", {
      params: {
        path: { format: "json" },
        query: {
          status: [1],
          is_public: ["1"],
          offset: 0,
          limit: 25,
        },
      },
    });
    assertStatus(200, response);
  });

  await t.test("GET /projects.json with all includes", async () => {
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

  await t.test("PUT /projects/{project_id}/close.json", async () => {
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

  await t.test("PUT /projects/{project_id}/reopen.json", async () => {
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

  await t.test("PUT /projects/{project_id}/archive.json", async () => {
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

  await t.test("PUT /projects/{project_id}/unarchive.json", async () => {
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

  await t.test("DELETE /projects/{project_id}.json", async () => {
    const response = await client.DELETE("/projects/{project_id}.{format}", {
      params: { path: { format: "json", project_id: postProjectId } },
    });
    assertStatus(204, response);
  });

  await client.DELETE("/projects/{project_id}.{format}", {
    params: { path: { format: "json", project_id: mainProjectId } },
  });
});
