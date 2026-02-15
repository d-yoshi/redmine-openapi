import { describe, test } from "node:test";

import { client, assertStatus } from "./helpers.js";

describe("Trackers", async () => {
  test("GET /trackers.json", async () => {
    const response = await client.GET("/trackers.{format}", {
      params: { path: { format: "json" } },
    });
    assertStatus(200, response);
  });
});
