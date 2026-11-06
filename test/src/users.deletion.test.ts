import { before, after, describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  client,
  createTestClient,
  createTestUser,
  assertStatus,
  runCleanup,
  someTrackerId,
} from "./helpers.js";

describe("Responses after user deletion", () => {
  let projectId: number;
  let authorId: number | undefined;
  let issueId: number;
  let attachmentId: number;
  let timeEntryId: number;

  before(async () => {
    const name = `deleted-user-${Date.now()}`;
    const project = await client.POST("/projects.{format}", {
      params: { path: { format: "json" } },
      body: {
        project: {
          name,
          identifier: name,
          enabled_module_names: ["issue_tracking", "time_tracking"],
          tracker_ids: [await someTrackerId()],
        },
      },
    });
    assertStatus(201, project);
    projectId = project.data!.project.id;

    authorId = await createTestUser("deleted-author", { admin: true });
    const author = await client.GET("/users/{user_id}.{format}", {
      params: { path: { format: "json", user_id: authorId } },
    });
    assertStatus(200, author);
    const actor = createTestClient(author.data!.user.login);

    const upload = await actor.POST("/uploads.{format}", {
      params: {
        path: { format: "json" },
        query: { filename: "deleted-author.txt" },
      },
      headers: { "Content-Type": "application/octet-stream" },
      body: "attachment content",
      bodySerializer: (body) => body,
    });
    assertStatus(201, upload);

    const issue = await actor.POST("/issues.{format}", {
      params: { path: { format: "json" } },
      body: {
        issue: {
          project_id: projectId,
          subject: "Attachment with a deleted author",
          uploads: [{ token: upload.data!.upload.token }],
        },
      },
    });
    assertStatus(201, issue);
    issueId = issue.data!.issue.id;
    assert.strictEqual(issue.data!.issue.author.id, authorId);
    const issueDetails = await client.GET("/issues/{issue_id}.{format}", {
      params: {
        path: { format: "json", issue_id: issueId },
        query: { include: ["attachments"] },
      },
    });
    assertStatus(200, issueDetails);
    const attachment = issueDetails.data!.issue.attachments?.find(
      (item) => item.filename === "deleted-author.txt"
    );
    assert(attachment, "Expected the attachment created by the dedicated user");
    assert.strictEqual(attachment.author.id, authorId);
    attachmentId = attachment.id;

    const activities = await client.GET(
      "/enumerations/time_entry_activities.{format}",
      { params: { path: { format: "json" } } }
    );
    assertStatus(200, activities);
    const activity = activities.data!.time_entry_activities[0];
    assert(activity, "Expected at least one time entry activity");
    const entry = await actor.POST("/time_entries.{format}", {
      params: { path: { format: "json" } },
      body: {
        time_entry: {
          project_id: projectId,
          activity_id: activity.id,
          hours: 1,
          spent_on: "2024-01-01",
        },
      },
    });
    assertStatus(201, entry);
    assert.strictEqual(entry.data!.time_entry.user.id, authorId);
    timeEntryId = entry.data!.time_entry.id;
  });

  after(async () => {
    await runCleanup([
      async () => {
        if (!projectId) return;
        const response = await client.DELETE("/projects/{project_id}.{format}", {
          params: { path: { format: "json", project_id: projectId } },
        });
        assertStatus(204, response);
      },
      async () => {
        if (authorId === undefined) return;
        const response = await client.DELETE("/users/{user_id}.{format}", {
          params: { path: { format: "json", user_id: authorId } },
        });
        assertStatus(204, response);
      },
    ]);
  });

  test("required user references remain present after user deletion", async () => {
    const deletedUserId = authorId;
    assert(deletedUserId);
    const removed = await client.DELETE("/users/{user_id}.{format}", {
      params: { path: { format: "json", user_id: deletedUserId } },
    });
    assertStatus(204, removed);
    const deletedUser = await client.GET("/users/{user_id}.{format}", {
      params: { path: { format: "json", user_id: deletedUserId } },
    });
    assertStatus(404, deletedUser);
    authorId = undefined;

    const attachment = await client.GET("/attachments/{attachment_id}.{format}", {
      params: { path: { format: "json", attachment_id: attachmentId } },
    });
    assertStatus(200, attachment);
    assert(Object.hasOwn(attachment.data!.attachment, "author"));

    const issue = await client.GET("/issues/{issue_id}.{format}", {
      params: { path: { format: "json", issue_id: issueId } },
    });
    assertStatus(200, issue);
    assert(Object.hasOwn(issue.data!.issue, "author"));

    const issues = await client.GET("/issues.{format}", {
      params: {
        path: { format: "json" },
        query: { issue_id: String(issueId) },
      },
    });
    assertStatus(200, issues);
    const summary = issues.data!.issues.find((item) => item.id === issueId);
    assert(summary, "Expected the issue with a deleted author in the issue list");
    assert(Object.hasOwn(summary, "author"));

    const entry = await client.GET("/time_entries/{time_entry_id}.{format}", {
      params: { path: { format: "json", time_entry_id: timeEntryId } },
    });
    assertStatus(200, entry);
    assert(Object.hasOwn(entry.data!.time_entry, "user"));
  });
});
