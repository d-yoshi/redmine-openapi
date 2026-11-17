import { before, describe, test } from "node:test";
import assert from "node:assert/strict";

import { assertStatus, client, createTestClient } from "./helpers.js";

describe("Authentication", () => {
  const requestClient = createTestClient(undefined, { anonymous: true });
  const login = "api-twofa-fixture";
  let userId: number;
  let apiKey: string;

  before(async () => {
    const users = await client.GET("/users.{format}", {
      params: { path: { format: "json" }, query: { login } },
    });
    assertStatus(200, users);
    assert.equal(users.data!.users.length, 1);
    userId = users.data!.users[0].id;
    const user = await client.GET("/users/{user_id}.{format}", {
      params: { path: { format: "json", user_id: userId } },
    });
    assertStatus(200, user);
    assert.equal(user.data!.user.twofa_scheme, "totp");
    const key = user.data!.user.api_key;
    assert(key, "Expected the fixture user's API key");
    apiKey = key;
  });

  for (const { name, headers } of [
    { name: "without credentials", headers: new Headers() },
    {
      name: "with invalid Basic credentials",
      headers: new Headers({
        Authorization: `Basic ${Buffer.from("missing-test-user:invalid-password").toString("base64")}`,
      }),
    },
    {
      name: "with an invalid API key",
      headers: new Headers({ "X-Redmine-API-Key": "not-a-real-api-key" }),
    },
  ]) {
    test(`public tracker metadata is available ${name}`, async () => {
      const result = await requestClient.GET("/trackers.{format}", {
        params: { path: { format: "json" } },
        headers,
      });
      assertStatus(200, result);
      assert(result.data!.trackers.length > 0);
    });
  }

  test("two-factor accounts reject password-based Basic but accept their API key", async () => {
    const password = process.env.REDMINE_ADMIN_PASSWORD;
    assert(password, "Expected the test runner's fixture password");
    const denied = await requestClient.GET("/users/current.{format}", {
      params: { path: { format: "json" } },
      headers: {
        Authorization: `Basic ${Buffer.from(`${login}:${password}`).toString("base64")}`,
      },
    });
    assertStatus(401, denied);
    const allowed = await requestClient.GET("/users/current.{format}", {
      params: { path: { format: "json" } },
      headers: { "X-Redmine-API-Key": apiKey },
    });
    assertStatus(200, allowed);
    assert.equal(allowed.data!.user.id, userId);
  });
});
