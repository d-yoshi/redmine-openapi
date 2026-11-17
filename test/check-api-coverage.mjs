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

// Both methods in each pair use the same Redmine controller action.
const METHOD_ALIASES = new Map([
  ["PATCH /journals/{journal_id}.{format}", "PUT /journals/{journal_id}.{format}"],
  ["PATCH /users/{user_id}.{format}", "PUT /users/{user_id}.{format}"],
  ["PATCH /memberships/{membership_id}.{format}", "PUT /memberships/{membership_id}.{format}"],
  [
    "PATCH /issue_categories/{issue_category_id}.{format}",
    "PUT /issue_categories/{issue_category_id}.{format}",
  ],
  [
    "PATCH /projects/{project_id}/wiki/{wiki_page_title}.{format}",
    "PUT /projects/{project_id}/wiki/{wiki_page_title}.{format}",
  ],
  ["PATCH /projects/{project_id}.{format}", "PUT /projects/{project_id}.{format}"],
  ["PATCH /issues/{issue_id}.{format}", "PUT /issues/{issue_id}.{format}"],
  ["PATCH /news/{news_id}.{format}", "PUT /news/{news_id}.{format}"],
  ["PATCH /versions/{version_id}.{format}", "PUT /versions/{version_id}.{format}"],
  ["PATCH /time_entries/{time_entry_id}.{format}", "PUT /time_entries/{time_entry_id}.{format}"],
  ["PATCH /groups/{group_id}.{format}", "PUT /groups/{group_id}.{format}"],
  ["PUT /attachments/{attachment_id}.{format}", "PATCH /attachments/{attachment_id}.{format}"],
  ["POST /projects/{project_id}/archive.{format}", "PUT /projects/{project_id}/archive.{format}"],
  [
    "POST /projects/{project_id}/unarchive.{format}",
    "PUT /projects/{project_id}/unarchive.{format}",
  ],
  ["POST /projects/{project_id}/close.{format}", "PUT /projects/{project_id}/close.{format}"],
  ["POST /projects/{project_id}/reopen.{format}", "PUT /projects/{project_id}/reopen.{format}"],
]);

// These routes share query-parameter processing.
const QUERY_OPERATION_ALIASES = new Map([
  ["GET /projects/{project_id}/issues.{format}", "GET /issues.{format}"],
  ["GET /projects/{project_id}/time_entries.{format}", "GET /time_entries.{format}"],
  ["POST /projects/{project_id}/issues.{format}", "POST /issues.{format}"],
  ["DELETE /issues.{format}", "DELETE /issues/{issue_id}.{format}"],
]);

// Only these shared definitions use the common pagination helpers.
const PAGINATION_PARAMETERS = new Set([
  "#/components/parameters/offset",
  "#/components/parameters/limit",
  "#/components/parameters/nometa",
  "#/components/parameters/page",
]);

const SHARED_FILTER_PARAMETERS = new Set([
  "#/components/parameters/filter_fields",
  "#/components/parameters/filter_operators",
  "#/components/parameters/filter_values",
]);

const UNREACHABLE = [
  {
    operation: "DELETE /time_entries/destroy.{format}",
    status: "422",
    reason:
      "Deletion can fail only through a callback abort, which the stock API cannot trigger",
  },
  {
    operation: "DELETE /time_entries/{time_entry_id}.{format}",
    status: "422",
    reason:
      "Deletion can fail only through a callback abort, which the stock API cannot trigger",
  },
];

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const specPath = process.argv[2] ?? path.join(scriptDir, "dist/openapi.strict.yaml");
const observedPath = process.argv[3] ?? path.join(scriptDir, "dist/observed.txt");

for (const [label, file] of [
  ["spec", specPath],
  ["observed log", observedPath],
]) {
  if (!fs.existsSync(file)) {
    console.error(`${label} not found: ${file}`);
    console.error("Run ./run-test.sh first; it generates both.");
    process.exit(1);
  }
}

