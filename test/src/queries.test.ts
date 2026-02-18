import { describe, test } from "node:test";

import { client, assertStatus } from "./helpers.js";

describe("Queries", async () => {
  test("GET /queries.json with pagination", async () => {
    const response = await client.GET("/queries.{format}", {
      params: {
        path: { format: "json" },
        query: { offset: 0, limit: 25 },
      },
    });
    assertStatus(200, response);
  });
});
