import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { findNoticeBackedRecoveryEvents, combineResetHistory } from "@/lib/radar/tiboHistory";
import { toPublicRadarSnapshot } from "@/lib/radar/publicDto";
import { UI_TRANSLATIONS } from "@/lib/radar/i18n";
import type { RadarData } from "@/lib/radar/types";

describe("Notice-backed Usage Recovery Confirmation Policy (A - J)", () => {
  const sampleNotice = {
    tweet_id: "2087706104814023111",
    text: "Old news actually from a bunch of days ago, but crossed that 15M. Enjoy a nice reset everyone. Landing in the next hour or so, go /fast.",
    tweet_url: "https://x.com/thsottiaux/status/2087706104814023111",
    tweet_created_at: "2026-08-13T01:01:37Z",
    signal_type: "official_notice" as const,
    confidence: 0.95,
    verification_status: "auto_unverified" as const,
    expected_start_at: "2026-08-13T02:01:37Z",
  };

  const sampleRecovery = {
    id: "68e38669-199b-4e56-a5db-83ee22f1e4b9",
    observedAt: "2026-08-13T03:34:43.341Z",
    previousObservedAt: "2026-08-13T03:32:44.526Z",
    previousUsedPercent: 100,
    currentUsedPercent: 0,
    previousResetsAt: 1787012725,
    currentResetsAt: 1787196882,
    cycleHint: "unexpected",
    confidence: "strong",
    status: "observed",
  };

  const sampleEstimate = {
    resetEventKey: "tibo-reset-2087706104814023111",
    displayExecutionAt: "2026-08-13T03:34:43.341Z",
    executionTimeSource: "usage_observation" as const,
    executionTimeConfidence: "high" as const,
    executionTimePrecision: "approximate" as const,
    executionWindowStartAt: "2026-08-13T03:32:44.526Z",
    executionWindowEndAt: "2026-08-13T03:34:43.341Z",
    recoveryObservationId: "68e38669-199b-4e56-a5db-83ee22f1e4b9",
    officialNoticeTweetId: "2087706104814023111",
    estimatorVersion: "usage-execution-v1",
    tiboSourceTweetIds: ["2087706104814023111"],
  };

  it("A. official_noticeなし + strong recovery -> global reset確定しない", () => {
    const events = findNoticeBackedRecoveryEvents([], [sampleRecovery]);
    assert.equal(events.length, 0);
  });

  it("B. official_noticeあり + medium recovery -> global reset確定しない", () => {
    const mediumRecovery = { ...sampleRecovery, confidence: "medium" };
    const events = findNoticeBackedRecoveryEvents([sampleNotice], [mediumRecovery]);
    assert.equal(events.length, 0);
  });

  it("C. official_noticeあり + strong regular recovery -> global reset確定しない", () => {
    const regularRecovery = { ...sampleRecovery, cycleHint: "regular" };
    const events = findNoticeBackedRecoveryEvents([sampleNotice], [regularRecovery]);
    assert.equal(events.length, 0);
  });

  it("D. rejected official_notice + strong recovery -> global reset確定しない", () => {
    const rejectedNotice = { ...sampleNotice, verification_status: "rejected" as const };
    const events = findNoticeBackedRecoveryEvents([rejectedNotice], [sampleRecovery]);
    assert.equal(events.length, 0);
  });

  it("E. official_noticeあり + strong unexpected recovery -> confirmed global reset", () => {
    const events = findNoticeBackedRecoveryEvents([sampleNotice], [sampleRecovery]);
    assert.equal(events.length, 1);
    assert.equal(events[0].recordKind, "confirmed_global");
    assert.equal(events[0].closed_at, sampleRecovery.observedAt);
  });

  it("F. 今回の実データ fixture (notice 2087706104814023111 & recovery 68e38669)", () => {
    const events = findNoticeBackedRecoveryEvents([sampleNotice], [sampleRecovery]);
    assert.equal(events.length, 1);
    const event = events[0];
    assert.equal(event.title, "全体リセット完了");
    assert.equal(event.completed_at, "2026-08-13T03:34:43.341Z");
    assert.ok(event.sourceTweetIds?.includes("2087706104814023111"));
  });

  it("G. 確定後の ViewModel & PublicDto 状態", () => {
    const data: RadarData = {
      active_tibo_signals: [sampleNotice as any],
      codex_usage_recovery: sampleRecovery as any,
      codex_recovery_observations: [sampleRecovery as any],
      reset_execution_estimates: [sampleEstimate as any],
    } as any;
    const now = new Date("2026-08-13T03:40:00Z");
    const snapshot = toPublicRadarSnapshot(data, "ja", { calculationNow: now });
    const publicVm = snapshot.viewModel;

    // Active official notice & provisional recovery ended
    assert.equal(snapshot.recoveryObservation, null);
    // Recent history contains item matching recovery reset time
    assert.ok(
      publicVm.recentHistory.some(
        (h) => h.resetAt === "2026-08-13T03:34:43.341Z" || h.key?.includes("notice-recovery") || h.key?.includes("68e38669"),
      ),
    );
    // Probabilities returned as numeric
    assert.equal(typeof publicVm.probability24h, "number");
    assert.equal(typeof publicVm.probability48h, "number");
  });

  it("H. 後から reset_executed 投稿が来ても同一 event へ merge され重複しない", () => {
    const resetExecuted = {
      tweet_id: "2087709900000000000",
      text: "Reset complete!",
      tweet_url: "https://x.com/thsottiaux/status/2087709900000000000",
      tweet_created_at: "2026-08-13T03:50:00Z",
      signal_type: "reset_executed" as const,
      confidence: 0.95,
      verification_status: "auto_unverified" as const,
      related_notice: sampleNotice,
    };

    const combined = combineResetHistory(
      [],
      [resetExecuted as any],
      [],
      [],
      [sampleNotice],
      [sampleRecovery],
    );

    const confirmedEvents = combined.filter((e) => e.recordKind === "confirmed_global");
    assert.equal(confirmedEvents.length, 1);
    assert.equal(confirmedEvents[0].completed_at, "2026-08-13T03:34:43.341Z");
  });

  it("I. 同じ webhook / recovery を再送しても idempotent で重複なし", () => {
    const combined = combineResetHistory(
      [],
      [],
      [],
      [],
      [sampleNotice],
      [sampleRecovery, sampleRecovery],
    );

    const confirmedEvents = combined.filter((e) => e.recordKind === "confirmed_global");
    assert.equal(confirmedEvents.length, 1);
  });

  it("J. JA / EN / ZH completion UI 文言が存在すること", () => {
    assert.equal(UI_TRANSLATIONS.noticeBackedRecoveryTitle.ja, "全体リセット完了");
    assert.equal(UI_TRANSLATIONS.noticeBackedRecoveryTitle.en, "Global reset completed");
    assert.equal(UI_TRANSLATIONS.noticeBackedRecoveryTitle.zh, "全局重置已完成");

    assert.ok(UI_TRANSLATIONS.noticeBackedRecoveryBody.ja.includes("監視中のCodexアカウントで利用枠の回復を確認しました"));
    assert.ok(UI_TRANSLATIONS.noticeBackedRecoveryBody.en.includes("A quota recovery was observed on the monitored Codex account"));
    assert.ok(UI_TRANSLATIONS.noticeBackedRecoveryBody.zh.includes("监控中的 Codex 账户已观测到额度恢复"));
  });
});
