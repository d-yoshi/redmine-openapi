import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { load } from "js-yaml";

import { digest } from "./github.mjs";
import { PAYLOAD_FILES, assertRevision, assertSha, parseTag, parseValidation, positiveInteger } from "./policy.mjs";

export function imagePin(document) {
  let image = document?.services?.redmine?.image;
  assert.equal(typeof image, "string", "Missing Redmine image pin");
  const prefix = "${REDMINE_IMAGE:-";
  if (image.startsWith(prefix) && image.endsWith("}")) image = image.slice(prefix.length, -1);
  assert(/^redmine:(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(image), "Image must pin a released Redmine patch");
  return image.slice("redmine:".length);
}

export function buildRelease({ sourceDir, outputDir, tag, sourceSha, toolingSha, repository, runId, runAttempt, pagesUrl, run = execFileSync }) {
  const source = path.resolve(sourceDir);
  const output = path.resolve(outputDir);
  const release = parseTag(tag);
  assertSha(sourceSha);
  assertSha(toolingSha);
  assert(!process.env.REDMINE_IMAGE, "Release validation must use the pinned image");
  assert(output !== source && !output.startsWith(`${source}${path.sep}`), "Release output must be outside the source checkout");
  assert(!fs.existsSync(output) || fs.readdirSync(output).length === 0, "Release output must be empty");
  const command = (name, args, options = {}) => run(name, args, { cwd: source, stdio: "inherit", ...options });
  const git = (...args) => command("git", args, { stdio: "pipe", encoding: "utf8" }).trim();
  assert.equal(git("rev-parse", "HEAD"), sourceSha, "Checkout differs from the requested source SHA");
  assert.equal(git("status", "--porcelain", "--untracked-files=no"), "", "Release source has local changes");
  assert.equal(git("rev-parse", "--is-shallow-repository"), "false", "Release history must not be shallow");
  for (const file of ["package-lock.json", ".tool-versions", "test/check.sh", "test/run-test.sh"]) {
    assert(fs.existsSync(path.join(source, file)), `Release source needs the current test foundation: ${file}`);
  }
  const document = (file) => load(fs.readFileSync(path.join(source, file), "utf8"));
  assert.equal(document("src/openapi.yaml").info.version, tag, "Tag differs from src/info.version");
  assert.equal(imagePin(document("test/redmine/docker-compose.yaml")), release.target, "Tag differs from the image pin");
  let previous;
  try {
    previous = git("describe", "--tags", "--abbrev=0", "--match", "[0-9]*-r[0-9]*", "--match", "*+redmine*", `${sourceSha}^`);
  } catch (error) {
    if (error.status !== 128) throw error;
  }
  assertRevision(tag, previous);
  git("ls-files", "--error-unmatch", "openapi.yaml");
  command("npm", ["run", "bundle"]);
  command("git", ["diff", "--exit-code", "--", "openapi.yaml"]);
  assert.equal(document("openapi.yaml").info.version, tag, "Tag differs from bundled info.version");
  command("./test/run-test.sh", []);
  assert.equal(git("status", "--porcelain", "--untracked-files=no"), "", "Validation modified tracked release source");

  fs.mkdirSync(output, { recursive: true });
  fs.copyFileSync(path.join(source, "openapi.yaml"), path.join(output, "openapi.yaml"));
  fs.copyFileSync(path.join(source, "test/dist/openapi.strict.yaml"), path.join(output, "openapi.strict.yaml"));
  const notes = [`Tested against: Redmine ${release.target}`, "", `Source: ${sourceSha}`, ""];
  if (previous) {
    const previousDir = path.join(output, "previous");
    fs.mkdirSync(previousDir, { recursive: true });
    fs.writeFileSync(path.join(previousDir, "openapi.yaml"), command("git", ["show", `refs/tags/${previous}:openapi.yaml`], { stdio: "pipe" }));
    const diff = (kind) => command("docker", ["run", "--rm", "-v", `${previousDir}:/previous:ro`, "-v", `${output}:/current:ro`, "tufin/oasdiff", kind, "/previous/openapi.yaml", "/current/openapi.yaml", ...(kind === "breaking" ? ["--fail-on", "ERR"] : [])], { stdio: "pipe", encoding: "utf8" });
    try { diff("breaking"); } catch (error) {
      if (error.status !== 1) throw error;
      notes.push(`**Breaking corrections compared with ${previous}: regenerated clients or validators may need changes.**`, "");
    }
    notes.push(`## Changes since ${previous}`, "", "```", diff("changelog").trim(), "```", "");
  }
  fs.writeFileSync(path.join(output, "notes.md"), `${notes.join("\n")}\n`);

  const url = new URL(pagesUrl);
  assert.equal(url.protocol, "https:", "Pages must use an HTTPS URL");
  const basePath = url.pathname.replace(/\/$/, "");
  command("npm", ["run", "docs", "--", "--templateOptions.basePath", basePath]);
  const site = path.join(output, "site");
  fs.mkdirSync(site);
  fs.copyFileSync(path.join(source, "dist/index.html"), path.join(site, "index.html"));
  fs.cpSync(path.join(source, "redocly/assets"), site, { recursive: true, dereference: true });
  fs.writeFileSync(path.join(site, "release.json"), `${JSON.stringify({ tag, sourceSha })}\n`);
  const modified = git("show", "-s", "--format=%cI", sourceSha);
  const location = new URL(pagesUrl).href.replaceAll("&", "&amp;").replaceAll("<", "&lt;");
  fs.writeFileSync(path.join(site, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${location}</loc><lastmod>${modified}</lastmod></url></urlset>\n`);
  command("tar", ["-cf", path.join(output, "artifact.tar"), "-C", site, "."]);
  fs.rmSync(site, { recursive: true });
  if (previous) fs.rmSync(path.join(output, "previous"), { recursive: true });
  const files = Object.fromEntries(PAYLOAD_FILES.map((name) => {
    const bytes = fs.readFileSync(path.join(output, name));
    return [name, { size: bytes.length, sha256: digest(bytes) }];
  }));
  const manifest = parseValidation({ schemaVersion: 1, tag, sourceSha, toolingSha, repository,
    runId: positiveInteger(runId, "run"), runAttempt: positiveInteger(runAttempt, "attempt"), files });
  fs.writeFileSync(path.join(output, "validation.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}
