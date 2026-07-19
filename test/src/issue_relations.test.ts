import { before, after, describe, test } from "node:test";

import { client, assertStatus } from "./helpers.js";

describe("Issue Relations", () => {
  let projectId: number;
  let issueId1: number;
  let issueId2: number;
  let relationId: number;

  before(async () => {
    const projectIdentifier = `rel-${Date.now()}`;
    const projectResponse = await client.POST("/projects.{format}", {
      params: { path: { format: "json" } },
      body: {
        project: {
          name: projectIdentifier,
          identifier: projectIdentifier,
        },
      },
    });
    assertStatus(201, projectResponse);
    projectId = projectResponse.data!.project.id;

    const issue1Response = await client.POST("/issues.{format}", {
      params: { path: { format: "json" } },
      body: {
        issue: {
          project_id: projectId,
          subject: "issue-1",
        },
      },
    });
    assertStatus(201, issue1Response);
    issueId1 = issue1Response.data!.issue.id;

    const issue2Response = await client.POST("/issues.{format}", {
      params: { path: { format: "json" } },
      body: {
        issue: {
          project_id: projectId,
          subject: "issue-2",
        },
      },
    });
    assertStatus(201, issue2Response);
    issueId2 = issue2Response.data!.issue.id;
  });

  after(async () => {
    if (projectId) {
      await client.DELETE("/projects/{project_id}.{format}", {
        params: { path: { format: "json", project_id: projectId } },
      });
    }
  });

  test("POST /issues/{issue_id}/relations.json", async () => {
    const response = await client.POST(
      "/issues/{issue_id}/relations.{format}",
      {
        params: {
          path: { format: "json", issue_id: issueId1 },
        },
        body: {
          relation: {
            issue_to_id: issueId2,
            relation_type: "precedes",
            delay: 3,
          },
        },
      }
    );
    assertStatus(201, response);
    relationId = response.data!.relation.id;
  });

  test("GET /relations/{issue_relation_id}.json", async () => {
    const response = await client.GET(
      "/relations/{issue_relation_id}.{format}",
      {
        params: {
          path: { format: "json", issue_relation_id: relationId },
        },
      }
    );
    assertStatus(200, response);
  });

  test("GET /issues/{issue_id}/relations.json", async () => {
    const response = await client.GET(
      "/issues/{issue_id}/relations.{format}",
      {
        params: {
          path: { format: "json", issue_id: issueId1 },
        },
      }
    );
    assertStatus(200, response);
  });

  test("POST /issues/{issue_id}/relations.json returns 404 for nonexistent issue", async () => {
    const response = await client.POST(
      "/issues/{issue_id}/relations.{format}",
      {
        params: { path: { format: "json", issue_id: 999999 } },
        body: { relation: { issue_to_id: issueId2, relation_type: "relates" } },
      }
    );
    assertStatus(404, response);
  });

  test("POST /issues/{issue_id}/relations.json returns 422 for invalid data", async () => {
    const response = await client.POST(
      "/issues/{issue_id}/relations.{format}",
      {
        params: { path: { format: "json", issue_id: issueId1 } },
        body: { relation: { issue_to_id: 999999, relation_type: "relates" } },
      }
    );
    assertStatus(422, response);
  });

  test("GET /issues/{issue_id}/relations.json returns 404 for nonexistent issue", async () => {
    const response = await client.GET(
      "/issues/{issue_id}/relations.{format}",
      {
        params: { path: { format: "json", issue_id: 999999 } },
      }
    );
    assertStatus(404, response);
  });

  test("GET /relations/{issue_relation_id}.json returns 404", async () => {
    const response = await client.GET(
      "/relations/{issue_relation_id}.{format}",
      {
        params: { path: { format: "json", issue_relation_id: 999999 } },
      }
    );
    assertStatus(404, response);
  });

  test("DELETE /relations/{issue_relation_id}.json returns 404", async () => {
    const response = await client.DELETE(
      "/relations/{issue_relation_id}.{format}",
      {
        params: { path: { format: "json", issue_relation_id: 999999 } },
      }
    );
    assertStatus(404, response);
  });

  test("DELETE /relations/{issue_relation_id}.json", async () => {
    const response = await client.DELETE(
      "/relations/{issue_relation_id}.{format}",
      {
        params: {
          path: { format: "json", issue_relation_id: relationId },
        },
      }
    );
    assertStatus(204, response);
  });
});
