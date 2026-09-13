import assert from "node:assert/strict";
import test from "node:test";

import {
  convertTiboResetSignalToHistoryEvent,
  type FormalTiboResetSignal,
  type TiboNoticeSignal,
} from "../lib/radar/tiboHistory";

function resetSignal(overrides: Partial<FormalTiboResetSignal> = {}): FormalTiboResetSignal {
  return {
    tweet_id: "scope-policy-reset",
    text: "I have reset usage limits.",
    tweet_url: "https://x.com/thsottiaux/status/2100000000000000001",
    tweet_created_at: "2026-09-13T10:00:00.000Z",
    signal_type: "reset_executed",
    confidence: 1,
    verification_status: "auto_unverified",
    classification_source: "gemini",
    ai_classification_status: "success",
    ...overrides,
  };
}

function noticeSignal(overrides: Partial<TiboNoticeSignal> = {}): TiboNoticeSignal {
  return {
    tweet_id: "scope-policy-notice",
    text: "A reset is coming soon.",
    tweet_url: "https://x.com/thsottiaux/status/2100000000000000002",
    tweet_created_at: "2026-09-13T09:00:00.000Z",
    signal_type: "official_notice",
    confidence: 1,
    verification_status: "auto_unverified",
    ...overrides,
  };
}

test("unknown reset applicability leaves scope blank instead of using Codex / ChatGPT Work", () => {
  const event = convertTiboResetSignalToHistoryEvent(resetSignal());

  assert.equal(event.scope, undefined);
  assert.equal(event.details?.scope, undefined);
  assert.notEqual(event.scope, "Codex / ChatGPT Work");
});

test("completed non-regular reset gets a non-empty low-stakes reason fallback", () => {
  const event = convertTiboResetSignalToHistoryEvent(resetSignal());

  assert.equal(event.details?.reasonType, "ご祝儀リセット");
});

test("explicit broad applicability still maps to all paid plans", () => {
  const notice = noticeSignal({
    text: "We will reset usage limits for all paid users tonight.",
  });
  const event = convertTiboResetSignalToHistoryEvent(
    resetSignal({ text: "Reset all propagated." }),
    notice,
    undefined,
    [notice],
  );

  assert.equal(event.scope, "全有料プラン");
  assert.equal(event.details?.scope, "全有料プラン");
});

test("explicit narrow applicability maps to partial users", () => {
  const notice = noticeSignal({
    text: "A reset will be issued only to affected users.",
  });
  const event = convertTiboResetSignalToHistoryEvent(
    resetSignal({ text: "Reset all propagated." }),
    notice,
    undefined,
    [notice],
  );

  assert.equal(event.scope, "一部ユーザー");
  assert.equal(event.details?.scope, "一部ユーザー");
});

test("audience-only greeting does not become scope evidence", () => {
  const notice = noticeSignal({
    text: "Hi Astra users. A reset is coming soon.",
  });
  const event = convertTiboResetSignalToHistoryEvent(
    resetSignal({ text: "Reset all propagated." }),
    notice,
    undefined,
    [notice],
  );

  assert.equal(event.scope, undefined);
  assert.equal(event.details?.scope, undefined);
});
