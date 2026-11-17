import fs from "node:fs";
import assert from "node:assert/strict";

import { load } from "js-yaml";
import type { OpenAPIV3 } from "openapi-types";
import createClient, { createQuerySerializer } from "openapi-fetch";
import { createResponseValidator } from "./response-validator.js";

import type { paths } from "../dist/openapi-typescript/schema.d.ts";

export type IssuesQuery = NonNullable<
  paths["/issues.{format}"]["get"]["parameters"]["query"]
>;

export const serializeRepeatedArrays = createQuerySerializer({
  array: { style: "form", explode: true },
  object: { style: "form", explode: true },
});

const REDMINE_URL = process.env.REDMINE_URL;
const REDMINE_ADMIN_LOGIN = process.env.REDMINE_ADMIN_LOGIN;
const REDMINE_ADMIN_PASSWORD = process.env.REDMINE_ADMIN_PASSWORD;
const OPENAPI_PATH = process.env.OPENAPI_PATH;
const OBSERVED_LOG = process.env.OBSERVED_LOG;

if (
  !REDMINE_URL ||
  !REDMINE_ADMIN_LOGIN ||
  !REDMINE_ADMIN_PASSWORD ||
  !OPENAPI_PATH
) {
  throw new Error(
    "Missing required environment variables: REDMINE_URL, REDMINE_ADMIN_LOGIN, REDMINE_ADMIN_PASSWORD, OPENAPI_PATH"
  );
}

// js-yaml returns unknown; check.sh has linted this generated OpenAPI document.
const openapi = load(
  fs.readFileSync(OPENAPI_PATH, "utf8")
) as OpenAPIV3.Document;

const basicAuth = Buffer.from(
  `${REDMINE_ADMIN_LOGIN}:${REDMINE_ADMIN_PASSWORD}`
).toString("base64");

// Each process loads one spec; its clients can share compiled validators.
const responseValidators = new Map<string, ReturnType<typeof createResponseValidator>>();

export const createTestClient = (switchUser?: string, options: { anonymous?: boolean } = {}) => {
  const client = createClient<paths>({
    baseUrl: `${REDMINE_URL}/`,
    fetch: (request) => fetch(request, { redirect: "manual" }),
    headers: switchUser ? { "X-Redmine-Switch-User": switchUser } : undefined,
    querySerializer: {
      array: { style: "form", explode: false },
      object: { style: "form", explode: true },
    },
  });

  client.use({
    onRequest({ request }) {
      if (!options.anonymous) request.headers.set("Authorization", `Basic ${basicAuth}`);
      return request;
    },
    async onResponse({ schemaPath, request, response }) {
      const method = request.method.toLowerCase();
      const status = response.status;

      if (OBSERVED_LOG) {
        fs.appendFileSync(
          OBSERVED_LOG,
          `${method.toUpperCase()} ${schemaPath} ${status} ${request.url}\n`
        );
      }

      // Only HTTP method keys are read here; other path-item keys are metadata.
      const pathItem = openapi.paths[schemaPath] as
        | Record<string, OpenAPIV3.OperationObject | undefined>
        | undefined;
      const responses = pathItem?.[method]?.responses;
      if (!responses) {
        throw new Error(`No OpenAPI spec found for ${method.toUpperCase()} ${schemaPath}`);
      }

      const responseSchema = responses[status] ?? responses[String(status)];
      if (!responseSchema) {
        throw new Error(
          `No response schema defined for ${method.toUpperCase()} ${schemaPath} status ${status}`
        );
      }

      const validatorKey = `${method} ${schemaPath}`;
      let validator = responseValidators.get(validatorKey);
      if (!validator) {
        validator = createResponseValidator(responses, openapi.components);
        responseValidators.set(validatorKey, validator);
      }

      await assert.doesNotReject(validator(response), `${request.method} ${schemaPath} ${status}`);

      return response;
    },
  });
  return client;
};

export const client = createTestClient();

export const uploadFile = async (filename: string, content: string) => {
  const response = await client.POST("/uploads.{format}", {
    params: {
      path: { format: "json" },
      query: { filename },
    },
    body: content,
    bodySerializer: (body) => body,
    headers: { "Content-Type": "application/octet-stream" },
  });
  assertStatus(201, response);
  return response.data!.upload;
};

export const assertStatus = (
  expectedStatus: number,
  fetchResponse: { data?: unknown; error?: unknown; response: Response }
) => {
  const { data, error, response } = fetchResponse;
  const { status, url } = response;

  if (status !== expectedStatus) {
    console.error(`Request failed: ${url}`);
    console.error(`Expected: ${expectedStatus}, Got: ${status}`);
    console.error("Response:", JSON.stringify(error ?? data, null, 2));
  }
  assert.strictEqual(status, expectedStatus);
};

const memoize = <T>(fetch: () => Promise<T>) => {
  let cached: Promise<T> | undefined;
  return () => (cached ??= fetch());
};

/** Attempt every deletion before reporting cleanup failures. */
export const runCleanup = async (steps: Array<() => Promise<void>>) => {
  const failures: string[] = [];
  for (const step of steps) {
    try {
      await step();
    } catch (error) {
      failures.push(String(error));
    }
  }
  assert.strictEqual(failures.length, 0, `cleanup failed:\n${failures.join("\n")}`);
};

// Default data varies between images, so discover fixture ids through the API.
export const currentUserId = memoize(async () => {
  const response = await client.GET("/users/current.{format}", {
    params: { path: { format: "json" } },
  });
  assertStatus(200, response);
  return response.data!.user.id;
});

export const someTrackerId = memoize(async () => {
  const response = await client.GET("/trackers.{format}", {
    params: { path: { format: "json" } },
  });
  assertStatus(200, response);
  const tracker = response.data!.trackers[0];
  assert(tracker, "Expected at least one tracker to exist");
  return tracker.id;
});

const roles = memoize(async () => {
  const response = await client.GET("/roles.{format}", {
    params: { path: { format: "json" } },
  });
  assertStatus(200, response);
  return response.data!.roles;
});

export const someRoleId = memoize(async () => {
  const role = (await roles())[0];
  assert(role, "Expected at least one givable role to exist");
  return role.id;
});

export const fixtureRoleId = async (name: string) => {
  const role = (await roles()).find((candidate) => candidate.name === name);
  assert(role, `Expected the seeded role: ${name}`);
  return role.id;
};

export const someStatusId = memoize(async () => {
  const response = await client.GET("/issue_statuses.{format}", {
    params: { path: { format: "json" } },
  });
  assertStatus(200, response);
  const status = response.data!.issue_statuses[0];
  assert(status, "Expected at least one issue status to exist");
  return status.id;
});

export const somePriorityId = memoize(async () => {
  const response = await client.GET("/enumerations/issue_priorities.{format}", {
    params: { path: { format: "json" } },
  });
  assertStatus(200, response);
  const priority = response.data!.issue_priorities[0];
  assert(priority, "Expected at least one issue priority to exist");
  return priority.id;
});

export const createTestUser = async (
  prefix: string,
  options: { admin?: boolean } = {}
) => {
  const ts = Date.now();
  const response = await client.POST("/users.{format}", {
    params: { path: { format: "json" } },
    body: {
      user: {
        login: `${prefix}-${ts}`,
        admin: options.admin,
        firstname: prefix,
        lastname: "User",
        mail: `${prefix}-${ts}@example.com`,
        password: "password123!",
      },
    },
  });
  assertStatus(201, response);
  return response.data!.user.id;
};
