import { before, after, describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  client,
  assertStatus,
  currentUserId,
  createTestUser,
  runCleanup,
  someRoleId,
  type IssuesQuery,
} from "./helpers.js";

describe("Issue filter representations", () => {
  let projectId: number;
  let userId: number;
  let otherUserId: number;
  let assignedId: number;
  let datedId: number;
  let emptyId: number;
  let cfId: number;

  before(async () => {
    const name = `issue-filters-${Date.now()}`;
    const project = await client.POST("/projects.{format}", {
      params: { path: { format: "json" } },
      body: { project: { name, identifier: name } },
    });
    assertStatus(201, project);
    projectId = project.data!.project.id;

    userId = await currentUserId();
    otherUserId = await createTestUser("filter-assignee");
    for (const memberId of [userId, otherUserId]) {
      const membership = await client.POST("/projects/{project_id}/memberships.{format}", {
        params: { path: { format: "json", project_id: projectId } },
        body: { membership: { user_id: memberId, role_ids: [await someRoleId()] } },
      });
      assertStatus(201, membership);
    }

    const customFields = await client.GET("/custom_fields.{format}", {
      params: { path: { format: "json" } },
    });
    assertStatus(200, customFields);
    const customField = customFields.data!.custom_fields.find((cf) => cf.name === "CF String");
    assert(customField, "Expected the seeded 'CF String' custom field");
    assert.strictEqual(customField.is_filter, true);
    cfId = customField.id;

    for (const [subject, startDate, assignee] of [
      ["assigned", "2024-01-01", userId],
      ["dated", "2024-02-01", otherUserId],
      ["empty", null, undefined],
    ] as const) {
      const response = await client.POST("/issues.{format}", {
        params: { path: { format: "json" } },
        body: {
          issue: {
            project_id: projectId,
            subject,
            start_date: startDate,
            assigned_to_id: assignee,
            custom_fields: [{ id: cfId, value: subject === "assigned" ? "matching" : "other" }],
          },
        },
      });
      assertStatus(201, response);
      if (subject === "assigned") assignedId = response.data!.issue.id;
      if (subject === "dated") datedId = response.data!.issue.id;
      if (subject === "empty") emptyId = response.data!.issue.id;
    }
  });

  after(async () => {
    await runCleanup([
      async () => {
        if (!projectId) return;
        const response = await client.DELETE("/projects/{project_id}.{format}", {
          params: { path: { format: "json", project_id: projectId } },
        });
        assertStatus(204, response);
      },
      async () => {
        if (!otherUserId) return;
        const response = await client.DELETE("/users/{user_id}.{format}", {
          params: { path: { format: "json", user_id: otherUserId } },
        });
        assertStatus(204, response);
      },
    ]);
  });

  const cases: Array<{
    name: string;
    query: () => IssuesQuery;
    expected: () => number[];
  }> = [
    {
      name: "unfiltered control",
      query: () => ({}),
      expected: () => [assignedId, datedId, emptyId],
    },
    {
      name: "comma-delimited issue IDs",
      query: () => ({ issue_id: `${assignedId},${datedId}` }),
      expected: () => [assignedId, datedId],
    },
    {
      name: "pipe-delimited assignees",
      query: () => ({ assigned_to_id: `${userId}|${otherUserId}` }),
      expected: () => [assignedId, datedId],
    },
    {
      name: "negated assignee",
      query: () => ({ assigned_to_id: "!me" }),
      expected: () => [datedId, emptyId],
    },
    {
      name: "date comparison",
      query: () => ({ start_date: ">=2024-02-01" }),
      expected: () => [datedId],
    },
    {
      name: "me assignee",
      query: () => ({ assigned_to_id: "me" }),
      expected: () => [assignedId],
    },
    {
      name: "custom field key and value",
      query: () => ({ cf_x: { [`cf_${cfId}`]: "matching" } }),
      expected: () => [assignedId],
    },
  ];

  for (const scoped of [false, true]) {
    for (const example of cases) {
      test(`${scoped ? "Project-scoped" : "Global"} issues: ${example.name}`, async () => {
        const query = {
          status_id: "*",
          sort: "id:asc",
          ...example.query(),
        };
        const response = scoped
          ? await client.GET("/projects/{project_id}/issues.{format}", {
              params: { path: { format: "json", project_id: projectId }, query },
            })
          : await client.GET("/issues.{format}", {
              params: { path: { format: "json" }, query: { ...query, project_id: String(projectId) } },
            });
        assertStatus(200, response);
        assert.deepStrictEqual(
          response.data!.issues.map((issue) => issue.id),
          example.expected()
        );
      });
    }
  }

  test("An unassigned issue exposes nullable values and omits absent associations", async () => {
    const response = await client.GET("/issues/{issue_id}.{format}", {
      params: { path: { format: "json", issue_id: emptyId } },
    });
    assertStatus(200, response);
    const issue = response.data!.issue;
    for (const field of ["start_date", "due_date", "closed_on", "estimated_hours"] as const) {
      assert.strictEqual(issue[field], null, `Expected null ${field}`);
    }
    for (const field of ["assigned_to", "category", "fixed_version", "parent"]) {
      assert(!Object.hasOwn(issue, field), `Expected omitted ${field}`);
    }
  });
});
