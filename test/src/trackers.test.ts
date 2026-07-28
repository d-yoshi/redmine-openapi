import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { client, assertStatus } from "./helpers.js";

describe("Trackers", async () => {
  test("GET /trackers.json", async () => {
    const response = await client.GET("/trackers.{format}", {
      params: { path: { format: "json" } },
    });
    assertStatus(200, response);
    // An empty array would validate nothing about the item schema
    assert(
      response.data!.trackers.length > 0,
      "Expected at least one tracker; the item schema is otherwise unchecked"
    );
  });
});
