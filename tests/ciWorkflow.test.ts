import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const workflowPath = resolve(".github/workflows/ci.yml");

test("CI workflow enforces the ordered quality gate contract", () => {
  assert.ok(existsSync(workflowPath), `Expected ${workflowPath} to exist`);

  const workflow = readFileSync(workflowPath, "utf8");

  assert.match(
    workflow,
    /^on:\r?\n  push:\r?\n  pull_request:\r?\n/m,
  );
  assert.match(workflow, /^permissions:\r?\n  contents: read\r?\n/m);
  assert.match(workflow, /^\s+node-version: 20\s*$/m);

  const commands = [
    "corepack pnpm install --frozen-lockfile",
    "corepack pnpm lint",
    "corepack pnpm typecheck",
    "corepack pnpm test",
    "corepack pnpm build",
    "corepack pnpm audit --prod --audit-level high",
  ];

  let previousCommandIndex = -1;
  for (const command of commands) {
    const commandIndex = workflow.indexOf(command);
    assert.notEqual(commandIndex, -1, `Missing CI command: ${command}`);
    assert.ok(
      commandIndex > previousCommandIndex,
      `CI command is out of order: ${command}`,
    );
    previousCommandIndex = commandIndex;
  }
});
