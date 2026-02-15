import { test } from "node:test";

import { client, assertStatus } from "./helpers.js";

test("Memberships", async (t) => {
  const projectIdentifier = `mem-${Date.now()}`;
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
  const projectId = projectResponse.data!.project.id;

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
  const userId = userResponse.data!.user.id;

  let membershipId: number;

  await t.test("POST /projects/{project_id}/memberships.json", async () => {
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

  await t.test("GET /memberships/{membership_id}.json", async () => {
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

  await t.test("PUT /memberships/{membership_id}.json", async () => {
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

  await t.test("GET /projects/{project_id}/memberships.json", async () => {
    const response = await client.GET(
      "/projects/{project_id}/memberships.{format}",
      {
        params: {
          path: { format: "json", project_id: projectIdentifier },
        },
      }
    );
    assertStatus(200, response);
  });

  await t.test("DELETE /memberships/{membership_id}.json", async () => {
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

  await client.DELETE("/projects/{project_id}.{format}", {
    params: { path: { format: "json", project_id: projectId } },
  });
  await client.DELETE("/users/{user_id}.{format}", {
    params: { path: { format: "json", user_id: userId } },
  });
});
