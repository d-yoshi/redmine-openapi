import assert from "node:assert/strict";
import test from "node:test";

import { GitHub } from "../scripts/release/github.mjs";
import { prepareRequest } from "../scripts/release/cli.mjs";
import { PUBLISH_WORKFLOW } from "../scripts/release/policy.mjs";
import { publishRelease } from "../scripts/release/publication.mjs";
import { FakeGitHub, payload } from "./fixtures/release.mjs";

const json = (value, status = 200) => new Response(JSON.stringify(value), { status });
const sha = "a".repeat(40);
const tag = "9.2.5-r1";
const context = { eventName: "workflow_dispatch", ref: "refs/heads/main", workflowRef: `example/api/${PUBLISH_WORKFLOW}@refs/heads/main` };

function sourceClient({ existing = null, version = tag } = {}) {
  const reads = [];
  return {
    reads, prefix: "/repos/example/api",
    repositoryInfo: async () => ({ full_name: "example/api", default_branch: "main" }),
    commitSha: async (ref) => { reads.push(ref); return sha; },
    fileAt: async (name, ref) => { assert.equal(name, "src/openapi.yaml"); assert.equal(ref, sha); return { content: Buffer.from(`info:\n  version: ${version}\n`) }; },
    tagSha: async () => existing,
    request: async () => ({ html_url: "https://example.github.io/api/" }),
  };
}

test("source_ref fixes a commit SHA and derives the release tag without writing refs", async () => {
  const github = sourceClient();
  const result = await prepareRequest(github, { inputs: { source_ref: "maintenance/9.2.5" } }, context);
  assert.deepEqual(result, { mode: "publish", tag, sha, create_tag: true, pages_url: "https://example.github.io/api/" });
  assert.deepEqual(github.reads, ["maintenance/9.2.5"]);
  assert.equal((await prepareRequest(sourceClient({ existing: sha }), { inputs: { source_ref: "main" } }, context)).sha, sha);
});

test("source selection rejects conflicting inputs, existing tags with another source, and invalid metadata", async () => {
  await assert.rejects(prepareRequest(sourceClient(), { inputs: { source_ref: "main", tag } }, context), /not both/);
  await assert.rejects(prepareRequest(sourceClient({ existing: "b".repeat(40) }), { inputs: { source_ref: "main" } }, context), /different source/);
  await assert.rejects(prepareRequest(sourceClient({ version: "invalid" }), { inputs: { source_ref: "main" } }, context), /Invalid release tag/);
  await assert.rejects(prepareRequest(sourceClient(), { inputs: { source_ref: "main" } }, { ...context, ref: "refs/heads/maintenance/9.2.5" }), /default branch/);
});

test("branch resolution reads metadata by its resolved SHA rather than the moving branch", async () => {
  const urls = [];
  const github = new GitHub({ repository: "example/api", token: "test", fetchImpl: async (url) => {
    urls.push(url);
    return urls.length === 1 ? json({ sha }) : json({ encoding: "base64", content: Buffer.from("info: {}\n").toString("base64"), sha: "b".repeat(40) });
  } });
  const resolved = await github.commitSha("maintenance/9.2.5");
  assert.equal(resolved, sha);
  assert.equal((await github.fileAt("src/openapi.yaml", resolved)).content.toString(), "info: {}\n");
  assert(urls[0].endsWith("/commits/maintenance%2F9.2.5"));
  assert(urls[1].endsWith(`?ref=${sha}`));
});

test("automatic tags are created once and never moved", async () => {
  for (const scenario of ["new", "existing", "race", "conflict", "permission"]) {
    let current = scenario === "existing" ? sha : scenario === "conflict" ? "b".repeat(40) : null;
    const writes = [];
    const github = new GitHub({ repository: "example/api", token: "test", fetchImpl: async (_url, options) => {
      if (options.method === "GET") return current ? json({ object: { type: "commit", sha: current } }) : json({}, 404);
      writes.push(options.method);
      assert.equal(options.method, "POST");
      assert.deepEqual(JSON.parse(options.body), { ref: `refs/tags/${tag}`, sha });
      if (scenario === "permission") return json({}, 403);
      current = sha;
      return scenario === "race" ? json({}, 422) : json({ ref: `refs/tags/${tag}`, object: { type: "commit", sha } }, 201);
    } });
    if (["conflict", "permission"].includes(scenario)) await assert.rejects(github.ensureTag(tag, sha), /different source|HTTP 403/);
    else { await github.ensureTag(tag, sha); await github.ensureTag(tag, sha); }
    assert.equal(writes.length, ["existing", "conflict"].includes(scenario) ? 0 : 1);
  }
});

test("a conflicting tag created during a race is rejected", async () => {
  let current;
  const github = new GitHub({ repository: "example/api", token: "test", fetchImpl: async (_url, options) => {
    if (options.method === "POST") { current = "f".repeat(40); return json({}, 422); }
    return current ? json({ object: { type: "commit", sha: current } }) : json({}, 404);
  } });
  await assert.rejects(github.ensureTag(tag, sha), /different source/);
});

test("publication checks artifact identity before creating a tag", async () => {
  const value = payload();
  const github = new FakeGitHub(value);
  github.tags.clear();
  github.ensureTag = async (name, source) => { github.mutations.push({ operation: "tag" }); github.tags.set(name, source); };
  const expected = { repository: github.repository, tag: value.manifest.tag, sourceSha: value.manifest.sourceSha, publisherSha: "b".repeat(40), createTag: true };
  await assert.rejects(publishRelease(github, value, { ...expected, sourceSha: "f".repeat(40) }), /artifact source/);
  assert.deepEqual(github.mutations, []);
  await assert.rejects(publishRelease(github, value, { ...expected, publisherSha: "invalid" }), /source SHA/);
  assert.deepEqual(github.mutations, []);
  await publishRelease(github, value, expected);
  assert.equal(github.mutations[0].operation, "tag");
  assert.equal(github.mutations.at(-1).operation, "publish");
  assert.equal((await github.release(value.manifest.tag)).draft, false);
});
