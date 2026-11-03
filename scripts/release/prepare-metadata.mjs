import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";
import { load } from "js-yaml";

import { nextReleaseTag } from "./policy.mjs";
import { imagePin } from "./validate.mjs";

function replaceOnce(text, pattern, replacement, label) {
  let count = 0;
  const updated = text.replace(pattern, (...args) => { count++; return replacement(...args); });
  assert.equal(count, 1, `Expected exactly one ${label}`);
  return updated;
}

export function prepareReleaseMetadata({ sourceDir, target, run = execFileSync }) {
  const root = fs.realpathSync(sourceDir);
  const command = (name, args, options = {}) => run(name, args, { cwd: root, stdio: "inherit", ...options });
  const git = (...args) => command("git", args, { stdio: "pipe", encoding: "utf8" }).trim();
  assert.equal(fs.realpathSync(git("rev-parse", "--show-toplevel")), root, "Run release preparation from the repository root");
  assert.equal(git("rev-parse", "--is-shallow-repository"), "false", "Release history must not be shallow");
  const paths = ["src/openapi.yaml", "test/redmine/docker-compose.yaml", "openapi.yaml"];
  const original = new Map(paths.map((name) => [name, fs.readFileSync(path.join(root, name), "utf8")]));
  const selected = target ?? imagePin(load(original.get(paths[1])));
  nextReleaseTag(selected);
  git("fetch", "--tags", "origin");
  let previous;
  try {
    previous = git("describe", "--tags", "--abbrev=0", "--match", "[0-9]*-r[0-9]*", "--match", "*+redmine*", "HEAD");
  } catch (error) {
    if (error.status !== 128) throw error;
  }
  const tag = nextReleaseTag(selected, previous);
  assert.equal(git("tag", "--list", tag), "", "The planned tag already exists outside this source history");
  let spec = replaceOnce(original.get(paths[0]), /^  version: .+$/gm, () => `  version: ${tag}`, "info.version");
  spec = replaceOnce(spec, /(tested against Redmine )\d+\.\d+\.\d+/g, (_match, prefix) => `${prefix}${selected}`, "tested Redmine description");
  const compose = replaceOnce(original.get(paths[1]), /redmine:\d+\.\d+\.\d+/g, () => `redmine:${selected}`, "Redmine image pin");
  assert.equal(load(spec).info.version, tag);
  assert.equal(imagePin(load(compose)), selected);
  try {
    fs.writeFileSync(path.join(root, paths[0]), spec);
    fs.writeFileSync(path.join(root, paths[1]), compose);
    command("npm", ["run", "bundle"]);
    const bundled = load(fs.readFileSync(path.join(root, paths[2]), "utf8"));
    assert.equal(bundled.info.version, tag, "Generated bundle has a different version");
    assert.equal(bundled.info.description, load(spec).info.description, "Generated bundle has a different test target");
  } catch (error) {
    for (const [name, bytes] of original) fs.writeFileSync(path.join(root, name), bytes);
    throw error;
  }
  return { tag, target: selected, previous };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values, positionals } = parseArgs({ options: { source: { type: "string" }, help: { type: "boolean" } }, allowPositionals: true });
    if (values.help) {
      console.log("Usage: npm run release:prepare -- [--source checkout-path] [Redmine-version]\nFetches tags, updates release metadata and rebuilds openapi.yaml; leaves changes uncommitted.");
    } else {
      assert(positionals.length <= 1, "Specify at most one Redmine version");
      const result = prepareReleaseMetadata({ sourceDir: values.source ?? process.cwd(), target: positionals[0] });
      console.log(`Prepared ${result.tag}. Review and commit the changes before publishing.`);
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
