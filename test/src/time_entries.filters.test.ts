import { before, after, describe, test } from "node:test";
import assert from "node:assert/strict";

import { client, assertStatus } from "./helpers.js";

describe("Time entry date filter representations", () => {
  let projectId: number;
  const entryIds: number[] = [];

  before(async () => {
    const name = `time-filters-${Date.now()}`;
    const project = await client.POST("/projects.{format}", {
      params: { path: { format: "json" } },
      body: { project: { name, identifier: name, enabled_module_names: ["time_tracking"] } },
    });
    assertStatus(201, project);
    projectId = project.data!.project.id;

    const activities = await client.GET("/enumerations/time_entry_activities.{format}", {
      params: { path: { format: "json" } },
    });
    assertStatus(200, activities);
    const activity = activities.data!.time_entry_activities[0];
    assert(activity, "Expected at least one time entry activity");

    for (const spentOn of ["2024-01-01", "2024-01-02", "2024-01-03", "2024-01-04"]) {
      const response = await client.POST("/time_entries.{format}", {
        params: { path: { format: "json" } },
        body: {
          time_entry: {
            project_id: projectId,
            spent_on: spentOn,
            hours: 1,
            activity_id: activity.id,
          },
        },
      });
      assertStatus(201, response);
      entryIds.push(response.data!.time_entry.id);
    }
  });

  after(async () => {
    if (!projectId) return;
    const response = await client.DELETE("/projects/{project_id}.{format}", {
      params: { path: { format: "json", project_id: projectId } },
    });
    assertStatus(204, response);
  });

  const cases = [
    {
      name: "unfiltered control",
      query: {},
      expected: () => entryIds,
    },
    {
      name: "from includes its lower bound",
      query: { from: "2024-01-02" },
      expected: () => entryIds.slice(1),
    },
    {
      name: "to includes its upper bound",
      query: { to: "2024-01-03" },
      expected: () => entryIds.slice(0, 3),
    },
    {
      name: "from and to include both bounds",
      query: { from: "2024-01-02", to: "2024-01-03" },
      expected: () => entryIds.slice(1, 3),
    },
  ];

  for (const scoped of [false, true]) {
    for (const example of cases) {
      test(`${scoped ? "Project-scoped" : "Global"} time entries: ${example.name}`, async () => {
        const query = { sort: "spent_on:asc", ...example.query };
        const response = scoped
          ? await client.GET("/projects/{project_id}/time_entries.{format}", {
              params: { path: { format: "json", project_id: projectId }, query },
            })
          : await client.GET("/time_entries.{format}", {
              params: { path: { format: "json" }, query: { ...query, project_id: String(projectId) } },
            });
        assertStatus(200, response);
        assert.deepStrictEqual(
          response.data!.time_entries.map((entry) => entry.id),
          example.expected()
        );
      });
    }
  }
});
