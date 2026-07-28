import { before, after, describe, test } from "node:test";
import assert from "node:assert/strict";

import { client, assertStatus } from "./helpers.js";

describe("My Account", () => {
  // This endpoint mutates the account the whole suite authenticates as, so the
  // original identity is captured up front and restored afterwards.
  //
  // GET /my/account returns identity fields only (my/account.api.rsb), so the
  // `pref` block and the `language`, `mail_notification`, `must_change_passwd`,
  // `status`, `notified_project_ids` and `group_ids` attributes cannot be read
  // back or restored. They are sent to exercise the request schema, with values
  // chosen so later suites observe no behavioural change — which is NOT the same
  // as Redmine's defaults (see auto_watch_on below).
  let original: {
    login: string;
    firstname: string;
    lastname: string;
    mail: string;
  };

  before(async () => {
    const response = await client.GET("/my/account.{format}", {
      params: { path: { format: "json" } },
    });
    assertStatus(200, response);
    const user = response.data!.user;
    original = {
      login: user.login,
      firstname: user.firstname,
      lastname: user.lastname,
      mail: user.mail,
    };
  });

  after(async () => {
    if (!original) return;
    const response = await client.PUT("/my/account.{format}", {
      params: { path: { format: "json" } },
      body: { user: original },
    });
    assertStatus(204, response);

    const verifyResponse = await client.GET("/my/account.{format}", {
      params: { path: { format: "json" } },
    });
    assertStatus(200, verifyResponse);
    assert.strictEqual(
      verifyResponse.data!.user.firstname,
      original.firstname,
      "Failed to restore the authenticated account's name"
    );
  });

  test("GET /my/account.json", async () => {
    const response = await client.GET("/my/account.{format}", {
      params: { path: { format: "json" } },
    });
    assertStatus(200, response);
  });

  test("PUT /my/account.json", async () => {
    const response = await client.PUT("/my/account.{format}", {
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
          // Deliberately NOT the default (["issue_created"]): the default would
          // auto-watch every issue later suites create as this account
          auto_watch_on: ["issue_contributed_to"],
          default_issue_query: null,
          default_project_query: null,
        },
      },
    });
    assertStatus(204, response);

    // PUT has no body, so a Redmine that ignored the attributes would also
    // answer 204; the change is read back instead
    const verifyResponse = await client.GET("/my/account.{format}", {
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
    const response = await client.PUT("/my/account.{format}", {
      params: { path: { format: "json" } },
      body: { user: { mail: "not-an-email" } },
    });
    assertStatus(422, response);
  });
});
