import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./check-api-coverage.mjs", import.meta.url));
const query = (name) => ({ name, in: "query", schema: { type: "string" } });
const get = (...parameters) => ({
  get: { parameters, responses: { 200: { description: "OK" } } },
});
const request = (schemaPath, values = {}) => {
  const url = new URL(
    schemaPath.replace(".{format}", ".json").replace(/\{[^}]+\}/g, "1"),
    "http://redmine.test"
  );
  url.search = new URLSearchParams(values).toString();
  return `GET ${schemaPath} 200 ${url}`;
};

const check = (t, paths, requests, parameters = {}) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "api-coverage-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const spec = {
    openapi: "3.0.3",
    info: { title: "Coverage fixture", version: "1" },
    paths: {
      // The CLI requires its unreachable-response entry to remain declared.
      "/time_entries/{time_entry_id}.{format}": {
        delete: {
          responses: {
            204: { description: "Deleted" },
            422: { description: "Unreachable" },
          },
        },
      },
      "/time_entries/destroy.{format}": {
        delete: {
          responses: { 204: { description: "Deleted" }, 422: { description: "Unreachable" } },
        },
      },
      ...paths,
    },
    components: { parameters },
  };
  const specPath = path.join(directory, "spec.json");
  const logPath = path.join(directory, "observed.txt");
  fs.writeFileSync(specPath, JSON.stringify(spec));
  fs.writeFileSync(
    logPath,
    [
      "DELETE /time_entries/{time_entry_id}.{format} 204 http://redmine.test/time_entries/1.json",
      "DELETE /time_entries/destroy.{format} 204 http://redmine.test/time_entries/destroy.json",
      ...requests,
    ].join("\n")
  );
  const result = spawnSync(process.execPath, [script, specPath, logPath], { encoding: "utf8" });
  assert.ifError(result.error);
  assert.equal(result.signal, null, result.stderr);
  return result;
};

test("the same query name on a different resource does not satisfy coverage", (t) => {
  const result = check(
    t,
    {
      "/issues.{format}": get(query("project.status")),
      "/time_entries.{format}": get(query("project.status")),
    },
    [request("/issues.{format}", { "project.status": "1" }), request("/time_entries.{format}")]
  );
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /no test sends the declared query parameter GET \/time_entries\.\{format\} \?project\.status/
  );
  assert.doesNotMatch(result.stderr, /GET \/issues\.\{format\} \?project\.status/);
});

for (const resource of ["issues", "time_entries"]) {
  test(`${resource} filters are shared between global and project-scoped lists`, (t) => {
    const global = `/${resource}.{format}`;
    const scoped = `/projects/{project_id}/${resource}.{format}`;
    for (const source of [global, scoped]) {
      const result = check(
        t,
        {
          [global]: get(query("project.status")),
          [scoped]: get(query("project.status")),
        },
        [global, scoped].map((route) =>
          request(route, route === source ? { "project.status": "1" } : {})
        )
      );
      assert.equal(result.status, 0, result.stderr);
    }
  });
}

test("only a parameter declared on the called operation can satisfy coverage", (t) => {
  const result = check(
    t,
    {
      "/issues.{format}": get(),
      "/projects/{project_id}/issues.{format}": get(query("subject")),
    },
    [
      request("/issues.{format}", { subject: "fixture" }),
      request("/projects/{project_id}/issues.{format}"),
    ]
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /GET \/issues\.\{format\} \?subject/);
});

test("common pagination definitions share coverage across resources", (t) => {
  const parameters = Object.fromEntries(
    ["offset", "limit", "page", "nometa"].map((name) => [name, query(name)])
  );
  const references = Object.keys(parameters).map((name) => ({
    $ref: `#/components/parameters/${name}`,
  }));
  const result = check(
    t,
    {
      "/issues.{format}": get(...references),
      "/projects.{format}": get(...references),
    },
    [
      request("/issues.{format}", { offset: "0", limit: "1", page: "2", nometa: "1" }),
      request("/projects.{format}"),
    ],
    parameters
  );
  assert.equal(result.status, 0, result.stderr);
});

