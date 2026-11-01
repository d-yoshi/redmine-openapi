import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { MANIFEST_NAME, draftSource } from "../scripts/release/policy.mjs";
import { GitHub, digest } from "../scripts/release/github.mjs";
import { beginSite, currentPromotion, readPayload, writeSite, publishRelease, updateLatest } from "../scripts/release/publication.mjs";
import { FakeGitHub, payload } from "./fixtures/release.mjs";

const expected = (value) => ({ tag: value.manifest.tag, sourceSha: value.manifest.sourceSha, repository: value.manifest.repository, publisherSha: "b".repeat(40) });
const publish = (github, value = github.original) => publishRelease(github, value, expected(value));

test("the HTTP client resumes a Draft by ID through uploads, publication and an immutable rerun", async () => {
  const value = payload();
  const tag = value.manifest.tag;
  const draft = { id: 4, tag_name: tag, draft: true, body: draftSource(value.manifest.sourceSha), assets: [], upload_url: "https://uploads.github.com/repos/example/api/releases/4/assets{?name,label}" };
  const bytes = new Map();
  const writes = [];
  let listed = true;
  let nextId = 10;
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
  const github = new GitHub({ repository: "example/api", token: "test-token", run: () => { throw new Error("Existing Draft must be resumed"); }, fetchImpl: async (url, options) => {
    const route = new URL(url);
    const method = options.method ?? "GET";
    if (method === "GET") {
      if (route.pathname.includes("/git/ref/tags/")) return json({ object: { type: "commit", sha: value.manifest.sourceSha } });
      if (route.pathname.endsWith(`/releases/tags/${tag}`)) return draft.draft ? json({}, 404) : json(draft);
      if (route.pathname.endsWith("/releases")) return json(listed ? [draft] : []);
      if (route.pathname.endsWith("/releases/4")) return json(draft);
      if (route.pathname.endsWith("/releases/4/assets")) return json(draft.assets);
      const id = Number(route.pathname.split("/").at(-1));
      assert(bytes.has(id), `Unexpected asset read: ${route.pathname}`);
      return new Response(bytes.get(id));
    }
    writes.push(method);
    if (method === "POST") {
      assert.equal(route.origin, "https://uploads.github.com");
      const content = Buffer.from(options.body);
      const asset = { id: nextId++, name: route.searchParams.get("name"), size: content.length, digest: `sha256:${digest(content)}` };
      bytes.set(asset.id, content);
      draft.assets.push(asset);
      return json(asset, 201);
    }
    assert.equal(method, "PATCH");
    const update = JSON.parse(options.body);
    if (update.body) { draft.body = update.body; listed = false; }
    else { assert.deepEqual(update, { draft: false, make_latest: "false" }); draft.draft = false; }
    return json(draft);
  } });
  const manifest = await publishRelease(github, value, expected(value));
  assert.equal(draft.draft, false);
  assert.equal(draft.assets.length, 5);
  const mutations = [...writes];
  assert.deepEqual(await publishRelease(github, value, expected(value)), manifest);
  assert.deepEqual(writes, mutations);
});

test("downloaded payloads check the producing run, attempt and file hashes", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "release-input-test-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const value = payload();
  fs.writeFileSync(path.join(directory, "validation.json"), JSON.stringify(value.manifest));
  for (const [name, bytes] of Object.entries(value.files)) fs.writeFileSync(path.join(directory, name), bytes);
  const context = { runId: 123, runAttempt: 2 };
  assert.deepEqual(readPayload(directory, context), value);
  assert.throws(() => readPayload(directory, { ...context, runId: 456 }), /another publication run/);
  assert.throws(() => readPayload(directory, { ...context, runAttempt: 0 }), /future attempt/);
  fs.writeFileSync(path.join(directory, "openapi.yaml"), "corrupt");
  assert.throws(() => readPayload(directory, context), /Asset (size|digest) differs/);
  fs.rmSync(path.join(directory, "openapi.yaml"));
  fs.symlinkSync(path.join(directory, "notes.md"), path.join(directory, "openapi.yaml"));
  assert.throws(() => readPayload(directory, context), /regular file/);
});

