import { before, after, describe, test } from "node:test";

import { client, assertStatus } from "./helpers.js";

describe("Journals", async () => {
  let projectId: number;
  let issueId: number;
  let journalId: number;

  before(async () => {
    const projectName = `journal-${Date.now()}`;
    const projectResponse = await client.POST("/projects.{format}", {
      params: { path: { format: "json" } },
      body: {
        project: { name: projectName, identifier: projectName },
      },
    });
    assertStatus(201, projectResponse);
    projectId = projectResponse.data!.project.id;

    const issueResponse = await client.POST("/issues.{format}", {
      params: { path: { format: "json" } },
      body: {
        issue: { project_id: projectId, subject: "journal-test" },
      },
    });
    assertStatus(201, issueResponse);
    issueId = issueResponse.data!.issue.id;

    // Add a note to create a journal
    await client.PUT("/issues/{issue_id}.{format}", {
      params: { path: { format: "json", issue_id: issueId } },
      body: { issue: { notes: "original note" } },
    });

    // Get the journal ID
    const getResponse = await client.GET("/issues/{issue_id}.{format}", {
      params: {
        path: { format: "json", issue_id: issueId },
        query: { include: ["journals"] },
      },
    });
    assertStatus(200, getResponse);
    journalId = getResponse.data!.issue.journals![0].id;
  });

  after(async () => {
    await client.DELETE("/projects/{project_id}.{format}", {
      params: { path: { format: "json", project_id: projectId } },
    });
  });

  test("PUT /journals/{journal_id}.json", async () => {
    const response = await client.PUT("/journals/{journal_id}.{format}", {
      params: { path: { format: "json", journal_id: journalId } },
      body: {
        journal: {
          notes: "updated note",
          private_notes: false,
        },
      },
    });
    assertStatus(204, response);
  });
});
