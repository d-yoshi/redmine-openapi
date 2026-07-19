import { before, after, describe, test } from "node:test";
import assert from "node:assert/strict";

import { client, assertStatus } from "./helpers.js";

describe("Memberships", () => {
  const projectIdentifier = `mem-${Date.now()}`;
  let projectId: number;
  let userId: number;
  let membershipId: number;

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

    const userResponse = await client.POST("/users.{format}", {
      params: { path: { format: "json" } },
      body: {
        user: {
          login: `memuser-${Date.now()}`,
          firstname: "Member",
          lastname: "User",
          mail: `memuser-${Date.now()}@example.com`,
          password: "password123!",
        },
      },
    });
    assertStatus(201, userResponse);
    userId = userResponse.data!.user.id;
  });

  after(async () => {
    if (projectId) {
      await client.DELETE("/projects/{project_id}.{format}", {
        params: { path: { format: "json", project_id: projectId } },
      });
    }
    if (userId) {
      await client.DELETE("/users/{user_id}.{format}", {
        params: { path: { format: "json", user_id: userId } },
      });
    }
  });

  test("POST /projects/{project_id}/memberships.json", async () => {
    const rolesResponse = await client.GET("/roles.{format}", {
      params: { path: { format: "json" } },
    });
    assertStatus(200, rolesResponse);
    const roleId = rolesResponse.data!.roles[0].id;

    const response = await client.POST(
      "/projects/{project_id}/memberships.{format}",
      {
        params: {
          path: { format: "json", project_id: projectIdentifier },
        },
        body: {
          membership: {
            user_id: userId,
            role_ids: [roleId],
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
    const roleId = rolesResponse.data!.roles[0].id;

    const response = await client.PUT(
      "/memberships/{membership_id}.{format}",
      {
        params: {
          path: { format: "json", membership_id: membershipId },
        },
        body: {
          membership: {
            role_ids: [roleId],
          },
        },
      }
    );
    assertStatus(204, response);
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
        body: { membership: { user_id: userId, role_ids: [1] } },
      }
    );
    assertStatus(404, response);
  });

  test("POST /projects/{project_id}/memberships.json returns 422 for invalid data", async () => {
    const userResponse = await client.POST("/users.{format}", {
      params: { path: { format: "json" } },
      body: {
        user: {
          login: `memuser2-${Date.now()}`,
          firstname: "Member2",
          lastname: "User2",
          mail: `memuser2-${Date.now()}@example.com`,
          password: "password123!",
        },
      },
    });
    assertStatus(201, userResponse);
    const roleLessUserId = userResponse.data!.user.id;

    const response = await client.POST(
      "/projects/{project_id}/memberships.{format}",
      {
        params: { path: { format: "json", project_id: projectIdentifier } },
        body: { membership: { user_id: roleLessUserId, role_ids: [] } },
      }
    );
    assertStatus(422, response);

    await client.DELETE("/users/{user_id}.{format}", {
      params: { path: { format: "json", user_id: roleLessUserId } },
    });
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
        body: { membership: { role_ids: [1] } },
      }
    );
    assertStatus(404, response);
  });

  test("PUT /memberships/{membership_id}.json returns 422 for empty role_ids and destroys the membership", async () => {
    // role_ids= saves the association immediately, and MemberRole's
    // after_destroy removes a member left without roles — the request
    // returns 422 but the membership is gone afterwards. Use a dedicated
    // membership so the main flow is unaffected.
    const ts = Date.now();
    const userResponse = await client.POST("/users.{format}", {
      params: { path: { format: "json" } },
      body: {
        user: {
          login: `memputuser-${ts}`,
          firstname: "Put",
          lastname: "User",
          mail: `memputuser-${ts}@example.com`,
          password: "password123!",
        },
      },
    });
    assertStatus(201, userResponse);
    const putUserId = userResponse.data!.user.id;

    const rolesResponse = await client.GET("/roles.{format}", {
      params: { path: { format: "json" } },
    });
    assertStatus(200, rolesResponse);
    const roleId = rolesResponse.data!.roles[0].id;

    const createResponse = await client.POST(
      "/projects/{project_id}/memberships.{format}",
      {
        params: { path: { format: "json", project_id: projectIdentifier } },
        body: { membership: { user_id: putUserId, role_ids: [roleId] } },
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

    await client.DELETE("/users/{user_id}.{format}", {
      params: { path: { format: "json", user_id: putUserId } },
    });
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
    const ts = Date.now();
    const groupUserResponse = await client.POST("/users.{format}", {
      params: { path: { format: "json" } },
      body: {
        user: {
          login: `memgrpuser-${ts}`,
          firstname: "GroupMember",
          lastname: "User",
          mail: `memgrpuser-${ts}@example.com`,
          password: "password123!",
        },
      },
    });
    assertStatus(201, groupUserResponse);
    const groupUserId = groupUserResponse.data!.user.id;

    const groupResponse = await client.POST("/groups.{format}", {
      params: { path: { format: "json" } },
      body: { group: { name: `mem-group-${ts}`, user_ids: [groupUserId] } },
    });
    assertStatus(201, groupResponse);
    const groupId = groupResponse.data!.group.id;

    const rolesResponse = await client.GET("/roles.{format}", {
      params: { path: { format: "json" } },
    });
    assertStatus(200, rolesResponse);
    const roleId = rolesResponse.data!.roles[0].id;

    const groupMembershipResponse = await client.POST(
      "/projects/{project_id}/memberships.{format}",
      {
        params: { path: { format: "json", project_id: projectIdentifier } },
        body: { membership: { user_id: groupId, role_ids: [roleId] } },
      }
    );
    assertStatus(201, groupMembershipResponse);
    const groupMembershipId = groupMembershipResponse.data!.membership.id;

    const listResponse = await client.GET(
      "/projects/{project_id}/memberships.{format}",
      {
        params: { path: { format: "json", project_id: projectIdentifier } },
      }
    );
    assertStatus(200, listResponse);
    const inheritedMembership = listResponse.data!.memberships.find(
      (m) => m.user?.id === groupUserId
    );
    assert(
      inheritedMembership,
      "Expected an inherited membership for the group user"
    );

    const response = await client.DELETE(
      "/memberships/{membership_id}.{format}",
      {
        params: {
          path: { format: "json", membership_id: inheritedMembership!.id },
        },
      }
    );
    assertStatus(422, response);

    await client.DELETE("/memberships/{membership_id}.{format}", {
      params: { path: { format: "json", membership_id: groupMembershipId } },
    });
    await client.DELETE("/groups/{group_id}.{format}", {
      params: { path: { format: "json", group_id: groupId } },
    });
    await client.DELETE("/users/{user_id}.{format}", {
      params: { path: { format: "json", user_id: groupUserId } },
    });
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
