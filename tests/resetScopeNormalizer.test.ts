import assert from "node:assert/strict";
import test from "node:test";

import { LOCAL_RESET_HISTORY } from "../data/resetHistory";
import { isBroadResetScope } from "../lib/radar/resetEligibility";
import { toRegularResetHistoryEvent } from "../lib/radar/regularResetSchedule";
import {
  normalizeRegularResetScope,
  normalizeResetScope,
} from "../lib/radar/resetScope";

test("normalizes broad reset scope to all paid plans", () => {
  assert.equal(normalizeResetScope("全有料プラン"), "全有料プラン");
  assert.equal(normalizeResetScope("全ユーザー"), "全有料プラン");
  assert.equal(normalizeResetScope("All paid plans"), "全有料プラン");
});

test("normalizes legacy narrow reset scope to partial users", () => {
  assert.equal(normalizeResetScope("一部ユーザー"), "一部ユーザー");
  assert.equal(normalizeResetScope("任意リセット未使用アカウント"), "一部ユーザー");
  assert.equal(normalizeResetScope("任意リセットを使っていないアカウント"), "一部ユーザー");
  assert.equal(normalizeResetScope("不具合対象ユーザー（約50万人）"), "一部ユーザー");
  assert.equal(normalizeResetScope("限定ユーザー"), "一部ユーザー");
  assert.equal(normalizeResetScope("Some users"), "一部ユーザー");
});

test("drops ambiguous or product-name-only scope labels", () => {
  assert.equal(normalizeResetScope("Codex / ChatGPT Work"), undefined);
  assert.equal(normalizeResetScope("Codex"), undefined);
  assert.equal(normalizeResetScope("ChatGPT Work"), undefined);
  assert.equal(normalizeResetScope("Astra users"), undefined);
  assert.equal(normalizeResetScope(""), undefined);
  assert.equal(normalizeResetScope(undefined), undefined);
});

test("legacy product labels never act as broad random-reset scope", () => {
  const item = {
    recordKind: "confirmed_global" as const,
    scope: "Codex / ChatGPT Work",
    details: {
      cycleType: "ランダムリセット",
      resetMethod: "強制リセット",
      noticeToExecution: "",
      scope: "Codex / ChatGPT Work",
    },
  };

  assert.equal(isBroadResetScope(item), false);
  assert.equal(isBroadResetScope({ ...item, scope: "全ユーザー" }), true);
  assert.equal(isBroadResetScope({ ...item, scope: "全有料プラン" }), true);
});

test("an empty primary scope does not hide a product-only details scope", () => {
  assert.equal(
    isBroadResetScope({
      recordKind: "confirmed_global",
      scope: "",
      details: {
        cycleType: "ランダムリセット",
        resetMethod: "強制リセット",
        noticeToExecution: "",
        scope: "Codex / ChatGPT Work",
      },
    }),
    false,
  );
});

test("regular scope preserves the concrete unused-account target separately from random scope", () => {
  assert.equal(
    normalizeRegularResetScope("任意リセット未使用アカウント"),
    "任意リセット未使用アカウント",
  );
  assert.equal(
    normalizeRegularResetScope("任意リセットを使っていないアカウント"),
    "任意リセット未使用アカウント",
  );
  assert.equal(normalizeRegularResetScope("全有料プラン"), "全有料プラン");
  assert.equal(normalizeRegularResetScope("一部ユーザー"), undefined);
  assert.equal(normalizeRegularResetScope("Codex / ChatGPT Work"), undefined);
});

test("regular history projection preserves concrete and broad scopes", () => {
  const event = toRegularResetHistoryEvent({
    schedule_key: "legacy-scope",
    window_start_at: "2026-08-08T03:30:00.000Z",
    window_end_at: "2026-08-08T03:45:00.000Z",
    representative_at: "2026-08-08T03:32:00.000Z",
    scheduled_at: "2026-08-08T03:32:00.000Z",
    completed_at: "2026-08-08T03:32:00.000Z",
    cycle_type: "定期リセット",
    reset_method: "強制リセット",
    scope: "任意リセット未使用アカウント",
    record_kind: "regular_completed",
    status: "completed",
  });

  assert.equal(event.scope, "任意リセット未使用アカウント");
  assert.equal(event.details?.scope, "任意リセット未使用アカウント");

  const broadEvent = toRegularResetHistoryEvent({
    schedule_key: "broad-scope",
    window_start_at: "2026-08-08T03:30:00.000Z",
    window_end_at: "2026-08-08T03:45:00.000Z",
    representative_at: "2026-08-08T03:32:00.000Z",
    scheduled_at: "2026-08-08T03:32:00.000Z",
    completed_at: "2026-08-08T03:32:00.000Z",
    cycle_type: "定期リセット",
    reset_method: "強制リセット",
    scope: "全有料プラン",
    record_kind: "regular_completed",
    status: "completed",
  });
  assert.equal(broadEvent.scope, "全有料プラン");
  assert.equal(broadEvent.details?.scope, "全有料プラン");
});

test("static canonical history preserves separate regular and random scope taxonomies", () => {
  const regularScope = LOCAL_RESET_HISTORY.find(
    (item) => item.id === "local-codex-regular-reset-2026-08-08",
  );
  const randomScope = LOCAL_RESET_HISTORY.find(
    (item) => item.details?.cycleType === "ランダムリセット" && item.recordKind === "confirmed_global",
  );
  const bankedScope = LOCAL_RESET_HISTORY.find(
    (item) => item.id === "personal-reset-credit-2026-06-11",
  );

  assert.equal(regularScope?.scope, "任意リセット未使用アカウント");
  assert.equal(regularScope?.details?.scope, "任意リセット未使用アカウント");
  assert.equal(randomScope?.scope, "全有料プラン");
  assert.equal(randomScope?.details?.scope, "全有料プラン");
  assert.equal(bankedScope?.recordKind, "banked_distribution");
  assert.equal(bankedScope?.details?.scope, "全有料プラン");
});
