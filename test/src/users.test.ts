import { before, after, describe, test } from "node:test";
import assert from "node:assert/strict";

import { client, assertStatus, currentUserId, runCleanup } from "./helpers.js";

describe("Users", () => {
  let userId: number;
  let userLogin: string;
  let filterGroupId: number;

  before(async () => {
    const response = await client.POST("/groups.{format}", {
      params: { path: { format: "json" } },
      body: { group: { name: `user-filter-group-${Date.now()}` } },
    });
    assertStatus(201, response);
    filterGroupId = response.data!.group.id;
  });

  after(async () => {
    await runCleanup([
      async () => {
        if (!userId) return;
        const response = await client.DELETE("/users/{user_id}.{format}", {
          params: { path: { format: "json", user_id: userId } },
        });
        assertStatus(204, response);
      },
      async () => {
        if (!filterGroupId) return;
        const response = await client.DELETE("/groups/{group_id}.{format}", {
          params: { path: { format: "json", group_id: filterGroupId } },
        });
        assertStatus(204, response);
      },
    ]);
  });

  test("POST /users.json", async () => {
    const ts = Date.now();
    userLogin = `user-${ts}`;
    const response = await client.POST("/users.{format}", {
      params: { path: { format: "json" } },
      body: {
        user: {
          login: userLogin,
          firstname: "Alice",
          lastname: "Doe",
          mail: `user-${ts}@example.com`,
          password: "password123!",
          admin: false,
          language: "en",
          mail_notification: "only_assigned",
          must_change_passwd: false,
          generate_password: false,
          status: 1,
          auth_source_id: null,
          notified_project_ids: [],
          custom_fields: [],
          custom_field_values: {},
        },
        send_information: false,
        pref: {
          hide_mail: true,
          time_zone: "Tokyo",
          comments_sorting: "asc",
          warn_on_leaving_unsaved: true,
          no_self_notified: true,
          notify_about_high_priority_issues: false,
          textarea_font: "monospace",
          recently_used_projects: 3,
          history_default_tab: "notes",
          toolbar_language_options: "",
          auto_watch_on: ["issue_created", "issue_contributed_to"],
          default_issue_query: null,
          default_project_query: null,
        },
      },
    });
    assertStatus(201, response);
    userId = response.data!.user.id;
  });

  test("GET /users/{user_id}.json with all includes", async () => {
    const addResponse = await client.POST("/groups/{group_id}/users.{format}", {
      params: { path: { format: "json", group_id: filterGroupId } },
      body: { user_id: userId },
    });
    assertStatus(204, addResponse);
    const response = await client.GET("/users/{user_id}.{format}", {
      params: {
        path: { format: "json", user_id: userId },
        query: {
          include: ["memberships", "groups", "auth_source"],
        },
      },
    });
    assertStatus(200, response);
    assert(response.data!.user.groups?.some((group) => group.id === filterGroupId));
    assert(Array.isArray(response.data!.user.memberships));
    assert(!Object.hasOwn(response.data!.user, "auth_source"));
  });

  test("PUT /users/{user_id}.json", async () => {
    const ts = Date.now();
    userLogin = `user-upd-${ts}`;
    const response = await client.PUT("/users/{user_id}.{format}", {
      params: { path: { format: "json", user_id: userId } },
      body: {
        user: {
          login: userLogin,
          admin: false,
          password: "newpassword123!",
          firstname: "Bob",
          lastname: "Doe",
          mail: `user-upd-${ts}@example.com`,
          language: "en",
          mail_notification: "only_my_events",
          must_change_passwd: false,
          generate_password: false,
          status: 1,
          group_ids: [filterGroupId],
          auth_source_id: null,
          notified_project_ids: [],
          custom_fields: [],
          custom_field_values: {},
        },
        send_information: false,
        pref: {
          hide_mail: false,
          time_zone: "UTC",
          comments_sorting: "desc",
          warn_on_leaving_unsaved: false,
          no_self_notified: false,
          notify_about_high_priority_issues: true,
          textarea_font: "proportional",
          recently_used_projects: 5,
          history_default_tab: "history",
          toolbar_language_options: "",
          auto_watch_on: [],
          default_issue_query: null,
          default_project_query: null,
        },
      },
    });
    assertStatus(204, response);

    const readback = await client.GET("/users/{user_id}.{format}", {
      params: { path: { format: "json", user_id: userId }, query: { include: ["groups"] } },
    });
    assertStatus(200, readback);
    assert.strictEqual(readback.data!.user.login, userLogin);
    assert.strictEqual(readback.data!.user.firstname, "Bob");
    assert.strictEqual(readback.data!.user.mail, `user-upd-${ts}@example.com`);
    assert(readback.data!.user.groups?.some((group) => group.id === filterGroupId));
  });

  test("GET /users/current.json with all includes", async () => {
    const response = await client.GET("/users/current.{format}", {
      params: {
        path: { format: "json" },
        query: {
          include: ["memberships", "groups", "auth_source"],
        },
      },
    });
    assertStatus(200, response);
  });

  test("include=auth_source returns a configured source and omits it without include", async () => {
    const query = { name: "api-ldap-fixture" };
    const list = await client.GET("/users.{format}", {
      params: { path: { format: "json" }, query: { ...query, include: ["auth_source"] } },
    });
    assertStatus(200, list);
    assert.strictEqual(list.data!.users.length, 1);
    const user = list.data!.users[0];
    assert.strictEqual(user.login, "api-ldap-fixture");
    assert(user.auth_source, "Expected the seeded LDAP authentication source");
    assert.strictEqual(user.auth_source.name, "API test LDAP");

    const detail = await client.GET("/users/{user_id}.{format}", {
      params: { path: { format: "json", user_id: user.id }, query: { include: ["auth_source"] } },
    });
    assertStatus(200, detail);
    assert.deepStrictEqual(detail.data!.user.auth_source, user.auth_source);

    const withoutInclude = await client.GET("/users.{format}", {
      params: { path: { format: "json" }, query },
    });
    assertStatus(200, withoutInclude);
    assert.strictEqual(withoutInclude.data!.users.length, 1);
    assert.strictEqual(withoutInclude.data!.users[0].id, user.id);
    assert(!Object.hasOwn(withoutInclude.data!.users[0], "auth_source"));

    const detailWithoutInclude = await client.GET("/users/{user_id}.{format}", {
      params: { path: { format: "json", user_id: user.id } },
    });
    assertStatus(200, detailWithoutInclude);
    assert(!Object.hasOwn(detailWithoutInclude.data!.user, "auth_source"));
  });

  test("GET /users.json with filters", async () => {
    const response = await client.GET("/users.{format}", {
      params: {
        path: { format: "json" },
        query: {
          status: "1",
          name: userLogin.slice("user-".length),
          include: ["auth_source"],
          offset: 0,
          limit: 25,
        },
      },
    });
    assertStatus(200, response);
    assert.deepStrictEqual(response.data!.users.map((user) => user.id), [userId]);
  });

  test("GET /users.json name treats an operator prefix as literal text", async () => {
    const response = await client.GET("/users.{format}", {
      params: {
        path: { format: "json" },
        query: { name: `~${userLogin.slice("user-".length)}` },
      },
    });
    assertStatus(200, response);
    assert.deepStrictEqual(response.data!.users, []);
  });

  test("GET /users.json with remaining filters", async () => {
    const response = await client.GET("/users.{format}", {
      params: {
        path: { format: "json" },
        query: {
          login: "~user",
          firstname: "~Ali",
          lastname: "~Doe",
          mail: "~example",
          created_on: ">=2020-01-01",
          last_login_on: "*",
          admin: "0",
          auth_source_id: "!*",
          twofa_scheme: "!*",
        },
      },
    });
    assertStatus(200, response);

    const groupFilterResponse = await client.GET("/users.{format}", {
      params: {
        path: { format: "json" },
        query: { group_id: String(filterGroupId) },
      },
    });
    assertStatus(200, groupFilterResponse);
    assert.deepStrictEqual(groupFilterResponse.data!.users.map((user) => user.id), [userId]);
  });

  test("GET /users.json returns 422 for invalid filter value", async () => {
    const response = await client.GET("/users.{format}", {
      params: {
        path: { format: "json" },
        query: { created_on: "invalid-date" },
      },
    });
    assertStatus(422, response);
  });

  test("POST /users.json returns 422 for invalid data", async () => {
    const response = await client.POST("/users.{format}", {
      params: { path: { format: "json" } },
      body: {
        user: {
          login: userLogin,
          firstname: "Duplicate",
          lastname: "Login",
          mail: "duplicate-login@example.com",
        },
      },
    });
    assertStatus(422, response);
  });

  test("GET /users/{user_id}.json returns 404", async () => {
    const response = await client.GET("/users/{user_id}.{format}", {
      params: { path: { format: "json", user_id: 999999 } },
    });
    assertStatus(404, response);
  });

  test("PUT /users/{user_id}.json returns 404", async () => {
    const response = await client.PUT("/users/{user_id}.{format}", {
      params: { path: { format: "json", user_id: 999999 } },
      body: { user: { firstname: "Missing" } },
    });
    assertStatus(404, response);
  });

  test("PUT /users/{user_id}.json returns 422 for invalid data", async () => {
    const response = await client.PUT("/users/{user_id}.{format}", {
      params: { path: { format: "json", user_id: userId } },
      body: { user: { mail: "not-an-email" } },
    });
    assertStatus(422, response);
  });

  test("DELETE /users/{user_id}.json returns 404", async () => {
    const response = await client.DELETE("/users/{user_id}.{format}", {
      params: { path: { format: "json", user_id: 999999 } },
    });
    assertStatus(404, response);
  });

  test("DELETE /users/{user_id}.json returns 422 for own account", async () => {
    // This test relies on the default Setting.unsubscribe being enabled.
    // Check the last-admin precondition before risking deletion of the API account.
    const ownId = await currentUserId();
    const adminsResponse = await client.GET("/users.{format}", {
      params: {
        path: { format: "json" },
        query: { status: "1", admin: "1" },
      },
    });
    assertStatus(200, adminsResponse);
    assert.deepStrictEqual(
      adminsResponse.data!.users.map((user) => user.id),
      [ownId],
      "This test only returns 422 while the authenticated account is the last " +
        "active administrator; another active admin would make Redmine delete it"
    );

    const response = await client.DELETE("/users/{user_id}.{format}", {
      params: { path: { format: "json", user_id: ownId } },
    });
    assertStatus(422, response);
  });

  test("DELETE /users/{user_id}.json", async () => {
    const response = await client.DELETE("/users/{user_id}.{format}", {
      params: { path: { format: "json", user_id: userId } },
    });
    assertStatus(204, response);
    userId = 0;
  });
});
