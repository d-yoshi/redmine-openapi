import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { assertStatus, client, createTestUser, runCleanup } from "./helpers.js";

describe("Shared query parameters", () => {
  const marker = `query${Date.now()}`;
  const projectIds: number[] = [];
  const userIds: number[] = [];
  const issueIds: number[] = [];
  const entryIds: number[] = [];
  const fields = new Map<string, number>();
  const queries = new Map<string, number>();

  const field = (name: string) => {
    const id = fields.get(name);
    assert(id, `Expected custom field ${name}`);
    return id;
  };
  const saved = (type: string) => {
    const id = queries.get(type);
    assert(id, `Expected a saved ${type}`);
    return id;
  };

  before(async () => {
    const customFields = await client.GET("/custom_fields.{format}", {
      params: { path: { format: "json" } },
    });
    assertStatus(200, customFields);
    for (const item of customFields.data!.custom_fields) fields.set(item.name, item.id);
    for (const type of [
      "IssueQuery",
      "TimeEntryQuery",
      "ProjectQuery",
      "UserQuery",
      "ProjectAdminQuery",
    ] as const) {
      const result = await client.GET("/queries.{format}", {
        params: { path: { format: "json" }, query: { type } },
      });
      assertStatus(200, result);
      const item = result.data!.queries.find(
        (q) => q.name === (type === "IssueQuery" ? "Seed Query" : `Seed ${type}`)
      );
      assert(item);
      queries.set(type, item.id);
    }
    for (const [index, value] of [marker, `${marker}other`].entries()) {
      const project = await client.POST("/projects.{format}", {
        params: { path: { format: "json" } },
        body: {
          project: {
            name: `${marker}-${index}`,
            identifier: `${marker}-${index}`,
            enabled_module_names: ["issue_tracking", "time_tracking"],
            custom_fields: [{ id: field("CF Project String"), value }],
          },
        },
      });
      assertStatus(201, project);
      projectIds.push(project.data!.project.id);
      const userId = await createTestUser(`${marker}-${index}`);
      userIds.push(userId);
      const user = await client.PUT("/users/{user_id}.{format}", {
        params: { path: { format: "json", user_id: userId } },
        body: { user: { custom_fields: [{ id: field("CF User String"), value }] } },
      });
      assertStatus(204, user);
    }
    const parent = await client.POST("/issues.{format}", {
      params: { path: { format: "json" } },
      body: {
        issue: {
          project_id: projectIds[0],
          subject: marker,
          estimated_hours: "1h30",
          custom_fields: [{ id: field("CF String"), value: marker }],
        },
      },
    });
    assertStatus(201, parent);
    assert.equal(parent.data!.issue.estimated_hours, 1.5);
    issueIds.push(parent.data!.issue.id);
    const child = await client.POST("/issues.{format}", {
      params: { path: { format: "json" } },
      body: {
        issue: {
          project_id: projectIds[0],
          subject: `${marker} child`,
          parent_issue_id: issueIds[0],
        },
      },
    });
    assertStatus(201, child);
    issueIds.push(child.data!.issue.id);
    for (const [index, issueId] of issueIds.entries()) {
      const date = new Date();
      date.setUTCDate(date.getUTCDate() - index * 10);
      const entry = await client.POST("/time_entries.{format}", {
        params: { path: { format: "json" } },
        body: {
          time_entry: {
            issue_id: issueId,
            hours: index ? "90m" : "1:30",
            comments: index ? `${marker} suffix` : marker,
            spent_on: date.toISOString().slice(0, 10),
            custom_fields: [{ id: field("CF TimeEntry String"), value: index ? "other" : marker }],
          },
        },
      });
      assertStatus(201, entry);
      assert.equal(entry.data!.time_entry.hours, 1.5);
      entryIds.push(entry.data!.time_entry.id);
    }
  });

  after(async () =>
    runCleanup([
      ...projectIds.map(
        (project_id) => async () =>
          assertStatus(
            204,
            await client.DELETE("/projects/{project_id}.{format}", {
              params: { path: { format: "json", project_id } },
            })
          )
      ),
      ...userIds.map(
        (user_id) => async () =>
          assertStatus(
            204,
            await client.DELETE("/users/{user_id}.{format}", {
              params: { path: { format: "json", user_id } },
            })
          )
      ),
    ])
  );

  test("project and user custom-field filters select matching records", async () => {
    const projects = await client.GET("/projects.{format}", {
      params: {
        path: { format: "json" },
        query: { cf_x: { [`cf_${field("CF Project String")}`]: `=${marker}` }, sort: "name:desc" },
      },
    });
    assertStatus(200, projects);
    assert.deepEqual(
      projects.data!.projects.map((p) => p.id),
      [projectIds[0]]
    );
    const users = await client.GET("/users.{format}", {
      params: {
        path: { format: "json" },
        query: { cf_x: { [`cf_${field("CF User String")}`]: `=${marker}` }, sort: "login:desc" },
      },
    });
    assertStatus(200, users);
    assert.deepEqual(
      users.data!.users.map((u) => u.id),
      [userIds[0]]
    );
  });

  test("saved project, user and time queries accept a sort override", async () => {
    const projects = await client.GET("/projects.{format}", {
      params: {
        path: { format: "json" },
        query: {
          query_id: saved("ProjectQuery"),
          sort: "name:desc",
          cf_x: { [`cf_${field("CF Project String")}`]: `=${marker}` },
        },
      },
    });
    assertStatus(200, projects);
    const orderedProjects = projects.data!.projects.map((p) => p.id);
    assert(orderedProjects.includes(projectIds[0]));
    assert(
      orderedProjects.includes(projectIds[1]),
      "Saved-query filters take precedence over shortcut filters"
    );
    assert(orderedProjects.indexOf(projectIds[1]) < orderedProjects.indexOf(projectIds[0]));
    const users = await client.GET("/users.{format}", {
      params: {
        path: { format: "json" },
        query: { query_id: saved("UserQuery"), sort: "login:desc" },
      },
    });
    assertStatus(200, users);
    const orderedUsers = users.data!.users.map((u) => u.id);
    assert(orderedUsers.indexOf(userIds[1]) >= 0);
    assert(orderedUsers.indexOf(userIds[0]) > orderedUsers.indexOf(userIds[1]));
    const entries = await client.GET("/time_entries.{format}", {
      params: {
        path: { format: "json" },
        query: { query_id: saved("TimeEntryQuery"), sort: "spent_on:asc" },
      },
    });
    assertStatus(200, entries);
    const orderedEntries = entries.data!.time_entries.map((e) => e.id);
    assert(orderedEntries.indexOf(entryIds[1]) >= 0);
    assert(orderedEntries.indexOf(entryIds[0]) > orderedEntries.indexOf(entryIds[1]));
  });

  test("explicit filters encode operators and repeated values without the project shortcut", async () => {
    const result = await client.GET("/issues.{format}", {
      params: {
        path: { format: "json" },
        query: {
          "f[]": ["project_id", "status_id"],
          op: { project_id: "=", status_id: "*" },
          v: { project_id: projectIds.map(String) },
        },
      },
      querySerializer: (query) => {
        const encoded = new URLSearchParams();
        for (const field of query["f[]"] ?? []) encoded.append("f[]", field);
        for (const [field, operator] of Object.entries(query.op ?? {}))
          encoded.append(`op[${field}]`, operator);
        for (const [field, values] of Object.entries(query.v ?? {}))
          for (const value of values) encoded.append(`v[${field}][]`, value);
        return encoded.toString();
      },
    });
    assertStatus(200, result);
    assert.deepEqual(
      result.data!.issues.map((i) => i.id).sort((a, b) => a - b),
      [...issueIds].sort((a, b) => a - b)
    );
  });

  test("time filters distinguish equality, substrings, relative dates and descendant boundaries", async () => {
    for (const [query, expected] of [
      [{ comments: marker }, [entryIds[0]]],
      [{ comments: `~${marker}` }, entryIds],
      [{ "issue.subject": marker }, [entryIds[0]]],
      [{ "issue.subject": `~${marker}` }, entryIds],
      [{ spent_on: "><t-7" }, [entryIds[0]]],
      [{ spent_on: ">t-7" }, [entryIds[0]]],
      [{ spent_on: "<t-7" }, [entryIds[1]]],
      [{ "issue.parent_id": `~${issueIds[0]}` }, [entryIds[1]]],
      [{ "issue.parent_id": `999999,${issueIds[0]}` }, [entryIds[1]]],
      [{ issue_id: String(issueIds[0]) }, [entryIds[0]]],
      [{ issue_id: `~${issueIds[0]}` }, entryIds],
      [{ cf_x: { [`cf_${field("CF TimeEntry String")}`]: `=${marker}` } }, [entryIds[0]]],
      [{ cf_x: { [`issue.cf_${field("CF String")}`]: `=${marker}` } }, [entryIds[0]]],
    ] as const) {
      const result = await client.GET("/time_entries.{format}", {
        params: {
          path: { format: "json" },
          query: { project_id: String(projectIds[0]), sort: "spent_on:desc", ...query },
        },
      });
      assertStatus(200, result);
      assert.deepEqual(
        result.data!.time_entries.map((e) => e.id),
        expected
      );
    }
  });

  test("page computes an offset, while an explicit offset takes precedence", async () => {
    const base = { project_id: String(projectIds[0]), sort: "spent_on:desc", limit: 1 };
    const page = await client.GET("/time_entries.{format}", {
      params: { path: { format: "json" }, query: { ...base, page: 2 } },
    });
    assertStatus(200, page);
    assert.deepEqual(
      page.data!.time_entries.map((e) => e.id),
      [entryIds[1]]
    );
    const offset = await client.GET("/time_entries.{format}", {
      params: { path: { format: "json" }, query: { ...base, page: 2, offset: 0 } },
    });
    assertStatus(200, offset);
    assert.deepEqual(
      offset.data!.time_entries.map((e) => e.id),
      [entryIds[0]]
    );
  });

  test("unknown projects and saved queries return their declared 404 representations", async () => {
    assertStatus(
      404,
      await client.GET("/projects.{format}", {
        params: { path: { format: "json" }, query: { query_id: 999999 } },
      })
    );
    assertStatus(
      404,
      await client.GET("/users.{format}", {
        params: { path: { format: "json" }, query: { query_id: 999999 } },
      })
    );
    assertStatus(
      404,
      await client.GET("/time_entries.{format}", {
        params: { path: { format: "json" }, query: { project_id: "999999" } },
      })
    );
    assertStatus(
      404,
      await client.GET("/time_entries.{format}", {
        params: { path: { format: "json" }, query: { query_id: 999999 } },
      })
    );
    assertStatus(
      404,
      await client.GET("/projects/{project_id}/time_entries.{format}", {
        params: {
          path: { format: "json", project_id: projectIds[0] },
          query: { query_id: 999999 },
        },
      })
    );
  });

  test("time-entry updates can clear comments and the optional issue reference", async () => {
    const update = await client.PUT("/time_entries/{time_entry_id}.{format}", {
      params: { path: { format: "json", time_entry_id: entryIds[0] } },
      body: { time_entry: { issue_id: null, comments: null } },
    });
    assertStatus(204, update);
    const result = await client.GET("/time_entries/{time_entry_id}.{format}", {
      params: { path: { format: "json", time_entry_id: entryIds[0] } },
    });
    assertStatus(200, result);
    assert.equal(result.data!.time_entry.comments, null);
    assert(!Object.hasOwn(result.data!.time_entry, "issue"));
  });
});
