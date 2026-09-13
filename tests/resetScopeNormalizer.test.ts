import assert from "node:assert/strict";
import test from "node:test";

import { normalizeResetScope } from "../lib/radar/resetScope";

test("normalizes broad reset scope to all paid plans", () => {
  assert.equal(normalizeResetScope("全有料プラン"), "全有料プラン");
  assert.equal(normalizeResetScope("全ユーザー"), "全有料プラン");
  assert.equal(normalizeResetScope("All paid plans"), "全有料プラン");
});

test("normalizes legacy narrow reset scope to partial users", () => {
  assert.equal(normalizeResetScope("一部ユーザー"), "一部ユーザー");
  assert.equal(normalizeResetScope("任意リセット未使用アカウント"), "一部ユーザー");
  assert.equal(normalizeResetScope("不具合対象ユーザー（約50万人）"), "一部ユーザー");
  assert.equal(normalizeResetScope("Some users"), "一部ユーザー");
});

test("drops ambiguous or product-name-only scope labels", () => {
  assert.equal(normalizeResetScope("Codex / ChatGPT Work"), undefined);
  assert.equal(normalizeResetScope("Astra users"), undefined);
  assert.equal(normalizeResetScope(""), undefined);
  assert.equal(normalizeResetScope(undefined), undefined);
});