import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

test("monitor health workflow preserves safe per-timeline alert details", () => {
  const workflow = fs.readFileSync(
    path.join(process.cwd(), ".github/workflows/tibo-monitor-health.yml"),
    "utf8",
  );
  const detailBlockStart = workflow.indexOf('DETAIL="$(jq -r');
  const detailBlockEnd = workflow.indexOf("HEARTBEAT_AGE_SECONDS=", detailBlockStart);
  const details = detailBlockStart >= 0 && detailBlockEnd > detailBlockStart
    ? workflow.slice(detailBlockStart, detailBlockEnd)
    : "";

  assert.match(details, /timeline_scan_empty/);
  assert.match(details, /timeline_scan_stale/);
});
