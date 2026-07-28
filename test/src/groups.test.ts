import { before, after, describe, test } from "node:test";
import assert from "node:assert/strict";

import { client, assertStatus, createTestUser, runCleanup } from "./helpers.js";

describe("Groups", () => {
  let groupId: number;
  // Global: not reclaimed by deleting the group, so the hooks own them —
  // creating them inside a test leaks them when a later assertion there fails.
  let userId: number;
  let extraUserId: number;
  let bulkUserIds: number[] = [];

  before(async () => {
    userId = await createTestUser("grpuser");
    extraUserId = await createTestUser("grpuser2");
    // One push per await: assigning after both would leak the first user's id
    // when the second creation fails
    bulkUserIds.push(await createTestUser("grpbulk1"));
    bulkUserIds.push(await createTestUser("grpbulk2"));
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
      ...[userId, extraUserId, ...bulkUserIds].map((id) => async () => {
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
    const response = await client.POST(
      "/groups/{group_id}/users.{format}",
      {
        params: { path: { format: "json", group_id: groupId } },
        body: { user_id: extraUserId },
      }
    );
    assertStatus(204, response);
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
  // array; the client's global serializer would join values with commas. Other
  // keys pass through, so adding a query parameter here cannot silently drop it.
  const repeatArraysSerializer = (query: Record<string, unknown>) =>
    Object.entries(query)
      .flatMap(([key, value]) =>
        Array.isArray(value)
          ? value.map((item) => `${key}=${item}`)
          : [`${key}=${value}`]
      )
      .join("&");

  const groupUserIds = async () => {
    const response = await client.GET("/groups/{group_id}.{format}", {
      params: {
        path: { format: "json", group_id: groupId },
        query: { include: ["users"] },
      },
    });
    assertStatus(200, response);
    const users = response.data!.group.users;
    assert(users, "Expected include=users to return a users array");
    return users.map((user) => user.id);
  };

  test("DELETE /groups/{group_id}/users.json (bulk remove)", async () => {
    for (const id of bulkUserIds) {
      const addResponse = await client.POST("/groups/{group_id}/users.{format}", {
        params: { path: { format: "json", group_id: groupId } },
        body: { user_id: id },
      });
      assertStatus(204, addResponse);
    }
    const membersBefore = await groupUserIds();
    for (const id of bulkUserIds) {
      assert(
        membersBefore.includes(id),
        `Expected user ${id} to be a member first`
      );
    }

    const response = await client.DELETE("/groups/{group_id}/users.{format}", {
      params: {
        path: { format: "json", group_id: groupId },
        query: { "user_ids[]": bulkUserIds },
      },
      querySerializer: repeatArraysSerializer,
    });
    assertStatus(204, response);

    const remaining = await groupUserIds();
    for (const id of bulkUserIds) {
      assert(
        !remaining.includes(id),
        `Expected user ${id} to be removed from the group`
      );
    }
    // Otherwise "the listed ids are gone" would also hold for a request that
    // emptied the group
    assert(
      remaining.includes(extraUserId),
      "Expected the unlisted member to remain in the group"
    );
  });

  test("DELETE /groups/{group_id}/users.json returns 404 when no given user is a member", async () => {
    // A missing group produces the same 404, so confirm the group exists first;
    // otherwise this test passes even when the group was never created
    const groupResponse = await client.GET("/groups/{group_id}.{format}", {
      params: { path: { format: "json", group_id: groupId } },
    });
    assertStatus(200, groupResponse);

    const response = await client.DELETE("/groups/{group_id}/users.{format}", {
      params: {
        path: { format: "json", group_id: groupId },
        query: { "user_ids[]": [999999] },
      },
      querySerializer: repeatArraysSerializer,
    });
    assertStatus(404, response);
  });

  test("DELETE /groups/{group_id}/users.json returns 404 for nonexistent group", async () => {
    const response = await client.DELETE("/groups/{group_id}/users.{format}", {
      params: {
        path: { format: "json", group_id: 999999 },
        query: { "user_ids[]": [userId] },
      },
      querySerializer: repeatArraysSerializer,
    });
    assertStatus(404, response);
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

  test("DELETE /groups/{group_id}.json", async () => {
    const response = await client.DELETE("/groups/{group_id}.{format}", {
      params: { path: { format: "json", group_id: groupId } },
    });
    assertStatus(204, response);
    groupId = 0;
  });
});
