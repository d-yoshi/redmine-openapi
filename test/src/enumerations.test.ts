import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { client, assertStatus } from "./helpers.js";

describe("Enumerations", async () => {
  test("GET /enumerations/issue_priorities.json", async () => {
    const response = await client.GET(
      "/enumerations/issue_priorities.{format}",
      {
        params: { path: { format: "json" } },
      }
    );
    assertStatus(200, response);
    // An empty array would validate nothing about the item schema
    assert(
      response.data!.issue_priorities.length > 0,
      "Expected at least one issue priority"
    );
  });

  test("GET /enumerations/time_entry_activities.json", async () => {
    const response = await client.GET(
      "/enumerations/time_entry_activities.{format}",
      {
        params: { path: { format: "json" } },
      }
    );
    assertStatus(200, response);
    assert(
      response.data!.time_entry_activities.length > 0,
      "Expected at least one time entry activity"
    );
  });

  test("GET /enumerations/document_categories.json", async () => {
    const response = await client.GET(
      "/enumerations/document_categories.{format}",
      {
        params: { path: { format: "json" } },
      }
    );
    assertStatus(200, response);
    // The seeded category guarantees the item schema is exercised
    assert(
      response.data!.document_categories.length > 0,
      "Expected at least one document category"
    );
  });
});
