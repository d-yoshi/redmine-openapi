import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { digest } from "./github.mjs";
import { MANIFEST_NAME, PAYLOAD_FILES, PUBLISH_WORKFLOW, draftSource, parseManifest, parseValidation, planPromotion, releaseCandidates } from "./policy.mjs";

export function checkBytes(bytes, expected, name) {
  assert.equal(bytes.length, expected.size, `Asset size differs: ${name}`);
  assert.equal(digest(bytes), expected.sha256, `Asset digest differs: ${name}`);
}

export function readPayload(directory, { runId, runAttempt }) {
  const read = (name) => {
    const file = path.join(directory, name);
    assert(fs.lstatSync(file).isFile(), `Payload is not a regular file: ${name}`);
    return fs.readFileSync(file);
  };
  const manifest = parseValidation(JSON.parse(read("validation.json").toString("utf8")));
  assert.equal(manifest.runId, runId, "Artifact belongs to another publication run");
  assert(manifest.runAttempt <= runAttempt, "Artifact belongs to a future attempt");
  const files = Object.fromEntries(PAYLOAD_FILES.map((name) => {
    const bytes = read(name);
    checkBytes(bytes, manifest.files[name], name);
    return [name, bytes];
  }));
  return { manifest, files };
}

const identity = (manifest, { tag, sourceSha, repository }) => {
  assert.equal(manifest.tag, tag, "Unexpected artifact tag");
  assert.equal(manifest.sourceSha, sourceSha, "Unexpected artifact source");
  assert.equal(manifest.repository, repository, "Unexpected artifact repository");
};

const assertTagUnchanged = async (github, manifest) => {
  assert.equal(await github.tagSha(manifest.tag), manifest.sourceSha, "Release tag moved after validation");
};

async function storedManifest(github, release) {
  const asset = release.assets.find((entry) => entry.name === MANIFEST_NAME);
  return asset ? parseManifest(JSON.parse((await github.asset(asset)).toString("utf8"))) : null;
}

async function checkedDraft(github, manifest, id) {
  const release = await github.releaseById(id);
  assert(release, "Draft no longer exists");
  assert(release.draft, "Published releases cannot be modified");
  assert.equal(release.id, id, "Draft was replaced during publication");
  assert.equal(release.tag_name, manifest.tag, "Draft tag changed during publication");
  if (!release.body?.trimEnd().endsWith(draftSource(manifest.sourceSha))) {
    const previous = await storedManifest(github, release);
    assert(previous, "Draft source cannot be verified");
    identity(previous, manifest);
  }
  await assertTagUnchanged(github, manifest);
  return release;
}

