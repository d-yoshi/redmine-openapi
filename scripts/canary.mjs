import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { load } from "js-yaml";

import { GitHub } from "./release/github.mjs";
import { CONFIG_PATH, compareTags, compareVersions, parseConfig, parseTag, parseVersion } from "./release/policy.mjs";
import { imagePin } from "./release/validate.mjs";

const tooling = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tagsUrl = "https://hub.docker.com/v2/repositories/library/redmine/tags?page_size=100";
const series = (version) => version.split(".").slice(0, 2).join(".");

export async function dockerVersions(fetchImpl = fetch) {
  const versions = new Set();
  const visited = new Set();
  let next = tagsUrl;
  while (next) {
    const url = new URL(next);
    assert.equal(url.origin, new URL(tagsUrl).origin, "Unexpected Docker Hub pagination origin");
    assert.equal(url.pathname.replace(/\/$/, ""), new URL(tagsUrl).pathname, "Unexpected Docker Hub pagination path");
    assert(!visited.has(url.href) && visited.size < 1000, "Invalid Docker Hub pagination");
    visited.add(url.href);
    const response = await fetchImpl(url.href, { signal: AbortSignal.timeout(30_000) });
    assert(response.ok, `Docker Hub: HTTP ${response.status}`);
    const page = await response.json();
    assert(Array.isArray(page.results), "Missing Docker Hub tag list");
    for (const entry of page.results) {
      assert.equal(typeof entry.name, "string", "Invalid Docker Hub tag");
      if (/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(entry.name)) versions.add(entry.name);
    }
    assert(page.next === null || typeof page.next === "string", "Invalid Docker Hub next page");
    next = page.next;
  }
  assert(versions.size, "No released Redmine image versions found");
  return [...versions].sort(compareVersions);
}

export async function planChecks(config, versions, github) {
  parseConfig(config);
  versions.forEach(parseVersion);
  const ordered = [...versions].sort(compareVersions);
  const checks = [];
  let releases;
  for (const target of [config.standard, ...config.maintenance]) {
    const candidate = ordered.findLast((version) => series(version) === series(target));
    assert(candidate, `No Docker image found for maintained series ${series(target)}`);
    if (compareVersions(candidate, target) <= 0) continue;
    const check = { target, candidate };
    try {
      releases ??= await github.releases();
      const release = releases.filter((entry) => {
        if (entry.draft || entry.prerelease) return false;
        try { return parseTag(entry.tag_name).target === target; } catch { return false; }
      }).sort((a, b) => compareTags(b.tag_name, a.tag_name))[0];
      assert(release, `No published specification for Redmine ${target}`);
      check.tag = release.tag_name;
      check.sha = await github.tagSha(check.tag);
    } catch (error) { check.error = error.message; }
    checks.push(check);
  }
  const newest = ordered.at(-1);
  return { checks, newSeries: newest && compareVersions(newest, config.standard) > 0 && series(newest) !== series(config.standard) ? newest : null };
}

async function execute(command, args, { cwd, env, onLine = () => {} }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "inherit"] });
    let pending = "";
    child.stdout.on("data", (chunk) => {
      process.stdout.write(chunk);
      const lines = (pending + chunk.toString()).split("\n");
      pending = lines.pop();
      lines.forEach(onLine);
    });
    child.on("error", reject);
    child.on("close", (code) => { if (pending) onLine(pending); resolve(code); });
  });
}

export async function runCheck(check, { sourceDir, resultsDir, run = execute }) {
  parseVersion(check.target);
  parseVersion(check.candidate);
  let phase = "source";
  let actual;
  const result = { ...check, status: "failure" };
  try {
    assert.equal(series(check.target), series(check.candidate), "Candidate belongs to another series");
    assert(compareVersions(check.candidate, check.target) > 0, "Candidate must be newer than the pin");
    assert.equal(parseTag(check.tag).target, check.target);
    const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: sourceDir, encoding: "utf8" }).trim();
    assert.equal(head, check.sha, "Checkout differs from the selected published tag");
    for (const name of ["package-lock.json", ".tool-versions", "test/check.sh", "test/run-test.sh"]) {
      assert(fs.existsSync(path.join(sourceDir, name)), `Published tag needs the current test foundation: ${name}`);
    }
    const read = (name) => load(fs.readFileSync(path.join(sourceDir, name), "utf8"));
    assert.equal(read("src/openapi.yaml").info.version, check.tag, "Published source has a different revision");
    assert.equal(imagePin(read("test/redmine/docker-compose.yaml")), check.target, "Published source has a different image pin");
    const env = { ...process.env, REDMINE_IMAGE: `redmine:${check.candidate}`, COMPOSE_PROJECT_NAME: `canary-${check.target.replaceAll(".", "-")}` };
    phase = "dependencies";
    assert.equal(await run("npm", ["ci"], { cwd: sourceDir, env }), 0, "Target dependency installation failed");
    phase = "validation";
    const code = await run("./test/run-test.sh", [], { cwd: sourceDir, env, onLine: (line) => {
      if (line === "=== Starting Redmine ===") phase = "startup";
      if (line === "=== Setting up Redmine ===") phase = "fixtures";
      if (line === "=== Running tests ===") phase = "tests";
      if (line === "=== Checking API coverage ===") phase = "coverage";
      const match = line.match(/^\s*Redmine version: (\d+\.\d+\.\d+)\s*$/);
      if (match) actual = match[1];
    } });
    if (actual && actual !== check.candidate) phase = "image";
    assert.equal(code, 0, `Target test runner failed during ${phase}`);
    phase = "image";
    assert.equal(actual, check.candidate, "Running Redmine version differs from the candidate or was not reported");
    phase = "complete";
    result.status = "success";
  } catch (error) { result.error = error.message; }
  result.phase = phase;
  fs.mkdirSync(resultsDir, { recursive: true });
  fs.writeFileSync(path.join(resultsDir, `${check.target}.json`), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}

