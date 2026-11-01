import assert from "node:assert/strict";
import test from "node:test";

import { GitHub } from "../scripts/release/github.mjs";
import { PUBLISH_WORKFLOW, REQUEST_WORKFLOW, SITE_MARKER } from "../scripts/release/policy.mjs";
import { prepareRequest } from "../scripts/release/cli.mjs";
import { payload } from "./fixtures/release.mjs";

const json = (value, status = 200) => new Response(JSON.stringify(value), { status });
const client = (options) => new GitHub({ repository: "example/api", token: "test-token", ...options });

test("only a missing Latest is treated as absent; permission and network failures propagate", async () => {
  assert.equal(await client({ fetchImpl: async () => json({}, 404) }).latest(), null);
  await assert.rejects(client({ fetchImpl: async () => json({}, 403) }).latest(), /HTTP 403/);
  await assert.rejects(client({ fetchImpl: async () => { throw new Error("offline"); } }).latest(), /offline/);
});

test("signed asset redirects are downloaded without the repository token", async () => {
  const calls = [];
  const github = client({ fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return calls.length === 1 ? new Response(null, { status: 302, headers: { location: "https://assets.example/payload?signature=token" } }) : new Response("asset");
  } });
  assert.equal((await github.asset({ id: 1 })).toString(), "asset");
  assert.equal(calls[0].options.headers.Authorization, "Bearer test-token");
  assert.equal(calls[1].options.headers, undefined);
  await assert.rejects(github.request("https://elsewhere.example/private"), /origin/);
});

test("canonical public tags peel annotated tags and never use local refs", async () => {
  const sha = "a".repeat(40);
  const calls = [];
  const github = client({ fetchImpl: async (url) => {
    calls.push(url);
    return json({ object: calls.length === 1 ? { type: "tag", sha: "b".repeat(40) } : { type: "commit", sha } });
  } });
  assert.equal(await github.tagSha("9.2.4-r2"), sha);
  assert(calls[0].endsWith("/git/ref/tags/9.2.4-r2"));
  assert(calls[1].endsWith(`/git/tags/${"b".repeat(40)}`));
});

test("release enumeration includes later API pages", async () => {
  const urls = [];
  const github = client({ fetchImpl: async (url) => {
    urls.push(url);
    return json(urls.length === 1 ? Array.from({ length: 100 }, (_, id) => ({ id })) : [{ id: 100 }]);
  } });
  assert.equal((await github.releases()).length, 101);
  assert(urls[1].endsWith("per_page=100&page=2"));
});

test("draft lookup uses all release pages when the tag endpoint returns 404", async () => {
  const tag = "9.2.4-r2";
  const draft = { id: 4, tag_name: tag, draft: true, assets: [{ name: "incomplete" }] };
  const urls = [];
  const github = client({ fetchImpl: async (url) => {
    urls.push(url);
    if (url.endsWith(`/releases/tags/${tag}`)) return json({}, 404);
    if (url.endsWith("/releases?per_page=100&page=1")) return json(Array.from({ length: 100 }, () => ({ tag_name: "other" })));
    if (url.endsWith("/releases?per_page=100&page=2")) return json([draft]);
    if (url.endsWith("/releases/4")) return json(draft);
    assert(url.endsWith("/releases/4/assets?per_page=100&page=1"));
    return json([{ id: 8, name: "openapi.yaml" }]);
  } });
  const found = await github.release(tag);
  assert.equal(found.id, draft.id);
  assert.equal(found.draft, true);
  assert.deepEqual(found.assets, [{ id: 8, name: "openapi.yaml" }]);
  assert.equal(urls.length, 5);
});

test("published release lookup avoids enumeration; missing drafts and errors stay distinct", async () => {
  const github = client({ fetchImpl: async (url) => {
    if (url.includes("/releases/tags/")) return json({ id: 4, draft: false });
    if (url.endsWith("/releases/4")) return json({ id: 4, draft: false });
    assert(url.endsWith("/releases/4/assets?per_page=100&page=1"));
    return json([]);
  } });
  assert.equal((await github.release("9.2.4-r2")).draft, false);
  assert.equal(await client({ fetchImpl: async (url) => url.includes("/releases/tags/") ? json({}, 404) : json([]) }).release("missing"), null);
  await assert.rejects(client({ fetchImpl: async () => json({}, 403) }).release("9.2.4-r2"), /HTTP 403/);
  await assert.rejects(client({ fetchImpl: async (url) => url.includes("/releases/tags/") ? json({}, 404) : json({}, 403) }).release("9.2.4-r2"), /HTTP 403/);
});

test("configuration is read from a snapshot of the current default branch", async () => {
  const sha = "d".repeat(40);
  const github = client({ fetchImpl: async (url) => {
    if (url.endsWith("/repos/example/api")) return json({ default_branch: "main" });
    if (url.endsWith("/git/ref/heads/main")) return json({ object: { sha } });
    assert(url.endsWith(`/.github/release-targets.json?ref=${sha}`));
    return json({ encoding: "base64", content: Buffer.from(JSON.stringify({ standard: "9.2.4", maintenance: [] })).toString("base64") });
  } });
  assert.deepEqual((await github.currentConfig()).config, { standard: "9.2.4", maintenance: [] });
});

