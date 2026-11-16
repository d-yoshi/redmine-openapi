import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const plugin = require("../redocly/plugins/common-responses.js");

test("injects shared errors while preserving an operation's different representation", () => {
  const htmlForbidden = {
    description: "HTML access-denied page",
    content: { "text/html": { schema: { type: "string", format: "binary" } } },
  };
  const operation = { responses: { 403: htmlForbidden } };
  plugin().decorators.oas3["inject-common-responses"]().Operation.leave(operation);
  assert.equal(operation.responses[403], htmlForbidden);
  assert.deepEqual(operation.responses[401], { $ref: "#/components/responses/Unauthorized" });
  assert.deepEqual(operation.responses[412], { $ref: "#/components/responses/PreconditionFailed" });
});
