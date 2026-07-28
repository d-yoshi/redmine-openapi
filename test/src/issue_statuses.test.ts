import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { client, assertStatus } from "./helpers.js";

describe("Issue Statuses", async () => {
  test("GET /issue_statuses.json", async () => {
    const response = await client.GET("/issue_statuses.{format}", {
      params: { path: { format: "json" } },
    });
    assertStatus(200, response);
    // An empty array would validate nothing about the item schema
    assert(
      response.data!.issue_statuses.length > 0,
      "Expected at least one issue status; the item schema is otherwise unchecked"
    );
  });
});
