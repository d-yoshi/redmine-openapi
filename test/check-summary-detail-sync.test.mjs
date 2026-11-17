import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

test("permits response-specific descriptions and only the documented news-summary nullability difference", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "summary-sync-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const check = (name, summary, detail) => {
    for (const file of fs.readdirSync(directory)) fs.unlinkSync(path.join(directory, file));
    fs.writeFileSync(
      path.join(directory, `${name}.summary.yaml`),
      JSON.stringify({ properties: summary })
    );
    fs.writeFileSync(path.join(directory, `${name}.yaml`), JSON.stringify({ properties: detail }));
    const result = spawnSync(
      process.execPath,
      [fileURLToPath(new URL("./check-summary-detail-sync.mjs", import.meta.url)), directory],
      { encoding: "utf8" }
    );
    assert.ifError(result.error);
    assert.equal(result.signal, null, result.stderr);
    return result.status;
  };
  assert.equal(
    check("news", { summary: { type: "string", nullable: true } }, { summary: { type: "string" } }),
    0
  );
  assert.equal(
    check(
      "news",
      { summary: { type: "string", nullable: true } },
      { summary: { type: "string", nullable: true } }
    ),
    1
  );
  assert.equal(
    check("news", { summary: { type: "string", nullable: true } }, { summary: { type: "number" } }),
    1
  );
  assert.equal(
    check(
      "other",
      { summary: { type: "string", nullable: true } },
      { summary: { type: "string" } }
    ),
    1
  );
  assert.equal(
    check(
      "other",
      { name: { type: "string", description: "List label" } },
      { name: { type: "string", description: "Detail label" } }
    ),
    0
  );
  assert.equal(
    check(
      "other",
      { name: { type: "string", description: "List label" } },
      { name: { type: "number", description: "Detail label" } }
    ),
    1
  );
  assert.equal(
    check(
      "other",
      { record: { type: "object", properties: { description: { type: "string" } } } },
      { record: { type: "object", properties: { description: { type: "number" } } } }
    ),
    1
  );
});