export async function publishRelease(github, payload, expected) {
  identity(payload.manifest, expected);
  const manifest = parseManifest({ ...payload.manifest, publisherSha: expected.publisherSha, publisherWorkflow: PUBLISH_WORKFLOW });
  if (expected.createTag) await github.ensureTag(manifest.tag, manifest.sourceSha);
  await assertTagUnchanged(github, manifest);
  let release = await github.release(manifest.tag);
  if (release && !release.draft) {
    const previous = await storedManifest(github, release);
    assert(previous, "Published release has no manifest; use a new revision");
    await verifyRelease(github, release, previous);
    for (const name of ["openapi.yaml", "openapi.strict.yaml"]) {
      assert.deepEqual(previous.files[name], manifest.files[name], `Revalidation changed ${name}`);
    }
    return previous;
  }

  const body = `${payload.files["notes.md"].toString("utf8").trimEnd()}\n\n${draftSource(manifest.sourceSha)}\n`;
  if (!release) release = await github.createDraft(manifest.tag, body);
  else {
    release = await checkedDraft(github, manifest, release.id);
    await github.updateDraftNotes(release, body);
  }
  // The source marker survives even if a retry stops while replacing assets.
  for (const asset of release.assets.filter((asset) => [...PAYLOAD_FILES, MANIFEST_NAME].includes(asset.name))) {
    await checkedDraft(github, manifest, release.id);
    await github.deleteAsset(asset);
  }
  for (const [name, bytes] of Object.entries({ ...payload.files, [MANIFEST_NAME]: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`) })) {
    release = await checkedDraft(github, manifest, release.id);
    await github.upload(release, name, bytes);
  }
  release = await checkedDraft(github, manifest, release.id);
  await github.publish(release);
  return manifest;
}

async function verifyRelease(github, release, manifest, expected) {
  identity(manifest, { tag: release.tag_name, sourceSha: manifest.sourceSha, repository: github.repository });
  await assertTagUnchanged(github, manifest);
  if (expected) assert.deepEqual(manifest, expected, "Release manifest changed after selection");
  let site;
  for (const name of PAYLOAD_FILES) {
    const asset = release.assets.find((entry) => entry.name === name);
    assert(asset, `Published release is missing ${name}`);
    if (expected && asset.digest) {
      assert.equal(asset.size, manifest.files[name].size, `Asset size differs: ${name}`);
      assert.equal(asset.digest, `sha256:${manifest.files[name].sha256}`, `Asset digest differs: ${name}`);
    } else {
      const bytes = await github.asset(asset);
      checkBytes(bytes, manifest.files[name], name);
      if (name === "artifact.tar") site = bytes;
    }
  }
  return site;
}

export async function verifiedPublishedRelease(github, tag, sourceSha) {
  const release = await github.release(tag);
  assert(release && !release.draft && !release.prerelease, "A published stable release is required");
  const manifest = await storedManifest(github, release);
  assert(manifest, "Published release has no manifest");
  assert.equal(manifest.sourceSha, sourceSha, "Published release has a different source");
  await verifyRelease(github, release, manifest);
  return manifest;
}

const sameSelection = (left, right) => left.tag && left.tag === right.tag && left.sourceSha === right.sourceSha && left.docsSha256 === right.docsSha256;

export async function currentPromotion(github, bootstrap = false, expected) {
  const { config } = await github.currentConfig();
  let release;
  for (const candidate of releaseCandidates(config, await github.releases())) {
    const current = await github.release(candidate.tag_name);
    const manifest = await storedManifest(github, current);
    if (manifest) { release = { ...current, manifest }; break; }
  }
  const [latest, deployed] = await Promise.all([github.latest(), github.deployedSite()]);
  const plan = planPromotion({ config, latest, releases: release ? [release] : [], deployed, bootstrap });
  const site = plan.tag && (!expected || sameSelection(expected, plan))
    ? await verifyRelease(github, release, release.manifest, expected?.manifest) : undefined;
  return { plan, release, latest, deployed, site };
}

export function writeSite(result, file) {
  if (!result.plan.deploy) return;
  assert(result.site, "Verified site archive is missing");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, result.site);
}

async function confirmPromotion(github, expected, bootstrap) {
  const current = await currentPromotion(github, bootstrap, expected);
  if (!sameSelection(expected, current.plan)) return null;
  const { config, repository } = await github.currentConfig();
  const latest = await github.latest();
  const plan = planPromotion({ config, latest, releases: [current.release], deployed: current.deployed, bootstrap });
  if (!sameSelection(expected, plan)) return null;
  await assertTagUnchanged(github, current.release.manifest);
  return { ...current, plan, latest, repository };
}

export async function updateLatest(github, expected, bootstrap = false) {
  const current = await confirmPromotion(github, expected, bootstrap);
  if (!current) return false;
  if (current.plan.updateLatest) await github.makeLatest(current.release);
  return true;
}

export async function beginSite(github, expected, bootstrap = false) {
  const current = await confirmPromotion(github, expected, bootstrap);
  if (!current?.plan.deploy || current.latest?.tag_name !== expected.tag) return null;
  return github.beginSite(current.plan, current.repository.default_branch);
}
