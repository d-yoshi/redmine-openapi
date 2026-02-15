import { describe, test } from "node:test";

import { client, assertStatus } from "./helpers.js";

describe("Issue Statuses", async () => {
  test("GET /issue_statuses.json", async () => {
    const response = await client.GET("/issue_statuses.{format}", {
      params: { path: { format: "json" } },
    });
    assertStatus(200, response);
  });
});
