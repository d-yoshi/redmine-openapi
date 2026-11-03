import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { load } from "js-yaml";

import { prepareReleaseMetadata } from "../scripts/release/prepare-metadata.mjs";

function fixture(t) {
  const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), "release-prepare-"));
  t.after(() => fs.rmSync(sourceDir, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", args, { cwd: sourceDir, encoding: "utf8", stdio: "pipe" }).trim();
  const write = (name, content) => { fs.mkdirSync(path.dirname(path.join(sourceDir, name)), { recursive: true }); fs.writeFileSync(path.join(sourceDir, name), content); };
  write("src/openapi.yaml", "openapi: 3.0.3\ninfo:\n  description: Unofficial API, tested against Redmine 9.2.4\n  version: 9.2.4-r1\npaths: {}\n");
  write("test/redmine/docker-compose.yaml", "services:\n  redmine:\n    image: ${REDMINE_IMAGE:-redmine:9.2.4}\n");
  fs.copyFileSync(path.join(sourceDir, "src/openapi.yaml"), path.join(sourceDir, "openapi.yaml"));
  git("init", "--quiet", "--initial-branch=main", "--object-format=sha1");
  git("add", ".");
  git("-c", "user.name=Release Test", "-c", "user.email=release-test@example.com", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", "commit", "--quiet", "-m", "fixture");
  git("tag", "9.2.4-r1");
  const calls = [];
  const run = (command, args, options) => {
    calls.push({ command, args });
    if (command === "git" && args[0] === "fetch") return "";
    if (command === "npm") {
      assert.deepEqual(args, ["run", "bundle"]);
      fs.copyFileSync(path.join(sourceDir, "src/openapi.yaml"), path.join(sourceDir, "openapi.yaml"));
      return Buffer.alloc(0);
    }
    return execFileSync(command, args, options);
  };
  const read = (name) => fs.readFileSync(path.join(sourceDir, name), "utf8");
  return { sourceDir, git, run, read, write, calls };
}

test("release preparation increments the revision without creating a commit or tag", (t) => {
  const value = fixture(t);
  const head = value.git("rev-parse", "HEAD");
  value.write("src/openapi.yaml", value.read("src/openapi.yaml") + "# Uncommitted specification work\n");
  const first = prepareReleaseMetadata(value);
  assert.deepEqual(first, { tag: "9.2.4-r2", target: "9.2.4", previous: "9.2.4-r1" });
  assert.deepEqual(prepareReleaseMetadata(value), first);
  assert.match(value.read("src/openapi.yaml"), /Uncommitted specification work/);
  assert.equal(load(value.read("openapi.yaml")).info.version, first.tag);
  assert.equal(value.git("rev-parse", "HEAD"), head);
  assert.equal(value.git("tag", "--list"), "9.2.4-r1");
  assert.equal(value.git("diff", "--cached", "--name-only"), "");
  assert(value.calls.some(({ command, args }) => command === "git" && args.join(" ") === "fetch --tags origin"));
});

test("a new Redmine target updates metadata and pin together and starts at r1", (t) => {
  const value = fixture(t);
  const result = prepareReleaseMetadata({ ...value, target: "9.2.5" });
  assert.equal(result.tag, "9.2.5-r1");
  assert.equal(load(value.read("src/openapi.yaml")).info.description, "Unofficial API, tested against Redmine 9.2.5");
  assert.equal(load(value.read("openapi.yaml")).info.version, result.tag);
  assert.match(value.read("test/redmine/docker-compose.yaml"), /redmine:9\.2\.5/);
});

test("fetched tags participate in revision calculation", (t) => {
  const value = fixture(t);
  value.git("tag", "--delete", "9.2.4-r1");
  const run = (command, args, options) => {
    if (command === "git" && args[0] === "fetch") { value.git("tag", "9.2.4-r1"); return ""; }
    return value.run(command, args, options);
  };
  assert.equal(prepareReleaseMetadata({ ...value, run }).tag, "9.2.4-r2");
});

test("invalid and older targets are rejected without changing release files", (t) => {
  for (const target of ["9.2", "9.02.5", "9.2.5-alpine", "9.2.3"]) {
    const value = fixture(t);
    assert.throws(() => prepareReleaseMetadata({ ...value, target }));
    assert.equal(value.git("status", "--porcelain"), "");
    assert(!value.calls.some(({ command }) => command === "npm"));
  }
});

test("fetch and bundle failures preserve the original working files", (t) => {
  for (const failure of ["fetch", "bundle", "wrong-bundle"]) {
    const value = fixture(t);
    const names = ["src/openapi.yaml", "test/redmine/docker-compose.yaml", "openapi.yaml"];
    const original = names.map(value.read);
    const run = (command, args, options) => {
      if (failure === "fetch" && command === "git" && args[0] === "fetch") throw new Error("fetch failed");
      if (command === "npm" && failure !== "fetch") {
        value.write("openapi.yaml", "info:\n  version: wrong\n");
        if (failure === "bundle") throw new Error("bundle failed");
        return "";
      }
      return value.run(command, args, options);
    };
    assert.throws(() => prepareReleaseMetadata({ ...value, target: "9.2.5", run }));
    assert.deepEqual(names.map(value.read), original);
  }
});

test("a tag collision outside the ancestry cannot be silently reused", (t) => {
  const value = fixture(t);
  const other = execFileSync("git", ["-c", "user.name=Release Test", "-c", "user.email=release-test@example.com", "commit-tree", value.git("rev-parse", "HEAD^{tree}")], { cwd: value.sourceDir, input: "unrelated source\n", encoding: "utf8" }).trim();
  value.git("tag", "9.2.4-r2", other);
  assert.throws(() => prepareReleaseMetadata(value), /already exists outside/);
  assert.equal(value.git("status", "--porcelain"), "");
});

test("ambiguous metadata is rejected before any file is written", (t) => {
  const value = fixture(t);
  const original = value.read("src/openapi.yaml").replace("paths: {}", "paths: {}\n# tested against Redmine 9.2.4");
  value.write("src/openapi.yaml", original);
  assert.throws(() => prepareReleaseMetadata(value), /exactly one/);
  assert.equal(value.read("src/openapi.yaml"), original);
  assert(!value.calls.some(({ command }) => command === "npm"));
});
