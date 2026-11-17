import assert from "node:assert/strict";
import { test } from "node:test";
import { createResponseValidator } from "./src/response-validator.ts";

test("validates calendar dates and timezone-qualified timestamps, including nullable values", async () => {
  const validate = createResponseValidator({
    200: {
      description: "",
      content: {
        "application/json": {
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["date", "timestamp"],
            properties: {
              date: { type: "string", format: "date", nullable: true },
              timestamp: { type: "string", format: "date-time", nullable: true },
            },
          },
        },
      },
    },
  });
  const check = (value) => validate(Response.json(value));
  await check({ date: "2024-02-29", timestamp: "2024-02-29T12:34:56+09:00" });
  await check({ date: null, timestamp: null });
  for (const value of [
    { date: "2023-02-29", timestamp: null },
    { date: "2024-13-01", timestamp: null },
    { date: null, timestamp: "2024-02-30T12:34:56Z" },
    { date: null, timestamp: "2024-02-29T12:34:56" },
  ])
    await assert.rejects(check(value));
});

test("checks JSON when HTML is listed first and permits a declared empty JSON response", async () => {
  const validate = createResponseValidator({
    404: {
      description: "",
      content: {
        "text/html": { schema: { type: "string", format: "binary" } },
        "application/json": {
          schema: {
            type: "object",
            nullable: true,
            additionalProperties: false,
            properties: { status: { type: "integer" } },
          },
        },
      },
    },
  });
  await validate(new Response(null, { status: 404 }));
  await validate(Response.json({ status: 404 }, { status: 404 }));
  await validate(
    new Response("<html>Error</html>", { status: 404, headers: { "Content-Type": "text/html" } })
  );
  await assert.rejects(validate(Response.json({ status: "404" }, { status: 404 })));
  await assert.rejects(
    validate(new Response("invalid", { status: 404, headers: { "Content-Type": "text/plain" } }))
  );
  await assert.rejects(
    validate(new Response(null, { status: 404, headers: { "Content-Type": "text/plain" } }))
  );
});
