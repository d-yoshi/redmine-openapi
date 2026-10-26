// Compare declared operations, statuses and query names with the request log
// produced by helpers.ts. Unreachable responses need a reason in UNREACHABLE.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { load } from "js-yaml";

const METHODS = ["get", "post", "put", "patch", "delete", "head", "options"];

// Globally injected statuses are excluded: fixed Basic credentials cannot
// exercise them all. Dedicated permission tests cover selected 403 responses.
const AUTO_INJECTED = new Set(["401", "403", "412"]);

// Each pair uses the same Query class for global and project-scoped lists.
const QUERY_OPERATION_ALIASES = new Map([
  ["GET /projects/{project_id}/issues.{format}", "GET /issues.{format}"],
  ["GET /projects/{project_id}/time_entries.{format}", "GET /time_entries.{format}"],
]);

// Only these shared definitions use the common pagination helpers.
const PAGINATION_PARAMETERS = new Set([
  "#/components/parameters/offset",
  "#/components/parameters/limit",
  "#/components/parameters/nometa",
]);

const UNREACHABLE = [
  {
    operation: "DELETE /time_entries/{time_entry_id}.{format}",
    status: "422",
    reason:
      "render_validation_errors exists in timelog_controller.rb but destroy " +
      "only fails on a callback abort, which the API cannot trigger",
  },
];

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const specPath = process.argv[2] ?? path.join(scriptDir, "dist/openapi.strict.yaml");
const observedPath = process.argv[3] ?? path.join(scriptDir, "dist/observed.txt");

for (const [label, file] of [["spec", specPath], ["observed log", observedPath]]) {
  if (!fs.existsSync(file)) {
    console.error(`${label} not found: ${file}`);
    console.error("Run ./run-test.sh first; it generates both.");
    process.exit(1);
  }
}

const spec = load(fs.readFileSync(specPath, "utf8"));
const deref = (node) =>
  node?.$ref
    ? deref(node.$ref.slice(2).split("/").reduce((o, key) => o[key], spec))
    : node;

const declaredOperations = new Set();
const declaredResponses = new Set();
const declaredQueryParams = new Set();
const queryParamsByOperation = new Map();
for (const [urlPath, pathItem] of Object.entries(spec.paths)) {
  for (const method of METHODS) {
    if (!pathItem[method]) continue;
    const operation = `${method.toUpperCase()} ${urlPath}`;
    declaredOperations.add(operation);
    for (const status of Object.keys(pathItem[method].responses)) {
      if (AUTO_INJECTED.has(String(status))) continue;
      declaredResponses.add(`${operation} ${status}`);
    }
    const parameters = [
      ...(pathItem.parameters ?? []),
      ...(pathItem[method].parameters ?? []),
    ];
    const queryParams = new Map();
    for (const reference of parameters) {
      const parameter = deref(reference);
      if (parameter.in !== "query") continue;
      const scope = PAGINATION_PARAMETERS.has(reference.$ref)
        ? "shared pagination"
        : QUERY_OPERATION_ALIASES.get(operation) ?? operation;
      queryParams.set(parameter.name, `${scope} ?${parameter.name}`);
    }
    queryParamsByOperation.set(operation, queryParams);
    for (const key of queryParams.values()) declaredQueryParams.add(key);
  }
}

const observedResponses = new Set();
const observedOperations = new Set();
const observedQueryParams = new Set();
for (const line of fs.readFileSync(observedPath, "utf8").split("\n")) {
  if (!line) continue;
  const [method, urlPath, status, url] = line.split(" ");
  const operation = `${method} ${urlPath}`;
  observedOperations.add(operation);
  observedResponses.add(`${method} ${urlPath} ${status}`);
  if (!url) continue;
  for (const key of new URL(url).searchParams.keys()) {
    // The spec spells the custom-field filter family as the literal `cf_x`;
    // requests carry a concrete id
    const name = /^cf_\d+$/.test(key) ? "cf_x" : key;
    const declaredKey = queryParamsByOperation.get(operation)?.get(name);
    if (declaredKey) observedQueryParams.add(declaredKey);
  }
}

const allowed = new Map(
  UNREACHABLE.map((entry) => [`${entry.operation} ${entry.status}`, entry])
);

const errors = [];

for (const operation of [...declaredOperations].sort()) {
  if (!observedOperations.has(operation)) {
    errors.push(`no test calls ${operation}`);
  }
}

for (const response of [...declaredResponses].sort()) {
  if (observedResponses.has(response) || allowed.has(response)) continue;
  errors.push(
    `${response} is declared but no test produces it ` +
      `(assert it, or add it to UNREACHABLE with a reason)`
  );
}

for (const key of [...declaredQueryParams].sort()) {
  if (!observedQueryParams.has(key)) {
    errors.push(`no test sends the declared query parameter ${key}`);
  }
}

for (const [key] of allowed) {
  if (!declaredResponses.has(key)) {
    errors.push(`UNREACHABLE lists ${key}, which the spec no longer declares`);
  } else if (observedResponses.has(key)) {
    errors.push(
      `UNREACHABLE lists ${key} but the suite now reaches it; remove the entry`
    );
  }
}

// The middleware already throws on an undeclared status; this only fires if it
// was bypassed.
for (const response of [...observedResponses].sort()) {
  const status = response.slice(response.lastIndexOf(" ") + 1);
  const operation = response.slice(0, response.lastIndexOf(" "));
  if (!declaredOperations.has(operation)) {
    errors.push(`a test called ${operation}, which the spec does not declare`);
  } else if (!declaredResponses.has(response) && !AUTO_INJECTED.has(status)) {
    errors.push(`${response} was returned but the spec does not declare it`);
  }
}

if (errors.length > 0) {
  for (const error of errors) console.error(`  ${error}`);
  console.error(`\n${errors.length} API-coverage problem(s) found.`);
  process.exit(1);
}

console.log(
  `API coverage: ${declaredOperations.size} operations, ` +
    `${declaredResponses.size} responses (${allowed.size} unreachable by design), ` +
    `${declaredQueryParams.size} query parameter checks.`
);
