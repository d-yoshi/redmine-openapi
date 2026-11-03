import assert from "node:assert/strict";

import { CONFIG_PATH, assertSha, parseConfig, publicationTargetUpdate } from "./policy.mjs";
import { verifiedPublishedRelease } from "./publication.mjs";

export async function proposeTargetUpdate(github, { tag, sourceSha }) {
  let current = await github.currentConfig();
  let proposal = publicationTargetUpdate(current.config, tag);
  if (!proposal) return null;
  await verifiedPublishedRelease(github, tag, assertSha(sourceSha));
  current = await github.currentConfig();
  proposal = publicationTargetUpdate(current.config, tag);
  if (!proposal) return null;
  const branch = `automation/release-target-${proposal.slot}-${proposal.target}`;
  const owner = github.repository.split("/")[0];
  const base = current.repository.default_branch;
  const pulls = await github.list(`${github.prefix}/pulls?state=all&head=${encodeURIComponent(`${owner}:${branch}`)}&base=${encodeURIComponent(base)}`);
  // A closed proposal records a maintainer decision; retries must not recreate it.
  if (pulls.length) return pulls[0].html_url;
  let ref = await github.request(`${github.prefix}/git/ref/heads/${encodeURIComponent(branch)}`, { missing: true });
  if (!ref) {
    ref = await github.request(`${github.prefix}/git/refs`, {
      method: "POST", body: { ref: `refs/heads/${branch}`, sha: assertSha(current.sha) },
    });
  } else {
    const comparison = await github.request(`${github.prefix}/compare/${assertSha(current.sha)}...${assertSha(ref.object.sha)}`);
    assert(Array.isArray(comparison.files) && comparison.files.every((file) => file.filename === CONFIG_PATH), "The proposal branch contains unrelated file changes");
  }
  const file = await github.fileAt(CONFIG_PATH, assertSha(ref.object.sha));
  const existing = parseConfig(JSON.parse(file.content.toString("utf8")));
  if (JSON.stringify(existing) !== JSON.stringify(proposal.config)) {
    assert.deepEqual(existing, current.config, "The proposal branch contains unexpected configuration changes");
    await github.request(`${github.prefix}/contents/${CONFIG_PATH}`, { method: "PUT", body: {
      branch, sha: assertSha(file.sha), message: `Select Redmine ${proposal.target} as the ${proposal.slot} target`,
      content: Buffer.from(`${JSON.stringify(proposal.config, null, 2)}\n`).toString("base64"),
    } });
  }
  const pull = await github.request(`${github.prefix}/pulls`, { method: "POST", body: {
    head: branch, base, title: `Select Redmine ${proposal.target} as the ${proposal.slot} target`,
    body: `Change the ${proposal.slot} target from \`${proposal.previous}\` to \`${proposal.target}\`.\n\n` +
      `Release: [${tag}](https://github.com/${github.repository}/releases/tag/${tag}).\n` +
      `Validated source: \`${sourceSha}\`.\n\nReview the target selection before merging. Publication of this release does not itself adopt the new target.`,
  } });
  assert.equal(typeof pull.html_url, "string", "Created pull request is missing its URL");
  return pull.html_url;
}
