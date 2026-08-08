import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const healthWorkflowPath = resolve(".github/workflows/tibo-monitor-health.yml");
const notifierWorkflowPath = resolve(
  ".github/workflows/notify-workflow-failures.yml",
);

function readWorkflow(path: string): string {
  assert.ok(existsSync(path), `Expected ${path} to exist`);
  return readFileSync(path, "utf8").replace(/\r\n/g, "\n");
}

test("monitor health workflow checks the production endpoint every ten minutes", () => {
  const workflow = readWorkflow(healthWorkflowPath);

  assert.match(workflow, /^name: Tibo monitor health$/m);
  assert.match(workflow, /- cron: "\*\/10 \* \* \* \*"/);
  assert.match(workflow, /^  workflow_dispatch:\s*$/m);
  assert.match(
    workflow,
    /https:\/\/codex\.gussuriworks\.com\/api\/monitor\/health/,
  );
  assert.match(
    workflow,
    /https:\/\/codex\.gussuriworks\.com\/api\/regular-reset\/sync/,
  );
  assert.match(workflow, /regular-reset-sync:/);
  assert.match(workflow, /secrets\.CRON_SECRET/);
  assert.match(workflow, /HTTP_STATUS.*!= "200"/);
  assert.doesNotMatch(workflow, /--show-error/);
});

test("workflow notifier only opens one issue and closes it after recovery", () => {
  const workflow = readWorkflow(notifierWorkflowPath);

  assert.match(workflow, /^  workflow_run:\s*$/m);
  assert.match(workflow, /workflows: \["CI", "Tibo monitor health"\]/);
  assert.match(workflow, /branches: \[main\]/);
  assert.match(
    workflow,
    /^permissions:\n  actions: read\n  contents: read\n  issues: write$/m,
  );
  assert.match(workflow, /actions\/github-script@v7/);
  assert.match(workflow, /conclusion === "success"/);
  assert.match(workflow, /issues\.create\(/);
  assert.match(workflow, /issues\.createComment\(/);
  assert.match(workflow, /issues\.update\(/);
  assert.match(workflow, /state: "open"/);
  assert.match(workflow, /existingIssue/);
  assert.match(
    workflow,
    /^concurrency:\n  group: workflow-alert-\$\{\{ github\.event\.workflow_run\.name \}\}\n  cancel-in-progress: false\n  queue: max$/m,
  );
  assert.match(workflow, /github\.paginate\(\s*github\.rest\.issues\.listForRepo,/);
  assert.match(workflow, /!issue\.pull_request/);
  assert.match(workflow, /issue\.body\?\.includes\(marker\)/);
});
