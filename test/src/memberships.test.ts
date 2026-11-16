import { before, after, describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  client,
  assertStatus,
  createTestUser,
  createTestClient,
  runCleanup,
  someRoleId,
} from "./helpers.js";

describe("Memberships", () => {
  const projectIdentifier = `mem-${Date.now()}`;
  let projectId: number;
  let membershipId: number;
  let userId: number;
  let roleLessUserId: number;
  let putUserId: number;
  let groupUserId: number;
  let groupId: number;

  before(async () => {
    const projectResponse = await client.POST("/projects.{format}", {
      params: { path: { format: "json" } },
      body: {
        project: {
          name: projectIdentifier,
          identifier: projectIdentifier,
        },
      },
    });
    assertStatus(201, projectResponse);
    projectId = projectResponse.data!.project.id;

    userId = await createTestUser("memuser");
    roleLessUserId = await createTestUser("memuser2");
    putUserId = await createTestUser("memputuser");
    groupUserId = await createTestUser("memgrpuser");

    const groupResponse = await client.POST("/groups.{format}", {
      params: { path: { format: "json" } },
      body: {
        group: { name: `mem-group-${Date.now()}`, user_ids: [groupUserId] },
      },
    });
    assertStatus(201, groupResponse);
    groupId = groupResponse.data!.group.id;
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
        if (!groupId) return;
        const response = await client.DELETE("/groups/{group_id}.{format}", {
          params: { path: { format: "json", group_id: groupId } },
        });
        assertStatus(204, response);
      },
      ...[userId, roleLessUserId, putUserId, groupUserId].map((id) => async () => {
        if (!id) return;
        const response = await client.DELETE("/users/{user_id}.{format}", {
          params: { path: { format: "json", user_id: id } },
        });
        assertStatus(204, response);
      }),
    ]);
  });

  test("POST /projects/{project_id}/memberships.json", async () => {
    const response = await client.POST(
      "/projects/{project_id}/memberships.{format}",
      {
        params: {
          path: { format: "json", project_id: projectIdentifier },
        },
        body: {
          membership: {
            user_id: userId,
            role_ids: [await someRoleId()],
          },
        },
      }
    );
    assertStatus(201, response);
    membershipId = response.data!.membership.id;
  });

  test("GET /memberships/{membership_id}.json", async () => {
    const response = await client.GET(
      "/memberships/{membership_id}.{format}",
      {
        params: {
          path: { format: "json", membership_id: membershipId },
        },
      }
    );
    assertStatus(200, response);
  });

  test("PUT /memberships/{membership_id}.json", async () => {
    const rolesResponse = await client.GET("/roles.{format}", {
      params: { path: { format: "json" } },
    });
    assertStatus(200, rolesResponse);
    const currentRoleId = await someRoleId();
    const otherRole = rolesResponse.data!.roles.find(
      (role) => role.id !== currentRoleId
    );
    assert(otherRole, "Expected at least two givable roles to exist");

    const response = await client.PUT(
      "/memberships/{membership_id}.{format}",
      {
        params: {
          path: { format: "json", membership_id: membershipId },
        },
        body: {
          membership: {
            role_ids: [otherRole.id],
          },
        },
      }
    );
    assertStatus(204, response);

    const getResponse = await client.GET(
      "/memberships/{membership_id}.{format}",
      {
        params: { path: { format: "json", membership_id: membershipId } },
      }
    );
    assertStatus(200, getResponse);
    assert.deepStrictEqual(
      getResponse.data!.membership.roles.map((role) => role.id),
      [otherRole.id],
      "Expected the membership's roles to be replaced"
    );
  });

  test("GET /projects/{project_id}/memberships.json with pagination", async () => {
    const response = await client.GET(
      "/projects/{project_id}/memberships.{format}",
      {
        params: {
          path: { format: "json", project_id: projectIdentifier },
          query: { offset: 0, limit: 25 },
        },
      }
    );
    assertStatus(200, response);
  });

  test("GET /projects/{project_id}/memberships.json returns 404 for nonexistent project", async () => {
    const response = await client.GET(
      "/projects/{project_id}/memberships.{format}",
      {
        params: { path: { format: "json", project_id: "nonexistent-project" } },
      }
    );
    assertStatus(404, response);
  });

  test("GET /users/{user_id}.json with include=memberships returns the membership", async () => {
    const response = await client.GET("/users/{user_id}.{format}", {
      params: {
        path: { format: "json", user_id: userId },
        query: { include: ["memberships"] },
      },
    });
    assertStatus(200, response);
    assert(
      response.data!.user.memberships!.length > 0,
      "Expected the user to have a membership"
    );
  });

  test("POST /projects/{project_id}/memberships.json returns 404 for nonexistent project", async () => {
    const response = await client.POST(
      "/projects/{project_id}/memberships.{format}",
      {
        params: { path: { format: "json", project_id: "nonexistent-project" } },
        body: {
          membership: { user_id: userId, role_ids: [await someRoleId()] },
        },
      }
    );
    assertStatus(404, response);
  });

  test("POST /projects/{project_id}/memberships.json returns 422 for invalid data", async () => {
    const response = await client.POST(
      "/projects/{project_id}/memberships.{format}",
      {
        params: { path: { format: "json", project_id: projectIdentifier } },
        body: { membership: { user_id: roleLessUserId, role_ids: [] } },
      }
    );
    assertStatus(422, response);
  });

  test("GET /memberships/{membership_id}.json returns 404", async () => {
    const response = await client.GET(
      "/memberships/{membership_id}.{format}",
      {
        params: { path: { format: "json", membership_id: 999999 } },
      }
    );
    assertStatus(404, response);
  });

  test("PUT /memberships/{membership_id}.json returns 404", async () => {
    const response = await client.PUT(
      "/memberships/{membership_id}.{format}",
      {
        params: { path: { format: "json", membership_id: 999999 } },
        body: { membership: { role_ids: [await someRoleId()] } },
      }
    );
    assertStatus(404, response);
  });

  test("PUT /memberships/{membership_id}.json returns 422 for empty role_ids and destroys the membership", async () => {
    // Empty role_ids deletes the membership despite the 422 response, so use
    // a dedicated membership for this request.
    const createResponse = await client.POST(
      "/projects/{project_id}/memberships.{format}",
      {
        params: { path: { format: "json", project_id: projectIdentifier } },
        body: {
          membership: { user_id: putUserId, role_ids: [await someRoleId()] },
        },
      }
    );
    assertStatus(201, createResponse);
    const putMembershipId = createResponse.data!.membership.id;

    const response = await client.PUT(
      "/memberships/{membership_id}.{format}",
      {
        params: { path: { format: "json", membership_id: putMembershipId } },
        body: { membership: { role_ids: [] } },
      }
    );
    assertStatus(422, response);

    const getResponse = await client.GET(
      "/memberships/{membership_id}.{format}",
      {
        params: { path: { format: "json", membership_id: putMembershipId } },
      }
    );
    assertStatus(404, getResponse);
  });

  test("DELETE /memberships/{membership_id}.json returns 404", async () => {
    const response = await client.DELETE(
      "/memberships/{membership_id}.{format}",
      {
        params: { path: { format: "json", membership_id: 999999 } },
      }
    );
    assertStatus(404, response);
  });

  test("inherited membership roles survive empty updates and prevent direct deletion", async () => {
    const groupMembershipResponse = await client.POST(
      "/projects/{project_id}/memberships.{format}",
      {
        params: { path: { format: "json", project_id: projectIdentifier } },
        body: {
          membership: { user_id: groupId, role_ids: [await someRoleId()] },
        },
      }
    );
    assertStatus(201, groupMembershipResponse);

    const listResponse = await client.GET("/projects/{project_id}/memberships.{format}", {
      params: { path: { format: "json", project_id: projectIdentifier } },
    });
    assertStatus(200, listResponse);
    const inheritedMembership = listResponse.data!.memberships.find(
      (membership) => membership.user?.id === groupUserId
    );
    assert(inheritedMembership, "Expected an inherited membership for the group user");

    const updated = await client.PATCH("/memberships/{membership_id}.{format}", {
      params: { path: { format: "json", membership_id: inheritedMembership.id } },
      body: { membership: { role_ids: [] } },
    });
    assertStatus(204, updated);
    const current = await client.GET("/memberships/{membership_id}.{format}", {
      params: { path: { format: "json", membership_id: inheritedMembership.id } },
    });
    assertStatus(200, current);
    assert.deepEqual(current.data!.membership.roles, inheritedMembership.roles);

    const response = await client.DELETE("/memberships/{membership_id}.{format}", {
      params: {
        path: { format: "json", membership_id: inheritedMembership.id },
      },
    });
    assertStatus(422, response);
  });

  test("PATCH updates membership roles", async () => {
    const params = { path: { format: "json" as const, membership_id: membershipId } };
    const before = await client.GET("/memberships/{membership_id}.{format}", { params });
    assertStatus(200, before);
    const roles = await client.GET("/roles.{format}", { params: { path: { format: "json" } } });
    assertStatus(200, roles);
    const alternative = roles.data!.roles.find(
      (role) => !before.data!.membership.roles.some((current) => current.id === role.id)
    );
    assert(alternative, "Expected an alternative assignable role");
    const updated = await client.PATCH("/memberships/{membership_id}.{format}", {
      params,
      body: { membership: { role_ids: [alternative.id] } },
    });
    assertStatus(204, updated);
    const current = await client.GET("/memberships/{membership_id}.{format}", { params });
    assertStatus(200, current);
    assert.deepEqual(
      current.data!.membership.roles.map((role) => role.id),
      [alternative.id]
    );
  });


  test("DELETE /memberships/{membership_id}.json", async () => {
    const response = await client.DELETE(
      "/memberships/{membership_id}.{format}",
      {
        params: {
          path: { format: "json", membership_id: membershipId },
        },
      }
    );
    assertStatus(204, response);
  });
  test("built-in group memberships use distinct principal keys and can grant anonymous permissions", async () => {
    const groups = await client.GET("/groups.{format}", {
      params: { path: { format: "json" }, query: { builtin: "1" } },
    });
    assertStatus(200, groups);
    const anonymous = createTestClient(undefined, { anonymous: true });
    const memberships: number[] = [];
    try {
      for (const builtin of ["anonymous", "non_member"]) {
        const group = groups.data!.groups.find((g) => g.builtin === builtin);
        assert(group);
        const created = await client.POST("/projects/{project_id}/memberships.{format}", {
          params: { path: { format: "json", project_id: projectId } },
          body: { membership: { user_id: group.id, role_ids: [await someRoleId()] } },
        });
        assertStatus(201, created);
        memberships.push(created.data!.membership.id);
        const key = builtin === "anonymous" ? "group_anonymous" : "group_non_member";
        assert.equal(created.data!.membership[key]?.id, group.id);
        const detail = await client.GET("/memberships/{membership_id}.{format}", {
          params: { path: { format: "json", membership_id: created.data!.membership.id } },
        });
        assertStatus(200, detail);
        assert.equal(detail.data!.membership[key]?.id, group.id);
      }
      const list = await client.GET("/projects/{project_id}/memberships.{format}", {
        params: { path: { format: "json", project_id: projectId } },
      });
      assertStatus(200, list);
      for (const id of memberships) assert(list.data!.memberships.some((m) => m.id === id));
      assertStatus(
        200,
        await anonymous.GET("/projects/{project_id}.{format}", {
          params: { path: { format: "json", project_id: projectId } },
        })
      );
      const issue = await anonymous.POST("/issues.{format}", {
        params: { path: { format: "json" } },
        body: { issue: { project_id: projectId, subject: "Anonymous permission fixture" } },
      });
      assertStatus(201, issue);
    } finally {
      await runCleanup(
        memberships.map(
          (membership_id) => async () =>
            assertStatus(
              204,
              await client.DELETE("/memberships/{membership_id}.{format}", {
                params: { path: { format: "json", membership_id } },
              })
            )
        )
      );
    }
  });

  test("membership creation accepts an array of principal IDs", async () => {
    const ids: number[] = [];
    try {
      for (const name of ["member-batch-a", "member-batch-b"]) ids.push(await createTestUser(name));
      const created = await client.POST("/projects/{project_id}/memberships.{format}", {
        params: { path: { format: "json", project_id: projectId } },
        body: { membership: { user_ids: ids, role_ids: [await someRoleId()] } },
      });
      assertStatus(201, created);
      assert.equal(created.data!.membership.user?.id, ids[0]);
      const list = await client.GET("/projects/{project_id}/memberships.{format}", {
        params: { path: { format: "json", project_id: projectId } },
      });
      assertStatus(200, list);
      for (const id of ids) assert(list.data!.memberships.some((m) => m.user?.id === id));
    } finally {
      await runCleanup(
        ids.map(
          (user_id) => async () =>
            assertStatus(
              204,
              await client.DELETE("/users/{user_id}.{format}", {
                params: { path: { format: "json", user_id } },
              })
            )
        )
      );
    }
  });


});
