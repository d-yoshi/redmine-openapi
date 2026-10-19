import { before, describe, test } from "node:test";
import assert from "node:assert/strict";

import { client, assertStatus, someRoleId } from "./helpers.js";

describe("Roles", () => {
  let roleId: number;

  before(async () => {
    roleId = await someRoleId();
  });

  test("GET /roles.json", async () => {
    const response = await client.GET("/roles.{format}", {
      params: { path: { format: "json" } },
    });
    assertStatus(200, response);
    assert(response.data!.roles.some((role) => role.id === roleId));
  });

  test("GET /roles/{role_id}.json", async () => {
    const response = await client.GET("/roles/{role_id}.{format}", {
      params: { path: { format: "json", role_id: roleId } },
    });
    assertStatus(200, response);
  });

  test("GET /roles/{role_id}.json returns 404", async () => {
    const response = await client.GET("/roles/{role_id}.{format}", {
      params: { path: { format: "json", role_id: 999999 } },
    });
    assertStatus(404, response);
  });
});
