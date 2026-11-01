import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { load } from "js-yaml";
import { GitHub } from "../scripts/release/github.mjs";
import { dockerVersions, planChecks, reportsFor, runCheck, updateIssues } from "../scripts/canary.mjs";

const json = (value, status = 200) => new Response(JSON.stringify(value), { status });
const config = { standard: "9.2.4", maintenance: ["8.1.7"] };
const check = { target: "9.2.4", candidate: "9.2.5", tag: "9.2.4-r2", sha: "a".repeat(40) };
const context = { checkResult: "success", runUrl: "https://github.com/example/api/actions/runs/1" };

test("Docker detection reads every page, filters aliases and compares versions numerically", async () => {
  const urls = [];
  const versions = await dockerVersions(async (url) => {
    urls.push(url);
    return json(urls.length === 1
      ? { next: "https://hub.docker.com/v2/repositories/library/redmine/tags?page=2", results: ["9.2.9", "9.2", "latest", "9.2.10-alpine", "10.0.0-rc1"].map((name) => ({ name })) }
      : { next: null, results: ["9.2.10", "8.1.7", "09.2.4", "9.2.9"].map((name) => ({ name })) });
  });
  assert.deepEqual(versions, ["8.1.7", "9.2.9", "9.2.10"]);
  assert.equal(urls.length, 2);
});

test("Docker failures, malformed pages and unsafe or cyclic pagination fail detection", async () => {
  for (const next of ["https://elsewhere.example/tags", "https://hub.docker.com/other", "https://hub.docker.com/v2/repositories/library/redmine/tags?page_size=100"]) {
    await assert.rejects(dockerVersions(async () => json({ next, results: [{ name: "9.2.4" }] })), /pagination/);
  }
  await assert.rejects(dockerVersions(async () => json({}, 503)), /HTTP 503/);
  await assert.rejects(dockerVersions(async () => json({ next: null })), /tag list/);
  await assert.rejects(dockerVersions(async () => json({ next: null, results: [{ name: "latest" }] })), /No released/);
});

test("both configured targets select their highest published revision and resolved source SHA", async () => {
  const releases = ["9.2.4-r9", "9.2.4-r10", "8.1.7-r2", "8.1.8-r99"].map((tag_name) => ({ tag_name }));
  releases.push({ tag_name: "8.1.7-r3", draft: true }, { tag_name: "9.2.4-r11", prerelease: true });
  const plan = await planChecks(config, ["8.1.10", "9.2.10", "9.3.0", "10.0.0"], { releases: async () => releases, tagSha: async (tag) => tag.startsWith("9") ? "a".repeat(40) : "b".repeat(40) });
  assert.deepEqual(plan.checks, [
    { target: "9.2.4", candidate: "9.2.10", tag: "9.2.4-r10", sha: "a".repeat(40) },
    { target: "8.1.7", candidate: "8.1.10", tag: "8.1.7-r2", sha: "b".repeat(40) },
  ]);
  assert.equal(plan.newSeries, "10.0.0");
});

test("equal or older images do not trigger tests, and one missing source does not hide the other target", async () => {
  const github = { releases: async () => [{ tag_name: "9.2.4-r2" }], tagSha: async () => check.sha };
  assert.deepEqual((await planChecks(config, ["8.1.6", "9.2.4"], github)).checks, []);
  const plan = await planChecks(config, ["8.1.8", "9.2.5"], github);
  assert.equal(plan.checks[0].sha, check.sha);
  assert.match(plan.checks[1].error, /No published specification/);
  assert.equal(plan.newSeries, null);
  await assert.rejects(planChecks(config, ["9.2.4"], github), /maintained series 8.1/);
});

function sourceFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "canary-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sourceDir = path.join(root, "source");
  const resultsDir = path.join(root, "results");
  fs.mkdirSync(sourceDir);
  const write = (name, value) => { fs.mkdirSync(path.dirname(path.join(sourceDir, name)), { recursive: true }); fs.writeFileSync(path.join(sourceDir, name), value); };
  write("package-lock.json", "{}");
  write(".tool-versions", "nodejs 24.22.1\n");
  write("test/check.sh", "#!/bin/bash\n");
  write("test/run-test.sh", "#!/bin/bash\n");
  write("src/openapi.yaml", `info:\n  version: ${check.tag}\n`);
  write("test/redmine/docker-compose.yaml", `services:\n  redmine:\n    image: redmine:${check.target}\n`);
  const git = (...args) => execFileSync("git", args, { cwd: sourceDir, encoding: "utf8", stdio: "pipe" });
  git("init", "--quiet", "--object-format=sha1");
  git("add", ".");
  git("-c", "user.name=Canary Test", "-c", "user.email=canary-test@example.com", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", "commit", "--quiet", "-m", "fixture");
  return { sourceDir, resultsDir, selected: { ...check, sha: git("rev-parse", "HEAD").trim() } };
}

test("candidate runs use the selected source's dependencies and verify the actual running version", async (t) => {
  const fixture = sourceFixture(t);
  const calls = [];
  const result = await runCheck(fixture.selected, { ...fixture, run: async (command, args, options) => {
    calls.push({ command, args, cwd: options.cwd, image: options.env.REDMINE_IMAGE });
    options.onLine?.(`  Redmine version: ${check.candidate}`);
    return 0;
  } });
  assert.equal(result.status, "success");
  assert.deepEqual(calls.map((entry) => [entry.command, entry.args]), [["npm", ["ci"]], ["./test/run-test.sh", []]]);
  assert(calls.every((entry) => entry.cwd === fixture.sourceDir && entry.image === `redmine:${check.candidate}`));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(fixture.resultsDir, `${check.target}.json`), "utf8")), result);
  for (const actual of [undefined, check.target]) {
    const failed = await runCheck(fixture.selected, { ...fixture, run: async (_command, _args, options) => {
      if (actual) options.onLine?.(`  Redmine version: ${actual}`);
      return 0;
    } });
    assert.equal(failed.status, "failure");
    assert.equal(failed.phase, "image");
  }
});

