import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { assertStatus, client, serializeRepeatedArrays } from "./helpers.js";

describe("Issue and time-entry batch deletion", () => {
  let projectId: number;
  const createIssue = async () => {
    const result = await client.POST("/issues.{format}", {
      params: { path: { format: "json" } },
      body: { issue: { project_id: projectId, subject: "deletion target" } },
    });
    assertStatus(201, result);
    return result.data!.issue.id;
  };
  const createEntry = async (issueId: number) => {
    const result = await client.POST("/time_entries.{format}", {
      params: { path: { format: "json" } },
      body: { time_entry: { issue_id: issueId, hours: 1 } },
    });
    assertStatus(201, result);
    return result.data!.time_entry.id;
  };

  before(async () => {
    const name = `batch-delete-${Date.now()}`;
    const result = await client.POST("/projects.{format}", {
      params: { path: { format: "json" } },
      body: {
        project: {
          name,
          identifier: name,
          enabled_module_names: ["issue_tracking", "time_tracking"],
        },
      },
    });
    assertStatus(201, result);
    projectId = result.data!.project.id;
  });
  after(async () => {
    if (projectId)
      assertStatus(
        204,
        await client.DELETE("/projects/{project_id}.{format}", {
          params: { path: { format: "json", project_id: projectId } },
        })
      );
  });

  test("the batch time-entry route deletes every selected entry", async () => {
    const issueId = await createIssue();
    const ids = [await createEntry(issueId), await createEntry(issueId)];
    const result = await client.DELETE("/time_entries/destroy.{format}", {
      params: { path: { format: "json" }, query: { "ids[]": ids } },
      querySerializer: serializeRepeatedArrays,
    });
    assertStatus(204, result);
    for (const time_entry_id of ids)
      assertStatus(
        404,
        await client.GET("/time_entries/{time_entry_id}.{format}", {
          params: { path: { format: "json", time_entry_id } },
        })
      );
  });

  test("batch issue deletion can reassign time entries to another issue", async () => {
    const targetId = await createIssue();
    const ids = [await createIssue(), await createIssue()];
    const entries = [await createEntry(ids[0]), await createEntry(ids[1])];
    const result = await client.DELETE("/issues.{format}", {
      params: {
        path: { format: "json" },
        query: { "ids[]": ids, todo: "reassign", reassign_to_id: targetId },
      },
      querySerializer: serializeRepeatedArrays,
    });
    assertStatus(204, result);
    for (const issue_id of ids)
      assertStatus(
        404,
        await client.GET("/issues/{issue_id}.{format}", {
          params: { path: { format: "json", issue_id } },
        })
      );
    for (const time_entry_id of entries) {
      const entry = await client.GET("/time_entries/{time_entry_id}.{format}", {
        params: { path: { format: "json", time_entry_id } },
      });
      assertStatus(200, entry);
      assert.equal(entry.data!.time_entry.issue?.id, targetId);
    }
  });

  test("single-issue deletion can keep time entries without their issue", async () => {
    const issueId = await createIssue();
    const entryId = await createEntry(issueId);
    const result = await client.DELETE("/issues/{issue_id}.{format}", {
      params: { path: { format: "json", issue_id: issueId }, query: { todo: "nullify" } },
    });
    assertStatus(204, result);
    const entry = await client.GET("/time_entries/{time_entry_id}.{format}", {
      params: { path: { format: "json", time_entry_id: entryId } },
    });
    assertStatus(200, entry);
    assert(!Object.hasOwn(entry.data!.time_entry, "issue"));
  });

  test("batch routes return 404 for nonexistent records", async () => {
    assertStatus(
      404,
      await client.DELETE("/issues.{format}", {
        params: { path: { format: "json" }, query: { "ids[]": [999999] } },
        querySerializer: serializeRepeatedArrays,
      })
    );
    assertStatus(
      404,
      await client.DELETE("/time_entries/destroy.{format}", {
        params: { path: { format: "json" }, query: { "ids[]": [999999] } },
        querySerializer: serializeRepeatedArrays,
      })
    );
  });
});
