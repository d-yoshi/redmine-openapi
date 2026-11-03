import assert from "node:assert/strict";
import test from "node:test";

import { CONFIG_PATH } from "../scripts/release/policy.mjs";
import { proposeTargetUpdate } from "../scripts/release/propose-target.mjs";
import { FakeGitHub, payload } from "./fixtures/release.mjs";

class ProposalGitHub extends FakeGitHub {
  branches = new Map();
  pulls = [];
  writes = [];

  constructor(tag) { super(payload(tag)); this.seed(this.original); }

  async list(route) {
    assert(route.startsWith(`${this.prefix}/pulls?state=all&head=example%3Aautomation%2Frelease-target-`));
    assert(route.includes("&base=main"));
    return structuredClone(this.pulls);
  }

  async fileAt(name, sha) {
    assert.equal(name, CONFIG_PATH);
    const branch = [...this.branches.values()].find((value) => value.sha === sha);
    assert(branch);
    return { content: Buffer.from(JSON.stringify(branch.config)), sha: "b".repeat(40) };
  }

  async request(route, { method = "GET", body } = {}) {
    if (method === "GET") {
      if (route.includes("/compare/")) return { files: [{ filename: CONFIG_PATH }] };
      const name = decodeURIComponent(route.split("/heads/")[1]);
      const branch = this.branches.get(name);
      return branch ? { object: { sha: branch.sha } } : null;
    }
    this.writes.push({ route, method, body: structuredClone(body) });
    if (route.endsWith("/git/refs")) {
      assert.equal(method, "POST");
      assert.equal(body.sha, "d".repeat(40));
      const name = body.ref.replace("refs/heads/", "");
      assert(!this.branches.has(name));
      this.branches.set(name, { sha: body.sha, config: structuredClone(this.config) });
      return { object: { sha: body.sha } };
    }
    if (route.endsWith(`/contents/${CONFIG_PATH}`)) {
      assert.equal(method, "PUT");
      assert.equal(body.sha, "b".repeat(40));
      assert.notEqual(body.branch, "main");
      this.branches.get(body.branch).config = JSON.parse(Buffer.from(body.content, "base64"));
      this.branches.get(body.branch).sha = "e".repeat(40);
      return {};
    }
    assert(route.endsWith("/pulls"));
    assert.equal(method, "POST");
    assert.equal(body.base, "main");
    const pull = { html_url: "https://github.com/example/api/pull/10", state: "open", ...body };
    this.pulls.push(pull);
    return structuredClone(pull);
  }
}

const propose = (github) => proposeTargetUpdate(github, { tag: github.original.manifest.tag, sourceSha: github.original.manifest.sourceSha });

test("new standard and maintenance patches produce reviewed configuration proposals without editing main", async () => {
  for (const [tag, slot, target] of [["9.2.5-r1", "standard", "9.2.5"], ["8.1.8-r2", "maintenance", "8.1.8"]]) {
    const github = new ProposalGitHub(tag);
    const original = structuredClone(github.config);
    const url = await propose(github);
    assert.equal(url, github.pulls[0].html_url);
    assert.deepEqual(github.config, original);
    assert.deepEqual(github.writes.map(({ method }) => method), ["POST", "PUT", "POST"]);
    const next = [...github.branches.values()][0].config;
    assert.deepEqual(next, { ...original, [slot]: slot === "standard" ? target : [target] });
    assert(github.pulls[0].body.includes(github.original.manifest.sourceSha));
    assert(github.pulls[0].body.includes(`/releases/tag/${tag}`));
    const writes = structuredClone(github.writes);
    assert.equal(await propose(github), url);
    assert.deepEqual(github.writes, writes);
  }
});

test("closed target proposals are not recreated by retries", async () => {
  const github = new ProposalGitHub("8.1.8-r1");
  await propose(github);
  github.pulls[0].state = "closed";
  github.writes = [];
  assert.equal(await propose(github), github.pulls[0].html_url);
  assert.deepEqual(github.writes, []);
});

test("a PR creation failure resumes the prepared branch without duplicate commits", async () => {
  const github = new ProposalGitHub("8.1.8-r1");
  const request = github.request.bind(github);
  github.request = async (route, options) => {
    if (route.endsWith("/pulls")) throw new Error("pull request permission denied");
    return request(route, options);
  };
  await assert.rejects(propose(github), /permission denied/);
  assert.equal(github.branches.size, 1);
  assert.equal(github.pulls.length, 0);
  github.request = request;
  github.writes = [];
  await propose(github);
  assert.deepEqual(github.writes.map(({ method }) => method), ["POST"]);
  assert.equal(github.branches.size, 1);
});

test("old patches, current-target revisions, and another series do not create selection proposals", async () => {
  for (const tag of ["9.2.4-r3", "9.2.3-r99", "8.1.7-r99", "8.1.6-r99", "9.3.0-r1", "10.0.0-r1", "7.0.8-r1"]) {
    const github = new ProposalGitHub(tag);
    assert.equal(await propose(github), null);
    assert.deepEqual(github.writes, []);
  }
});

test("unpublished, unverified, corrupt, or mismatched releases cannot create a proposal", async () => {
  for (const scenario of ["draft", "manifest", "asset", "source", "moved-tag"]) {
    const github = new ProposalGitHub("8.1.8-r1");
    const release = github.stored.get(github.original.manifest.tag);
    if (scenario === "draft") release.draft = true;
    if (scenario === "manifest") release.assets = release.assets.filter(({ name }) => name !== "release-manifest.json");
    if (scenario === "asset") github.bytes.set(release.assets[0].id, Buffer.from("corrupt"));
    if (scenario === "moved-tag") github.tags.set(release.tag_name, "f".repeat(40));
    await assert.rejects(proposeTargetUpdate(github, { tag: release.tag_name, sourceSha: scenario === "source" ? "f".repeat(40) : github.original.manifest.sourceSha }));
    assert.deepEqual(github.writes, []);
  }
});

test("unexpected changes on a proposal branch are not overwritten", async () => {
  const github = new ProposalGitHub("8.1.8-r1");
  github.branches.set("automation/release-target-maintenance-8.1.8", { sha: "d".repeat(40), config: { ...github.config, maintenance: ["8.1.99"] } });
  await assert.rejects(propose(github), /unexpected configuration/);
  assert.deepEqual(github.writes, []);
});

test("a newer policy selection made during asset verification prevents a stale proposal", async () => {
  const github = new ProposalGitHub("8.1.8-r1");
  const read = github.currentConfig.bind(github);
  let reads = 0;
  github.currentConfig = async () => {
    if (++reads === 2) github.config.maintenance = ["8.1.9"];
    return read();
  };
  assert.equal(await propose(github), null);
  assert.deepEqual(github.writes, []);
});

test("a reused proposal branch cannot bring unrelated files into the configuration PR", async () => {
  const github = new ProposalGitHub("8.1.8-r1");
  github.branches.set("automation/release-target-maintenance-8.1.8", { sha: "d".repeat(40), config: structuredClone(github.config) });
  const request = github.request.bind(github);
  github.request = async (route, options) => route.includes("/compare/") ? { files: [{ filename: "src/openapi.yaml" }] } : request(route, options);
  await assert.rejects(propose(github), /unrelated file/);
  assert.deepEqual(github.writes, []);
});