const spec = load(fs.readFileSync(specPath, "utf8"));
const deref = (node) =>
  node?.$ref
    ? deref(
        node.$ref
          .slice(2)
          .split("/")
          .reduce((o, key) => o[key], spec)
      )
    : node;

const declaredOperations = new Set();
const operationDefinitions = new Map();
const declaredResponses = new Set();
const declaredQueryParams = new Set();
const queryParamsByOperation = new Map();
for (const [urlPath, pathItem] of Object.entries(spec.paths)) {
  for (const method of METHODS) {
    if (!pathItem[method]) continue;
    const operation = `${method.toUpperCase()} ${urlPath}`;
    declaredOperations.add(operation);
    operationDefinitions.set(operation, pathItem[method]);
    for (const status of Object.keys(pathItem[method].responses)) {
      if (AUTO_INJECTED.has(String(status))) continue;
      declaredResponses.add(`${operation} ${status}`);
    }
    const parameters = [...(pathItem.parameters ?? []), ...(pathItem[method].parameters ?? [])];
    const queryParams = new Map();
    for (const reference of parameters) {
      const parameter = deref(reference);
      if (parameter.in !== "query") continue;
      const scope = PAGINATION_PARAMETERS.has(reference.$ref)
        ? "shared pagination"
        : SHARED_FILTER_PARAMETERS.has(reference.$ref)
          ? "shared filter encoding"
          : (QUERY_OPERATION_ALIASES.get(operation) ?? operation);
      queryParams.set(parameter.name, `${scope} ?${parameter.name}`);
    }
    queryParamsByOperation.set(operation, queryParams);
    for (const key of queryParams.values()) declaredQueryParams.add(key);
  }
}

const responseContract = (response) => {
  const split = response.lastIndexOf(" ");
  const operation = response.slice(0, split);
  return `${METHOD_ALIASES.get(operation) ?? operation}${response.slice(split)}`;
};

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
    const name =
      /^(?:(?:project|user|issue|author|assigned_to|fixed_version)\.)?cf_\d+(?:\.(?:cf_\d+|due_date|status))?$/.test(
        key
      )
        ? "cf_x"
        : /^op\[/.test(key)
          ? "op"
          : /^v\[/.test(key)
            ? "v"
            : key;
    const declaredKey = queryParamsByOperation.get(operation)?.get(name);
    if (declaredKey) observedQueryParams.add(declaredKey);
  }
}

const observedResponseContracts = new Set([...observedResponses].map(responseContract));

const allowed = new Map(UNREACHABLE.map((entry) => [`${entry.operation} ${entry.status}`, entry]));

const errors = [];

for (const [alias, canonical] of METHOD_ALIASES) {
  const aliasDefinition = operationDefinitions.get(alias);
  if (!aliasDefinition) continue;
  const canonicalDefinition = operationDefinitions.get(canonical);
  const contract = (operation) =>
    JSON.stringify([
      operation?.parameters ?? [],
      operation?.requestBody ?? null,
      operation?.responses,
      operation?.security ?? spec.security,
    ]);
  if (!canonicalDefinition || contract(aliasDefinition) !== contract(canonicalDefinition)) {
    errors.push(
      `${alias} must share the declared contract of ${canonical} to share response coverage`
    );
  }
  if (![...observedResponses].some((response) => response.startsWith(`${alias} 2`))) {
    errors.push(`no successful test call for ${alias}`);
  }
}

for (const operation of [...declaredOperations].sort()) {
  if (!observedOperations.has(operation)) {
    errors.push(`no test calls ${operation}`);
  }
}

for (const response of [...declaredResponses].sort()) {
  if (observedResponseContracts.has(responseContract(response)) || allowed.has(response)) continue;
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
    errors.push(`UNREACHABLE lists ${key} but the suite now reaches it; remove the entry`);
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
