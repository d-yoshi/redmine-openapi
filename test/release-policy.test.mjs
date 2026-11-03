import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { load } from "js-yaml";

import { CONFIG_PATH, PUBLISH_WORKFLOW, assertDefaultWorkflow, assertRevision, compareTags, nextReleaseTag, parseConfig, parseTag, planPromotion, publicationTargetUpdate } from "../scripts/release/policy.mjs";
import { payload, receipt } from "./fixtures/release.mjs";

const release = (tag) => ({ tag_name: tag, draft: false, prerelease: false, manifest: receipt(payload(tag)) });
const config = { standard: "9.2.4", maintenance: ["8.1.7"] };

test("release tags use numeric target and revision ordering", () => {
  assert(compareTags("9.2.4-r10", "9.2.4-r9") > 0);
  assert(compareTags("9.2.10-r1", "9.2.9-r99") > 0);
  assert(compareTags("10.0.0-r1", "9.99.99-r99") > 0);
  for (const tag of ["9.2-r1", "09.2.4-r1", "9.2.4-r0", "9.2.4-r01", "9.2.4-r2\nother", "2.0+redmine.9.2.4"]) {
    assert.throws(() => parseTag(tag));
  }
});

test("configuration selects one patch per series and at most one previous series", () => {
  assert.deepEqual(parseConfig(config), config);
  for (const value of [
    { ...config, standard: "9.2" }, { ...config, maintenance: ["9.2.3"] },
    { ...config, maintenance: ["10.0.0"] }, { ...config, maintenance: ["8.1.7", "7.0.1"] },
    { ...config, extra: true },
  ]) assert.throws(() => parseConfig(value));
  parseConfig(JSON.parse(fs.readFileSync(new URL(`../${CONFIG_PATH}`, import.meta.url), "utf8")));
});

test("revision gates preserve the target's own ancestry", () => {
  assertRevision("8.1.7-r2", "8.1.7-r1");
  assertRevision("9.2.5-r1", "9.2.4-r10");
  assertRevision("8.1.7-r1", "1.0+redmine.8.1.7");
  assert.throws(() => assertRevision("8.1.7-r3", "8.1.7-r1"));
  assert.throws(() => assertRevision("9.2.5-r2", "9.2.4-r10"));
  assert.throws(() => assertRevision("8.1.7-r1", "9.2.4-r1"));
  assert.throws(() => assertRevision("8.1.7-r2", undefined));
  assert.throws(() => assertRevision("8.1.7-r2", "1.0+redmine.8.1.7"));
});

test("preparation uses numeric revisions and resets them only for a new target", () => {
  assert.equal(nextReleaseTag("9.2.4", "9.2.4-r9"), "9.2.4-r10");
  assert.equal(nextReleaseTag("9.2.10", "9.2.9-r99"), "9.2.10-r1");
  assert.equal(nextReleaseTag("8.1.7", "1.0+redmine.8.1.7"), "8.1.7-r1");
  assert.equal(nextReleaseTag("9.2.4"), "9.2.4-r1");
  assert.throws(() => nextReleaseTag("9.2.3", "9.2.4-r1"));
});

test("target proposals advance only a patch within an already selected series", () => {
  assert.deepEqual(publicationTargetUpdate(config, "9.2.5-r1"), { slot: "standard", previous: "9.2.4", target: "9.2.5", config: { ...config, standard: "9.2.5" } });
  assert.deepEqual(publicationTargetUpdate(config, "8.1.8-r2"), { slot: "maintenance", previous: "8.1.7", target: "8.1.8", config: { ...config, maintenance: ["8.1.8"] } });
  for (const tag of ["9.2.4-r99", "9.2.3-r99", "8.1.7-r99", "8.1.6-r99", "9.3.0-r1", "10.0.0-r1", "7.0.5-r1"]) assert.equal(publicationTargetUpdate(config, tag), null);
  assert.equal(publicationTargetUpdate({ ...config, maintenance: [] }, "8.1.8-r1"), null);
});

test("only the default branch's publisher ref is accepted", () => {
  const repository = { full_name: "example/api", default_branch: "main" };
  const context = { ref: "refs/heads/main", workflowRef: `example/api/${PUBLISH_WORKFLOW}@refs/heads/main` };
  assertDefaultWorkflow(context, repository);
  for (const ref of ["refs/heads/other", "refs/tags/9.2.4-r2"]) {
    assert.throws(() => assertDefaultWorkflow({ ...context, ref }, repository));
    assert.throws(() => assertDefaultWorkflow({ ...context, workflowRef: `example/api/${PUBLISH_WORKFLOW}@${ref}` }, repository));
  }
});

test("maintenance and unverified releases never become standard candidates", () => {
  const plan = planPromotion({ config, latest: { tag_name: "9.2.4-r1" }, releases: [release("8.1.7-r99"), { ...release("9.2.4-r3"), manifest: null }] });
  assert.equal(plan.deploy, false);
  assert.equal(plan.updateLatest, false);
});

