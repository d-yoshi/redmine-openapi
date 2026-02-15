import { describe, test } from "node:test";

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
  });

  test("GET /enumerations/time_entry_activities.json", async () => {
    const response = await client.GET(
      "/enumerations/time_entry_activities.{format}",
      {
        params: { path: { format: "json" } },
      }
    );
    assertStatus(200, response);
  });

  test("GET /enumerations/document_categories.json", async () => {
    const response = await client.GET(
      "/enumerations/document_categories.{format}",
      {
        params: { path: { format: "json" } },
      }
    );
    assertStatus(200, response);
  });
});
