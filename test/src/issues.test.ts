import { before, after, describe, test } from "node:test";
import assert from "node:assert/strict";

import { client, assertStatus, uploadFile } from "./helpers.js";

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

describe("Issues", () => {
  let projectId: number;
  let categoryId: number;
  let versionId: number;
  let parentIssueId: number;
  let uploadToken: string;
  let issueId: number;

  before(async () => {
    const project = await createProject({ trackerIds: [1] });
    projectId = project.id;

    const categoryResponse = await client.POST(
      "/projects/{project_id}/issue_categories.{format}",
      {
        params: { path: { format: "json", project_id: projectId } },
        body: { issue_category: { name: "category-1" } },
      }
    );
    assertStatus(201, categoryResponse);
    categoryId = categoryResponse.data!.issue_category.id;

    const versionResponse = await client.POST(
      "/projects/{project_id}/versions.{format}",
      {
        params: { path: { format: "json", project_id: projectId } },
        body: { version: { name: "v1.0" } },
      }
    );
    assertStatus(201, versionResponse);
    versionId = versionResponse.data!.version.id;

    const parentResponse = await client.POST("/issues.{format}", {
      params: { path: { format: "json" } },
      body: {
        issue: { project_id: projectId, tracker_id: 1, subject: "parent" },
      },
    });
    assertStatus(201, parentResponse);
    parentIssueId = parentResponse.data!.issue.id;

    const upload = await uploadFile("attachment.txt", "file content");
    uploadToken = upload.token;
  });

  after(async () => {
    if (projectId) {
      await deleteProject(projectId);
    }
  });

  test("POST /issues.json", async () => {
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

  test("GET /issues/{issue_id}.json with all includes", async () => {
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

  test("PUT /issues/{issue_id}.json", async () => {
    // Get attachment ID for deleted_attachment_ids testing
    const getRes = await client.GET("/issues/{issue_id}.{format}", {
      params: {
        path: { format: "json", issue_id: issueId },
        query: { include: ["attachments"] },
      },
    });
    assertStatus(200, getRes);
    const attachmentId = getRes.data!.issue.attachments![0].id;

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
          deleted_attachment_ids: [attachmentId],
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

  test("GET /issues.json", async () => {
    const response = await client.GET("/issues.{format}", {
      params: { path: { format: "json" } },
    });
    assertStatus(200, response);
  });

  test("GET /issues.json with all includes", async () => {
    const response = await client.GET("/issues.{format}", {
      params: {
        path: { format: "json" },
        query: { include: ["attachments", "relations"] },
      },
    });
    assertStatus(200, response);
  });

  test("GET /issues.json with filters", async () => {
    const response = await client.GET("/issues.{format}", {
      params: {
        path: { format: "json" },
        query: {
          sort: "id:desc",
          status_id: "*",
          tracker_id: "1",
          assigned_to_id: "me",
          subject: "issue",
          created_on: ">=2020-01-01",
          issue_id: "*",
          parent_id: "*",
          author_id: "*",
          fixed_version_id: "*",
          category_id: "*",
          done_ratio: ">=0",
          is_private: "0",
        },
      },
    });
    assertStatus(200, response);
  });

  test("GET /issues.json with pagination and nometa", async () => {
    const response = await client.GET("/issues.{format}", {
      params: {
        path: { format: "json" },
        query: { offset: 0, limit: 1, nometa: 1 },
      },
    });
    assertStatus(200, response);
  });

  test("GET /issues.json with remaining filters", async () => {
    const cfResponse = await client.GET("/custom_fields.{format}", {
      params: { path: { format: "json" } },
    });
    assertStatus(200, cfResponse);
    const cfId = cfResponse.data!.custom_fields.find(
      (cf) => cf.name === "CF String"
    )!.id;

    const response = await client.GET("/issues.{format}", {
      params: {
        path: { format: "json" },
        query: {
          project_id: String(projectId),
          subproject_id: "!*",
          priority_id: "*",
          "author.group": "*",
          "author.role": "*",
          member_of_group: "*",
          assigned_to_role: "*",
          "fixed_version.due_date": "*",
          "fixed_version.status": "*",
          child_id: "*",
          description: "~description",
          notes: "~note",
          updated_on: ">=2020-01-01",
          closed_on: ">=2020-01-01",
          start_date: ">=2020-01-01",
          due_date: ">=2020-01-01",
          estimated_hours: ">=0",
          spent_time: ">=0",
          attachment: "*",
          attachment_description: "*",
          watcher_id: "me",
          updated_by: "me",
          last_updated_by: "me",
          "project.status": "1",
          relates: "!*",
          duplicates: "!*",
          duplicated: "!*",
          blocks: "!*",
          blocked: "!*",
          precedes: "!*",
          follows: "!*",
          copied_to: "!*",
          copied_from: "!*",
          any_searchable: "~test",
          [`cf_${cfId}`]: "*",
        } as any,
      },
    });
    assertStatus(200, response);
  });

  test("GET /issues.json with query_id", async () => {
    const queriesResponse = await client.GET("/queries.{format}", {
      params: { path: { format: "json" } },
    });
    assertStatus(200, queriesResponse);
    const query = queriesResponse.data!.queries.find(
      (q) => q.name === "Seed Query"
    );
    assert(query, "Expected seeded query 'Seed Query' to exist");

    const response = await client.GET("/issues.{format}", {
      params: {
        path: { format: "json" },
        query: { query_id: query!.id },
      },
    });
    assertStatus(200, response);
  });

  test("GET /issues.json returns 404 for nonexistent query_id", async () => {
    const response = await client.GET("/issues.{format}", {
      params: {
        path: { format: "json" },
        query: { query_id: 999999 },
      },
    });
    assertStatus(404, response);
  });

  test("GET /issues.json returns 422 for invalid filter value", async () => {
    const response = await client.GET("/issues.{format}", {
      params: {
        path: { format: "json" },
        query: { created_on: "invalid-date" },
      },
    });
    assertStatus(422, response);
  });

  test("GET /issues/{issue_id}.json with include=children", async () => {
    const response = await client.GET("/issues/{issue_id}.{format}", {
      params: {
        path: { format: "json", issue_id: parentIssueId },
        query: { include: ["children"] },
      },
    });
    assertStatus(200, response);
    assert(
      response.data!.issue.children!.length > 0,
      "Expected the parent issue to have children"
    );
  });

  test("GET /issues/{issue_id}.json returns 404", async () => {
    const response = await client.GET("/issues/{issue_id}.{format}", {
      params: { path: { format: "json", issue_id: 999999 } },
    });
    assertStatus(404, response);
  });

  test("PUT /issues/{issue_id}.json returns 404", async () => {
    const response = await client.PUT("/issues/{issue_id}.{format}", {
      params: { path: { format: "json", issue_id: 999999 } },
      body: { issue: { subject: "missing" } },
    });
    assertStatus(404, response);
  });

  test("PUT /issues/{issue_id}.json returns 422 for invalid data", async () => {
    const response = await client.PUT("/issues/{issue_id}.{format}", {
      params: { path: { format: "json", issue_id: issueId } },
      body: { issue: { subject: "" } },
    });
    assertStatus(422, response);
  });

  test("DELETE /issues/{issue_id}.json returns 404", async () => {
    const response = await client.DELETE("/issues/{issue_id}.{format}", {
      params: { path: { format: "json", issue_id: 999999 } },
    });
    assertStatus(404, response);
  });

  test("POST /issues.json returns 422 for invalid data", async () => {
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

  test("POST /projects/{project_id}/issues.json", async () => {
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

  test("GET /projects/{project_id}/issues.json with filters", async () => {
    const response = await client.GET(
      "/projects/{project_id}/issues.{format}",
      {
        params: {
          path: { format: "json", project_id: projectId },
          query: {
            include: ["attachments", "relations"],
            sort: "id:desc",
            status_id: "*",
            tracker_id: "1",
            offset: 0,
            limit: 25,
          },
        },
      }
    );
    assertStatus(200, response);
  });

  test("POST /projects/{project_id}/issues.json returns 404 for nonexistent project", async () => {
    const response = await client.POST(
      "/projects/{project_id}/issues.{format}",
      {
        params: { path: { format: "json", project_id: "nonexistent-project" } },
        body: { issue: { subject: "missing" } },
      }
    );
    assertStatus(404, response);
  });

  test("POST /projects/{project_id}/issues.json returns 422 for invalid data", async () => {
    const response = await client.POST(
      "/projects/{project_id}/issues.{format}",
      {
        params: { path: { format: "json", project_id: projectId } },
        body: { issue: { subject: "" } },
      }
    );
    assertStatus(422, response);
  });

  test("GET /projects/{project_id}/issues.json returns 404 for nonexistent project", async () => {
    const response = await client.GET(
      "/projects/{project_id}/issues.{format}",
      {
        params: { path: { format: "json", project_id: "nonexistent-project" } },
      }
    );
    assertStatus(404, response);
  });

  test("GET /projects/{project_id}/issues.json returns 422 for invalid filter value", async () => {
    const response = await client.GET(
      "/projects/{project_id}/issues.{format}",
      {
        params: {
          path: { format: "json", project_id: projectId },
          query: { created_on: "invalid-date" },
        },
      }
    );
    assertStatus(422, response);
  });

  test("DELETE /issues/{issue_id}.json", async () => {
    const response = await client.DELETE("/issues/{issue_id}.{format}", {
      params: { path: { format: "json", issue_id: issueId } },
    });
    assertStatus(204, response);
  });
});
