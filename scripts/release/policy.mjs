import assert from "node:assert/strict";

export const CONFIG_PATH = ".github/release-targets.json";
export const REQUEST_WORKFLOW = ".github/workflows/request-release.yaml";
export const PUBLISH_WORKFLOW = ".github/workflows/publish-release.yaml";
export const MANIFEST_NAME = "release-manifest.json";
export const SITE_MARKER = "redmine-openapi-publisher-v1";
export const PAYLOAD_FILES = ["openapi.yaml", "openapi.strict.yaml", "artifact.tar", "notes.md"];

const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const TAG = /^((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))-r([1-9]\d*)$/;

export function parseVersion(value) {
  assert.equal(typeof value, "string", "Redmine version must be a string");
  assert(VERSION.test(value), `Invalid Redmine version: ${value}`);
  return value.split(".");
}

export function parseTag(value) {
  assert.equal(typeof value, "string", "Release tag must be a string");
  const match = TAG.exec(value);
  assert(match, `Invalid release tag: ${value}`);
  return { tag: value, target: match[1], revision: match[2] };
}

const compareNumber = (a, b) => BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0;

export function compareVersions(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  return left.map((value, i) => compareNumber(value, right[i])).find((order) => order !== 0) ?? 0;
}

export function compareTags(a, b) {
  const left = parseTag(a);
  const right = parseTag(b);
  return compareVersions(left.target, right.target) || compareNumber(left.revision, right.revision);
}

export function parseConfig(value) {
  assert(value && typeof value === "object" && !Array.isArray(value), "Invalid release configuration");
  assert.deepEqual(Object.keys(value).sort(), ["maintenance", "standard"], "Unexpected release configuration fields");
  parseVersion(value.standard);
  assert(Array.isArray(value.maintenance) && value.maintenance.length <= 1, "At most one previous series is maintained");
  for (const target of value.maintenance) {
    parseVersion(target);
    assert(compareVersions(target, value.standard) < 0, "Maintenance must precede the standard target");
    assert.notEqual(target.split(".").slice(0, 2).join("."), value.standard.split(".").slice(0, 2).join("."), "Select one patch per series");
  }
  return { standard: value.standard, maintenance: [...value.maintenance] };
}

export function assertSha(value) {
  assert(typeof value === "string" && /^[a-f0-9]{40}$/.test(value), "Invalid source SHA");
  return value;
}

export const draftSource = (sha) => `<!-- redmine-openapi-source:${assertSha(sha)} -->`;

export function positiveInteger(value, label) {
  const number = Number(value);
  assert(/^\d+$/.test(String(value)) && Number.isSafeInteger(number) && number > 0, `Invalid ${label}`);
  return number;
}

export function assertDefaultWorkflow({ ref, workflowRef }, repository) {
  const expected = `refs/heads/${repository.default_branch}`;
  assert.equal(ref, expected, "Publication must run on the default branch");
  assert.equal(workflowRef, `${repository.full_name}/${PUBLISH_WORKFLOW}@${expected}`, "Unexpected publisher workflow ref");
}

export function assertRevision(tag, previous) {
  const next = parseTag(tag);
  if (!previous) {
    assert.equal(next.revision, "1", "The first release must start at r1");
    return;
  }
  if (previous.includes("+redmine")) {
    assert.equal(next.revision, "1", "The first release in this scheme must start at r1");
    return;
  }
  const old = parseTag(previous);
  const order = compareVersions(next.target, old.target);
  assert(order >= 0, "A release cannot precede its ancestor's Redmine target");
  if (order === 0) {
    assert.equal(BigInt(next.revision), BigInt(old.revision) + 1n, "Revisions must increase by exactly one");
  } else {
    assert.equal(next.revision, "1", "A new Redmine target must start at r1");
  }
}

export function nextReleaseTag(target, previous) {
  parseVersion(target);
  let revision = 1n;
  if (previous && !previous.includes("+redmine")) {
    const old = parseTag(previous);
    if (old.target === target) revision = BigInt(old.revision) + 1n;
  }
  const tag = `${target}-r${revision}`;
  assertRevision(tag, previous);
  return tag;
}

export function publicationTargetUpdate(config, tag) {
  const current = parseConfig(config);
  const { target } = parseTag(tag);
  const series = (version) => version.split(".").slice(0, 2).join(".");
  for (const slot of ["standard", "maintenance"]) {
    const previous = slot === "standard" ? current.standard : current.maintenance[0];
    if (!previous || series(previous) !== series(target) || compareVersions(target, previous) <= 0) continue;
    const next = { ...current, [slot]: slot === "standard" ? target : [target] };
    return { slot, previous, target, config: parseConfig(next) };
  }
  return null;
}

export function parseValidation(value) {
  assert.equal(value?.schemaVersion, 1, "Unsupported validation manifest");
  parseTag(value.tag);
  assertSha(value.sourceSha);
  assertSha(value.toolingSha);
  assert(typeof value.repository === "string" && /^[\w.-]+\/[\w.-]+$/.test(value.repository), "Invalid repository");
  positiveInteger(value.runId, "validation run");
  positiveInteger(value.runAttempt, "validation attempt");
  assert.deepEqual(Object.keys(value.files).sort(), [...PAYLOAD_FILES].sort(), "Unexpected release payload");
  for (const name of PAYLOAD_FILES) {
    const file = value.files[name];
    assert(typeof file.sha256 === "string" && /^[a-f0-9]{64}$/.test(file.sha256), `Invalid digest: ${name}`);
    assert(Number.isSafeInteger(file.size) && file.size > 0, `Invalid file size: ${name}`);
  }
  return value;
}

export function parseManifest(value) {
  parseValidation(value);
  assertSha(value.publisherSha);
  assert.equal(value.publisherWorkflow, PUBLISH_WORKFLOW, "Unexpected publisher");
  return value;
}

export function releaseCandidates(config, releases) {
  parseConfig(config);
  return releases.filter((release) => {
    if (release.draft || release.prerelease) return false;
    try { return parseTag(release.tag_name).target === config.standard; } catch { return false; }
  }).sort((a, b) => compareTags(b.tag_name, a.tag_name));
}

// Choose from all verified releases, not the event that reached the queue last.
export function planPromotion({ config, latest, releases, deployed, bootstrap = false }) {
  const candidate = releaseCandidates(config, releases.filter((release) => release.manifest))[0];
  if (!candidate) return { deploy: false, updateLatest: false, reason: "No verified release for the standard target" };
  const manifest = parseManifest(candidate.manifest);
  assert.equal(manifest.tag, candidate.tag_name, "Release and manifest tags differ");
  if (!latest) assert(bootstrap, "Latest does not exist; initial selection requires an explicit bootstrap");
  for (const tag of [latest?.tag_name, deployed?.tag].filter(Boolean)) {
    if (compareTags(candidate.tag_name, tag) < 0) {
      return { deploy: false, updateLatest: false, reason: `Refusing to move backwards from ${tag}` };
    }
  }
  const currentSite = deployed?.tag === manifest.tag && deployed?.sourceSha === manifest.sourceSha &&
    deployed?.docsSha256 === manifest.files["artifact.tar"].sha256;
  return {
    tag: manifest.tag,
    manifest,
    sourceSha: manifest.sourceSha,
    docsSha256: manifest.files["artifact.tar"].sha256,
    updateLatest: latest?.tag_name !== manifest.tag,
    deploy: !currentSite,
    reason: currentSite ? "The site already matches the selected release" : "Reconcile the selected release",
  };
}
