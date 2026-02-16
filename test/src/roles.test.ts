import { test } from "node:test";

import { client, assertStatus } from "./helpers.js";

test("Roles", async (t) => {
  let roleId: number;

  await t.test("GET /roles.json", async () => {
    const response = await client.GET("/roles.{format}", {
      params: { path: { format: "json" } },
    });
    assertStatus(200, response);
    roleId = response.data!.roles[0].id;
  });

  await t.test("GET /roles/{role_id}.json", async () => {
    const response = await client.GET("/roles/{role_id}.{format}", {
      params: { path: { format: "json", role_id: roleId } },
    });
    assertStatus(200, response);
  });

  await t.test("GET /roles/{role_id}.json returns 404", async () => {
    const response = await client.GET("/roles/{role_id}.{format}", {
      params: { path: { format: "json", role_id: 999999 } },
    });
    assertStatus(404, response);
  });
});
