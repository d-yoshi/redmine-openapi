import { test } from "node:test";

import { client, assertStatus } from "./helpers.js";

test("Groups", async (t) => {
  const userResponse = await client.POST("/users.{format}", {
    params: { path: { format: "json" } },
    body: {
      user: {
        login: `grpuser-${Date.now()}`,
        firstname: "Group",
        lastname: "User",
        mail: `grpuser-${Date.now()}@example.com`,
        password: "password123!",
      },
    },
  });
  assertStatus(201, userResponse);
  const userId = userResponse.data!.user.id;

  let groupId: number;

  await t.test("POST /groups.json", async () => {
    const response = await client.POST("/groups.{format}", {
      params: { path: { format: "json" } },
      body: {
        group: {
          name: `test-group-${Date.now()}`,
          user_ids: [userId],
        },
      },
    });
    assertStatus(201, response);
    groupId = response.data!.group.id;
  });

  await t.test("GET /groups/{group_id}.json with include=users,memberships", async () => {
    const response = await client.GET("/groups/{group_id}.{format}", {
      params: {
        path: { format: "json", group_id: groupId },
        query: { include: ["users", "memberships"] },
      },
    });
    assertStatus(200, response);
  });

  await t.test("PUT /groups/{group_id}.json", async () => {
    const response = await client.PUT("/groups/{group_id}.{format}", {
      params: { path: { format: "json", group_id: groupId } },
      body: {
        group: {
          name: `test-group-updated-${Date.now()}`,
        },
      },
    });
    assertStatus(204, response);
  });

  await t.test("POST /groups/{group_id}/users.json (add user)", async () => {
    const newUserResponse = await client.POST("/users.{format}", {
      params: { path: { format: "json" } },
      body: {
        user: {
          login: `grpuser2-${Date.now()}`,
          firstname: "Group2",
          lastname: "User2",
          mail: `grpuser2-${Date.now()}@example.com`,
          password: "password123!",
        },
      },
    });
    assertStatus(201, newUserResponse);
    const newUserId = newUserResponse.data!.user.id;

    const response = await client.POST(
      "/groups/{group_id}/users.{format}",
      {
        params: { path: { format: "json", group_id: groupId } },
        body: { user_id: newUserId },
      }
    );
    assertStatus(204, response);

    await client.DELETE("/users/{user_id}.{format}", {
      params: { path: { format: "json", user_id: newUserId } },
    });
  });

  await t.test("DELETE /groups/{group_id}/users/{user_id}.json (remove user)", async () => {
    const response = await client.DELETE(
      "/groups/{group_id}/users/{user_id}.{format}",
      {
        params: {
          path: { format: "json", group_id: groupId, user_id: userId },
        },
      }
    );
    assertStatus(204, response);
  });

  await t.test("GET /groups.json", async () => {
    const response = await client.GET("/groups.{format}", {
      params: { path: { format: "json" } },
    });
    assertStatus(200, response);
  });

  await t.test("DELETE /groups/{group_id}.json", async () => {
    const response = await client.DELETE("/groups/{group_id}.{format}", {
      params: { path: { format: "json", group_id: groupId } },
    });
    assertStatus(204, response);
    groupId = 0;
  });

  if (groupId) {
    await client.DELETE("/groups/{group_id}.{format}", {
      params: { path: { format: "json", group_id: groupId } },
    });
  }
  await client.DELETE("/users/{user_id}.{format}", {
    params: { path: { format: "json", user_id: userId } },
  });
});
