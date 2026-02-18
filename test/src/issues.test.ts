import { test } from "node:test";

import { client, assertStatus } from "./helpers.js";

const uploadFile = async (filename: string, content: string) => {
  const response = await client.POST("/uploads.{format}", {
    params: {
      path: { format: "json" },
      query: { filename },
    },
    body: content,
    bodySerializer: (body) => body,
    headers: { "Content-Type": "application/octet-stream" },
  });
  assertStatus(201, response);
  return response.data!.upload;
};

const createProject = async (options?: { trackerIds?: number[] }) => {
  const projectName = `issues-${Date.now()}`;
  const response = await client.POST("/projects.{format}", {
    params: { path: { format: "json" } },
    body: {
      project: {
        name: projectName,
        identifier: projectName,
        tracker_ids: options?.trackerIds,
      },
    },
  });
  assertStatus(201, response);
  return response.data!.project;
};

const deleteProject = async (projectId: number) => {
  const response = await client.DELETE("/projects/{project_id}.{format}", {
    params: { path: { format: "json", project_id: projectId } },
  });
  assertStatus(204, response);
};

test("Issues", async (t) => {
  const project = await createProject({ trackerIds: [1] });
  const projectId = project.id;

  const categoryResponse = await client.POST(
    "/projects/{project_id}/issue_categories.{format}",
    {
      params: { path: { format: "json", project_id: projectId } },
      body: { issue_category: { name: "category-1" } },
    }
  );
  assertStatus(201, categoryResponse);
  const categoryId = categoryResponse.data!.issue_category.id;

  const versionResponse = await client.POST(
    "/projects/{project_id}/versions.{format}",
    {
      params: { path: { format: "json", project_id: projectId } },
      body: { version: { name: "v1.0" } },
    }
  );
  assertStatus(201, versionResponse);
  const versionId = versionResponse.data!.version.id;

  const parentResponse = await client.POST("/issues.{format}", {
    params: { path: { format: "json" } },
    body: {
      issue: { project_id: projectId, tracker_id: 1, subject: "parent" },
    },
  });
  assertStatus(201, parentResponse);
  const parentIssueId = parentResponse.data!.issue.id;

  const upload = await uploadFile("attachment.txt", "file content");
  const uploadToken = upload.token;

  let issueId: number;

  await t.test("POST /issues.json", async () => {
    const response = await client.POST("/issues.{format}", {
      params: { path: { format: "json" } },
      body: {
        issue: {
          project_id: projectId,
          tracker_id: 1,
          status_id: 1,
          priority_id: 1,
          subject: "issue-1",
          description: "description",
          start_date: new Date().toISOString().slice(0, 10),
          due_date: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
          done_ratio: 10,
          assigned_to_id: 1,
          category_id: categoryId,
          fixed_version_id: versionId,
          parent_issue_id: parentIssueId,
          is_private: false,
          estimated_hours: 2,
          watcher_user_ids: [1],
          custom_fields: [],
          custom_field_values: {},
          uploads: [
            {
              token: uploadToken,
              filename: "attachment.txt",
              description: "attachment",
              content_type: "text/plain",
            },
          ],
        },
      },
    });
    assertStatus(201, response);
    issueId = response.data!.issue.id;
  });

  await t.test("GET /issues/{issue_id}.json with all includes", async () => {
    await client.PUT("/issues/{issue_id}.{format}", {
      params: { path: { format: "json", issue_id: issueId } },
      body: { issue: { notes: "journal-1" } },
    });

    const response = await client.GET("/issues/{issue_id}.{format}", {
      params: {
        path: { format: "json", issue_id: issueId },
        query: {
          include: [
            "children",
            "attachments",
            "relations",
            "changesets",
            "journals",
            "watchers",
            "allowed_statuses",
          ],
        },
      },
    });
    assertStatus(200, response);
  });

  await t.test("PUT /issues/{issue_id}.json", async () => {
    const updateUpload = await uploadFile("update-attachment.txt", "updated content");
    const response = await client.PUT("/issues/{issue_id}.{format}", {
      params: { path: { format: "json", issue_id: issueId } },
      body: {
        issue: {
          project_id: projectId,
          tracker_id: 1,
          status_id: 1,
          priority_id: 1,
          subject: "issue-1-updated",
          description: "updated description",
          start_date: new Date().toISOString().slice(0, 10),
          due_date: new Date(Date.now() + 172800000).toISOString().slice(0, 10),
          done_ratio: 50,
          category_id: categoryId,
          fixed_version_id: versionId,
          assigned_to_id: 1,
          parent_issue_id: parentIssueId,
          is_private: true,
          estimated_hours: 5,
          notes: "note-1",
          private_notes: false,
          watcher_user_ids: [1],
          custom_fields: [],
          custom_field_values: {},
          uploads: [
            {
              token: updateUpload.token,
              filename: "update-attachment.txt",
              description: "updated attachment",
              content_type: "text/plain",
            },
          ],
        },
      },
    });
    assertStatus(204, response);
  });

  await t.test("GET /issues.json", async () => {
    const response = await client.GET("/issues.{format}", {
      params: { path: { format: "json" } },
    });
    assertStatus(200, response);
  });

  await t.test("GET /issues.json with all includes", async () => {
    const response = await client.GET("/issues.{format}", {
      params: {
        path: { format: "json" },
        query: { include: ["attachments", "relations"] },
      },
    });
    assertStatus(200, response);
  });

  await t.test("GET /issues.json with filters", async () => {
    const response = await client.GET("/issues.{format}", {
      params: {
        path: { format: "json" },
        query: {
          sort: "id:desc",
          status_id: ["*"],
          tracker_id: ["1"],
          assigned_to_id: ["me"],
          subject: "issue",
          created_on: ">=2020-01-01",
          issue_id: ["*"],
          parent_id: ["*"],
          author_id: ["*"],
          fixed_version_id: ["*"],
          category_id: ["*"],
          done_ratio: ">=0",
          is_private: "0",
        },
      },
    });
    assertStatus(200, response);
  });

  await t.test("GET /issues.json with pagination and nometa", async () => {
    const response = await client.GET("/issues.{format}", {
      params: {
        path: { format: "json" },
        query: { offset: 0, limit: 1, nometa: 1 },
      },
    });
    assertStatus(200, response);
  });

  await t.test("POST /issues.json returns 422 for invalid data", async () => {
    const response = await client.POST("/issues.{format}", {
      params: { path: { format: "json" } },
      body: {
        issue: {
          project_id: projectId,
        } as any,
      },
    });
    assertStatus(422, response);
  });

  await t.test("POST /projects/{project_id}/issues.json", async () => {
    const scopedUpload = await uploadFile("scoped-attachment.txt", "scoped content");
    const response = await client.POST(
      "/projects/{project_id}/issues.{format}",
      {
        params: {
          path: { format: "json", project_id: projectId },
        },
        body: {
          issue: {
            tracker_id: 1,
            status_id: 1,
            priority_id: 1,
            subject: "project-scoped-issue",
            description: "created via project-scoped endpoint",
            start_date: new Date().toISOString().slice(0, 10),
            due_date: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
            done_ratio: 0,
            category_id: categoryId,
            fixed_version_id: versionId,
            assigned_to_id: 1,
            parent_issue_id: parentIssueId,
            is_private: false,
            estimated_hours: 1,
            watcher_user_ids: [1],
            custom_fields: [],
            custom_field_values: {},
            uploads: [
              {
                token: scopedUpload.token,
                filename: "scoped-attachment.txt",
                description: "scoped attachment",
                content_type: "text/plain",
              },
            ],
          },
        },
      }
    );
    assertStatus(201, response);
  });

  await t.test("GET /projects/{project_id}/issues.json with filters", async () => {
    const response = await client.GET(
      "/projects/{project_id}/issues.{format}",
      {
        params: {
          path: { format: "json", project_id: projectId },
          query: {
            include: ["attachments", "relations"],
            sort: "id:desc",
            status_id: ["*"],
            tracker_id: ["1"],
            offset: 0,
            limit: 25,
          },
        },
      }
    );
    assertStatus(200, response);
  });

  await t.test("DELETE /issues/{issue_id}.json", async () => {
    const response = await client.DELETE("/issues/{issue_id}.{format}", {
      params: { path: { format: "json", issue_id: issueId } },
    });
    assertStatus(204, response);
  });

  await deleteProject(projectId);
});