test("dependency, validation, startup, fixture, API test and coverage failures remain distinct", async (t) => {
  const fixture = sourceFixture(t);
  for (const [phase, marker] of [["dependencies", null], ["validation", ""], ["startup", "=== Starting Redmine ==="], ["fixtures", "=== Setting up Redmine ==="], ["tests", "=== Running tests ==="], ["coverage", "=== Checking API coverage ==="]]) {
    const result = await runCheck(fixture.selected, { ...fixture, run: async (command, _args, options) => {
      if (command === "npm") return phase === "dependencies" ? 1 : 0;
      options.onLine(marker);
      return 1;
    } });
    assert.equal(result.status, "failure");
    assert.equal(result.phase, phase);
  }
  const mismatched = await runCheck(check, { ...fixture, run: async () => { throw new Error("Must not run a mismatched source"); } });
  assert.equal(mismatched.phase, "source");
  assert.match(mismatched.error, /selected published tag/);
  fs.rmSync(path.join(fixture.sourceDir, "package-lock.json"));
  assert.match((await runCheck(fixture.selected, { ...fixture, run: async () => 0 })).error, /current test foundation/);
});

test("reports distinguish missing results from API test failure without claiming an API change", () => {
  const plan = { checks: [check], newSeries: "10.0.2" };
  const missing = reportsFor(plan, [], context);
  assert.match(missing[0].title, /setup failed/);
  const failed = reportsFor(plan, [{ ...check, status: "failure", phase: "tests", error: "assertion failed" }], context);
  assert.match(failed[0].title, /tests failed/);
  assert.match(failed[0].body, /does not by itself establish an API behavior change/);
  const passed = reportsFor(plan, [{ ...check, status: "success", phase: "complete" }], context);
  assert.match(passed[0].title, /tests pass/);
  assert.equal(missing[0].key, failed[0].key);
  assert.equal(passed[0].key, failed[0].key);
  assert.equal(passed[1].key, "series:10.0");
  assert.match(reportsFor(plan, [{ ...check, sha: "b".repeat(40), status: "success" }], context)[0].title, /setup failed/);
  assert.equal(reportsFor(null, [], { ...context, checkResult: "failure" })[0].key, "detection");
  assert.equal(reportsFor(null, [], context)[0].key, "detection");
  assert.match(reportsFor(plan, [null, {}, { ...check, status: "success" }], context)[0].title, /setup failed/);
});

test("stable issue markers find later pages, ignore pull requests and update changed outcomes", async () => {
  const report = reportsFor({ checks: [check] }, [], context)[0];
  const marker = `<!-- redmine-openapi-canary:${report.key} -->`;
  const existing = { number: 999, title: "previous tests pass", body: marker };
  const writes = [];
  const github = new GitHub({ repository: "example/api", token: "test-token", fetchImpl: async (url, options) => {
    if (options.method === "GET") return json(url.endsWith("page=1") ? Array.from({ length: 100 }, (_, number) => ({ number, body: marker, pull_request: {} })) : [existing]);
    assert(url.endsWith("/issues/999"));
    assert.equal(options.method, "PATCH");
    const update = JSON.parse(options.body);
    writes.push(update);
    Object.assign(existing, update);
    return json(existing);
  } });
  await updateIssues(github, [report]);
  await updateIssues(github, [report]);
  assert.equal(writes.length, 1);
  assert(writes[0].body.includes(marker));
  assert.equal(writes[0].title, report.title);
  await updateIssues({ list: () => { throw new Error("No issues need to be read"); } }, []);
});

test("manual summary mode ignores failed artifact downloads and never calls GitHub", (t) => {
  const fixture = sourceFixture(t);
  fs.mkdirSync(fixture.resultsDir);
  fs.writeFileSync(path.join(fixture.resultsDir, `${check.target}.json`), JSON.stringify({ ...check, status: "success" }));
  const summary = path.join(fixture.resultsDir, "summary.md");
  execFileSync("node", ["scripts/canary.mjs", "report"], { env: { ...process.env, GH_TOKEN: "", CANARY_NOTIFY: "false", CANARY_DOWNLOAD_RESULT: "failure", CANARY_PLAN: JSON.stringify({ checks: [check] }), CANARY_CHECK_RESULT: "success", CANARY_RESULTS_DIR: fixture.resultsDir, GITHUB_STEP_SUMMARY: summary, GITHUB_SERVER_URL: "https://github.com", GITHUB_REPOSITORY: "example/api", GITHUB_RUN_ID: "1" } });
  const text = fs.readFileSync(summary, "utf8");
  assert.match(text, /setup failed/);
  assert(!text.includes("tests pass"));
});

test("the workflow isolates candidate code from issue-write permission and supports independent series", () => {
  const workflow = load(fs.readFileSync(new URL("../.github/workflows/canary.yaml", import.meta.url), "utf8"));
  assert.deepEqual(workflow.permissions, { contents: "read" });
  assert.equal(workflow.jobs.report.permissions.issues, "write");
  assert.equal(workflow.jobs.test.permissions, undefined);
  assert.equal(workflow.jobs.test.strategy["fail-fast"], false);
  assert.equal(workflow.on.workflow_dispatch.inputs.notify.default, false);
  assert(workflow.jobs.check.if.includes("repository.default_branch"));
});
