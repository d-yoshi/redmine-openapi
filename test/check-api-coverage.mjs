// Verifies that the suite exercises what the spec declares: every operation,
// every response status, and every query parameter name. Reads the log helpers.ts
// writes when OBSERVED_LOG is set, so coverage is measured from real requests
// rather than by grepping the sources.
//
// Unreachable responses go in UNREACHABLE with a reason. That list is checked for
// staleness both ways — an entry the spec no longer declares, or one the suite now
// reaches, fails the check — so it cannot silently rot.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const METHODS = ["get", "post", "put", "patch", "delete", "head", "options"];

// Injected into every operation by redocly/plugins/common-responses.js. The
// tests authenticate with fixed Basic credentials, so 401/412 are unreachable
// and 403 is only reachable on the few operations that check a permission.
//
// Limitation: because these are excluded wholesale, this check does not notice
// if the one test that does assert a 403 (watchers.test.ts) is removed. Making
// it notice would mean listing per-operation which injected statuses are
// expected, which is not worth the bookkeeping for a single case.
const AUTO_INJECTED = new Set(["401", "403", "412"]);

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

const spec = yaml.load(fs.readFileSync(specPath, "utf8"));
const deref = (node) =>
  node?.$ref
    ? deref(node.$ref.slice(2).split("/").reduce((o, key) => o[key], spec))
    : node;

const declaredOperations = new Set();
const declaredResponses = new Set();
const declaredQueryParams = new Set();
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
    ].map(deref);
    for (const parameter of parameters) {
      if (parameter.in === "query") declaredQueryParams.add(parameter.name);
    }
  }
}

const observedResponses = new Set();
const observedOperations = new Set();
const observedQueryParams = new Set();
for (const line of fs.readFileSync(observedPath, "utf8").split("\n")) {
  if (!line) continue;
  const [method, urlPath, status, url] = line.split(" ");
  observedOperations.add(`${method} ${urlPath}`);
  observedResponses.add(`${method} ${urlPath} ${status}`);
  if (!url) continue;
  for (const key of new URL(url).searchParams.keys()) {
    // The spec spells the custom-field filter family as the literal `cf_x`;
    // requests carry a concrete id
    observedQueryParams.add(/^cf_\d+$/.test(key) ? "cf_x" : key);
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

// Name-level, not per-operation: a filter declared on both `GET /issues` and
// `GET /projects/{id}/issues` goes through the same query builder, so exercising
// it on one of them is enough.
for (const name of [...declaredQueryParams].sort()) {
  if (!observedQueryParams.has(name)) {
    errors.push(`no test sends the declared query parameter ?${name}`);
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
    `${declaredQueryParams.size} query parameters.`
);
