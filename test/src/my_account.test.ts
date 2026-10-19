import { before, after, describe, test } from "node:test";
import assert from "node:assert/strict";

import { client, assertStatus, createTestClient, createTestUser } from "./helpers.js";

describe("My Account", () => {
  // Preferences cannot be read back, so this suite owns a disposable account.
  let accountId: number;
  let accountClient: ReturnType<typeof createTestClient>;
  let original: {
    login: string;
    firstname: string;
    lastname: string;
    mail: string;
  };

  before(async () => {
    accountId = await createTestUser("my-account", { admin: true });
    const userResponse = await client.GET("/users/{user_id}.{format}", {
      params: { path: { format: "json", user_id: accountId } },
    });
    assertStatus(200, userResponse);
    accountClient = createTestClient(userResponse.data!.user.login);

    const response = await accountClient.GET("/my/account.{format}", {
      params: { path: { format: "json" } },
    });
    assertStatus(200, response);
    const user = response.data!.user;
    assert.strictEqual(user.id, accountId);
    original = {
      login: user.login,
      firstname: user.firstname,
      lastname: user.lastname,
      mail: user.mail,
    };
  });

  after(async () => {
    if (!accountId) return;
    const response = await client.DELETE("/users/{user_id}.{format}", {
      params: { path: { format: "json", user_id: accountId } },
    });
    assertStatus(204, response);
  });

  test("GET /my/account.json", async () => {
    const response = await accountClient.GET("/my/account.{format}", {
      params: { path: { format: "json" } },
    });
    assertStatus(200, response);
    assert.strictEqual(response.data!.user.id, accountId);
  });

  test("PUT /my/account.json", async () => {
    const response = await accountClient.PUT("/my/account.{format}", {
      params: { path: { format: "json" } },
      body: {
        user: {
          login: original.login,
          admin: true,
          firstname: `${original.firstname}-upd`,
          lastname: original.lastname,
          mail: original.mail,
          language: "en",
          auth_source_id: null,
          mail_notification: "only_my_events",
          notified_project_ids: [],
          must_change_passwd: false,
          generate_password: false,
          status: 1,
          custom_fields: [],
          custom_field_values: {},
          group_ids: [],
        },
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
          auto_watch_on: ["issue_contributed_to"],
          default_issue_query: null,
          default_project_query: null,
        },
      },
    });
    assertStatus(204, response);

    const verifyResponse = await accountClient.GET("/my/account.{format}", {
      params: { path: { format: "json" } },
    });
    assertStatus(200, verifyResponse);
    assert.strictEqual(
      verifyResponse.data!.user.firstname,
      `${original.firstname}-upd`
    );
    assert.strictEqual(verifyResponse.data!.user.admin, true);
  });

  test("PUT /my/account.json returns 422 for invalid data", async () => {
    const response = await accountClient.PUT("/my/account.{format}", {
      params: { path: { format: "json" } },
      body: { user: { mail: "not-an-email" } },
    });
    assertStatus(422, response);
  });
});
