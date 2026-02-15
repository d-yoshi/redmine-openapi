import { describe, test } from "node:test";

import { client, assertStatus } from "./helpers.js";

describe("Queries", async () => {
  test("GET /queries.json", async () => {
    const response = await client.GET("/queries.{format}", {
      params: { path: { format: "json" } },
    });
    assertStatus(200, response);
  });
});
