import { before, after, describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  client,
  assertStatus,
  createTestUser,
  runCleanup,
  someRoleId,
} from "./helpers.js";

describe("Issue default assignment", () => {
  let projectId: number;
  let categoryId: number;
  let categoryAssigneeId: number;
  let projectAssigneeId: number;

  before(async () => {
    categoryAssigneeId = await createTestUser("category-assignee");
    projectAssigneeId = await createTestUser("project-assignee");
    const name = `default-assignment-${Date.now()}`;
    const projectResponse = await client.POST("/projects.{format}", {
      params: { path: { format: "json" } },
      body: { project: { name, identifier: name } },
    });
    assertStatus(201, projectResponse);
    projectId = projectResponse.data!.project.id;

    for (const userId of [categoryAssigneeId, projectAssigneeId]) {
      const response = await client.POST(
        "/projects/{project_id}/memberships.{format}",
        {
          params: { path: { format: "json", project_id: projectId } },
          body: {
            membership: { user_id: userId, role_ids: [await someRoleId()] },
          },
        }
      );
      assertStatus(201, response);
    }
    const projectUpdate = await client.PUT("/projects/{project_id}.{format}", {
      params: { path: { format: "json", project_id: projectId } },
      body: { project: { default_assigned_to_id: projectAssigneeId } },
    });
    assertStatus(204, projectUpdate);

    const categoryResponse = await client.POST(
      "/projects/{project_id}/issue_categories.{format}",
      {
        params: { path: { format: "json", project_id: projectId } },
        body: {
          issue_category: {
            name: "Default assignee",
            assigned_to_id: categoryAssigneeId,
          },
        },
      }
    );
    assertStatus(201, categoryResponse);
    categoryId = categoryResponse.data!.issue_category.id;
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
      ...[categoryAssigneeId, projectAssigneeId].map((id) => async () => {
        if (!id) return;
        const response = await client.DELETE("/users/{user_id}.{format}", {
          params: { path: { format: "json", user_id: id } },
        });
        assertStatus(204, response);
      }),
    ]);
  });

  const lockUser = async (userId: number) => {
    const response = await client.PUT("/users/{user_id}.{format}", {
      params: { path: { format: "json", user_id: userId } },
      body: { user: { status: 3 } },
    });
    assertStatus(204, response);
    const readback = await client.GET("/users/{user_id}.{format}", {
      params: { path: { format: "json", user_id: userId } },
    });
    assertStatus(200, readback);
    assert.strictEqual(readback.data!.user.status, 3);
  };

  test("an omitted or null assigned_to_id uses assignable category and project defaults", async () => {
    for (const assignedToId of [undefined, null]) {
      const categoryResponse = await client.POST("/issues.{format}", {
        params: { path: { format: "json" } },
        body: {
          issue: {
            project_id: projectId,
            subject: "Category default",
            category_id: categoryId,
            assigned_to_id: assignedToId,
          },
        },
      });
      assertStatus(201, categoryResponse);
      assert.strictEqual(
        categoryResponse.data!.issue.assigned_to?.id,
        categoryAssigneeId
      );

      const projectResponse = await client.POST(
        "/projects/{project_id}/issues.{format}",
        {
          params: { path: { format: "json", project_id: projectId } },
          body: {
            issue: { subject: "Project default", assigned_to_id: assignedToId },
          },
        }
      );
      assertStatus(201, projectResponse);
      assert.strictEqual(
        projectResponse.data!.issue.assigned_to?.id,
        projectAssigneeId
      );
    }
  });

  test("a locked category default falls back to the assignable project default", async () => {
    await lockUser(categoryAssigneeId);
    const response = await client.POST("/issues.{format}", {
      params: { path: { format: "json" } },
      body: {
        issue: {
          project_id: projectId,
          subject: "Category fallback",
          category_id: categoryId,
        },
      },
    });
    assertStatus(201, response);
    assert.strictEqual(response.data!.issue.assigned_to?.id, projectAssigneeId);
  });

  test("a locked project default is skipped when creating a project-scoped issue", async () => {
    await lockUser(projectAssigneeId);
    const response = await client.POST(
      "/projects/{project_id}/issues.{format}",
      {
        params: { path: { format: "json", project_id: projectId } },
        body: { issue: { subject: "Unassignable project default" } },
      }
    );
    assertStatus(201, response);
    assert.strictEqual(response.data!.issue.assigned_to, undefined);
  });
});