test("Release creation uses the POST response and verifies the remote tag before writing", async () => {
  const tag = "9.2.4-r2";
  const sha = "a".repeat(40);
  const created = { id: 4, tag_name: tag, name: tag, draft: true, assets: [] };
  const calls = [];
  const github = client({ fetchImpl: async (url, options) => {
    calls.push({ url, method: options.method, body: options.body === undefined ? undefined : JSON.parse(options.body) });
    if (url.endsWith(`/git/ref/tags/${tag}`)) return json({ object: { type: "commit", sha } });
    assert.notEqual(options.method, "GET", "Creation must not depend on an immediate tag/list lookup");
    return json(created, options.method === "POST" ? 201 : 200);
  } });
  const release = await github.createDraft(tag, "Release notes\n");
  assert.deepEqual(release, created);
  await github.updateDraftNotes(release, "Updated notes\n");
  await github.publish(release);
  await github.makeLatest(release);
  assert(calls[0].url.endsWith(`/git/ref/tags/${tag}`));
  assert.deepEqual(calls.map((entry) => entry.method), ["GET", "POST", "PATCH", "PATCH", "PATCH"]);
  assert.deepEqual(calls.slice(1).map((entry) => entry.body), [
    { tag_name: tag, name: tag, body: "Release notes\n", draft: true, make_latest: "false" },
    { tag_name: tag, name: tag, body: "Updated notes\n" },
    { tag_name: tag, name: tag, draft: false, make_latest: "false" },
    { make_latest: "true" },
  ]);
});

test("a missing remote tag stops Draft creation before the POST", async () => {
  const methods = [];
  const github = client({ fetchImpl: async (_url, options) => { methods.push(options.method); return json({}, 404); } });
  await assert.rejects(github.createDraft("9.2.4-r2", "notes"), /HTTP 404/);
  assert.deepEqual(methods, ["GET"]);
});

test("site history uses successful publisher deployments and skips unrelated or failed entries", async () => {
  const selected = { publisher: SITE_MARKER, tag: "9.2.4-r2" };
  const github = client({ fetchImpl: async (url) => json([{ state: url.includes("/3/") ? "failure" : "success" }]) });
  github.list = async () => [{ id: 5, payload: "invalid JSON" }, { id: 4, payload: {} }, { id: 3, payload: JSON.stringify(selected) }, { id: 2, payload: selected }];
  assert.deepEqual(await github.deployedSite(), selected);
});

test("site records use the publisher branch and retain the released source in their payload", async () => {
  const plan = { tag: "9.2.4-r2", sourceSha: "a".repeat(40), docsSha256: "b".repeat(64) };
  const github = client({ fetchImpl: async (_url, options) => {
    const body = JSON.parse(options.body);
    assert.equal(body.ref, "main");
    assert.equal(body.auto_merge, false);
    assert.equal(body.payload.sourceSha, plan.sourceSha);
    assert.equal(body.payload.publisher, SITE_MARKER);
    return json({ id: 77 });
  } });
  assert.equal((await github.beginSite(plan, "main")).id, 77);
});

test("automatic requests validate server-side workflow identity and canonical tag SHA", async () => {
  const value = payload();
  const context = { eventName: "workflow_run", ref: "refs/heads/main", workflowRef: `example/api/${PUBLISH_WORKFLOW}@refs/heads/main` };
  const run = { path: REQUEST_WORKFLOW, event: "push", conclusion: "success", head_repository: { id: 1 }, head_branch: value.manifest.tag, head_sha: value.manifest.sourceSha };
  for (const scenario of ["valid", "path", "event", "conclusion", "repository", "sha", "ref"]) {
    const execution = structuredClone(run);
    if (scenario === "path") execution.path = ".github/workflows/other.yaml";
    if (scenario === "event") execution.event = "workflow_dispatch";
    if (scenario === "conclusion") execution.conclusion = "failure";
    if (scenario === "repository") execution.head_repository.id = 2;
    if (scenario === "sha") execution.head_sha = "f".repeat(40);
    const github = {
      prefix: "/repos/example/api", repositoryInfo: async () => ({ id: 1, full_name: "example/api", default_branch: "main" }),
      runInfo: async () => execution, tagSha: async () => value.manifest.sourceSha,
      request: async () => ({ html_url: "https://example.github.io/api/" }),
    };
    const current = { ...context, ...(scenario === "ref" ? { ref: "refs/tags/9.2.4-r2" } : {}) };
    if (scenario === "valid") assert.equal((await prepareRequest(github, { workflow_run: { id: 10 } }, current)).sha, value.manifest.sourceSha);
    else await assert.rejects(prepareRequest(github, { workflow_run: { id: 10 } }, current));
    if (scenario === "valid") {
      assert.equal((await prepareRequest(github, { inputs: {} }, { ...current, eventName: "workflow_dispatch" })).mode, "reconcile");
      assert.equal((await prepareRequest(github, { inputs: { tag: value.manifest.tag } }, { ...current, eventName: "workflow_dispatch" })).mode, "publish");
    }
  }
});
