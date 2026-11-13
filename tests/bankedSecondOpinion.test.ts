import assert from "node:assert/strict";
import test from "node:test";

import { classifyWithGemini, resolveGeminiClassificationModel } from "../lib/radar/geminiClassification";
import {
  notifyPendingBankedAssociation,
  notifyPendingForcedResetAssociation,
  runBankedSecondOpinionReview,
  runForcedResetSecondOpinionReview,
  selectBankedSecondOpinionCandidates,
  selectForcedResetSecondOpinionCandidates,
} from "../lib/radar/bankedSecondOpinion";
import { runBankedGrantAssociationReconciliation } from "../lib/codexUsageBankedAssociationReconciliation";
import type { ActiveTiboSignal } from "../lib/radar/types";

function makeSignal(overrides: Partial<ActiveTiboSignal> = {}): ActiveTiboSignal {
  return {
    tweet_id: "2120999993079451919",
    signal_type: "irrelevant",
    text: "We shipped some good updates to dots today and the banked reset has been activated and should land in everyones accounts sometime soon!",
    tweet_url: "https://x.com/thsottiaux/status/2120999993079451919",
    tweet_created_at: "2026-11-12T21:59:39.000Z",
    expires_at: "2026-11-13T08:00:00.000Z",
    verification_status: "auto_unverified",
    confidence: 0.95,
    classification_source: "gemini",
    is_reply: false,
    is_quote: false,
    ...overrides,
  };
}

test("resolveGeminiClassificationModel escalates flash-lite for reset keywords and second-opinion context", () => {
  assert.equal(
    resolveGeminiClassificationModel({ text: "The banked reset has been activated." }, undefined, "gemini-3.5-flash-lite"),
    "gemini-3.5-flash",
  );
  assert.equal(
    resolveGeminiClassificationModel({ text: "Had a great lunch today." }, undefined, "gemini-3.5-flash-lite"),
    "gemini-3.5-flash-lite",
  );
  assert.equal(
    resolveGeminiClassificationModel(
      { text: "Surprise update!", secondOpinionMonitorContext: "Usage Monitor observed a grant" },
      undefined,
      "gemini-3.5-flash-lite",
    ),
    "gemini-3.5-pro",
  );
  assert.equal(
    resolveGeminiClassificationModel({ text: "The banked reset has been activated." }, "custom-model", "gemini-3.5-flash-lite"),
    "custom-model",
  );
});

test("selectBankedSecondOpinionCandidates prioritizes banked/reset keywords and excludes manual/replies", () => {
  const observedAt = "2026-11-12T22:13:22.616Z";
  const candidates = selectBankedSecondOpinionCandidates(
    [
      makeSignal({ tweet_id: "1", text: "Had coffee.", tweet_created_at: "2026-11-12T22:10:00.000Z" }),
      makeSignal({ tweet_id: "2", text: "Banked reset activated!", tweet_created_at: "2026-11-12T21:59:39.000Z" }),
      makeSignal({ tweet_id: "3", classification_source: "manual", tweet_created_at: "2026-11-12T22:05:00.000Z" }),
      makeSignal({ tweet_id: "4", is_reply: true, tweet_created_at: "2026-11-12T22:05:00.000Z" }),
      makeSignal({ tweet_id: "5", tweet_created_at: "2026-11-10T20:00:00.000Z" }),
    ],
    observedAt,
  );
  assert.deepEqual(candidates.map((c) => c.tweet_id), ["2", "1"]);
});

