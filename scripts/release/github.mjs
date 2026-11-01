import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { CONFIG_PATH, SITE_MARKER, assertSha, parseConfig, positiveInteger } from "./policy.mjs";

export const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

export class GitHub {
  constructor({ repository, token, apiUrl = "https://api.github.com", fetchImpl = fetch }) {
    assert(/^[\w.-]+\/[\w.-]+$/.test(repository), "Invalid repository");
    assert(token, "GH_TOKEN is required");
    this.repository = repository;
    this.prefix = `/repos/${repository}`;
    this.token = token;
    this.apiUrl = apiUrl;
    this.fetch = fetchImpl;
  }

  async request(route, { method = "GET", body, missing = false, binary = false } = {}) {
    const url = route.startsWith("https://") ? route : `${this.apiUrl}${route}`;
    const origin = new URL(url).origin;
    assert([new URL(this.apiUrl).origin, "https://uploads.github.com"].includes(origin), "Unexpected GitHub API origin");
    const headers = {
      Authorization: `Bearer ${this.token}`,
      Accept: binary ? "application/octet-stream" : "application/vnd.github+json",
      "X-GitHub-Api-Version": "2026-03-10",
    };
    if (body !== undefined) headers["Content-Type"] = Buffer.isBuffer(body) ? "application/octet-stream" : "application/json";
    let response = await this.fetch(url, {
      method, headers, redirect: "manual", signal: AbortSignal.timeout(60_000),
      body: body === undefined ? undefined : Buffer.isBuffer(body) ? body : JSON.stringify(body),
    });
    if (binary && [301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      assert(location && new URL(location).protocol === "https:", "Invalid download redirect");
      // Signed asset URLs do not need the repository token.
      response = await this.fetch(location, { signal: AbortSignal.timeout(60_000) });
    }
    if (missing && response.status === 404) return null;
    assert(response.ok, `GitHub ${method} ${route}: HTTP ${response.status}`);
    if (binary) return Buffer.from(await response.arrayBuffer());
    if (response.status === 204) return null;
    return response.json();
  }

  async list(route) {
    const result = [];
    for (let page = 1; ; page++) {
      const value = await this.request(`${route}${route.includes("?") ? "&" : "?"}per_page=100&page=${page}`);
      assert(Array.isArray(value), "Unexpected paginated GitHub response");
      result.push(...value);
      if (value.length < 100) return result;
    }
  }

  repositoryInfo() { return this.request(this.prefix); }
  latest() { return this.request(`${this.prefix}/releases/latest`, { missing: true }); }
  releases() { return this.list(`${this.prefix}/releases`); }
  runInfo(id) { return this.request(`${this.prefix}/actions/runs/${positiveInteger(id, "run")}`); }

  async tagSha(tag) {
    let value = (await this.request(`${this.prefix}/git/ref/tags/${encodeURIComponent(tag)}`)).object;
    for (let depth = 0; depth < 10 && value.type === "tag"; depth++) {
      value = (await this.request(`${this.prefix}/git/tags/${assertSha(value.sha)}`)).object;
    }
    assert.equal(value.type, "commit", "Release tag does not resolve to a commit");
    return assertSha(value.sha);
  }

  async currentConfig() {
    const repository = await this.repositoryInfo();
    const branch = await this.request(`${this.prefix}/git/ref/heads/${encodeURIComponent(repository.default_branch)}`);
    const sha = assertSha(branch.object.sha);
    const file = await this.request(`${this.prefix}/contents/${CONFIG_PATH}?ref=${sha}`);
    assert.equal(file.encoding, "base64", "Unexpected configuration encoding");
    return { config: parseConfig(JSON.parse(Buffer.from(file.content, "base64").toString("utf8"))), sha, repository };
  }

  async release(tag) {
    // The tag endpoint returns published releases; drafts are listed separately.
    const release = await this.request(`${this.prefix}/releases/tags/${encodeURIComponent(tag)}`, { missing: true }) ??
      (await this.releases()).find((entry) => entry.tag_name === tag) ?? null;
    return release ? this.releaseById(release.id) : null;
  }

  async releaseById(id) {
    const release = await this.request(`${this.prefix}/releases/${positiveInteger(id, "release")}`, { missing: true });
    if (release) release.assets = await this.list(`${this.prefix}/releases/${release.id}/assets`);
    return release;
  }

  asset(asset) {
    return this.request(`${this.prefix}/releases/assets/${positiveInteger(asset.id, "asset")}`, { binary: true });
  }

  async createDraft(tag, body) {
    // POST can create a missing tag, so verify the remote tag first.
    await this.tagSha(tag);
    const release = await this.request(`${this.prefix}/releases`, {
      method: "POST", body: { tag_name: tag, name: tag, body, draft: true, make_latest: "false" },
    });
    assert(release?.draft && release.tag_name === tag, "Unexpected created Draft response");
    positiveInteger(release.id, "release");
    assert(Array.isArray(release.assets), "Created Draft is missing its asset list");
    return release;
  }

  upload(release, name, bytes) {
    const url = new URL(release.upload_url.replace(/\{.*$/, ""));
    url.searchParams.set("name", name);
    return this.request(url.href, { method: "POST", body: bytes });
  }

  deleteAsset(asset) {
    return this.request(`${this.prefix}/releases/assets/${positiveInteger(asset.id, "asset")}`, { method: "DELETE" });
  }

  updateDraftNotes(release, body) {
    return this.request(`${this.prefix}/releases/${release.id}`, { method: "PATCH", body: { tag_name: release.tag_name, name: release.name ?? release.tag_name, body } });
  }

  publish(release) {
    return this.request(`${this.prefix}/releases/${release.id}`, { method: "PATCH", body: { tag_name: release.tag_name, name: release.name ?? release.tag_name, draft: false, make_latest: "false" } });
  }

  makeLatest(release) {
    return this.request(`${this.prefix}/releases/${release.id}`, { method: "PATCH", body: { make_latest: "true" } });
  }

  async deployedSite() {
    const deployments = await this.list(`${this.prefix}/deployments?environment=github-pages`);
    for (const deployment of deployments) {
      let payload;
      try { payload = typeof deployment.payload === "string" ? JSON.parse(deployment.payload) : deployment.payload; } catch { continue; }
      if (payload?.publisher !== SITE_MARKER) continue;
      const statuses = await this.request(`${this.prefix}/deployments/${deployment.id}/statuses?per_page=1`);
      if (statuses[0]?.state === "success") return payload;
    }
    return null;
  }

  beginSite(plan, defaultBranch) {
    return this.request(`${this.prefix}/deployments`, { method: "POST", body: {
      ref: defaultBranch, auto_merge: false, required_contexts: [],
      environment: "github-pages", production_environment: true,
      description: `API specification ${plan.tag}`,
      payload: { publisher: SITE_MARKER, tag: plan.tag, sourceSha: plan.sourceSha, docsSha256: plan.docsSha256 },
    } });
  }

  recordSite(id, state, url, logUrl) {
    return this.request(`${this.prefix}/deployments/${positiveInteger(id, "deployment")}/statuses`, { method: "POST", body: {
      state, environment_url: url, log_url: logUrl, auto_inactive: state === "success",
    } });
  }
}
