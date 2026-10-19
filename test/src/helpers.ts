import fs from "node:fs";
import { createRequire } from "node:module";
import assert from "node:assert/strict";

import yaml from "js-yaml";
import type { OpenAPIV3 } from "openapi-types";
import createClient from "openapi-fetch";
import type { OpenAPIResponseValidatorArgs } from "openapi-response-validator";

const _require = createRequire(import.meta.url);
const OpenAPIResponseValidator: new (args: ResponseValidatorArgs) => {
  validateResponse(status: number, body: unknown): unknown;
} =
  _require("openapi-response-validator").default;

/**
 * The package accepts OpenAPI 3 response content at runtime (`getSchemas` in
 * dist/index.js), but declares only the OpenAPI 2 response shape.
 * It validates only the first declared media type; current responses declare one.
 */
type ResponseValidatorArgs = Omit<OpenAPIResponseValidatorArgs, "responses"> & {
  responses: OpenAPIV3.ResponsesObject;
};

import type { paths } from "../dist/openapi-typescript/schema.d.ts";

export type IssuesQuery = NonNullable<
  paths["/issues.{format}"]["get"]["parameters"]["query"]
>;

const REDMINE_URL = process.env.REDMINE_URL;
const REDMINE_ADMIN_LOGIN = process.env.REDMINE_ADMIN_LOGIN;
const REDMINE_ADMIN_PASSWORD = process.env.REDMINE_ADMIN_PASSWORD;
const OPENAPI_PATH = process.env.OPENAPI_PATH;
// When set, every request/response pair is recorded for check-api-coverage.mjs
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
const openapi = yaml.load(
  fs.readFileSync(OPENAPI_PATH, "utf8")
) as OpenAPIV3.Document;

const basicAuth = Buffer.from(
  `${REDMINE_ADMIN_LOGIN}:${REDMINE_ADMIN_PASSWORD}`
).toString("base64");

export const createTestClient = (switchUser?: string) => {
  const client = createClient<paths>({
    baseUrl: `${REDMINE_URL}/`,
    headers: switchUser ? { "X-Redmine-Switch-User": switchUser } : undefined,
    querySerializer: {
      array: { style: "form", explode: false },
      object: { style: "form", explode: true },
    },
  });

  client.use({
    onRequest({ request }) {
      request.headers.set("Authorization", `Basic ${basicAuth}`);
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
        throw new Error(
          `No OpenAPI spec found for ${method.toUpperCase()} ${schemaPath}`
        );
      }

      const responseSchema = responses[status] ?? responses[String(status)];
      if (!responseSchema) {
        throw new Error(
          `No response schema defined for ${method.toUpperCase()} ${schemaPath} status ${status}`
        );
      }

      const args: ResponseValidatorArgs = {
        responses,
        components: openapi.components,
      };
      const validator = new OpenAPIResponseValidator(args);

      if ("content" in responseSchema) {
        const declaredTypes = Object.keys(responseSchema.content!);
        const actualType = (response.headers.get("content-type") ?? "")
          .split(";")[0]
          .trim()
          .toLowerCase();
        const actualParts = actualType.split("/");
        assert(
          actualParts.length === 2 &&
            declaredTypes.some((declared) =>
              declared.toLowerCase().split("/").every(
                (part, index) => part === "*" || part === actualParts[index]
              )
            ),
          `${method.toUpperCase()} ${schemaPath} ${status}: Content-Type '${actualType}' is not declared (${declaredTypes.join(", ")})`
        );

        const isBinary = Object.values(responseSchema.content!).some(
          ({ schema }) => schema && "format" in schema && schema.format === "binary"
        );

        if (!isBinary) {
          const data: unknown = await response.clone().json();
          const validationError = validator.validateResponse(status, data);
          assert(
            !validationError,
            JSON.stringify([validationError, data], null, 2)
          );
        }
      } else {
        const text = await response.clone().text();
        assert.strictEqual(text, "", `Expected empty body, got: ${text}`);
        const validationError = validator.validateResponse(status, undefined);
        assert(!validationError, JSON.stringify(validationError, null, 2));
      }

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

// The ids below are looked up rather than hardcoded: run-test.sh seeds trackers,
// roles and enumerations only when the database has none, so on an image that
// ships default data these ids come from the image and need not start at 1.

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

export const someRoleId = memoize(async () => {
  const response = await client.GET("/roles.{format}", {
    params: { path: { format: "json" } },
  });
  assertStatus(200, response);
  const role = response.data!.roles[0];
  assert(role, "Expected at least one givable role to exist");
  return role.id;
});

export const visibilityRoleId = memoize(async () => {
  const response = await client.GET("/roles.{format}", {
    params: { path: { format: "json" } },
  });
  assertStatus(200, response);
  const role = response.data!.roles.find(
    (role) => role.name === "API visibility viewer"
  );
  assert(role, "Expected the seeded visibility role");
  return role.id;
});

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
