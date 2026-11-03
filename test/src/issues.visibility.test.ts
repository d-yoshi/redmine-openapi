import { before, after, describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  client,
  assertStatus,
  createTestUser,
  runCleanup,
  someTrackerId,
  fixtureRoleId,
} from "./helpers.js";

describe("Issue visibility", () => {
  const projectIds: number[] = [];
  let viewerId: number;
  let viewerLogin: string;
  let visibleProjectId: number;
  let privateProjectId: number;
  let parentId: number;
  let childId: number;
  let grandchildId: number;
  let privateChildId: number;
  let privateGrandchildId: number;
  let hiddenProjectChildId: number;
  let hiddenOnlyParentId: number;
  let visibleRelationId: number;
  let privateRelationId: number;

  before(async () => {
    viewerId = await createTestUser("issues-vis-viewer");
    const viewerResponse = await client.GET("/users/{user_id}.{format}", {
      params: { path: { format: "json", user_id: viewerId } },
    });
    assertStatus(200, viewerResponse);
    viewerLogin = viewerResponse.data!.user.login;

    const roleId = await fixtureRoleId("API issue relation editor");
    const prefix = `issues-visibility-${Date.now()}`;
    const trackerId = await someTrackerId();
    for (const name of ["visible", "private"]) {
      const projectResponse = await client.POST("/projects.{format}", {
        params: { path: { format: "json" } },
        body: {
          project: {
            name: `${prefix}-${name}`,
            identifier: `${prefix}-${name}`,
            is_public: name !== "private",
            // A private subproject allows cross-project subtasks with the
            // default 'tree' setting, without inheriting the viewer's role.
            parent_id: name === "private" ? visibleProjectId : undefined,
            inherit_members: false,
            tracker_ids: [trackerId],
            enabled_module_names: ["issue_tracking"],
          },
        },
      });
      assertStatus(201, projectResponse);
      const projectId = projectResponse.data!.project.id;
      projectIds.push(projectId);
      if (name === "visible") visibleProjectId = projectId;
      if (name === "private") privateProjectId = projectId;

      if (name !== "private") {
        const viewerMembership = await client.POST(
          "/projects/{project_id}/memberships.{format}",
          {
            params: { path: { format: "json", project_id: projectId } },
            body: {
              membership: {
                user_id: viewerId,
                role_ids: [roleId],
              },
            },
          }
        );
        assertStatus(201, viewerMembership);
      }
    }

    const createIssue = async (
      subject: string,
      parentIssueId?: number,
      isPrivate = false,
      projectId = visibleProjectId
    ) => {
      const response = await client.POST("/issues.{format}", {
        params: { path: { format: "json" } },
        body: {
          issue: {
            project_id: projectId,
            tracker_id: trackerId,
            subject,
            parent_issue_id: parentIssueId,
            is_private: isPrivate,
          },
        },
      });
      assertStatus(201, response);
      return response.data!.issue.id;
    };
    parentId = await createIssue("Visible parent");
    childId = await createIssue("Visible child", parentId);
    grandchildId = await createIssue("Visible grandchild", childId);
    privateChildId = await createIssue("Private child", parentId, true);
    privateGrandchildId = await createIssue("Private grandchild", childId, true);
    hiddenProjectChildId = await createIssue(
      "Child in a private project",
      parentId,
      false,
      privateProjectId
    );
    hiddenOnlyParentId = await createIssue("Parent with only a private child");
    await createIssue("Hidden only child", hiddenOnlyParentId, true);

    const privatePeerId = await createIssue("Private related issue", undefined, true);
    for (const targetId of [hiddenOnlyParentId, privatePeerId]) {
      const response = await client.POST("/issues/{issue_id}/relations.{format}", {
        params: { path: { format: "json", issue_id: parentId } },
        body: { relation: { issue_to_id: targetId, relation_type: "relates" } },
      });
      assertStatus(201, response);
      if (targetId === hiddenOnlyParentId) visibleRelationId = response.data!.relation.id;
      else privateRelationId = response.data!.relation.id;
    }
  });

  after(async () => {
    await runCleanup([
      ...[...projectIds].reverse().map((id) => async () => {
        const response = await client.DELETE("/projects/{project_id}.{format}", {
          params: { path: { format: "json", project_id: id } },
        });
        assertStatus(204, response);
      }),
      async () => {
        if (!viewerId) return;
        const response = await client.DELETE("/users/{user_id}.{format}", {
          params: { path: { format: "json", user_id: viewerId } },
        });
        assertStatus(204, response);
      },
    ]);
  });

  test("include=children returns nested and private descendants to an administrator", async () => {
    const response = await client.GET("/issues/{issue_id}.{format}", {
      params: {
        path: { format: "json", issue_id: parentId },
        query: { include: ["children"] },
      },
    });
    assertStatus(200, response);
    const children = response.data!.issue.children!;
    assert.deepStrictEqual(
      new Set(children.map((child) => child.id)),
      new Set([childId, privateChildId, hiddenProjectChildId])
    );
    const child = children.find((child) => child.id === childId)!;
    assert.deepStrictEqual(
      new Set(child.children!.map((grandchild) => grandchild.id)),
      new Set([grandchildId, privateGrandchildId])
    );
  });

  test("include=children excludes invisible descendants at every level", async () => {
    const response = await client.GET("/issues/{issue_id}.{format}", {
      params: {
        path: { format: "json", issue_id: parentId },
        header: { "X-Redmine-Switch-User": viewerLogin },
        query: { include: ["children"] },
      },
    });
    assertStatus(200, response);
    const children = response.data!.issue.children!;
    assert.deepStrictEqual(children.map((child) => child.id), [childId]);
    assert.deepStrictEqual(
      children[0].children!.map((grandchild) => grandchild.id),
      [grandchildId]
    );
    assert.strictEqual(children[0].children![0].children, undefined);
  });

  test("include=children returns an empty array when all children are invisible", async () => {
    const response = await client.GET("/issues/{issue_id}.{format}", {
      params: {
        path: { format: "json", issue_id: hiddenOnlyParentId },
        header: { "X-Redmine-Switch-User": viewerLogin },
        query: { include: ["children"] },
      },
    });
    assertStatus(200, response);
    assert.deepStrictEqual(response.data!.issue.children, []);
  });

  test("GET /issues/{issue_id}/relations.json excludes relations to invisible issues", async () => {
    for (const login of [undefined, viewerLogin]) {
      const response = await client.GET("/issues/{issue_id}/relations.{format}", {
        params: {
          path: { format: "json", issue_id: parentId },
          header: { "X-Redmine-Switch-User": login },
        },
      });
      assertStatus(200, response);
      assert.deepStrictEqual(
        new Set(response.data!.relations.map((relation) => relation.id)),
        new Set(login ? [visibleRelationId] : [visibleRelationId, privateRelationId])
      );
    }
  });

  test("nested relation endpoints return 403 for an invisible source issue", async () => {
    const header = { "X-Redmine-Switch-User": viewerLogin };
    const getResponse = await client.GET("/issues/{issue_id}/relations.{format}", {
      params: { path: { format: "json", issue_id: privateChildId }, header },
    });
    assertStatus(403, getResponse);
    const postResponse = await client.POST("/issues/{issue_id}/relations.{format}", {
      params: { path: { format: "json", issue_id: privateChildId }, header },
      body: { relation: { issue_to_id: hiddenOnlyParentId, relation_type: "relates" } },
    });
    assertStatus(403, postResponse);
  });
});