test("runBankedSecondOpinionReview promotes misclassified BANKED notice and triggers reconciliation acceptance", async () => {
  const observation = {
    observation_key: "local-codex-app-server:codex:2026-11-12T22:13:22.616Z",
    reset_event_key: "banked-reset-local-codex-app-server-observation-20261112T221322616Z",
    source_key: "local-codex-app-server" as const,
    limit_id: "codex" as const,
    plan_type: "plus",
    previous_observed_at: "2026-11-12T22:09:21.067Z",
    observed_at: "2026-11-12T22:13:22.616Z",
    received_at: "2026-11-12T22:13:23.426Z",
    previous_available_count: 2,
    current_available_count: 3,
    observation_window_start_at: "2026-11-12T22:09:21.067Z",
    observation_window_end_at: "2026-11-12T22:13:22.616Z",
    execution_time_precision: "approximate" as const,
    legacy_identity_status: "resolved" as const,
    legacy_reset_event_key: null,
    current_revision: 1,
    current_decision_source: "automatic" as const,
    current_notice_tweet_id: null,
    current_logical_post_id: null,
    current_eligible_candidate_ids: [],
  };

  const misclassified = makeSignal({ tweet_id: "2120999993079999999" });
  let persistedStatus: string | null = null;
  let notified = false;

  const result = await runBankedGrantAssociationReconciliation(
    {
      listDue: async () => ({ observations: [observation], hasMore: false }),
      loadSignals: async () => ({ signals: [misclassified] }),
      runSecondOpinion: async (obs, signals) =>
        runBankedSecondOpinionReview({
          observation: obs,
          signals,
          classify: async () => ({
            signalType: "official_notice",
            confidence: 0.96,
            temporalDirection: "future",
            evidenceQuote: "the banked reset has been activated",
            reasonJa: "Second opinion confirmed BANKED activation.",
            resetTypeJa: null,
            contextualResetAssessment: "not_applicable",
            contextualResetTweetId: null,
            noticeToExecution: null,
            teaserStrength: null,
            teaserStrengthConfidence: null,
            teaserStrengthEvidenceQuote: null,
            teaserStrengthReasonJa: null,
            futureSignal: null,
            temporalExpression: null,
            temporalKind: null,
            temporalPrecision: null,
            weekday: null,
            relativeDayOffset: null,
            relativeAmount: null,
            relativeUnit: null,
            explicitDateParts: null,
            explicitTimeParts: null,
            daypart: null,
            rangeKind: null,
            explicitTimezone: null,
            temporalConfidence: null,
            codexOperationalStatus: "none",
            codexOperationalConfidence: 0.95,
            codexOperationalEvidenceQuote: null,
            codexOperationalReasonJa: null,
            model: "gemini-3.5-flash",
            status: "success",
            classifiedAt: "2026-11-12T22:15:00.000Z",
          }),
        }),
      persist: async (_obs, decision) => {
        persistedStatus = decision.status;
        return { status: decision.status === "accepted" ? "accepted" : "pending", publicationChanged: decision.status === "accepted" };
      },
      invalidate: async () => {},
      notifyPending: async () => {
        notified = true;
        return true;
      },
    },
    {
      now: new Date("2026-11-12T22:15:00.000Z"),
    },
  );

  assert.equal(persistedStatus, "accepted");
  assert.equal(result.accepted, 1);
  assert.equal(result.pending, 0);
  assert.equal(result.invalidated, true);
  assert.equal(notified, false);
});

test("notifyPendingBankedAssociation posts webhook when configured", async () => {
  const prev = process.env.BANKED_ASSOCIATION_ALERT_WEBHOOK_URL;
  process.env.BANKED_ASSOCIATION_ALERT_WEBHOOK_URL = "https://example.test/webhook";
  let postedUrl = "";
  let postedBody = "";
  try {
    const sent = await notifyPendingBankedAssociation({
      observation: {
        observation_key: "obs-1",
        reset_event_key: "banked-reset-test",
        observed_at: "2026-11-12T22:13:22.616Z",
        previous_available_count: 2,
        current_available_count: 3,
      },
      decision: {
        observationKey: "obs-1",
        resetEventKey: "banked-reset-test",
        status: "pending",
        reason: "no_eligible_claim",
        matcherVersion: "banked-post-association-v1",
        noticeTweetId: null,
        logicalPostId: null,
        sourceTweetIds: [],
        eligibleCandidateIds: [],
        excludedCandidates: [],
      },
      candidateSignals: [makeSignal()],
      sendWebhook: async (url, body) => {
        postedUrl = url;
        postedBody = body.content;
      },
    });
    assert.equal(sent, true);
    assert.equal(postedUrl, "https://example.test/webhook");
    assert.match(postedBody, /no_eligible_claim/);
    assert.match(postedBody, /2120999993079451919/);
  } finally {
    if (prev === undefined) delete process.env.BANKED_ASSOCIATION_ALERT_WEBHOOK_URL;
    else process.env.BANKED_ASSOCIATION_ALERT_WEBHOOK_URL = prev;
  }
});

test("classifyWithGemini falls back to OpenAI-compatible API when Gemini fails", async () => {
  const result = await classifyWithGemini(
    {
      text: "The banked reset has been activated and should land in everyones accounts sometime soon!",
      tweetCreatedAt: "2026-11-12T21:59:39.000Z",
    },
    {
      mode: "primary",
      apiKey: "invalid-test-key",
      model: "gemini-3.5-flash",
      openAiFallbackApiKey: "test-openai-key",
      openAiFallbackModel: "gpt-4o-mini",
      openAiFetch: async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    signalType: "official_notice",
                    confidence: 0.96,
                    temporalDirection: "future",
                    evidenceQuote: "the banked reset has been activated",
                    reasonJa: "OpenAI fallback detected BANKED activation notice.",
                    noticeTimingStatus: "unknown",
                  }),
                },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    },
  );

  assert.equal(result.status, "success");
  assert.equal(result.model, "gpt-4o-mini");
  assert.equal(result.signalType, "official_notice");
  assert.equal(result.confidence, 0.96);
});

