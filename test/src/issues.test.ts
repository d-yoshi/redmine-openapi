import { before, after, describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  client,
  assertStatus,
  uploadFile,
  currentUserId,
  someTrackerId,
  someStatusId,
  somePriorityId,
  someRoleId,
  type IssuesQuery,
} from "./helpers.js";

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
  let trackerId: number;
  let userId: number;
  let statusId: number;
  let priorityId: number;
  let categoryId: number;
  let versionId: number;
  let parentIssueId: number;
  let uploadToken: string;
  let issueId: number;
  let relationId: number;

  before(async () => {
    trackerId = await someTrackerId();
    userId = await currentUserId();
    statusId = await someStatusId();
    priorityId = await somePriorityId();
    const project = await createProject({ trackerIds: [trackerId] });
    projectId = project.id;

    const membershipResponse = await client.POST(
      "/projects/{project_id}/memberships.{format}",
      {
        params: { path: { format: "json", project_id: projectId } },
        body: { membership: { user_id: userId, role_ids: [await someRoleId()] } },
      }
    );
    assertStatus(201, membershipResponse);

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
        issue: { project_id: projectId, tracker_id: trackerId, subject: "parent" },
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
          tracker_id: trackerId,
          status_id: statusId,
          priority_id: priorityId,
          subject: "issue-1",
          description: "description",
          start_date: new Date().toISOString().slice(0, 10),
          due_date: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
          done_ratio: 10,
          assigned_to_id: "me",
          category_id: categoryId,
          fixed_version_id: versionId,
          parent_issue_id: parentIssueId,
          is_private: false,
          estimated_hours: "2:00",
          watcher_user_ids: [userId],
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
    assert.strictEqual(response.data!.issue.assigned_to?.id, userId);
    assert.strictEqual(response.data!.issue.category?.id, categoryId);
    assert.strictEqual(response.data!.issue.fixed_version?.id, versionId);
    assert.strictEqual(response.data!.issue.parent?.id, parentIssueId);
  });

  test("GET /issues/{issue_id}.json omits include-only fields without include", async () => {
    const response = await client.GET("/issues/{issue_id}.{format}", {
      params: { path: { format: "json", issue_id: issueId } },
    });
    assertStatus(200, response);
    for (const field of ["children", "attachments", "relations", "changesets", "journals", "watchers", "allowed_statuses"]) {
      assert(!Object.hasOwn(response.data!.issue, field), `Unexpected ${field} without include`);
    }
  });

  test("GET /issues/{issue_id}.json with all includes", async () => {
    const noteResponse = await client.PUT("/issues/{issue_id}.{format}", {
      params: { path: { format: "json", issue_id: issueId } },
      body: { issue: { notes: "journal-1" } },
    });
    assertStatus(204, noteResponse);

    const relatedResponse = await client.POST("/issues.{format}", {
      params: { path: { format: "json" } },
      body: { issue: { project_id: projectId, subject: "related issue" } },
    });
    assertStatus(201, relatedResponse);
    const relationResponse = await client.POST("/issues/{issue_id}/relations.{format}", {
      params: { path: { format: "json", issue_id: issueId } },
      body: { relation: { issue_to_id: relatedResponse.data!.issue.id, relation_type: "relates" } },
    });
    assertStatus(201, relationResponse);
    relationId = relationResponse.data!.relation.id;

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
    const issue = response.data!.issue;
    assert(!Object.hasOwn(issue, "children"), "Leaf issues omit children even with include=children");
    assert(issue.attachments?.some((attachment) => attachment.filename === "attachment.txt"));
    assert(issue.relations?.some((relation) => relation.id === relationId));
    assert(Array.isArray(issue.changesets));
    assert(issue.journals?.some((journal) => journal.notes === "journal-1"));
    assert(issue.watchers?.some((watcher) => watcher.id === userId));
    assert(Array.isArray(issue.allowed_statuses));
    assert.strictEqual(issue.parent?.id, parentIssueId);
  });

  test("PUT /issues/{issue_id}.json", async () => {
    const getRes = await client.GET("/issues/{issue_id}.{format}", {
      params: {
        path: { format: "json", issue_id: issueId },
        query: { include: ["attachments"] },
      },
    });
    assertStatus(200, getRes);
    const originalAttachment = getRes.data!.issue.attachments?.[0];
    assert(originalAttachment);

    const updateUpload = await uploadFile("update-attachment.txt", "updated content");
    const response = await client.PUT("/issues/{issue_id}.{format}", {
      params: { path: { format: "json", issue_id: issueId } },
      body: {
        issue: {
          project_id: projectId,
          tracker_id: trackerId,
          status_id: statusId,
          priority_id: priorityId,
          subject: "issue-1-updated",
          description: "updated description",
          start_date: new Date().toISOString().slice(0, 10),
          due_date: new Date(Date.now() + 172800000).toISOString().slice(0, 10),
          done_ratio: 50,
          category_id: categoryId,
          fixed_version_id: versionId,
          assigned_to_id: userId,
          parent_issue_id: parentIssueId,
          is_private: true,
          estimated_hours: 5,
          notes: "note-1",
          private_notes: false,
          deleted_attachment_ids: [originalAttachment.id],
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

    const readback = await client.GET("/issues/{issue_id}.{format}", {
      params: {
        path: { format: "json", issue_id: issueId },
        query: { include: ["attachments", "journals"] },
      },
    });
    assertStatus(200, readback);
    const issue = readback.data!.issue;
    assert.strictEqual(issue.subject, "issue-1-updated");
    assert.strictEqual(issue.description, "updated description");
    assert.strictEqual(issue.is_private, true);
    assert.strictEqual(issue.estimated_hours, 5);
    assert.strictEqual(issue.done_ratio, 50);
    assert.equal(issue.attachments?.length, 1);
    const attachment = issue.attachments?.[0];
    assert(attachment);
    assert.equal(attachment.filename, "update-attachment.txt");

    const journal = issue.journals?.find((item) => item.notes === "note-1");
    assert(journal);
    const attachmentDetails = journal.details.filter((detail) => detail.property === "attachment");
    assert(attachmentDetails.some(
      (detail) => detail.name === String(attachment.id) && detail.new_value === attachment.filename
    ));
    assert(attachmentDetails.some(
      (detail) => detail.name === String(originalAttachment.id) && detail.old_value === originalAttachment.filename
    ));
  });

  test("GET /issues.json", async () => {
    const response = await client.GET("/issues.{format}", {
      params: { path: { format: "json" }, query: { project_id: String(projectId), status_id: "*" } },
    });
    assertStatus(200, response);
    const issue = response.data!.issues.find((item) => item.id === issueId);
    assert(issue, "Expected the created child issue in the issue list");
    assert.strictEqual(issue.parent?.id, parentIssueId);
  });

  test("GET /issues.json with all includes", async () => {
    const response = await client.GET("/issues.{format}", {
      params: {
        path: { format: "json" },
        query: { include: ["attachments", "relations"], issue_id: String(issueId), status_id: "*" },
      },
    });
    assertStatus(200, response);
    const issue = response.data!.issues.find((issue) => issue.id === issueId);
    assert(issue, "Expected a populated issue summary");
    assert(issue.attachments?.some((attachment) => attachment.filename === "update-attachment.txt"));
    assert(issue.relations?.some((relation) => relation.id === relationId));
  });

  test("GET /issues.json with filters", async () => {
    const response = await client.GET("/issues.{format}", {
      params: {
        path: { format: "json" },
        query: {
          sort: "id:desc",
          status_id: "*",
          tracker_id: String(trackerId),
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

  for (const nometaIn of ["query", "header"] as const) {
    test(`GET /issues.json with pagination and nometa ${nometaIn}`, async () => {
      const page = { project_id: String(projectId), status_id: "*", sort: "id:asc", offset: 1, limit: 1 };
      const withMeta = await client.GET("/issues.{format}", {
        params: { path: { format: "json" }, query: page },
      });
      assertStatus(200, withMeta);
      assert.deepStrictEqual(withMeta.data!.issues.map((issue) => issue.id), [issueId]);
      assert.strictEqual(withMeta.data!.offset, 1);
      assert.strictEqual(withMeta.data!.limit, 1);
      assert.strictEqual(withMeta.data!.total_count, 3);

      const response = await client.GET("/issues.{format}", {
        params: {
          path: { format: "json" },
          query: nometaIn === "query" ? { ...page, nometa: 1 } : page,
          header: nometaIn === "header" ? { "X-Redmine-Nometa": 1 } : undefined,
        },
      });
      assertStatus(200, response);
      assert.deepStrictEqual(response.data!.issues.map((issue) => issue.id), [issueId]);
      for (const field of ["total_count", "offset", "limit"]) {
        assert(!Object.hasOwn(response.data!, field), `Unexpected ${field} with nometa ${nometaIn}`);
      }
    });
  }

  test("GET /issues.json with remaining filters", async () => {
    const cfResponse = await client.GET("/custom_fields.{format}", {
      params: { path: { format: "json" } },
    });
    assertStatus(200, cfResponse);
    const cfId = cfResponse.data!.custom_fields.find(
      (cf) => cf.name === "CF String"
    )!.id;

    const filters = {
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
      // form/explode serializes the map keys as actual query parameter names.
      cf_x: { [`cf_${cfId}`]: "*" },
    } satisfies IssuesQuery;

    const response = await client.GET("/issues.{format}", {
      params: {
        path: { format: "json" },
        query: filters,
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

  test("creating an issue without copy_from requires a subject", async () => {
    const response = await client.POST("/issues.{format}", {
      params: { path: { format: "json" } },
      body: {
        issue: {
          project_id: projectId,
        },
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
            tracker_id: trackerId,
            status_id: statusId,
            priority_id: priorityId,
            subject: "project-scoped-issue",
            description: "created via project-scoped endpoint",
            start_date: new Date().toISOString().slice(0, 10),
            due_date: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
            done_ratio: 0,
            category_id: categoryId,
            fixed_version_id: versionId,
            assigned_to_id: userId,
            parent_issue_id: parentIssueId,
            is_private: false,
            estimated_hours: 1,
            watcher_user_ids: [userId],
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
            tracker_id: String(trackerId),
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

  test("creating a project-scoped issue without copy_from requires a body", async () => {
    const response = await client.POST(
      "/projects/{project_id}/issues.{format}",
      {
        params: { path: { format: "json", project_id: projectId } },
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

  test("copy options inherit the subject, attachments and subtasks and link the source", async () => {
    const upload = await uploadFile("copy-source.txt", "copy content");
    const source = await client.POST("/issues.{format}", {
      params: { path: { format: "json" } },
      body: {
        issue: {
          project_id: projectId,
          subject: "Copy source",
          uploads: [{ token: upload.token }],
        },
      },
    });
    assertStatus(201, source);
    const sourceId = source.data!.issue.id;
    const child = await client.POST("/issues.{format}", {
      params: { path: { format: "json" } },
      body: { issue: { project_id: projectId, subject: "Copy child", parent_issue_id: sourceId } },
    });
    assertStatus(201, child);
    const copy = await client.POST("/issues.{format}", {
      params: {
        path: { format: "json" },
        query: { copy_from: sourceId, link_copy: 1, copy_attachments: 1, copy_subtasks: 1 },
      },
      body: { issue: { project_id: projectId } },
    });
    assertStatus(201, copy);
    assert.equal(copy.data!.issue.subject, source.data!.issue.subject);
    const detail = await client.GET("/issues/{issue_id}.{format}", {
      params: {
        path: { format: "json", issue_id: copy.data!.issue.id },
        query: { include: ["attachments", "children", "relations"] },
      },
    });
    assertStatus(200, detail);
    assert(detail.data!.issue.attachments?.some((a) => a.filename === "copy-source.txt"));
    assert(detail.data!.issue.children?.some((i) => i.subject === "Copy child"));
    assert(
      detail.data!.issue.relations?.some(
        (r) => r.issue_id === sourceId || r.issue_to_id === sourceId
      )
    );
  });

  test("project-scoped copies accept an omitted body or an override without a subject", async () => {
    const params = {
      path: { format: "json" as const, project_id: projectId },
      query: { copy_from: parentIssueId },
    };
    for (const description of [undefined, "Description override"]) {
      const copy = await client.POST("/projects/{project_id}/issues.{format}", {
        params,
        body: description === undefined ? undefined : { issue: { description } },
      });
      assertStatus(201, copy);
      assert.notEqual(copy.data!.issue.id, parentIssueId);
      assert.equal(copy.data!.issue.project.id, projectId);
      assert.equal(copy.data!.issue.subject, "parent");
      if (description !== undefined) assert.equal(copy.data!.issue.description, description);
    }
  });

  test("PATCH updates an issue", async () => {
    const params = { path: { format: "json" as const, issue_id: issueId } };
    const updated = await client.PATCH("/issues/{issue_id}.{format}", {
      params,
      body: { issue: { subject: "Issue updated via PATCH" } },
    });
    assertStatus(204, updated);
    const current = await client.GET("/issues/{issue_id}.{format}", { params });
    assertStatus(200, current);
    assert.equal(current.data!.issue.subject, "Issue updated via PATCH");
  });

  test("An empty string clears the assignee and null keeps it", async () => {
    const params = { path: { format: "json" as const, issue_id: issueId } };
    for (const [assignee, expectedId] of [[null, userId], ["", undefined]] as const) {
      const update = await client.PUT("/issues/{issue_id}.{format}", {
        params,
        body: { issue: { assigned_to_id: assignee } },
      });
      assertStatus(204, update);

      const readback = await client.GET("/issues/{issue_id}.{format}", { params });
      assertStatus(200, readback);
      assert.equal(readback.data!.issue.assigned_to?.id, expectedId);
    }
  });

  test("DELETE /issues/{issue_id}.json", async () => {
    const response = await client.DELETE("/issues/{issue_id}.{format}", {
      params: { path: { format: "json", issue_id: issueId } },
    });
    assertStatus(204, response);
  });
});
