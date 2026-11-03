import { before, after, describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  client,
  assertStatus,
  createTestUser,
  fixtureRoleId,
  runCleanup,
  someTrackerId,
} from "./helpers.js";

describe("Project permissions", () => {
  const projectIds: number[] = [];
  const userIds: number[] = [];
  let projectId: number;
  let categoryId: number;
  let editorLogin: string;
  let readerLogin: string;
  const includes = ["trackers", "issue_categories", "time_entry_activities", "issue_custom_fields"] as const;

  before(async () => {
    const prefix = `project-permissions-${Date.now()}`;
    for (const name of ["parent", "child"]) {
      const response = await client.POST("/projects.{format}", {
        params: { path: { format: "json" } },
        body: {
          project: {
            name: `${prefix}-${name}`,
            identifier: `${prefix}-${name}`,
            parent_id: name === "child" ? projectIds[0] : undefined,
            inherit_members: false,
            tracker_ids: [await someTrackerId()],
            enabled_module_names: ["issue_tracking", "time_tracking"],
          },
        },
      });
      assertStatus(201, response);
      projectIds.push(response.data!.project.id);
    }
    projectId = projectIds[1];

    const category = await client.POST("/projects/{project_id}/issue_categories.{format}", {
      params: { path: { format: "json", project_id: projectId } },
      body: { issue_category: { name: "Permission fixture" } },
    });
    assertStatus(201, category);
    categoryId = category.data!.issue_category.id;

    for (const [name, role] of [["editor", "API project editor"], ["reader", "API visibility viewer"]]) {
      const userId = await createTestUser(`project-${name}`);
      userIds.push(userId);
      const user = await client.GET("/users/{user_id}.{format}", {
        params: { path: { format: "json", user_id: userId } },
      });
      assertStatus(200, user);
      if (name === "editor") editorLogin = user.data!.user.login;
      else readerLogin = user.data!.user.login;

      const membership = await client.POST("/projects/{project_id}/memberships.{format}", {
        params: { path: { format: "json", project_id: projectId } },
        body: { membership: { user_id: userId, role_ids: [await fixtureRoleId(role)] } },
      });
      assertStatus(201, membership);
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
      ...userIds.map((id) => async () => {
        const response = await client.DELETE("/users/{user_id}.{format}", {
          params: { path: { format: "json", user_id: id } },
        });
        assertStatus(204, response);
      }),
    ]);
  });

  const getProject = async (list: boolean, login?: string) => {
    const header = { "X-Redmine-Switch-User": login };
    if (list) {
      const response = await client.GET("/projects.{format}", {
        params: { path: { format: "json" }, header, query: { id: String(projectId), include: [...includes] } },
      });
      assertStatus(200, response);
      const project = response.data!.projects.find((candidate) => candidate.id === projectId);
      assert(project, "Expected the visible project in the list");
      return project;
    }
    const response = await client.GET("/projects/{project_id}.{format}", {
      params: { path: { format: "json", project_id: projectId }, header, query: { include: [...includes] } },
    });
    assertStatus(200, response);
    return response.data!.project;
  };

  for (const list of [false, true]) {
    test(`${list ? "project list" : "project detail"} omits requested associations without their view permissions`, async () => {
      const adminProject = await getProject(list);
      const editorProject = await getProject(list, editorLogin);
      const readerProject = await getProject(list, readerLogin);
      for (const field of includes) {
        assert(adminProject[field]?.length, `Expected populated ${field} for the administrator`);
        assert(!Object.hasOwn(editorProject, field), `Expected ${field} to be omitted without its permission`);
        if (field === "time_entry_activities") assert(!Object.hasOwn(readerProject, field));
        else assert(readerProject[field]?.length, `Expected populated ${field} with View issues`);
      }
    });
  }

  test("View issues permits reading categories without Manage issue categories", async () => {
    const header = { "X-Redmine-Switch-User": readerLogin };
    const list = await client.GET("/projects/{project_id}/issue_categories.{format}", {
      params: { path: { format: "json", project_id: projectId }, header },
    });
    assertStatus(200, list);
    assert(list.data!.issue_categories.some((category) => category.id === categoryId));
    const detail = await client.GET("/issue_categories/{issue_category_id}.{format}", {
      params: { path: { format: "json", issue_category_id: categoryId }, header },
    });
    assertStatus(200, detail);
    assert.strictEqual(detail.data!.issue_category.id, categoryId);
  });

  test("View issues does not permit creating categories", async () => {
    const response = await client.POST("/projects/{project_id}/issue_categories.{format}", {
      params: {
        path: { format: "json", project_id: projectId },
        header: { "X-Redmine-Switch-User": readerLogin },
      },
      body: { issue_category: { name: "Forbidden category" } },
    });
    assertStatus(403, response);
  });

  test("creating a subproject uses the default role's Manage members permission for inherit_members", async () => {
    for (const login of [editorLogin, undefined]) {
      const name = `inheritance-${login ? "editor" : "admin"}-${Date.now()}`;
      const response = await client.POST("/projects.{format}", {
        params: {
          path: { format: "json" },
          header: { "X-Redmine-Switch-User": login },
        },
        body: { project: { name, identifier: name, parent_id: projectId, inherit_members: true } },
      });
      assertStatus(201, response);
      projectIds.push(response.data!.project.id);
      assert.strictEqual(response.data!.project.parent?.id, projectId);
      assert.strictEqual(response.data!.project.inherit_members, login === undefined);
    }
  });

  test("updating inherit_members requires Manage members in addition to Edit project", async () => {
    for (const login of [editorLogin, undefined]) {
      const response = await client.PUT("/projects/{project_id}.{format}", {
        params: {
          path: { format: "json", project_id: projectId },
          header: { "X-Redmine-Switch-User": login },
        },
        body: { project: { inherit_members: true } },
      });
      assertStatus(204, response);
      const readback = await client.GET("/projects/{project_id}.{format}", {
        params: { path: { format: "json", project_id: projectId } },
      });
      assertStatus(200, readback);
      assert.strictEqual(readback.data!.project.inherit_members, login === undefined);
    }
  });
});