test("selectForcedResetSecondOpinionCandidates prioritizes forced-reset keywords within 48h", () => {
  const observedAt = "2026-11-13T12:00:00.000Z";
  const unrelated = makeSignal({
    tweet_id: "1",
    text: "Coffee tastes good today.",
    tweet_created_at: "2026-11-13T11:30:00.000Z",
  });
  const resetHint = makeSignal({
    tweet_id: "2",
    text: "Weekly quota reset rolled out to Codex users right now.",
    tweet_created_at: "2026-11-13T11:00:00.000Z",
  });

  const candidates = selectForcedResetSecondOpinionCandidates([unrelated, resetHint], observedAt);
  assert.deepEqual(candidates.map((c) => c.tweet_id), ["2", "1"]);
});

test("runForcedResetSecondOpinionReview promotes reset_executed and enforces safety gate", async () => {
  let receivedContext = "";
  const validReset = makeSignal({
    tweet_id: "3001",
    signal_type: "irrelevant",
    text: "Weekly limits just reset for everyone on Codex.",
    tweet_created_at: "2026-11-13T11:45:00.000Z",
  });
  const unsafePersonalReset = makeSignal({
    tweet_id: "3002",
    signal_type: "irrelevant",
    text: "Just reset my laptop and local cache before dinner.",
    tweet_created_at: "2026-11-13T11:50:00.000Z",
  });

  const result = await runForcedResetSecondOpinionReview({
    observation: {
      observedAt: "2026-11-13T12:00:00.000Z",
      previousUsedPercent: 85,
      currentUsedPercent: 0,
      cycleHint: "unexpected",
      confidence: "strong",
    },
    signals: [validReset, unsafePersonalReset],
    classify: async (input) => {
      receivedContext = input.secondOpinionMonitorContext ?? "";
      return {
        signalType: "reset_executed",
        confidence: 0.96,
        temporalDirection: "completed_now",
        evidenceQuote: null,
        reasonJa: "Second opinion confirmed reset execution.",
        resetTypeJa: null,
        noticeTimingStatus: null,
        noticeToExecution: null,
        model: "gemini-3.5-pro",
        status: "success",
        classifiedAt: "2026-11-13T12:00:05.000Z",
      };
    },
  });

  assert.match(receivedContext, /unexpected global Codex quota recovery/i);
  assert.deepEqual(result.promotedResetSignals.map((s) => s.tweet_id), ["3001"]);
  assert.equal(result.signals.find((s) => s.tweet_id === "3001")?.signal_type, "reset_executed");
  assert.equal(result.signals.find((s) => s.tweet_id === "3002")?.signal_type, "irrelevant");
});

test("notifyPendingForcedResetAssociation sends alert webhook when pending url is configured", async () => {
  const prev = process.env.RESET_PENDING_ALERT_WEBHOOK_URL;
  process.env.RESET_PENDING_ALERT_WEBHOOK_URL = "https://example.test/forced-pending";
  let postedUrl = "";
  let postedBody = "";
  try {
    const sent = await notifyPendingForcedResetAssociation({
      observation: {
        observedAt: "2026-11-13T12:00:00.000Z",
        previousUsedPercent: 90,
        currentUsedPercent: 0,
        cycleHint: "unexpected",
        confidence: "strong",
      },
      candidateSignals: [
        makeSignal({
          tweet_id: "3099",
          text: "Weekly quota button incoming?",
          tweet_created_at: "2026-11-13T11:30:00.000Z",
        }),
      ],
      sendWebhook: async (url, body) => {
        postedUrl = url;
        postedBody = body.content;
      },
    });
    assert.equal(sent, true);
    assert.equal(postedUrl, "https://example.test/forced-pending");
    assert.match(postedBody, /usage-reset-pending/);
    assert.match(postedBody, /3099/);
  } finally {
    if (prev === undefined) delete process.env.RESET_PENDING_ALERT_WEBHOOK_URL;
    else process.env.RESET_PENDING_ALERT_WEBHOOK_URL = prev;
  }
});
