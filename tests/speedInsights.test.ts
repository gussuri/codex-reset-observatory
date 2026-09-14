import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const ROOT_LAYOUTS = [
  "app/(ja)/layout.tsx",
  "app/(en)/layout.tsx",
  "app/(zh)/layout.tsx",
];

test("Speed Insights is mounted once in each mutually exclusive locale root layout", () => {
  assert.equal(existsSync("app/layout.tsx"), false);

  for (const layoutPath of ROOT_LAYOUTS) {
    const source = readFileSync(layoutPath, "utf8");

    assert.equal((source.match(/@vercel\/speed-insights\/next/g) ?? []).length, 1, layoutPath);
    assert.equal((source.match(/<SpeedInsights \/>/g) ?? []).length, 1, layoutPath);
    assert.equal((source.match(/<Analytics \/>/g) ?? []).length, 1, layoutPath);
  }
});
