import assert from "node:assert/strict";
import { createRequire } from "node:module";
import type { OpenAPIV3 } from "openapi-types";
import type { OpenAPIResponseValidatorArgs } from "openapi-response-validator";

// The package accepts OpenAPI 3 responses but declares the OpenAPI 2 shape.
type ValidatorArgs = Omit<OpenAPIResponseValidatorArgs, "responses"> & {
  responses: OpenAPIV3.ResponsesObject;
};
const require = createRequire(import.meta.url);
const formats: {
  get(name: "date" | "date-time"): { validate(value: string): boolean };
} = require("ajv-formats");
const Validator: new (args: ValidatorArgs) => {
  validateResponse(status: number, body: unknown): unknown;
} = require("openapi-response-validator").default;

export const createResponseValidator = (
  responses: OpenAPIV3.ResponsesObject,
  components?: OpenAPIV3.ComponentsObject
) => {
  const resolved = Object.fromEntries(
    Object.entries(responses).map(([status, response]) => {
      if (!("$ref" in response)) return [status, response];
      const name = response.$ref.replace("#/components/responses/", "");
      const definition = components?.responses?.[name];
      assert(
        definition && !("$ref" in definition),
        `Unresolved response reference: ${response.$ref}`
      );
      return [status, definition];
    })
  );
  // The library selects the first media type. Binary representations are checked
  // separately below, so compile the JSON representation when one is declared.
  const jsonResponses = Object.fromEntries(
    Object.entries(resolved).map(([status, response]) => [
      status,
      "content" in response && response.content?.["application/json"]
        ? { ...response, content: { "application/json": response.content["application/json"] } }
        : response,
    ])
  );
  const validator = new Validator({
    responses: jsonResponses,
    components,
    customFormats: {
      date: formats.get("date").validate,
      "date-time": formats.get("date-time").validate,
    },
  });

  return async (response: Response) => {
    const definition = resolved[response.status];
    assert(definition, `No response schema for status ${response.status}`);
    assert(!("$ref" in definition), "Response references must be resolved before validation");
    if (!definition.content) {
      const text = await response.clone().text();
      assert.equal(text, "", `Expected an empty response body, got: ${text}`);
      const error = validator.validateResponse(response.status, undefined);
      assert(!error, JSON.stringify(error, null, 2));
      return;
    }
    const actualType = (response.headers.get("content-type") ?? "")
      .split(";")[0]
      .trim()
      .toLowerCase();
    const media = Object.entries(definition.content).find(
      ([declared]) =>
        actualType.split("/").length === 2 &&
        declared
          .toLowerCase()
          .split("/")
          .every((part, index) => part === "*" || part === actualType.split("/")[index])
    );
    const schema = media?.[1].schema;
    if (schema && "format" in schema && schema.format === "binary") return;
    const text = await response.clone().text();
    const json = definition.content["application/json"];
    const emptyJson =
      actualType === "" &&
      text === "" &&
      json?.schema &&
      "nullable" in json.schema &&
      json.schema.nullable;
    assert(
      media || emptyJson,
      `Content-Type '${actualType}' is not declared (${Object.keys(definition.content).join(", ")})`
    );
    const data: unknown = text === "" ? null : JSON.parse(text);
    const error = validator.validateResponse(response.status, data);
    assert(!error, JSON.stringify([error, data], null, 2));
  };
};
