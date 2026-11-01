import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { load } from "js-yaml";

import { buildRelease, imagePin } from "../scripts/release/validate.mjs";
import { checkBytes } from "../scripts/release/publication.mjs";
import { PAYLOAD_FILES } from "../scripts/release/policy.mjs";

function fixture(t, { stale = false, tag = "9.2.4-r2", pin = "9.2.4", version = tag } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "release-build-test-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const sourceDir = path.join(directory, "source");
  const outputDir = path.join(directory, "payload");
  fs.mkdirSync(sourceDir);
  const write = (file, bytes) => {
    fs.mkdirSync(path.dirname(path.join(sourceDir, file)), { recursive: true });
    fs.writeFileSync(path.join(sourceDir, file), bytes);
  };
  const git = (...args) => execFileSync("git", args, { cwd: sourceDir, encoding: "utf8", stdio: "pipe" });
  const commit = () => {
    git("add", ".");
    git("-c", "user.name=Release Test", "-c", "user.email=release-test@example.com", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", "commit", "--quiet", "--allow-empty", "-m", "fixture");
  };
  git("init", "--quiet", "--initial-branch=main", "--object-format=sha1");
  write(".gitignore", "/dist/\n/test/dist/\n");
  write("package-lock.json", "{}\n");
  write(".tool-versions", "nodejs 24.22.1\n");
  write("test/check.sh", "#!/bin/bash\nexit 0\n");
  write("test/run-test.sh", "#!/bin/bash\nexit 0\n");
  write("redocly/assets/favicon.svg", "<svg/>\n");
  write("test/redmine/docker-compose.yaml", `services:\n  redmine:\n    image: redmine:${pin}\n`);
  write("src/openapi.yaml", "openapi: 3.0.3\ninfo:\n  title: Fixture\n  version: 9.2.4-r1\npaths: {}\n");
  fs.copyFileSync(path.join(sourceDir, "src/openapi.yaml"), path.join(sourceDir, "openapi.yaml"));
  commit();
  git("tag", "9.2.4-r1");
  git("branch", "9.2.4-r1");
  write("src/openapi.yaml", `openapi: 3.0.3\ninfo:\n  title: Fixture\n  version: ${version}\npaths: {}\n`);
  if (!stale) fs.copyFileSync(path.join(sourceDir, "src/openapi.yaml"), path.join(sourceDir, "openapi.yaml"));
  commit();
  const calls = [];
  const run = (command, args, options) => {
    calls.push({ command, args });
    if (command === "git" || command === "tar") return execFileSync(command, args, { ...options, stdio: "pipe" });
    if (command === "npm" && args[1] === "bundle") fs.copyFileSync(path.join(sourceDir, "src/openapi.yaml"), path.join(sourceDir, "openapi.yaml"));
    else if (command === "./test/run-test.sh") write("test/dist/openapi.strict.yaml", fs.readFileSync(path.join(sourceDir, "openapi.yaml")));
    else if (command === "npm" && args[1] === "docs") write("dist/index.html", "<html>release docs</html>\n");
    else if (command === "docker") return args.includes("changelog") ? "API changes\n" : "";
    else throw new Error(`Unexpected fixture command: ${command} ${args.join(" ")}`);
    return Buffer.alloc(0);
  };
  const options = { sourceDir, outputDir, tag, sourceSha: git("rev-parse", "HEAD").trim(), toolingSha: "b".repeat(40), repository: "example/api", runId: "123", runAttempt: "1", pagesUrl: "https://example.github.io/api/", run };
  return { options, calls, git, write, run };
}

test("release validation packages the tested source, strict schema and site with matching hashes", (t) => {
  const { options, calls } = fixture(t);
  const manifest = buildRelease(options);
  assert.equal(manifest.tag, options.tag);
  assert.equal(manifest.sourceSha, options.sourceSha);
  for (const name of PAYLOAD_FILES) checkBytes(fs.readFileSync(path.join(options.outputDir, name)), manifest.files[name], name);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(options.outputDir, "validation.json"), "utf8")), manifest);
  assert(calls.some((entry) => entry.command === "./test/run-test.sh"));
  assert(calls.some((entry) => entry.command === "git" && entry.args.includes("refs/tags/9.2.4-r1:openapi.yaml")));
  const docs = calls.find((entry) => entry.command === "npm" && entry.args[1] === "docs");
  assert.equal(docs.args.at(-1), "/api");
  const archive = path.join(options.outputDir, "artifact.tar");
  const members = execFileSync("tar", ["-tf", archive], { encoding: "utf8" });
  for (const name of ["index.html", "favicon.svg", "release.json", "sitemap.xml"]) assert(members.includes(name));
  assert.deepEqual(JSON.parse(execFileSync("tar", ["-xOf", archive, "./release.json"], { encoding: "utf8" })), { tag: options.tag, sourceSha: options.sourceSha });
  assert.equal(load(fs.readFileSync(path.join(options.outputDir, "openapi.yaml"), "utf8")).info.version, options.tag);
});

