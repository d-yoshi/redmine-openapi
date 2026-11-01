import { createHash } from "node:crypto";

import { digest } from "../../scripts/release/github.mjs";
import { MANIFEST_NAME, PAYLOAD_FILES, PUBLISH_WORKFLOW, draftSource } from "../../scripts/release/policy.mjs";

export function payload(tag = "9.2.4-r2", overrides = {}) {
  const files = Object.fromEntries(PAYLOAD_FILES.map((name) => [name, Buffer.from(`${tag}: ${name}\n`)]));
  Object.assign(files, overrides);
  const manifest = { schemaVersion: 1, tag, repository: "example/api",
    sourceSha: createHash("sha1").update(tag).digest("hex"), toolingSha: "b".repeat(40), runId: 123, runAttempt: 1,
    files: Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, { size: bytes.length, sha256: digest(bytes) }])) };
  return { manifest, files };
}

export function receipt(value) {
  return { ...value.manifest, publisherSha: "b".repeat(40), publisherWorkflow: PUBLISH_WORKFLOW };
}

export class FakeGitHub {
  repository = "example/api";
  prefix = "/repos/example/api";
  config = { standard: "9.2.4", maintenance: ["8.1.7"] };
  stored = new Map();
  bytes = new Map();
  tags = new Map();
  mutations = [];
  currentLatest = { tag_name: "9.2.4-r1" };
  deployed = null;
  nextId = 1;

  constructor(value = payload()) {
    this.original = value;
    this.tags.set(value.manifest.tag, value.manifest.sourceSha);
  }

  async currentConfig() { return { config: structuredClone(this.config), sha: "d".repeat(40), repository: { default_branch: "main" } }; }
  async latest() { return structuredClone(this.currentLatest); }
  async releases() { return [...this.stored.values()].map((entry) => structuredClone(entry)); }
  async release(tag) { return this.stored.has(tag) ? structuredClone(this.stored.get(tag)) : null; }
  async releaseById(id) { return structuredClone([...this.stored.values()].find((entry) => entry.id === id) ?? null); }
  async tagSha(tag) { return this.tags.get(tag); }
  async asset(asset) { return Buffer.from(this.bytes.get(asset.id)); }
  async deployedSite() { return structuredClone(this.deployed); }

  async createDraft(tag, body) {
    this.mutations.push({ operation: "draft", tag, latest: false });
    const release = { id: this.nextId++, tag_name: tag, body, draft: true, prerelease: false, assets: [] };
    this.stored.set(tag, release);
    return structuredClone(release);
  }

  async upload(release, name, bytes) {
    this.mutations.push({ operation: "upload", name });
    const asset = { id: this.nextId++, name, size: bytes.length, digest: `sha256:${digest(bytes)}` };
    this.bytes.set(asset.id, Buffer.from(bytes));
    this.stored.get(release.tag_name).assets.push(asset);
    return asset;
  }

  async deleteAsset(asset) {
    this.mutations.push({ operation: "delete", name: asset.name });
    for (const release of this.stored.values()) release.assets = release.assets.filter((entry) => entry.id !== asset.id);
    this.bytes.delete(asset.id);
  }

  async updateDraftNotes(release, body) {
    this.mutations.push({ operation: "notes" });
    this.stored.get(release.tag_name).body = body;
  }

  async publish(release) { this.mutations.push({ operation: "publish", latest: false }); this.stored.get(release.tag_name).draft = false; }
  async makeLatest(release) { this.mutations.push({ operation: "latest", tag: release.tag_name }); this.currentLatest = { tag_name: release.tag_name }; }
  async beginSite(plan) { this.mutations.push({ operation: "site", ...plan }); return { id: 999 }; }

  seed(value, { draft = false, manifest = true } = {}) {
    const release = { id: this.nextId++, tag_name: value.manifest.tag, body: `${draftSource(value.manifest.sourceSha)}\n`, draft, prerelease: false, assets: [] };
    this.tags.set(value.manifest.tag, value.manifest.sourceSha);
    for (const [name, bytes] of Object.entries({ ...value.files, ...(manifest ? { [MANIFEST_NAME]: Buffer.from(JSON.stringify(receipt(value))) } : {}) })) {
      const asset = { id: this.nextId++, name, size: bytes.length, digest: `sha256:${digest(bytes)}` };
      this.bytes.set(asset.id, bytes);
      release.assets.push(asset);
    }
    this.stored.set(release.tag_name, release);
    return release;
  }
}
