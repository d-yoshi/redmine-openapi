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

  test("include=journals returns property change details", async () => {
    const update = await client.PUT("/issues/{issue_id}.{format}", {
      params: { path: { format: "json", issue_id: issueId } },
      body: { issue: { subject: "journal-test-updated" } },
    });
    assertStatus(204, update);

    const response = await client.GET("/issues/{issue_id}.{format}", {
      params: {
        path: { format: "json", issue_id: issueId },
        query: { include: ["journals"] },
      },
    });
    assertStatus(200, response);
    const journals = response.data!.issue.journals;
    assert(journals, "Expected include=journals to return a journals array");
    assert(
      journals.some((journal) =>
        journal.details.some((detail) => detail.property === "attr" && detail.name === "subject")
      ),
      "Expected a subject change detail"
    );
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

  test("PUT /journals/{journal_id}.json with empty notes hides the journal", async () => {
    // Empty journals are retained but omitted from include=journals.
    // Refill the same record to distinguish omission from deletion.
    const emptiedJournalId = await addNote("note to be emptied");

    const response = await client.PUT("/journals/{journal_id}.{format}", {
      params: { path: { format: "json", journal_id: emptiedJournalId } },
      body: { journal: { notes: "" } },
    });
    assertStatus(204, response);

    assert(
      !(await journalIds()).includes(emptiedJournalId),
      "Expected the emptied journal to be omitted from include=journals"
    );

    const refillResponse = await client.PUT("/journals/{journal_id}.{format}", {
      params: { path: { format: "json", journal_id: emptiedJournalId } },
      body: { journal: { notes: "refilled note" } },
    });
    assertStatus(204, refillResponse);

    assert(
      (await journalIds()).includes(emptiedJournalId),
      "Expected the refilled journal to reappear in include=journals"
    );
  });

  test("PUT /journals/{journal_id}.json returns 404", async () => {
    const response = await client.PUT("/journals/{journal_id}.{format}", {
      params: { path: { format: "json", journal_id: 999999 } },
      body: { journal: { notes: "missing" } },
    });
    assertStatus(404, response);
  });
  test("private notes accompanying a property change can produce null public notes", async () => {
    const ids = await journalIds();
    const update = await client.PUT("/issues/{issue_id}.{format}", {
      params: { path: { format: "json", issue_id: issueId } },
      body: {
        issue: {
          subject: "Property change with private notes",
          notes: "Private explanation",
          private_notes: true,
        },
      },
    });
    assertStatus(204, update);
    const result = await client.GET("/issues/{issue_id}.{format}", {
      params: { path: { format: "json", issue_id: issueId }, query: { include: ["journals"] } },
    });
    assertStatus(200, result);
    const added = result.data!.issue.journals!.filter((j) => !ids.includes(j.id));
    assert(added.some((j) => j.notes === null && j.details.length > 0));
    assert(added.some((j) => j.notes === "Private explanation" && j.private_notes));
  });

  test("PATCH updates journal notes", async () => {
    const id = await addNote("Notes before PATCH");
    const updated = await client.PATCH("/journals/{journal_id}.{format}", {
      params: { path: { format: "json", journal_id: id } },
      body: { journal: { notes: "Notes after PATCH" } },
    });
    assertStatus(204, updated);
    const current = await client.GET("/issues/{issue_id}.{format}", {
      params: { path: { format: "json", issue_id: issueId }, query: { include: ["journals"] } },
    });
    assertStatus(200, current);
    assert.equal(
      current.data!.issue.journals?.find((j) => j.id === id)?.notes,
      "Notes after PATCH"
    );
  });


});
