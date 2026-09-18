import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { formatProbabilityModelRegistryMarkdown } from "../data/probabilityModelRegistry";

const outputPath = resolve("docs/probability/model-registry.md");
const expected = formatProbabilityModelRegistryMarkdown();
const checkOnly = process.argv.slice(2).includes("--check");

if (checkOnly) {
  if (!existsSync(outputPath) || readFileSync(outputPath, "utf8") !== expected) {
    console.error("Probability model registry documentation is stale: " + outputPath);
    process.exitCode = 1;
  } else {
    console.log("Probability model registry documentation is up to date.");
  }
} else {
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, expected, "utf8");
  console.log("Generated " + outputPath);
}
