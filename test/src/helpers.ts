import fs from "node:fs";
import { createRequire } from "node:module";
import assert from "node:assert/strict";

import yaml from "js-yaml";
import type { OpenAPIV3 } from "openapi-types";
import createClient from "openapi-fetch";
import type { OpenAPIResponseValidatorArgs } from "openapi-response-validator";

const _require = createRequire(import.meta.url);
const OpenAPIResponseValidator =
  _require("openapi-response-validator").default;

import type { paths } from "../dist/openapi-typescript/schema.d.ts";

const REDMINE_URL = process.env.REDMINE_URL;
const REDMINE_ADMIN_LOGIN = process.env.REDMINE_ADMIN_LOGIN;
const REDMINE_ADMIN_PASSWORD = process.env.REDMINE_ADMIN_PASSWORD;
const OPENAPI_PATH = process.env.OPENAPI_PATH;

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

const openapi = yaml.load(
  fs.readFileSync(OPENAPI_PATH, "utf8")
) as OpenAPIV3.Document;

const basicAuth = Buffer.from(
  `${REDMINE_ADMIN_LOGIN}:${REDMINE_ADMIN_PASSWORD}`
).toString("base64");

export const client = createClient<paths>({
  baseUrl: `${REDMINE_URL}/`,
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

    const responses = openapi.paths[schemaPath]?.[method]?.responses;
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

    const args: OpenAPIResponseValidatorArgs = {
      responses,
      components: openapi.components,
    };
    const validator = new OpenAPIResponseValidator(args);

    if ("content" in responseSchema) {
      const isBinary = Object.values(
        (responseSchema as OpenAPIV3.ResponseObject).content!
      ).some(
        (mediaType) =>
          (mediaType.schema as OpenAPIV3.SchemaObject | undefined)?.format ===
          "binary"
      );

      if (!isBinary) {
        const data = await response.clone().json();
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