test("wrong metadata, image pins and revision gaps are rejected before target tests", (t) => {
  for (const settings of [{ version: "9.2.4-r1" }, { pin: "9.2.3" }, { tag: "9.2.4-r3" }]) {
    const { options, calls } = fixture(t, settings);
    assert.throws(() => buildRelease(options), /Tag differs|Revisions must increase/);
    assert(!calls.some((entry) => entry.command === "./test/run-test.sh"));
  }
});

test("stale bundles and unsuccessful target tests never produce a publication manifest", (t) => {
  const stale = fixture(t, { stale: true });
  assert.throws(() => buildRelease(stale.options));
  assert.equal(fs.existsSync(path.join(stale.options.outputDir, "validation.json")), false);
  const failed = fixture(t);
  const run = (command, args, options) => {
    if (command === "./test/run-test.sh") throw new Error("API contract tests failed");
    return failed.run(command, args, options);
  };
  assert.throws(() => buildRelease({ ...failed.options, run }), /API contract tests failed/);
  assert.equal(fs.existsSync(path.join(failed.options.outputDir, "validation.json")), false);
});

test("breaking corrections are noted, while diff tool failures stop the build", (t) => {
  for (const status of [1, 2]) {
    const value = fixture(t);
    const run = (command, args, options) => {
      if (command === "docker" && args.includes("breaking")) throw Object.assign(new Error("diff failed"), { status });
      return value.run(command, args, options);
    };
    if (status === 1) {
      buildRelease({ ...value.options, run });
      assert.match(fs.readFileSync(path.join(value.options.outputDir, "notes.md"), "utf8"), /Breaking corrections compared with 9.2.4-r1/);
    } else assert.throws(() => buildRelease({ ...value.options, run }), /diff failed/);
  }
});

test("old test foundations and dirty source checkouts fail before running target code", (t) => {
  const old = fixture(t);
  old.git("rm", "--quiet", "package-lock.json");
  old.git("-c", "user.name=Release Test", "-c", "user.email=release-test@example.com", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", "commit", "--quiet", "-m", "old foundation");
  assert.throws(() => buildRelease({ ...old.options, sourceSha: old.git("rev-parse", "HEAD").trim() }), /current test foundation/);
  const dirty = fixture(t);
  dirty.write("src/openapi.yaml", "uncommitted changes\n");
  assert.throws(() => buildRelease(dirty.options), /local changes/);
});

test("release output cannot mix old artifacts or be inside the source checkout", (t) => {
  const { options } = fixture(t);
  fs.mkdirSync(options.outputDir);
  fs.writeFileSync(path.join(options.outputDir, "stale"), "old artifact");
  assert.throws(() => buildRelease(options), /output must be empty/);
  assert.throws(() => buildRelease({ ...options, outputDir: path.join(options.sourceDir, "dist") }), /outside the source/);
});

test("release image pins accept only exact released versions", () => {
  for (const image of ["redmine:9.2.4", "${REDMINE_IMAGE:-redmine:9.2.4}"]) assert.equal(imagePin({ services: { redmine: { image } } }), "9.2.4");
  for (const image of ["redmine:9.2", "redmine:latest", "redmine:9.2.4-alpine", "${REDMINE_IMAGE}"]) assert.throws(() => imagePin({ services: { redmine: { image } } }));
});

test("release validation rejects candidate image overrides before running target code", (t) => {
  const { options, calls } = fixture(t);
  const previous = process.env.REDMINE_IMAGE;
  try {
    process.env.REDMINE_IMAGE = "redmine:9.2.5";
    assert.throws(() => buildRelease(options), /must use the pinned image/);
    assert.deepEqual(calls, []);
  } finally {
    if (previous === undefined) delete process.env.REDMINE_IMAGE;
    else process.env.REDMINE_IMAGE = previous;
  }
});