test("individual releases publish without changing Latest; reruns preserve every asset", async () => {
  const github = new FakeGitHub(payload("8.1.7-r2"));
  await publish(github);
  assert.deepEqual(github.mutations.map((entry) => entry.operation), ["draft", ...Array(5).fill("upload"), "publish"]);
  assert.equal(github.mutations.at(-2).name, MANIFEST_NAME);
  assert(github.mutations.filter((entry) => entry.operation === "draft" || entry.operation === "publish").every((entry) => entry.latest === false));
  assert.equal(github.currentLatest.tag_name, "9.2.4-r1");
  const before = structuredClone(github.stored.get("8.1.7-r2"));
  github.mutations = [];
  await publish(github, payload("8.1.7-r2", { "artifact.tar": Buffer.from("rebuilt site"), "notes.md": Buffer.from("rebuilt notes") }));
  assert.deepEqual(github.stored.get("8.1.7-r2"), before);
  assert.deepEqual(github.mutations, []);
});

test("partial Draft uploads are regenerated from freshly validated payloads", async () => {
  const github = new FakeGitHub();
  const upload = github.upload.bind(github);
  github.upload = async (...args) => {
    if (args[1] === "artifact.tar") throw new Error("upload interrupted");
    return upload(...args);
  };
  await assert.rejects(publish(github), /upload interrupted/);
  const partial = structuredClone(github.stored.get(github.original.manifest.tag));
  assert.equal(partial.draft, true);
  github.upload = upload;
  github.mutations = [];
  const rebuilt = payload(undefined, { "artifact.tar": Buffer.from("different rebuild"), "notes.md": Buffer.from("different notes") });
  await publish(github, rebuilt);
  const completed = await github.release(github.original.manifest.tag);
  assert.equal(completed.draft, false);
  for (const asset of partial.assets) assert(!completed.assets.some((entry) => entry.id === asset.id));
  assert.equal(github.mutations.filter((entry) => entry.operation === "delete").length, partial.assets.length);
  for (const [name, bytes] of Object.entries(rebuilt.files)) assert.deepEqual(await github.asset(completed.assets.find((entry) => entry.name === name)), bytes);
});

test("a Draft retry remains recoverable after all its assets have been removed", async () => {
  const github = new FakeGitHub();
  github.seed(github.original, { draft: true });
  const upload = github.upload.bind(github);
  github.upload = async () => { throw new Error("upload interrupted"); };
  await assert.rejects(publish(github), /upload interrupted/);
  assert.equal((await github.release(github.original.manifest.tag)).assets.length, 0);
  github.upload = upload;
  await publish(github);
  assert.equal((await github.release(github.original.manifest.tag)).draft, false);
});

test("Draft retries require the same source and support previous manifest-based Drafts", async () => {
  const github = new FakeGitHub();
  const other = payload();
  other.manifest.sourceSha = "f".repeat(40);
  github.seed(other, { draft: true });
  github.tags.set(github.original.manifest.tag, github.original.manifest.sourceSha);
  await assert.rejects(publish(github), /artifact source/);
  assert.deepEqual(github.mutations, []);
  const draft = github.seed(github.original, { draft: true });
  draft.body = "Previous release notes without a source marker";
  await publish(github);
  assert.equal((await github.release(draft.tag_name)).draft, false);
});

test("a Draft published by another actor is never reset", async () => {
  const github = new FakeGitHub();
  const original = github.seed(github.original, { draft: true });
  const update = github.updateDraftNotes.bind(github);
  github.updateDraftNotes = async (...args) => {
    await update(...args);
    original.draft = false;
  };
  await assert.rejects(publish(github), /Published releases cannot be modified/);
  assert.equal(github.mutations.some((entry) => ["delete", "upload"].includes(entry.operation)), false);
});

