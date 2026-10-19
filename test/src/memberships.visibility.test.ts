import { before, after, describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  client,
  assertStatus,
  createTestUser,
  runCleanup,
  visibilityRoleId,
} from "./helpers.js";

describe("Membership visibility", () => {
  const projectIds: number[] = [];
  let viewerId: number;
  let viewerLogin: string;
  let memberId: number;
  let groupId: number;
  let visibleProjectId: number;
  let closedProjectId: number;
  let privateProjectId: number;

  before(async () => {
    viewerId = await createTestUser("memberships-vis-viewer");
    memberId = await createTestUser("memberships-vis-member");
    const viewerResponse = await client.GET("/users/{user_id}.{format}", {
      params: { path: { format: "json", user_id: viewerId } },
    });
    assertStatus(200, viewerResponse);
    viewerLogin = viewerResponse.data!.user.login;

    const roleId = await visibilityRoleId();
    const groupResponse = await client.POST("/groups.{format}", {
      params: { path: { format: "json" } },
      body: {
        group: {
          name: `memberships-visibility-${Date.now()}`,
          user_ids: [memberId],
        },
      },
    });
    assertStatus(201, groupResponse);
    groupId = groupResponse.data!.group.id;

    const prefix = `memberships-visibility-${Date.now()}`;
    for (const name of ["visible", "closed", "private", "archived"]) {
      const projectResponse = await client.POST("/projects.{format}", {
        params: { path: { format: "json" } },
        body: {
          project: {
            name: `${prefix}-${name}`,
            identifier: `${prefix}-${name}`,
            is_public: name !== "private",
          },
        },
      });
      assertStatus(201, projectResponse);
      const projectId = projectResponse.data!.project.id;
      projectIds.push(projectId);
      if (name === "visible") visibleProjectId = projectId;
      if (name === "closed") closedProjectId = projectId;
      if (name === "private") privateProjectId = projectId;

      const groupMembership = await client.POST(
        "/projects/{project_id}/memberships.{format}",
        {
          params: { path: { format: "json", project_id: projectId } },
          body: {
            membership: { user_id: groupId, role_ids: [roleId] },
          },
        }
      );
      assertStatus(201, groupMembership);

      if (name !== "private") {
        const viewerMembership = await client.POST(
          "/projects/{project_id}/memberships.{format}",
          {
            params: { path: { format: "json", project_id: projectId } },
            body: {
              membership: { user_id: viewerId, role_ids: [roleId] },
            },
          }
        );
        assertStatus(201, viewerMembership);
      }

      if (name === "closed" || name === "archived") {
        const stateResponse = await client.PUT(
          name === "closed"
            ? "/projects/{project_id}/close.{format}"
            : "/projects/{project_id}/archive.{format}",
          { params: { path: { format: "json", project_id: projectId } } }
        );
        assertStatus(204, stateResponse);
        if (name === "closed") {
          const readback = await client.GET("/projects/{project_id}.{format}", {
            params: { path: { format: "json", project_id: projectId } },
          });
          assertStatus(200, readback);
          assert.strictEqual(
            readback.data!.project.status,
            5,
            "Expected the membership fixture project to be closed"
          );
        }
      }
    }
  });

  after(async () => {
    await runCleanup([
      ...[...projectIds].reverse().map((id) => async () => {
        const response = await client.DELETE("/projects/{project_id}.{format}", {
          params: { path: { format: "json", project_id: id } },
        });
        assertStatus(204, response);
      }),
      async () => {
        if (!groupId) return;
        const response = await client.DELETE("/groups/{group_id}.{format}", {
          params: { path: { format: "json", group_id: groupId } },
        });
        assertStatus(204, response);
      },
      ...[viewerId, memberId].map((id) => async () => {
        if (!id) return;
        const response = await client.DELETE("/users/{user_id}.{format}", {
          params: { path: { format: "json", user_id: id } },
        });
        assertStatus(204, response);
      }),
    ]);
  });

  test("group memberships exclude invisible and archived projects but include closed projects", async () => {
    for (const login of [undefined, viewerLogin]) {
      const response = await client.GET("/groups/{group_id}.{format}", {
        params: {
          path: { format: "json", group_id: groupId },
          header: { "X-Redmine-Switch-User": login },
          query: { include: ["memberships"] },
        },
      });
      assertStatus(200, response);
      assert.deepStrictEqual(
        new Set(response.data!.group.memberships!.map((m) => m.project.id)),
        new Set(
          login
            ? [visibleProjectId, closedProjectId]
            : [visibleProjectId, closedProjectId, privateProjectId]
        )
      );
    }
  });

  test("user memberships exclude invisible and archived projects but include closed projects", async () => {
    for (const login of [undefined, viewerLogin]) {
      const response = await client.GET("/users/{user_id}.{format}", {
        params: {
          path: { format: "json", user_id: memberId },
          header: { "X-Redmine-Switch-User": login },
          query: { include: ["memberships"] },
        },
      });
      assertStatus(200, response);
      assert.deepStrictEqual(
        new Set(response.data!.user.memberships!.map((m) => m.project.id)),
        new Set(
          login
            ? [visibleProjectId, closedProjectId]
            : [visibleProjectId, closedProjectId, privateProjectId]
        )
      );
    }
  });

  test("current user memberships exclude archived projects but include closed projects", async () => {
    const response = await client.GET("/users/current.{format}", {
      params: {
        path: { format: "json" },
        header: { "X-Redmine-Switch-User": viewerLogin },
        query: { include: ["memberships"] },
      },
    });
    assertStatus(200, response);
    assert.strictEqual(response.data!.user.id, viewerId);
    assert.deepStrictEqual(
      response.data!.user.memberships!.map((m) => m.project.id),
      [visibleProjectId, closedProjectId]
    );
  });
});
