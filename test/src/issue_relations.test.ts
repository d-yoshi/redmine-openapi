import { test } from "node:test";

import { client, assertStatus } from "./helpers.js";

test("Issue Relations", async (t) => {
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
  const projectId = projectResponse.data!.project.id;

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
  const issueId1 = issue1Response.data!.issue.id;

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
  const issueId2 = issue2Response.data!.issue.id;

  let relationId: number;

  await t.test("POST /issues/{issue_id}/relations.json", async () => {
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

  await t.test("GET /relations/{issue_relation_id}.json", async () => {
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

  await t.test("GET /issues/{issue_id}/relations.json", async () => {
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

  await t.test("DELETE /relations/{issue_relation_id}.json", async () => {
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

  await client.DELETE("/projects/{project_id}.{format}", {
    params: { path: { format: "json", project_id: projectId } },
  });
});