test("a deleted or retagged Draft stops before asset writes", async () => {
  for (const scenario of ["deleted", "retagged"]) {
    const github = new FakeGitHub();
    const draft = github.seed(github.original, { draft: true });
    const update = github.updateDraftNotes.bind(github);
    github.updateDraftNotes = async (...args) => {
      await update(...args);
      if (scenario === "deleted") github.stored.delete(draft.tag_name);
      else draft.tag_name = "9.2.4-r3";
    };
    await assert.rejects(publish(github), /Draft (no longer exists|tag changed)/);
    assert.equal(github.mutations.some((entry) => ["delete", "upload", "publish"].includes(entry.operation)), false);
  }
});

test("incomplete or unverified published releases require a new revision", async () => {
  for (const manifest of [true, false]) {
    const github = new FakeGitHub();
    const release = github.seed(github.original, { manifest });
    if (manifest) release.assets.shift();
    await assert.rejects(publish(github), /Published release (is missing|has no manifest)/);
    assert.deepEqual(github.mutations, []);
  }
});

test("changed schema bytes, existing corrupt assets and moved tags stop publication", async () => {
  for (const scenario of ["schema", "asset", "tag"]) {
    const github = new FakeGitHub();
    const release = github.seed(github.original);
    let value = github.original;
    if (scenario === "schema") value = payload(undefined, { "openapi.yaml": Buffer.from("changed schema") });
    if (scenario === "asset") github.bytes.set(release.assets[0].id, Buffer.from("corrupt"));
    if (scenario === "tag") github.tags.set(value.manifest.tag, "f".repeat(40));
    await assert.rejects(publish(github, value), /Revalidation changed|Asset (size|digest) differs|tag moved/);
    assert.deepEqual(github.mutations, []);
  }
});

test("tag movement during upload stops before the next write", async () => {
  const github = new FakeGitHub();
  const upload = github.upload.bind(github);
  github.upload = async (...args) => {
    const result = await upload(...args);
    github.tags.set(github.original.manifest.tag, "f".repeat(40));
    return result;
  };
  await assert.rejects(publish(github), /tag moved/);
  assert.deepEqual(github.mutations.map((entry) => entry.operation), ["draft", "upload"]);
  assert.equal((await github.release(github.original.manifest.tag)).draft, true);
});

test("a payload for another repository stops before any Release write", async () => {
  const github = new FakeGitHub();
  await assert.rejects(publishRelease(github, github.original, { ...expected(github.original), repository: "other/repo" }), /repository/);
  assert.deepEqual(github.mutations, []);
});

test("promotion verifies released assets and chooses the highest standard revision", async () => {
  const github = new FakeGitHub();
  github.seed(payload("9.2.4-r10"));
  github.seed(payload("8.1.7-r99"));
  github.seed(payload("9.2.4-r11"), { manifest: false });
  github.seed(payload("9.2.4-r12"), { draft: true });
  const superseded = github.seed(payload("9.2.4-r9"));
  github.bytes.set(superseded.assets[0].id, Buffer.from("old corrupt asset"));
  const result = await currentPromotion(github);
  assert.equal(result.plan.tag, "9.2.4-r10");
  const asset = result.release.assets.find((entry) => entry.name === "artifact.tar");
  github.bytes.set(asset.id, Buffer.from("changed"));
  await assert.rejects(currentPromotion(github), /Asset (size|digest) differs/);
  assert.deepEqual(github.mutations, []);
});

test("configuration and Latest read failures never result in writes", async () => {
  for (const method of ["currentConfig", "latest", "deployedSite"]) {
    const github = new FakeGitHub();
    github.seed(github.original);
    github[method] = async () => { throw new Error("API unavailable"); };
    await assert.rejects(updateLatest(github, { tag: github.original.manifest.tag }), /API unavailable/);
    assert.deepEqual(github.mutations, []);
  }
});