test("an inline parameter named like pagination remains operation-specific", (t) => {
  const result = check(
    t,
    {
      "/issues.{format}": get({ $ref: "#/components/parameters/offset" }),
      "/projects.{format}": get(query("offset")),
    },
    [request("/issues.{format}", { offset: "0" }), request("/projects.{format}")],
    {
      offset: query("offset"),
    }
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /GET \/projects\.\{format\} \?offset/);
});

test("equivalent methods share response checks while each method must be called", (t) => {
  const responses = { 204: { description: "Updated" }, 404: { description: "Not found" } };
  const route = "/issues/{issue_id}.{format}";
  const paths = { [route]: { put: { responses }, patch: { responses } } };
  const canonical = [
    `PUT ${route} 204 http://redmine.test/issues/1.json`,
    `PUT ${route} 404 http://redmine.test/issues/999.json`,
  ];
  const result = check(t, paths, [
    ...canonical,
    `PATCH ${route} 204 http://redmine.test/issues/1.json`,
  ]);
  assert.equal(result.status, 0, result.stderr);
  const missingMethod = check(t, paths, canonical);
  assert.equal(missingMethod.status, 1);
  assert.match(missingMethod.stderr, /no test calls PATCH/);
  const onlyNotFound = check(t, paths, [
    ...canonical,
    `PATCH ${route} 404 http://redmine.test/issues/999.json`,
  ]);
  assert.equal(onlyNotFound.status, 1);
  assert.match(onlyNotFound.stderr, /no successful test call for PATCH/);
});

test("method aliases with different contracts cannot share response checks", (t) => {
  const route = "/issues/{issue_id}.{format}";
  const result = check(
    t,
    {
      [route]: {
        put: { responses: { 204: { description: "Updated" } } },
        patch: {
          responses: { 204: { description: "Updated" }, 404: { description: "Not found" } },
        },
      },
    },
    [
      `PUT ${route} 204 http://redmine.test/issues/1.json`,
      `PATCH ${route} 204 http://redmine.test/issues/1.json`,
    ]
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /PATCH .*must share the declared contract of PUT/);
});

test("shared explicit-filter encoding recognizes bracketed operator and value keys", (t) => {
  const parameters = {
    filter_fields: query("f[]"),
    filter_operators: query("op"),
    filter_values: query("v"),
  };
  const references = Object.keys(parameters).map((name) => ({
    $ref: `#/components/parameters/${name}`,
  }));
  const result = check(
    t,
    {
      "/issues.{format}": get(...references),
      "/users.{format}": get(...references),
    },
    [
      request("/issues.{format}", {
        "f[]": "project_id",
        "op[project_id]": "=",
        "v[project_id][]": "1",
      }),
      request("/users.{format}"),
    ],
    parameters
  );
  assert.equal(result.status, 0, result.stderr);
});

test("associated custom-field keys count only for a declared filter family", (t) => {
  const result = check(
    t,
    {
      "/issues.{format}": get(query("cf_x")),
      "/time_entries.{format}": get(query("cf_x")),
    },
    [
      request("/issues.{format}", { "project.cf_12": "value" }),
      request("/time_entries.{format}", { "issue.cf_12": "value" }),
    ]
  );
  assert.equal(result.status, 0, result.stderr);
  const wrongResource = check(
    t,
    {
      "/issues.{format}": get(),
      "/time_entries.{format}": get(query("cf_x")),
    },
    [request("/issues.{format}", { "issue.cf_12": "value" }), request("/time_entries.{format}")]
  );
  assert.equal(wrongResource.status, 1);
  assert.match(wrongResource.stderr, /GET \/time_entries\.\{format\} \?cf_x/);
});

test("operation parameters override path-level parameters", (t) => {
  const result = check(
    t,
    {
      "/issues.{format}": {
        parameters: [{ $ref: "#/components/parameters/offset" }],
        ...get(query("offset")),
      },
    },
    [request("/issues.{format}", { offset: "0" })],
    { offset: query("offset") }
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /1 query parameter checks/);
});

test("concrete custom-field query keys satisfy the declared cf_x family", (t) => {
  const result = check(
    t,
    {
      "/issues.{format}": get(query("cf_x")),
    },
    [request("/issues.{format}", { cf_42: "fixture" })]
  );
  assert.equal(result.status, 0, result.stderr);
});
