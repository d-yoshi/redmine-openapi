import { before, after, describe, test } from "node:test";
import assert from "node:assert/strict";

import { client, assertStatus } from "./helpers.js";

describe("Groups", () => {
  let userId: number;
  let groupId: number;

  before(async () => {
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
    userId = userResponse.data!.user.id;
  });

  after(async () => {
    if (groupId) {
      await client.DELETE("/groups/{group_id}.{format}", {
        params: { path: { format: "json", group_id: groupId } },
      });
    }
    if (userId) {
      await client.DELETE("/users/{user_id}.{format}", {
        params: { path: { format: "json", user_id: userId } },
      });
    }
  });

  test("POST /groups.json", async () => {
    const response = await client.POST("/groups.{format}", {
      params: { path: { format: "json" } },
      body: {
        group: {
          name: `test-group-${Date.now()}`,
          user_ids: [userId],
          twofa_required: false,
          custom_fields: [],
          custom_field_values: {},
        },
      },
    });
    assertStatus(201, response);
    groupId = response.data!.group.id;
  });

  test("GET /groups/{group_id}.json with include=users,memberships", async () => {
    const response = await client.GET("/groups/{group_id}.{format}", {
      params: {
        path: { format: "json", group_id: groupId },
        query: { include: ["users", "memberships"] },
      },
    });
    assertStatus(200, response);
  });

  test("PUT /groups/{group_id}.json", async () => {
    const response = await client.PUT("/groups/{group_id}.{format}", {
      params: { path: { format: "json", group_id: groupId } },
      body: {
        group: {
          name: `test-group-updated-${Date.now()}`,
          user_ids: [userId],
          twofa_required: false,
          custom_fields: [],
          custom_field_values: {},
        },
      },
    });
    assertStatus(204, response);
  });

  test("POST /groups/{group_id}/users.json (add user)", async () => {
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

  test("DELETE /groups/{group_id}/users/{user_id}.json (remove user)", async () => {
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

  // Rails only parses repeated bracketed keys (user_ids[]=1&user_ids[]=2) as an
  // array; the client's global serializer would join values with commas
  const userIdsSerializer = (q: Record<string, unknown>) =>
    (q["user_ids[]"] as number[]).map((id) => `user_ids[]=${id}`).join("&");

  test("DELETE /groups/{group_id}/users.json (bulk remove)", async () => {
    const ids: number[] = [];
    for (const n of [1, 2]) {
      const userResponse = await client.POST("/users.{format}", {
        params: { path: { format: "json" } },
        body: {
          user: {
            login: `grpbulk${n}-${Date.now()}`,
            firstname: `Bulk${n}`,
            lastname: "User",
            mail: `grpbulk${n}-${Date.now()}@example.com`,
            password: "password123!",
          },
        },
      });
      assertStatus(201, userResponse);
      ids.push(userResponse.data!.user.id);
    }
    for (const id of ids) {
      const addResponse = await client.POST("/groups/{group_id}/users.{format}", {
        params: { path: { format: "json", group_id: groupId } },
        body: { user_id: id },
      });
      assertStatus(204, addResponse);
    }

    const response = await client.DELETE("/groups/{group_id}/users.{format}", {
      params: {
        path: { format: "json", group_id: groupId },
        query: { "user_ids[]": ids },
      },
      querySerializer: userIdsSerializer,
    });
    assertStatus(204, response);

    const groupResponse = await client.GET("/groups/{group_id}.{format}", {
      params: {
        path: { format: "json", group_id: groupId },
        query: { include: ["users"] },
      },
    });
    assertStatus(200, groupResponse);
    const remaining = (groupResponse.data!.group.users ?? []).map((u) => u.id);
    for (const id of ids) {
      assert(
        !remaining.includes(id),
        `Expected user ${id} to be removed from the group`
      );
    }

    for (const id of ids) {
      await client.DELETE("/users/{user_id}.{format}", {
        params: { path: { format: "json", user_id: id } },
      });
    }
  });

  test("DELETE /groups/{group_id}/users.json returns 404 when no given user is a member", async () => {
    const response = await client.DELETE("/groups/{group_id}/users.{format}", {
      params: {
        path: { format: "json", group_id: groupId },
        query: { "user_ids[]": [999999] },
      },
      querySerializer: userIdsSerializer,
    });
    assertStatus(404, response);
  });

  test("DELETE /groups/{group_id}/users.json returns 404 for nonexistent group", async () => {
    const response = await client.DELETE("/groups/{group_id}/users.{format}", {
      params: {
        path: { format: "json", group_id: 999999 },
        query: { "user_ids[]": [userId] },
      },
      querySerializer: userIdsSerializer,
    });
    assertStatus(404, response);
  });

  test("GET /groups.json", async () => {
    const response = await client.GET("/groups.{format}", {
      params: { path: { format: "json" } },
    });
    assertStatus(200, response);
  });

  test("GET /groups.json with builtin", async () => {
    const response = await client.GET("/groups.{format}", {
      params: {
        path: { format: "json" },
        query: { builtin: "1" },
      },
    });
    assertStatus(200, response);
  });

  test("POST /groups/{group_id}/users.json returns 422 for a user already in the group", async () => {
    const firstResponse = await client.POST("/groups/{group_id}/users.{format}", {
      params: { path: { format: "json", group_id: groupId } },
      body: { user_id: userId },
    });
    assertStatus(204, firstResponse);

    const response = await client.POST("/groups/{group_id}/users.{format}", {
      params: { path: { format: "json", group_id: groupId } },
      body: { user_id: userId },
    });
    assertStatus(422, response);
  });

  test("GET /users/{user_id}.json with include=groups returns the group", async () => {
    const response = await client.GET("/users/{user_id}.{format}", {
      params: {
        path: { format: "json", user_id: userId },
        query: { include: ["groups"] },
      },
    });
    assertStatus(200, response);
    assert(
      response.data!.user.groups!.some((g) => g.id === groupId),
      "Expected the user to belong to the group"
    );
  });

  test("POST /groups.json returns 422 for invalid data", async () => {
    const response = await client.POST("/groups.{format}", {
      params: { path: { format: "json" } },
      body: { group: { name: "" } },
    });
    assertStatus(422, response);
  });

  test("GET /groups/{group_id}.json returns 404", async () => {
    const response = await client.GET("/groups/{group_id}.{format}", {
      params: { path: { format: "json", group_id: 999999 } },
    });
    assertStatus(404, response);
  });

  test("PUT /groups/{group_id}.json returns 404", async () => {
    const response = await client.PUT("/groups/{group_id}.{format}", {
      params: { path: { format: "json", group_id: 999999 } },
      body: { group: { name: "missing" } },
    });
    assertStatus(404, response);
  });

  test("PUT /groups/{group_id}.json returns 422 for invalid data", async () => {
    const response = await client.PUT("/groups/{group_id}.{format}", {
      params: { path: { format: "json", group_id: groupId } },
      body: { group: { name: "" } },
    });
    assertStatus(422, response);
  });

  test("DELETE /groups/{group_id}.json returns 404", async () => {
    const response = await client.DELETE("/groups/{group_id}.{format}", {
      params: { path: { format: "json", group_id: 999999 } },
    });
    assertStatus(404, response);
  });

  test("POST /groups/{group_id}/users.json returns 404 for nonexistent group", async () => {
    const response = await client.POST("/groups/{group_id}/users.{format}", {
      params: { path: { format: "json", group_id: 999999 } },
      body: { user_id: userId },
    });
    assertStatus(404, response);
  });

  test("DELETE /groups/{group_id}/users/{user_id}.json returns 404 for nonexistent group", async () => {
    const response = await client.DELETE(
      "/groups/{group_id}/users/{user_id}.{format}",
      {
        params: { path: { format: "json", group_id: 999999, user_id: userId } },
      }
    );
    assertStatus(404, response);
  });

  test("DELETE /groups/{group_id}.json", async () => {
    const response = await client.DELETE("/groups/{group_id}.{format}", {
      params: { path: { format: "json", group_id: groupId } },
    });
    assertStatus(204, response);
    groupId = 0;
  });
});
