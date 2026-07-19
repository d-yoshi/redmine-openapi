// Verifies that each *.simple.yaml schema stays in sync with its detail
// counterpart (*.yaml): every field of the simple schema must exist in the
// detail schema with an identical definition. The two files are intentionally
// duplicated because additionalProperties:false cannot be composed with
// allOf in OpenAPI 3.0; the check guards against one-sided edits.
// (required lists may differ deliberately: rendering conditions differ
// between index and show endpoints.)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const schemaDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../src/components/schemas"
);
const load = (f) => yaml.load(fs.readFileSync(f, "utf8"));

let failures = 0;
for (const file of fs.readdirSync(schemaDir).filter((f) => f.endsWith(".simple.yaml"))) {
  const detailFile = file.replace(".simple.yaml", ".yaml");
  const detailPath = path.join(schemaDir, detailFile);
  if (!fs.existsSync(detailPath)) continue;

  const simple = load(path.join(schemaDir, file));
  const detail = load(detailPath);
  for (const [key, def] of Object.entries(simple.properties ?? {})) {
    const detailDef = (detail.properties ?? {})[key];
    if (detailDef === undefined) {
      console.error(`${detailFile}: missing field "${key}" defined in ${file}`);
      failures++;
    } else if (JSON.stringify(def) !== JSON.stringify(detailDef)) {
      console.error(`${detailFile}: field "${key}" differs from ${file}`);
      failures++;
    }
  }
}

if (failures > 0) {
  console.error(`\n${failures} simple/detail mismatch(es) found. Apply the same change to both files.`);
  process.exit(1);
}
console.log("simple/detail schemas are in sync.");