test("the highest verified revision wins regardless of completion order", () => {
  const plan = planPromotion({ config, latest: { tag_name: "9.2.4-r1" }, releases: [release("9.2.4-r10"), release("9.2.4-r2"), release("9.2.4-r9")] });
  assert.equal(plan.tag, "9.2.4-r10");
  assert.equal(plan.updateLatest, true);
});

for (const latest of ["9.2.4-r10", "9.2.5-r1", "10.0.0-r1"]) {
  test(`a delayed older publication cannot roll back ${latest}`, () => {
    const plan = planPromotion({ config, latest: { tag_name: latest }, releases: [release("9.2.4-r2")] });
    assert.equal(plan.deploy, false);
    assert.equal(plan.updateLatest, false);
  });
}

test("selection can advance to a new patch's r1", () => {
  const plan = planPromotion({ config: { ...config, standard: "9.2.5" }, latest: { tag_name: "9.2.4-r99" }, releases: [release("9.2.5-r1")] });
  assert.equal(plan.tag, "9.2.5-r1");
});

test("unknown Latest and implicit initial selection fail closed", () => {
  const options = { config, releases: [release("9.2.4-r2")] };
  assert.throws(() => planPromotion({ ...options, latest: { tag_name: "old-format" } }));
  assert.throws(() => planPromotion({ ...options, latest: null }));
  assert.equal(planPromotion({ ...options, latest: null, bootstrap: true }).tag, "9.2.4-r2");
});

test("a site newer than Latest is never rolled back", () => {
  const plan = planPromotion({ config, latest: { tag_name: "9.2.4-r1" }, deployed: { tag: "9.2.4-r3" }, releases: [release("9.2.4-r2")] });
  assert.equal(plan.deploy, false);
  assert.equal(plan.updateLatest, false);
});

test("site-only recovery keeps Latest and avoids redeploying a matching site", () => {
  const candidate = release("9.2.4-r2");
  const options = { config, latest: { tag_name: candidate.tag_name }, releases: [candidate] };
  const recovery = planPromotion(options);
  assert.equal(recovery.updateLatest, false);
  assert.equal(recovery.deploy, true);
  assert.equal(planPromotion({ ...options, deployed: { tag: candidate.tag_name, sourceSha: candidate.manifest.sourceSha, docsSha256: candidate.manifest.files["artifact.tar"].sha256 } }).deploy, false);
});

test("workflow permissions and artifact flow keep target code out of write jobs", () => {
  const read = (name) => load(fs.readFileSync(new URL(`../.github/workflows/${name}.yaml`, import.meta.url), "utf8"));
  const request = read("request-release");
  assert.deepEqual(request.permissions, {});
  assert(!request.jobs.request.steps.some((step) => step.uses));
  const publisher = read("publish-release");
  assert.deepEqual(publisher.on.workflow_run.workflows, [request.name]);
  assert.deepEqual(publisher.jobs.validate.permissions, { contents: "read" });
  const validationUpload = publisher.jobs.validate.steps.find((step) => step.id === "artifact");
  assert(validationUpload.with.name.includes("${{ github.run_attempt }}"), "Validation reruns need distinct immutable artifacts");
  const publish = publisher.jobs.publish;
  assert(publish.needs.includes("validate"));
  assert(publish.if.includes("needs.validate.result == 'success'"));
  const transfer = publish.steps.find((step) => step.uses?.startsWith("actions/download-artifact@"));
  assert.equal(transfer.with["artifact-ids"], "${{ needs.validate.outputs.artifact_id }}");
  assert.equal(transfer.with["digest-mismatch"], "error");
  for (const name of ["github-token", "repository", "run-id"]) assert.equal(transfer.with[name], undefined);
  for (const name of ["publish", "reconcile"]) {
    const job = publisher.jobs[name];
    assert.equal(job.permissions.contents, "write");
    for (const step of job.steps) {
      if (step.uses?.startsWith("actions/checkout@")) {
        assert.equal(step.with.ref, "${{ github.event.repository.default_branch }}");
        assert.equal(step.with["persist-credentials"], false);
      }
      if (step.uses?.startsWith("actions/setup-node@")) assert.equal(step.with.cache, undefined);
      assert(!step.run?.includes("./test/run-test.sh"));
    }
  }
  const reconcile = publisher.jobs.reconcile;
  assert.equal(reconcile.concurrency["cancel-in-progress"], false);
  assert(!reconcile.concurrency.group.includes("${{"));
  const steps = reconcile.steps;
  const siteUpload = steps.find((step) => step.uses?.startsWith("actions/upload-artifact@"));
  const siteDeploy = steps.find((step) => step.id === "deploy");
  assert.equal(siteUpload.with.name, siteDeploy.with.artifact_name);
  assert(siteUpload.with.name.includes("${{ github.run_attempt }}"), "Site reruns need distinct immutable artifacts");
  assert(steps.findIndex((step) => step.id === "latest") < steps.findIndex((step) => step.id === "site"));
  assert(steps.findIndex((step) => step.id === "site") < steps.findIndex((step) => step.id === "deploy"));
  const retired = read("release");
  assert.equal(retired.on, "workflow_dispatch");
  assert.deepEqual(retired.permissions, {});
});
