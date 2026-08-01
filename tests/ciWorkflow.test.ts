import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const workflowPath = resolve(".github/workflows/ci.yml");
const packageJsonPath = resolve("package.json");

test("CI workflow enforces the ordered quality gate contract", () => {
  assert.ok(existsSync(workflowPath), `Expected ${workflowPath} to exist`);

  const workflow = readFileSync(workflowPath, "utf8").replace(/\r\n/g, "\n");
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
    packageManager?: string;
  };
  const packageManagerPin = packageJson.packageManager;

  assert.equal(
    packageManagerPin,
    "pnpm@11.18.0",
    "package.json must keep the pinned pnpm version",
  );

  assert.match(workflow, /^on:\n  push:\n  pull_request:\n/m);
  assert.match(workflow, /^permissions:\n  contents: read\n/m);
  assert.match(workflow, /^          node-version: 22\.13\.0\s*$/m);

  assert.ok(
    workflow.includes(
      [
        "      - name: Enable pinned pnpm",
        "        run: |",
        "          corepack enable",
        `          corepack prepare ${packageManagerPin} --activate`,
      ].join("\n"),
    ),
    "CI must enable Corepack and activate the package.json pnpm pin",
  );

  const commands = [
    "corepack pnpm install --frozen-lockfile",
    "corepack pnpm lint",
    "corepack pnpm typecheck",
    "corepack pnpm test",
    "corepack pnpm build",
    "corepack pnpm audit --prod --audit-level high",
  ];

  const runCommands = workflow.split("\n").flatMap((line) => {
    const match = line.match(/^      - run: ([^\s].*?)\s*$/);
    return match === null ? [] : [match[1]];
  });

  assert.deepStrictEqual(runCommands, commands);
});
