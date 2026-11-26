import { before, after, describe, test } from "node:test";
import assert from "node:assert/strict";

import { client, assertStatus } from "./helpers.js";

describe("Time entry filter representations", () => {
  const fixtureName = `time-filters-${Date.now()}`;
  let projectId: number;
  let activityId: number;
  const entryIds: number[] = [];

  before(async () => {
    const project = await client.POST("/projects.{format}", {
      params: { path: { format: "json" } },
      body: {
        project: {
          name: fixtureName,
          identifier: fixtureName,
          enabled_module_names: ["time_tracking", "issue_tracking"],
        },
      },
    });
    assertStatus(201, project);
    projectId = project.data!.project.id;

    const activities = await client.GET("/enumerations/time_entry_activities.{format}", {
      params: { path: { format: "json" } },
    });
    assertStatus(200, activities);
    const activity = activities.data!.time_entry_activities[0];
    assert(activity, "Expected at least one time entry activity");
    activityId = activity.id;

    for (const [index, spentOn] of ["2024-01-01", "2024-01-02", "2024-01-03", "2024-01-04"].entries()) {
      const response = await client.POST("/time_entries.{format}", {
        params: { path: { format: "json" } },
        body: {
          time_entry: {
            project_id: projectId,
            spent_on: spentOn,
            hours: index + 0.5,
            comments: fixtureName,
            activity_id: activityId,
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
    {
      name: "hours=1.5 matches decimal hours",
      query: { hours: "1.5" },
      expected: () => entryIds.slice(1, 2),
    },
    {
      name: "hours=><1.5|2.5 includes both bounds",
      query: { hours: "><1.5|2.5" },
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

  test("Time entry category and subproject filters depend on project context", async () => {
    const format = "json";
    const scopedPath = { format, project_id: projectId } as const;
    const childName = "time-filters-child-" + projectId;
    const child = await client.POST("/projects.{format}", {
      params: { path: { format } },
      body: {
        project: {
          name: childName,
          identifier: childName,
          parent_id: projectId,
          enabled_module_names: ["time_tracking"],
        },
      },
    });
    assertStatus(201, child);
    const childProjectId = child.data!.project.id;

    const category = await client.POST("/projects/{project_id}/issue_categories.{format}", {
      params: { path: scopedPath },
      body: { issue_category: { name: "Time entry category" } },
    });
    assertStatus(201, category);
    const categoryId = category.data!.issue_category.id;

    const issue = await client.POST("/issues.{format}", {
      params: { path: { format } },
      body: { issue: { project_id: projectId, subject: "Categorized issue", category_id: categoryId } },
    });
    assertStatus(201, issue);

    const createEntry = async (project: number, spentOn: string, issueId?: number) => {
      const response = await client.POST("/time_entries.{format}", {
        params: { path: { format } },
        body: {
          time_entry: {
            project_id: project,
            issue_id: issueId,
            spent_on: spentOn,
            activity_id: activityId,
            hours: 1,
            comments: fixtureName,
          },
        },
      });
      assertStatus(201, response);
      return response.data!.time_entry.id;
    };

    const categorizedEntry = await createEntry(projectId, "2024-02-01", issue.data!.issue.id);
    const childEntry = await createEntry(childProjectId, "2024-02-02");
    const baseQuery = { comments: fixtureName, sort: "spent_on:asc" };

    const projectEntries = [...entryIds, categorizedEntry];
    const unfiltered = [...projectEntries, childEntry];
    for (const [filter, expected] of [
      [{}, unfiltered],
      [{ "issue.category_id": String(categoryId) }, [categorizedEntry]],
      [{ subproject_id: "!*" }, projectEntries],
    ] as const) {
      const query = { ...baseQuery, ...filter };
      const label = JSON.stringify(filter);
      const global = await client.GET("/time_entries.{format}", { params: { path: { format }, query } });
      assertStatus(200, global);
      assert.deepEqual(global.data!.time_entries.map((entry) => entry.id), unfiltered, label);

      const selected = await client.GET("/time_entries.{format}", {
        params: { path: { format }, query: { ...query, project_id: String(projectId) } },
      });
      assertStatus(200, selected);
      assert.deepEqual(selected.data!.time_entries.map((entry) => entry.id), expected, label);

      const scoped = await client.GET("/projects/{project_id}/time_entries.{format}", {
        params: { path: scopedPath, query },
      });
      assertStatus(200, scoped);
      assert.deepEqual(scoped.data!.time_entries.map((entry) => entry.id), expected, label);
    }

    const leaf = await client.GET("/projects/{project_id}/time_entries.{format}", {
      params: {
        path: { format, project_id: childProjectId },
        query: { ...baseQuery, subproject_id: String(projectId) },
      },
    });
    assertStatus(200, leaf);
    assert.deepEqual(leaf.data!.time_entries.map((entry) => entry.id), [childEntry]);
  });
});
