import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

import { GitHub } from "./github.mjs";
import { CONFIG_PATH, REQUEST_WORKFLOW, assertDefaultWorkflow, assertSha, parseConfig, parseTag, positiveInteger } from "./policy.mjs";
import { beginSite, currentPromotion, readPayload, writeSite, publishRelease, updateLatest } from "./publication.mjs";
import { buildRelease } from "./validate.mjs";

const tooling = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const required = (name) => { assert(process.env[name], `${name} is required`); return process.env[name]; };
const outputs = (values) => {
  for (const [name, value] of Object.entries(values)) {
    assert(!/[\r\n]/.test(String(value)), "Invalid workflow output");
    fs.appendFileSync(required("GITHUB_OUTPUT"), `${name}=${value}\n`);
  }
};
const bootstrap = () => process.env.RELEASE_BOOTSTRAP === "true";
const savedPlan = () => JSON.parse(fs.readFileSync(required("RELEASE_PLAN"), "utf8"));
const gitHead = () => assertSha(execFileSync("git", ["rev-parse", "HEAD"], { cwd: tooling, encoding: "utf8" }).trim());

export async function prepareRequest(github, event, context) {
  const repository = await github.repositoryInfo();
  assertDefaultWorkflow(context, repository);
  let tag = "";
  let sourceSha = "";
  if (context.eventName === "workflow_run") {
    const run = await github.runInfo(event.workflow_run.id);
    assert.equal(run.path, REQUEST_WORKFLOW, "Unexpected release request workflow");
    assert.equal(run.event, "push", "Only tag pushes can request automatic publication");
    assert.equal(run.conclusion, "success", "Release request did not succeed");
    assert.equal(run.head_repository.id, repository.id, "Release request came from another repository");
    tag = parseTag(run.head_branch).tag;
    sourceSha = await github.tagSha(tag);
    assert.equal(sourceSha, run.head_sha, "Request no longer matches the release tag");
  } else if (context.eventName === "workflow_dispatch") {
    tag = event.inputs?.tag?.trim() ?? "";
    if (tag) sourceSha = await github.tagSha(parseTag(tag).tag);
  } else {
    assert.equal(context.eventName, "push", "Unexpected publication event");
  }
  const pages = await github.request(`${github.prefix}/pages`);
  assert(pages.html_url, "GitHub Pages is not configured");
  return { mode: tag ? "publish" : "reconcile", tag, sha: sourceSha, pages_url: pages.html_url };
}

async function main() {
  const command = process.argv[2];
  if (command === "check-config") {
    parseConfig(JSON.parse(fs.readFileSync(path.join(tooling, CONFIG_PATH), "utf8")));
    return;
  }
  if (command === "validate") {
    buildRelease({
      sourceDir: required("RELEASE_SOURCE_DIR"), outputDir: required("RELEASE_OUTPUT_DIR"),
      tag: required("RELEASE_TAG"), sourceSha: required("RELEASE_SOURCE_SHA"), toolingSha: required("RELEASE_TOOLING_SHA"),
      repository: required("GITHUB_REPOSITORY"), runId: required("GITHUB_RUN_ID"), runAttempt: required("GITHUB_RUN_ATTEMPT"),
      pagesUrl: required("RELEASE_PAGES_URL"),
    });
    return;
  }
  const github = new GitHub({ repository: required("GITHUB_REPOSITORY"), token: required("GH_TOKEN"), apiUrl: process.env.GITHUB_API_URL });
  const context = { ref: required("GITHUB_REF"), workflowRef: required("GITHUB_WORKFLOW_REF"), eventName: required("GITHUB_EVENT_NAME") };
  if (command !== "prepare") assertDefaultWorkflow(context, await github.repositoryInfo());
  switch (command) {
    case "prepare": {
      const request = await prepareRequest(github, JSON.parse(fs.readFileSync(required("GITHUB_EVENT_PATH"), "utf8")), context);
      outputs({ ...request, tooling_sha: gitHead() });
      break;
    }
    case "publish": {
      const payload = readPayload(required("RELEASE_INPUT_DIR"), {
        runId: positiveInteger(required("GITHUB_RUN_ID"), "run"), runAttempt: positiveInteger(required("GITHUB_RUN_ATTEMPT"), "attempt"),
      });
      const manifest = await publishRelease(github, payload, {
        repository: github.repository, tag: required("RELEASE_TAG"), sourceSha: required("RELEASE_SOURCE_SHA"), publisherSha: gitHead(),
      });
      console.log(`Published ${manifest.tag} from ${manifest.sourceSha}`);
      break;
    }
    case "plan": {
      const result = await currentPromotion(github, bootstrap());
      fs.writeFileSync(required("RELEASE_PLAN"), `${JSON.stringify(result.plan, null, 2)}\n`);
      writeSite(result, required("RELEASE_SITE_ARTIFACT"));
      outputs({ ready: Boolean(result.plan.tag), deploy: result.plan.deploy });
      console.log(result.plan.reason);
      break;
    }
    case "latest":
      outputs({ valid: await updateLatest(github, savedPlan(), bootstrap()) });
      break;
    case "begin-site": {
      const deployment = await beginSite(github, savedPlan(), bootstrap());
      outputs({ id: deployment?.id ?? "", deploy: Boolean(deployment) });
      break;
    }
    case "record-site": {
      const state = required("RELEASE_SITE_RESULT") === "success" ? "success" : "failure";
      await github.recordSite(required("RELEASE_DEPLOYMENT_ID"), state, required("RELEASE_SITE_URL"), `${required("GITHUB_SERVER_URL")}/${github.repository}/actions/runs/${required("GITHUB_RUN_ID")}`);
      break;
    }
    default:
      throw new Error(`Unknown release command: ${command}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error); process.exitCode = 1; });
}