export function reportsFor(plan, results, { checkResult, runUrl }) {
  if (checkResult !== "success" || !Array.isArray(plan?.checks)) return [{ key: "detection", title: "Canary: Redmine version detection failed", body: `Version detection or monitor setup failed. No API compatibility conclusion can be drawn.\n\nWorkflow run: ${runUrl}` }];
  const reports = plan.checks.map((check) => {
    const result = results.find((entry) => entry && ["target", "candidate", "sha", "tag"].every((key) => entry[key] === check[key]));
    const passed = !check.error && result?.status === "success" && result.phase === "complete";
    const phase = check.error ? "source selection" : ["source", "dependencies", "validation", "startup", "fixtures", "tests", "coverage", "image", "complete"].includes(result?.phase) ? result.phase : "setup";
    const detail = check.error ?? result?.error ?? "No result was produced; inspect checkout, Node.js setup, tooling installation and artifact download.";
    return {
      key: `patch:${check.target}:${check.candidate}`,
      title: `Canary: Redmine ${check.candidate} (pinned: ${check.target}) — ${passed ? "tests pass" : `${phase} failed`}`,
      body: `Candidate image: \`redmine:${check.candidate}\`.\nSpecification: ${check.tag ?? "unavailable"}${check.sha ? ` (${check.sha})` : ""}.\n\n${passed ? "The published specification's tests passed. Review the released Redmine source before proposing a pin/specification update." : `Canary did not complete successfully. This does not by itself establish an API behavior change.\n\nPhase: ${phase}.\nDetail: \`${String(detail).replace(/[\r\n`]/g, " ").slice(0, 500)}\``}\n\nWorkflow run: ${runUrl}`,
    };
  });
  if (plan.newSeries) reports.push({ key: `series:${series(plan.newSeries)}`, title: `Canary: Redmine ${series(plan.newSeries)} is available`, body: `Docker Hub has \`redmine:${plan.newSeries}\`, from a newer series. No tests were run against this series. Decide whether to adopt it through the release policy.\n\nWorkflow run: ${runUrl}` });
  return reports;
}

export async function updateIssues(github, reports) {
  if (!reports.length) return;
  const issues = (await github.list(`${github.prefix}/issues?state=open`)).filter((entry) => !entry.pull_request);
  for (const report of reports) {
    const marker = `<!-- redmine-openapi-canary:${report.key} -->`;
    const body = `${report.body}\n\n${marker}\n`;
    const existing = issues.find((issue) => issue.body?.includes(marker));
    if (!existing) await github.request(`${github.prefix}/issues`, { method: "POST", body: { title: report.title, body } });
    else if (existing.title !== report.title || existing.body !== body) await github.request(`${github.prefix}/issues/${existing.number}`, { method: "PATCH", body: { title: report.title, body } });
  }
}

async function main() {
  const command = process.argv[2];
  const github = () => new GitHub({ repository: process.env.GITHUB_REPOSITORY, token: process.env.GH_TOKEN, apiUrl: process.env.GITHUB_API_URL });
  if (command === "detect") {
    const config = parseConfig(JSON.parse(fs.readFileSync(path.join(tooling, CONFIG_PATH), "utf8")));
    const plan = await planChecks(config, await dockerVersions(), github());
    const include = plan.checks.filter((check) => !check.error);
    for (const [key, value] of Object.entries({ plan: JSON.stringify(plan), matrix: JSON.stringify({ include }), changed: include.length > 0 })) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
    console.log(JSON.stringify(plan, null, 2));
  } else if (command === "test") {
    const result = await runCheck(JSON.parse(process.env.CANARY_CHECK), { sourceDir: process.env.CANARY_SOURCE_DIR, resultsDir: process.env.CANARY_RESULTS_DIR });
    if (result.status !== "success") process.exitCode = 1;
  } else if (command === "report") {
    const directory = process.env.CANARY_RESULTS_DIR;
    const results = process.env.CANARY_DOWNLOAD_RESULT === "success" && fs.existsSync(directory)
      ? fs.readdirSync(directory).filter((name) => name.endsWith(".json")).flatMap((name) => { try { return [JSON.parse(fs.readFileSync(path.join(directory, name), "utf8"))]; } catch { return []; } }) : [];
    const reports = reportsFor(JSON.parse(process.env.CANARY_PLAN || "null"), results, { checkResult: process.env.CANARY_CHECK_RESULT, runUrl: `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` });
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, reports.map((report) => `## ${report.title}\n\n${report.body}\n`).join("\n") || "No newer images were found for the maintained targets.\n");
    if (process.env.CANARY_NOTIFY === "true") await updateIssues(github(), reports);
  } else throw new Error(`Unknown Canary command: ${command}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(error); process.exitCode = 1; });
