import { before, after, describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  client,
  assertStatus,
  createTestUser,
  runCleanup,
  someRoleId,
} from "./helpers.js";

describe("Memberships", () => {
  const projectIdentifier = `mem-${Date.now()}`;
  let projectId: number;
  let membershipId: number;
  // Global: not reclaimed by deleting the project, so the hooks own them —
  // creating them inside a test leaks them when an assertion there fails first.
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
    // Re-sending the role it already has would return 204 even if Redmine
    // ignored role_ids entirely, so a different role is assigned and read back.
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
    // role_ids= saves the association immediately, and MemberRole's
    // after_destroy removes a member left without roles — the request
    // returns 422 but the membership is gone afterwards. Use a dedicated
    // membership so the main flow is unaffected.
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

  test("DELETE /memberships/{membership_id}.json returns 422 when not deletable", async () => {
    // A membership inherited from a group membership cannot be deleted
    // directly; Redmine responds 422 with an empty body
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

    const listResponse = await client.GET(
      "/projects/{project_id}/memberships.{format}",
      {
        params: { path: { format: "json", project_id: projectIdentifier } },
      }
    );
    assertStatus(200, listResponse);
    const inheritedMembership = listResponse.data!.memberships.find(
      (membership) => membership.user?.id === groupUserId
    );
    assert(
      inheritedMembership,
      "Expected an inherited membership for the group user"
    );

    const response = await client.DELETE(
      "/memberships/{membership_id}.{format}",
      {
        params: {
          path: { format: "json", membership_id: inheritedMembership.id },
        },
      }
    );
    assertStatus(422, response);
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
});
