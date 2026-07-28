import { before, after, describe, test } from "node:test";
import assert from "node:assert/strict";

import { client, assertStatus } from "./helpers.js";

describe("Journals", () => {
  let projectId: number;
  let issueId: number;
  let journalId: number;

  const journalIds = async () => {
    const response = await client.GET("/issues/{issue_id}.{format}", {
      params: {
        path: { format: "json", issue_id: issueId },
        query: { include: ["journals"] },
      },
    });
    assertStatus(200, response);
    const journals = response.data!.issue.journals;
    assert(journals, "Expected include=journals to return a journals array");
    return journals.map((journal) => journal.id);
  };

  const addNote = async (notes: string) => {
    const existing = await journalIds();
    const putResponse = await client.PUT("/issues/{issue_id}.{format}", {
      params: { path: { format: "json", issue_id: issueId } },
      body: { issue: { notes } },
    });
    assertStatus(204, putResponse);

    const added = (await journalIds()).filter((id) => !existing.includes(id));
    assert.strictEqual(added.length, 1, "Expected the note to create a journal");
    return added[0];
  };

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

    journalId = await addNote("original note");
  });

  after(async () => {
    if (projectId) {
      const response = await client.DELETE("/projects/{project_id}.{format}", {
        params: { path: { format: "json", project_id: projectId } },
      });
      assertStatus(204, response);
    }
  });

  test("PUT /journals/{journal_id}.json", async () => {
    const response = await client.PUT("/journals/{journal_id}.{format}", {
      params: { path: { format: "json", journal_id: journalId } },
      body: {
        journal: {
          notes: "updated note",
          private_notes: true,
        },
      },
    });
    assertStatus(204, response);

    // PUT has no body, so a Redmine that ignored the attributes would also
    // answer 204; the change is read back instead
    const getResponse = await client.GET("/issues/{issue_id}.{format}", {
      params: {
        path: { format: "json", issue_id: issueId },
        query: { include: ["journals"] },
      },
    });
    assertStatus(200, getResponse);
    const journal = getResponse.data!.issue.journals!.find(
      (candidate) => candidate.id === journalId
    );
    assert(journal, "Expected the updated journal to still exist");
    assert.strictEqual(journal.notes, "updated note");
    assert.strictEqual(journal.private_notes, true);
  });

  test("PUT /journals/{journal_id}.json with empty notes destroys the journal", async () => {
    // journals_controller#update destroys a journal left with no notes and no
    // property changes, and still answers 204
    const throwawayJournalId = await addNote("note to be emptied");

    const response = await client.PUT("/journals/{journal_id}.{format}", {
      params: { path: { format: "json", journal_id: throwawayJournalId } },
      body: { journal: { notes: "" } },
    });
    assertStatus(204, response);

    assert(
      !(await journalIds()).includes(throwawayJournalId),
      "Expected the journal to be destroyed once its notes were emptied"
    );
  });

  test("PUT /journals/{journal_id}.json returns 404", async () => {
    const response = await client.PUT("/journals/{journal_id}.{format}", {
      params: { path: { format: "json", journal_id: 999999 } },
      body: { journal: { notes: "missing" } },
    });
    assertStatus(404, response);
  });
});