test("a changed selection or a newly completed higher revision invalidates an old plan", async () => {
  for (const scenario of ["config", "release", "latest"]) {
    const github = new FakeGitHub();
    github.seed(github.original);
    const { plan } = await currentPromotion(github);
    if (scenario === "config") github.config.standard = "9.2.5";
    if (scenario === "release") github.seed(payload("9.2.4-r3"));
    if (scenario === "latest") github.currentLatest = { tag_name: "9.2.5-r1" };
    assert.equal(await updateLatest(github, plan), false);
    assert.equal(await beginSite(github, plan), null);
    assert.deepEqual(github.mutations, []);
  }
});

test("configuration and Latest are read again immediately before promotion writes", async () => {
  for (const scenario of ["config", "latest"]) {
    const github = new FakeGitHub();
    github.seed(github.original);
    const { plan } = await currentPromotion(github);
    const method = scenario === "config" ? "currentConfig" : "latest";
    const read = github[method].bind(github);
    let reads = 0;
    github[method] = async () => {
      if (++reads === 2) {
        if (scenario === "config") github.config.standard = "9.2.5";
        else github.currentLatest = { tag_name: "9.2.4-r3" };
      }
      return read();
    };
    assert.equal(await updateLatest(github, plan), false);
    assert.deepEqual(github.mutations, []);
  }
});

test("site recovery uses the selected opaque archive and preserves Release assets", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "release-site-test-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const github = new FakeGitHub();
  github.seed(github.original);
  const reads = [];
  const read = github.asset.bind(github);
  github.asset = async (asset) => { reads.push(asset.name); return read(asset); };
  const before = await github.release(github.original.manifest.tag);
  const result = await currentPromotion(github);
  const file = path.join(directory, "artifact.tar");
  writeSite(result, file);
  assert.deepEqual(fs.readFileSync(file), github.original.files["artifact.tar"]);
  assert.equal(await beginSite(github, result.plan), null);
  assert.equal(await updateLatest(github, result.plan), true);
  assert.equal((await beginSite(github, result.plan)).id, 999);
  assert.equal(reads.filter((name) => name !== MANIFEST_NAME).length, 4);
  assert.equal(reads.filter((name) => name === "artifact.tar").length, 1);
  assert.deepEqual(await github.release(github.original.manifest.tag), before);
  github.deployed = { tag: result.plan.tag, sourceSha: result.plan.sourceSha, docsSha256: result.plan.docsSha256 };
  assert.equal(await beginSite(github, result.plan), null);
});

test("asset and manifest changes invalidate a cached promotion plan", async () => {
  for (const scenario of ["metadata", "manifest", "missing digest"]) {
    const github = new FakeGitHub();
    const release = github.seed(github.original);
    const { plan } = await currentPromotion(github);
    const asset = release.assets.find((entry) => entry.name === (scenario === "manifest" ? MANIFEST_NAME : "artifact.tar"));
    if (scenario === "manifest") {
      const manifest = JSON.parse(github.bytes.get(asset.id));
      manifest.publisherSha = "e".repeat(40);
      github.bytes.set(asset.id, Buffer.from(JSON.stringify(manifest)));
    } else if (scenario === "metadata") asset.digest = `sha256:${"0".repeat(64)}`;
    else { delete asset.digest; github.bytes.set(asset.id, Buffer.from("corrupt")); }
    await assert.rejects(updateLatest(github, plan), /digest differs|size differs|manifest changed/);
    assert.deepEqual(github.mutations, []);
  }
});

test("site deployment rereads policy after Latest selection", async () => {
  const github = new FakeGitHub();
  github.seed(github.original);
  github.currentLatest = { tag_name: github.original.manifest.tag };
  const { plan } = await currentPromotion(github);
  const read = github.currentConfig.bind(github);
  let reads = 0;
  github.currentConfig = async () => {
    if (++reads === 2) github.config.standard = "9.2.5";
    return read();
  };
  assert.equal(await beginSite(github, plan), null);
  assert.deepEqual(github.mutations, []);
});
