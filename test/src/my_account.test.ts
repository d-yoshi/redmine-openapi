import { describe, test } from "node:test";

import { client, assertStatus } from "./helpers.js";

describe("My Account", async () => {
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
          firstname: "Redmine",
          lastname: "Admin",
          mail: "admin@example.net",
          language: "en",
          mail_notification: "only_my_events",
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
          auto_watch_on: ["issue_created", "issue_contributed_to", "issue_assigned_to_me"],
        },
      },
    });
    assertStatus(204, response);
  });
});
