import { before, after, describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  client,
  assertStatus,
  createTestUser,
  runCleanup,
} from "./helpers.js";

describe("Groups", () => {
  let groupId: number;
  let userId: number;
  let extraUserId: number;

  const groupUserIds = async () => {
    const result = await client.GET("/groups/{group_id}.{format}", {
      params: { path: { format: "json", group_id: groupId }, query: { include: ["users"] } },
    });
    assertStatus(200, result);
    assert(result.data!.group.users);
    return result.data!.group.users.map((user) => user.id).sort((a, b) => a - b);
  };

  before(async () => {
    userId = await createTestUser("grpuser");
    extraUserId = await createTestUser("grpuser2");
  });

  after(async () => {
    await runCleanup([
      async () => {
        if (!groupId) return;
        const response = await client.DELETE("/groups/{group_id}.{format}", {
          params: { path: { format: "json", group_id: groupId } },
        });
        assertStatus(204, response);
      },
      ...[userId, extraUserId].map((id) => async () => {
        if (!id) return;
        const response = await client.DELETE("/users/{user_id}.{format}", {
          params: { path: { format: "json", user_id: id } },
        });
        assertStatus(204, response);
      }),
    ]);
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
    assert.deepStrictEqual(response.data!.group.users!.map((user) => user.id), [userId]);
    assert(Array.isArray(response.data!.group.memberships));
  });

  test("PUT /groups/{group_id}.json", async () => {
    const name = `test-group-updated-${Date.now()}`;
    const response = await client.PUT("/groups/{group_id}.{format}", {
      params: { path: { format: "json", group_id: groupId } },
      body: {
        group: {
          name,
          user_ids: [extraUserId],
          twofa_required: false,
          custom_fields: [],
          custom_field_values: {},
        },
      },
    });
    assertStatus(204, response);

    const readback = await client.GET("/groups/{group_id}.{format}", {
      params: { path: { format: "json", group_id: groupId }, query: { include: ["users"] } },
    });
    assertStatus(200, readback);
    assert.strictEqual(readback.data!.group.name, name);
    assert.deepStrictEqual(readback.data!.group.users!.map((user) => user.id), [extraUserId]);
  });

  test("POST /groups/{group_id}/users.json (add user)", async () => {
    const response = await client.POST(
      "/groups/{group_id}/users.{format}",
      {
        params: { path: { format: "json", group_id: groupId } },
        body: { user_id: userId },
      }
    );
    assertStatus(204, response);
    assert.deepEqual(await groupUserIds(), [userId, extraUserId].sort((a, b) => a - b));
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
    assert.deepEqual(await groupUserIds(), [extraUserId]);
  });

  test("removing an existing user who is not a group member also returns 204", async () => {
    assert(!(await groupUserIds()).includes(userId));
    const result = await client.DELETE("/groups/{group_id}/users/{user_id}.{format}", {
      params: { path: { format: "json", group_id: groupId, user_id: userId } },
    });
    assertStatus(204, result);
    assert.deepEqual(await groupUserIds(), [extraUserId]);
  });

  test("group-user creation accepts several IDs in user_ids", async () => {
    assertStatus(204, await client.DELETE("/groups/{group_id}/users/{user_id}.{format}", {
      params: { path: { format: "json", group_id: groupId, user_id: extraUserId } },
    }));
    assert.deepEqual(await groupUserIds(), []);
    const result = await client.POST("/groups/{group_id}/users.{format}", {
      params: { path: { format: "json", group_id: groupId } },
      body: { user_ids: [userId, extraUserId] },
    });
    assertStatus(204, result);
    assert.deepEqual(await groupUserIds(), [userId, extraUserId].sort((a, b) => a - b));
  });

  test("GET /groups.json", async () => {
    const response = await client.GET("/groups.{format}", {
      params: { path: { format: "json" } },
    });
    assertStatus(200, response);
    assert(
      response.data!.groups.some((group) => group.id === groupId),
      "Expected the created group in the list"
    );
    assert(response.data!.groups.every((group) => !Object.hasOwn(group, "builtin")));
  });

  test("GET /groups.json with builtin", async () => {
    const response = await client.GET("/groups.{format}", {
      params: {
        path: { format: "json" },
        query: { builtin: "1" },
      },
    });
    assertStatus(200, response);
    assert.deepStrictEqual(
      response.data!.groups.filter((group) => group.builtin).map((group) => group.builtin).sort(),
      ["anonymous", "non_member"]
    );
    assert(response.data!.groups.some((group) => group.id === groupId));
  });

  test("POST /groups/{group_id}/users.json returns 422 for a user already in the group", async () => {
    assertStatus(204, await client.DELETE("/groups/{group_id}/users/{user_id}.{format}", {
      params: { path: { format: "json", group_id: groupId, user_id: userId } },
    }));
    assert(!(await groupUserIds()).includes(userId));
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
      response.data!.user.groups!.some((group) => group.id === groupId),
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

  test("PATCH updates a group", async () => {
    const params = { path: { format: "json" as const, group_id: groupId } };
    const updated = await client.PATCH("/groups/{group_id}.{format}", {
      params,
      body: { group: { name: "Group via PATCH" } },
    });
    assertStatus(204, updated);
    const current = await client.GET("/groups/{group_id}.{format}", { params });
    assertStatus(200, current);
    assert.equal(current.data!.group.name, "Group via PATCH");
  });

  test("DELETE /groups/{group_id}.json", async () => {
    const response = await client.DELETE("/groups/{group_id}.{format}", {
      params: { path: { format: "json", group_id: groupId } },
    });
    assertStatus(204, response);
    groupId = 0;
  });
});
