import { test } from "node:test";

import { client, assertStatus } from "./helpers.js";

test("Users", async (t) => {
  let userId: number;

  await t.test("POST /users.json", async () => {
    const ts = Date.now();
    const response = await client.POST("/users.{format}", {
      params: { path: { format: "json" } },
      body: {
        user: {
          login: `user-${ts}`,
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
          auto_watch_on: ["issue_created", "issue_contributed_to", "issue_assigned_to_me"],
        },
      },
    });
    assertStatus(201, response);
    userId = response.data!.user.id;
  });

  await t.test("GET /users/{user_id}.json with all includes", async () => {
    const response = await client.GET("/users/{user_id}.{format}", {
      params: {
        path: { format: "json", user_id: userId },
        query: {
          include: ["memberships", "groups", "auth_source"],
        },
      },
    });
    assertStatus(200, response);
  });

  await t.test("GET /users/current.json", async () => {
    const response = await client.GET("/users/current.{format}", {
      params: { path: { format: "json" } },
    });
    assertStatus(200, response);
  });

  await t.test("PUT /users/{user_id}.json", async () => {
    const ts = Date.now();
    const response = await client.PUT("/users/{user_id}.{format}", {
      params: { path: { format: "json", user_id: userId } },
      body: {
        user: {
          login: `user-upd-${ts}`,
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
          group_ids: [],
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
        },
      },
    });
    assertStatus(204, response);
  });

  await t.test("GET /users.json", async () => {
    const response = await client.GET("/users.{format}", {
      params: { path: { format: "json" } },
    });
    assertStatus(200, response);
  });

  await t.test("DELETE /users/{user_id}.json", async () => {
    const response = await client.DELETE("/users/{user_id}.{format}", {
      params: { path: { format: "json", user_id: userId } },
    });
    assertStatus(204, response);
    userId = 0;
  });

  if (userId) {
    await client.DELETE("/users/{user_id}.{format}", {
      params: { path: { format: "json", user_id: userId } },
    });
  }
});
