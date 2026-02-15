import { describe, test } from "node:test";

import { client, assertStatus } from "./helpers.js";

describe("Custom Fields", async () => {
  test("GET /custom_fields.json", async () => {
    const response = await client.GET("/custom_fields.{format}", {
      params: { path: { format: "json" } },
    });
    assertStatus(200, response);
  });
});
