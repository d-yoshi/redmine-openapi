import { describe, test } from "node:test";
import assert from "node:assert/strict";

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
    // The seeded query guarantees the query item schema is exercised
    assert(
      response.data!.queries.some((q) => q.name === "Seed Query"),
      "Expected seeded query 'Seed Query' in the list"
    );
  });
});
