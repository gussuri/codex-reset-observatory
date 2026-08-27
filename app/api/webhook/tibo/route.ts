import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { createClient } from "@supabase/supabase-js";
import { classifyTiboTweet } from "@/lib/radar/classification";
import { classifyWithGemini } from "@/lib/radar/geminiClassification";
import {
  buildTiboClassificationResponse,
  normalizeTiboClassificationMode,
  selectTiboClassification,
  shouldRunGeminiClassification,
} from "@/lib/radar/tiboClassificationMode";
import {
  convertTiboResetSignalToHistoryEvent,
  isFormalTiboResetSignal,
  type FormalTiboResetSignal,
} from "@/lib/radar/tiboHistory";
import {
  confirmNearestCodexRecoveryObservation,
  findNearestCodexRecoveryObservation,
  findFormalTiboResetCluster,
  readCodexUsageMonitorState,
  upsertResetExecutionEstimate,
} from "@/lib/codexUsageRecoveryStore";
import { USAGE_TIBO_MATCH_WINDOW_MS } from "@/lib/codexUsageRecovery";
import { getUsageMonitorCoverageAtEvent } from "@/lib/codexUsageMonitorCoverage";
import {
  buildFormalAdoptionResult,
  hasExistingFormalResetCluster,
  isNewFormalAdoption,
  shouldDeferFormalTiboReset,
} from "@/lib/radar/formalAdoption";
import { preserveTiboWebhookState } from "@/lib/radar/tiboWebhookState";
import type { TiboSecondarySignal } from "@/lib/radar/tiboSecondarySignal";
import { parseTiboReplyMetadata } from "@/lib/radar/tiboReplyMetadata";
import { getTiboContextSafetyDecision } from "@/lib/radar/tiboContextSafety";
import { translateWithGemini } from "@/lib/radar/geminiTranslation";
import {
  ensureResetDisplayNameForEvent,
} from "@/lib/radar/resetDisplayNameStore";
import { RANDOM_RESET_NAME_MODEL } from "@/lib/radar/randomResetNaming";
import { isBearerAuthorizationValid } from "@/lib/security/bearerAuth";
import {
  getTemporalNoticeExpiry,
  parseTiboTemporalSemantics,
  resolveTiboTemporalSchedule,
  TIBO_SOURCE_TIME_ZONE,
} from "@/lib/radar/tiboTemporal";

function isMissingTiboOptionalColumnError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const value = error as { code?: unknown; message?: unknown; details?: unknown };
  const code = typeof value.code === "string" ? value.code : "";
  const message = [value.message, value.details]
    .filter((item): item is string => typeof item === "string")
    .join(" ");

  return (
    /(secondary_signal|teaser_strength|translated_text_(ja|zh)|ai_teaser_strength(?:_confidence|_evidence_quote|_reason_ja)?|ai_temporal_|temporal_(expression|kind|precision|timezone|confidence|resolution_source)|expected_(start|end)_at|temporal_resolution_|quote_(context_text|tweet_url|author_handle))/i.test(message) &&
    (code === "PGRST204" ||
      code === "42703" ||
      /column|schema cache|does not exist/i.test(message))
  );
}

function normalizeStoredTranslation(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\r\n?/g, "\n").trim();
  return normalized && normalized.length <= 6000 ? normalized : null;
}

function buildSecondarySignal(
  aiResult: Awaited<ReturnType<typeof classifyWithGemini>> | null,
  sourceText: string,
  createdAt: string,
  primarySignalType: string | null | undefined,
): TiboSecondarySignal | null {
  const futureSignal = aiResult?.futureSignal;
  if (
    primarySignalType !== "reset_executed" ||
    !futureSignal ||
    (futureSignal.signalType !== "official_notice" &&
      futureSignal.signalType !== "teaser" &&
      futureSignal.signalType !== "none")
  ) {
    return null;
  }

  const temporalSemantics = futureSignal.signalType === "official_notice"
    ? parseTiboTemporalSemantics(futureSignal, sourceText)
    : null;
  const temporalResolution = futureSignal.signalType === "official_notice"
    ? resolveTiboTemporalSchedule(temporalSemantics, createdAt, TIBO_SOURCE_TIME_ZONE)
    : null;
  const fallbackExpiresAt = new Date(new Date(createdAt).getTime() + 24 * 60 * 60 * 1000).toISOString();
  const expiresAt = temporalResolution?.status === "resolved"
    ? new Date(
        getTemporalNoticeExpiry(temporalResolution, createdAt) ?? fallbackExpiresAt,
      ).toISOString()
    : fallbackExpiresAt;

  return {
    signalType: futureSignal.signalType,
    teaserStrength: futureSignal.signalType === "teaser"
      ? futureSignal.teaserStrength ?? null
      : null,
    confidence: futureSignal.confidence,
    evidenceQuote: futureSignal.evidenceQuote,
    reasonJa: futureSignal.reasonJa,
    expiresAt,
    temporal: temporalResolution
      ? {
          status: temporalResolution.status,
          version: temporalResolution.version,
          temporalExpression: temporalResolution.temporalExpression,
          temporalKind: temporalResolution.temporalKind,
          temporalPrecision: temporalResolution.temporalPrecision,
          timezone: temporalResolution.timezone,
          confidence: temporalResolution.confidence,
          expectedStartAt: temporalResolution.expectedStartAt,
          expectedEndAt: temporalResolution.expectedEndAt,
          resolutionSource: temporalResolution.resolutionSource,
        }
      : null,
  };
}

function getSupabaseServiceClient() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error("Missing Supabase Service Role configuration.");
  }
  return createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false },
  });
}

export async function POST(req: NextRequest) {
  try {
    // 1. Fail closed if TIBO_WEBHOOK_SECRET is not configured
    const expectedSecret = process.env.TIBO_WEBHOOK_SECRET;
    if (!expectedSecret) {
      return NextResponse.json(
        { error: "Server Configuration Error: TIBO_WEBHOOK_SECRET is not configured." },
        { status: 503 }
      );
    }

    if (!isBearerAuthorizationValid(req.headers.get("authorization"), expectedSecret)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { tweetId, text, tweetUrl, tweetCreatedAt } = body;

    // 2. Strict Input Validation
    if (!tweetId || typeof tweetId !== "string" || !/^\d+$/.test(tweetId)) {
      return NextResponse.json({ error: "Invalid tweetId" }, { status: 400 });
    }

    if (
      typeof text !== "string" ||
      text.trim().length === 0 ||
      text.length > 2000
    ) {
      return NextResponse.json({ error: "Invalid text" }, { status: 400 });
    }

    if (
      !tweetUrl ||
      typeof tweetUrl !== "string" ||
      !/^https:\/\/(x|twitter)\.com\/thsottiaux\/status\/\d+/i.test(tweetUrl)
    ) {
      return NextResponse.json(
        { error: "Invalid tweetUrl: Must belong to @thsottiaux status path" },
        { status: 400 }
      );
    }

    if (!tweetCreatedAt || typeof tweetCreatedAt !== "string") {
      return NextResponse.json({ error: "tweetCreatedAt is required" }, { status: 400 });
    }

    const createdDate = new Date(tweetCreatedAt);
    const nowTime = Date.now();

    if (isNaN(createdDate.getTime())) {
      return NextResponse.json({ error: "Invalid tweetCreatedAt date format" }, { status: 400 });
    }

    if (createdDate.getTime() > nowTime + 5 * 60 * 1000) {
      return NextResponse.json(
        { error: "Invalid tweetCreatedAt: Timestamp is more than 5 minutes in the future" },
        { status: 400 }
      );
    }

    const replyMetadataResult = parseTiboReplyMetadata(body);
    if (!replyMetadataResult.ok) {
      return NextResponse.json({ error: "Invalid reply metadata" }, { status: 400 });
    }
    const replyMetadata = replyMetadataResult.value;

    // 3. Existing Rule Classification
    const ruleResult = classifyTiboTweet(text, tweetUrl, replyMetadata);

    // 4. Gemini Classification (Optional based on GEMINI_CLASSIFICATION_MODE)
    const mode = normalizeTiboClassificationMode(process.env.GEMINI_CLASSIFICATION_MODE);

    let aiResult = null;
    if (shouldRunGeminiClassification(mode)) {
      try {
        aiResult = await classifyWithGemini(
          { text, tweetCreatedAt, sourceTimeZone: TIBO_SOURCE_TIME_ZONE, ...replyMetadata },
          { mode },
        );
      } catch {
        // Keep the webhook successful and let primary mode select the rule fallback.
        console.warn("[Webhook Warning] Gemini classification failed; using the rule fallback.");
          aiResult = {
          signalType: null,
          confidence: null,
          temporalDirection: null,
          evidenceQuote: null,
          reasonJa: null,
          resetTypeJa: null,
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
          model: process.env.GEMINI_MODEL || null,
          status: "api_error" as const,
          classifiedAt: new Date().toISOString(),
        };
      }
    }

    const selectedClassification = selectTiboClassification(mode, ruleResult, aiResult);
    const contextSafetyDecision = getTiboContextSafetyDecision({
      authorText: text,
      replyContextText: replyMetadata.replyContextText,
      quoteContextText: replyMetadata.quoteContextText,
      selectedSignalType: selectedClassification.signalType,
      aiTeaserStrength: aiResult?.teaserStrength,
      ruleSignalType: ruleResult.signalType,
      ruleConfidence: ruleResult.confidence,
      isReply: ruleResult.isReply,
    });
    const effectiveClassification = contextSafetyDecision
      ? {
          ...selectedClassification,
          signalType: contextSafetyDecision.signalType,
          reason: contextSafetyDecision.reasonJa,
        }
      : selectedClassification;
    const baseClassificationResponse = buildTiboClassificationResponse(mode, ruleResult, aiResult);
    const classificationResponse = contextSafetyDecision
      ? {
          ...baseClassificationResponse,
          signalType: effectiveClassification.signalType,
          teaserStrength: contextSafetyDecision.teaserStrength,
        }
      : baseClassificationResponse;

    const temporalSemantics = effectiveClassification.signalType === "official_notice"
      ? parseTiboTemporalSemantics(aiResult, text)
      : null;
    const temporalResolution = effectiveClassification.signalType === "official_notice"
      ? resolveTiboTemporalSchedule(
          temporalSemantics,
          createdDate.toISOString(),
          TIBO_SOURCE_TIME_ZONE,
        )
      : null;

    // 5. Expiration follows the resolved notice window when available. Other
    // signals retain the existing tweet-created-at + 24h behavior.
    const expiresAt = temporalResolution?.status === "resolved"
      ? new Date(getTemporalNoticeExpiry(temporalResolution, createdDate.toISOString()) ?? createdDate.toISOString())
      : new Date(createdDate.getTime() + 24 * 60 * 60 * 1000);
    const receivedAt = new Date().toISOString();

    // 6. Build Supabase Payload
    const secondarySignal = buildSecondarySignal(
      aiResult,
      text,
      createdDate.toISOString(),
      effectiveClassification.signalType,
    );
    const secondaryExpiresTime = secondarySignal?.expiresAt
      ? new Date(secondarySignal.expiresAt).getTime()
      : Number.NaN;
    const payloadExpiresAt = Number.isFinite(secondaryExpiresTime) &&
        secondaryExpiresTime > expiresAt.getTime()
      ? new Date(secondaryExpiresTime)
      : expiresAt;

    const payload = {
      tweet_id: tweetId,
      signal_type: effectiveClassification.signalType,
      confidence: effectiveClassification.confidence,
      text: text.trim(),
      tweet_url: tweetUrl,
      tweet_created_at: createdDate.toISOString(),
      detected_at: receivedAt,
      expires_at: payloadExpiresAt.toISOString(),
      verification_status: "auto_unverified" as const,
      classification_reason: effectiveClassification.reason,
      teaser_strength: contextSafetyDecision?.teaserStrength ?? null,
      secondary_signal: secondarySignal,
      is_reply: ruleResult.isReply,
      reply_to_handles: replyMetadata.replyToHandles ?? null,
      reply_context_text: replyMetadata.replyContextText ?? null,
      source_timeline: replyMetadata.sourceTimeline ?? null,
      is_quote: ruleResult.isQuote || replyMetadata.isQuote === true,
      quote_context_text: replyMetadata.quoteContextText ?? null,
      quote_tweet_url: replyMetadata.quoteTweetUrl ?? null,
      quote_author_handle: replyMetadata.quoteAuthorHandle ?? null,

      // Audit columns
      rule_signal_type: ruleResult.signalType,
      rule_confidence: ruleResult.confidence,
      ai_signal_type: aiResult?.signalType ?? null,
      ai_confidence: aiResult?.confidence ?? null,
      ai_temporal_direction: aiResult?.temporalDirection || null,
      ai_evidence_quote: aiResult?.evidenceQuote || null,
      ai_reason_ja: aiResult?.reasonJa || null,
      ai_reset_type_ja: aiResult?.resetTypeJa || null,
      ai_notice_to_execution: aiResult?.noticeToExecution || null,
      ai_teaser_strength: aiResult?.teaserStrength || null,
      ai_teaser_strength_confidence: aiResult?.teaserStrengthConfidence ?? null,
      ai_teaser_strength_evidence_quote: aiResult?.teaserStrengthEvidenceQuote || null,
      ai_teaser_strength_reason_ja: aiResult?.teaserStrengthReasonJa || null,
      ai_temporal_expression: aiResult?.temporalExpression || null,
      ai_temporal_kind: aiResult?.temporalKind || null,
      ai_temporal_precision: aiResult?.temporalPrecision || null,
      ai_temporal_timezone: aiResult?.explicitTimezone ?? null,
      ai_temporal_confidence: aiResult?.temporalConfidence ?? null,
      temporal_expression: temporalResolution?.temporalExpression ?? null,
      temporal_kind: temporalResolution?.temporalKind ?? null,
      temporal_precision: temporalResolution?.temporalPrecision ?? null,
      temporal_timezone: temporalResolution?.timezone ?? null,
      temporal_confidence: temporalResolution?.confidence ?? null,
      temporal_resolution_source: temporalResolution?.resolutionSource ?? null,
      expected_start_at: temporalResolution?.expectedStartAt ?? null,
      expected_end_at: temporalResolution?.expectedEndAt ?? null,
      temporal_resolution_status: temporalResolution?.status ?? null,
      temporal_resolution_version: temporalResolution?.version ?? null,
      ai_model: aiResult?.model || null,
      ai_classification_status: aiResult?.status || "skipped",
      ai_classified_at: aiResult?.classifiedAt || null,
      classification_source: selectedClassification.classificationSource,
    };

    // 7. Detect a first formal adoption before the upsert. State lookup is
    // fail-closed so an unknown existing state can never be overwritten.
    const supabase = getSupabaseServiceClient();
    let existingSignal: Partial<FormalTiboResetSignal> | null = null;
    try {
      const { data, error: lookupError } = await supabase
        .from("tibo_signals")
        .select("tweet_id,text,tweet_url,tweet_created_at,detected_at,expires_at,signal_type,confidence,classification_reason,verification_status,classification_source,teaser_strength,secondary_signal,is_reply,reply_to_handles,reply_context_text,source_timeline,translated_text_ja,translated_text_zh,ai_teaser_strength,ai_teaser_strength_confidence,ai_teaser_strength_evidence_quote,ai_teaser_strength_reason_ja")
        .eq("tweet_id", tweetId)
        .maybeSingle();

      if (lookupError) {
        // The translation migration may be applied after the application is
        // deployed. Keep the existing state lookup usable during that window,
        // while all real lookup failures remain fail-closed.
        if (isMissingTiboOptionalColumnError(lookupError)) {
          const legacyLookup = await supabase
            .from("tibo_signals")
            .select("tweet_id,text,tweet_url,tweet_created_at,detected_at,signal_type,confidence,classification_reason,verification_status,classification_source,is_reply,reply_to_handles,reply_context_text,source_timeline")
            .eq("tweet_id", tweetId)
            .maybeSingle();
          if (legacyLookup.error) {
            console.warn("[Webhook Warning] Existing Tibo state lookup failed", {
              reason: "lookup_failed",
            });
            return NextResponse.json(
              { error: "Tibo state lookup unavailable" },
              { status: 503 },
            );
          }
          existingSignal = legacyLookup.data as Partial<FormalTiboResetSignal> | null;
        } else {
          console.warn("[Webhook Warning] Existing Tibo state lookup failed", {
            reason: "lookup_failed",
          });
          return NextResponse.json(
            { error: "Tibo state lookup unavailable" },
            { status: 503 },
          );
        }
      } else {
        existingSignal = data as Partial<FormalTiboResetSignal> | null;
      }

    } catch {
      console.warn("[Webhook Warning] Existing Tibo state lookup failed", {
        reason: "lookup_failed",
      });
      return NextResponse.json(
        { error: "Tibo state lookup unavailable" },
        { status: 503 },
      );
    }

    const existingTranslationJa = normalizeStoredTranslation(existingSignal?.translated_text_ja);
    const existingTranslationZh = normalizeStoredTranslation(existingSignal?.translated_text_zh);
    let translationResult: Awaited<ReturnType<typeof translateWithGemini>> | null = null;

    if (!existingTranslationJa || !existingTranslationZh) {
      translationResult = await translateWithGemini({
        text: text.trim(),
        tweetCreatedAt: createdDate.toISOString(),
      });
      if (
        translationResult.status !== "success" &&
        translationResult.status !== "skipped" &&
        translationResult.status !== "model_not_configured"
      ) {
        console.warn("[Webhook Warning] Tibo translation unavailable", {
          reason: translationResult.status,
        });
      }
    }

    const payloadWithTranslations = {
      ...payload,
      translated_text_ja: translationResult?.textJa ?? existingTranslationJa,
      translated_text_zh: translationResult?.textZh ?? existingTranslationZh,
    };
    let persistedPayload = preserveTiboWebhookState(
      payloadWithTranslations,
      existingSignal,
      receivedAt,
    );

    let formalCandidate: FormalTiboResetSignal = {
      tweet_id: persistedPayload.tweet_id,
      text: persistedPayload.text,
      tweet_url: persistedPayload.tweet_url,
      tweet_created_at: persistedPayload.tweet_created_at,
      detected_at: persistedPayload.detected_at,
      signal_type: persistedPayload.signal_type,
      confidence: persistedPayload.confidence,
      verification_status: persistedPayload.verification_status,
      classification_source: persistedPayload.classification_source,
      rule_signal_type: persistedPayload.rule_signal_type,
      ai_signal_type: persistedPayload.ai_signal_type,
      ai_classification_status: persistedPayload.ai_classification_status,
      ai_reset_type_ja: persistedPayload.ai_reset_type_ja,
      ai_notice_to_execution: persistedPayload.ai_notice_to_execution,
      expires_at: persistedPayload.expires_at,
      is_reply: persistedPayload.is_reply,
      is_quote: persistedPayload.is_quote,
      quote_context_text: persistedPayload.quote_context_text,
      quote_tweet_url: persistedPayload.quote_tweet_url,
      quote_author_handle: persistedPayload.quote_author_handle,
    };

    // A fresh local quota observation is the only state in which absence of
    // recovery can safely defer an unverified Tibo completion. If the monitor
    // or recovery lookup is unavailable, preserve the existing non-blocking
    // behavior because absence is not evidence there.
    if (isFormalTiboResetSignal(formalCandidate)) {
      const monitorState = await readCodexUsageMonitorState(supabase);
      if (monitorState.error) {
        console.warn("[Tibo Warning] Usage monitor coverage lookup unavailable", {
          reason: "lookup_failed",
        });
      } else {
        const coverage = getUsageMonitorCoverageAtEvent(
          monitorState.state,
          formalCandidate.tweet_created_at,
          new Date(receivedAt),
        );
        if (coverage.state === "fresh") {
          const recoveryLookup = await findNearestCodexRecoveryObservation(
            supabase,
            formalCandidate.tweet_created_at,
            USAGE_TIBO_MATCH_WINDOW_MS,
          );
          const shouldDefer = shouldDeferFormalTiboReset(
            formalCandidate,
            coverage,
            {
              available: !recoveryLookup.error,
              matched: Boolean(recoveryLookup.observation),
            },
          );
          if (shouldDefer) {
            persistedPayload = {
              ...persistedPayload,
              signal_type: "irrelevant",
              classification_reason: "Usage Monitorがfreshですが、quota recoveryが未確認のため正式resetとして保留しています。",
            };
            formalCandidate = {
              ...formalCandidate,
              signal_type: "irrelevant",
            };
          }
        }
      }
    }

    let existingFormalCluster = false;
    const adoptionEligible = isNewFormalAdoption(formalCandidate, existingSignal);
    if (adoptionEligible) {
      const createdTime = Date.parse(formalCandidate.tweet_created_at);
      if (Number.isFinite(createdTime)) {
        try {
          const { data: nearbySignals, error: nearbyLookupError } = await supabase
            .from("tibo_signals")
            .select("tweet_id,text,tweet_url,tweet_created_at,signal_type,confidence,verification_status,classification_source,rule_signal_type,ai_signal_type,is_reply")
            .eq("signal_type", "reset_executed")
            .neq("tweet_id", tweetId)
            .gte("tweet_created_at", new Date(createdTime - 5 * 60 * 1000).toISOString())
            .lte("tweet_created_at", new Date(createdTime + 5 * 60 * 1000).toISOString())
            .limit(20);

          if (nearbyLookupError) {
            console.warn("[Tibo Warning] Formal cluster lookup unavailable", {
              reason: "lookup_failed",
            });
          } else {
            existingFormalCluster = hasExistingFormalResetCluster(
              formalCandidate,
              (nearbySignals ?? []) as Array<FormalTiboResetSignal>,
            );
          }
        } catch {
          console.warn("[Tibo Warning] Formal cluster lookup unavailable", {
            reason: "lookup_failed",
          });
        }
      }
    }
    const newlyAdopted = adoptionEligible && !existingFormalCluster;

    // 8. Supabase Upsert
    let upsertResult = await supabase
      .from("tibo_signals")
      .upsert(persistedPayload, { onConflict: "tweet_id" });

    if (upsertResult.error && isMissingTiboOptionalColumnError(upsertResult.error)) {
      const {
        translated_text_ja: _translatedTextJa,
        translated_text_zh: _translatedTextZh,
        teaser_strength: _teaserStrength,
        ai_teaser_strength: _aiTeaserStrength,
        ai_teaser_strength_confidence: _aiTeaserStrengthConfidence,
        ai_teaser_strength_evidence_quote: _aiTeaserStrengthEvidenceQuote,
        ai_teaser_strength_reason_ja: _aiTeaserStrengthReasonJa,
        ai_temporal_expression: _aiTemporalExpression,
        ai_temporal_kind: _aiTemporalKind,
        ai_temporal_precision: _aiTemporalPrecision,
        ai_temporal_timezone: _aiTemporalTimezone,
        ai_temporal_confidence: _aiTemporalConfidence,
        temporal_expression: _temporalExpression,
        temporal_kind: _temporalKind,
        temporal_precision: _temporalPrecision,
        temporal_timezone: _temporalTimezone,
        temporal_confidence: _temporalConfidence,
        temporal_resolution_source: _temporalResolutionSource,
        expected_start_at: _expectedStartAt,
        expected_end_at: _expectedEndAt,
        temporal_resolution_status: _temporalResolutionStatus,
        temporal_resolution_version: _temporalResolutionVersion,
        quote_context_text: _quoteContextText,
        quote_tweet_url: _quoteTweetUrl,
        quote_author_handle: _quoteAuthorHandle,
        secondary_signal: _secondarySignal,
        ...legacyPayload
      } = persistedPayload;
      upsertResult = await supabase
        .from("tibo_signals")
        .upsert(legacyPayload, { onConflict: "tweet_id" });
    }

    if (upsertResult.error) {
      console.error("[Webhook Error] Supabase upsert failed", {
        reason: "database_error",
      });
      return NextResponse.json({ error: "Database error" }, { status: 500 });
    }

    if (isFormalTiboResetSignal(formalCandidate)) {
      try {
        const recoveryMatch = await confirmNearestCodexRecoveryObservation(
          supabase,
          formalCandidate.tweet_id,
          formalCandidate.tweet_created_at,
          USAGE_TIBO_MATCH_WINDOW_MS,
          receivedAt,
        );
        if (recoveryMatch.error) {
          console.warn("[Tibo Warning] Codex recovery reconciliation unavailable", {
            reason: "lookup_failed",
          });
        } else if (recoveryMatch.observation) {
          const cluster = await findFormalTiboResetCluster(
            supabase,
            formalCandidate.tweet_id,
            formalCandidate.tweet_created_at,
          );
          if (!cluster.error) {
            const estimateResult = await upsertResetExecutionEstimate(supabase, {
              resetEventKey: `tibo-reset-${cluster.primaryTweetId}`,
              tiboAnnouncedAt: cluster.announcedAt,
              tiboPrimaryTweetId: cluster.representativeTweetId,
              tiboSourceTweetIds: cluster.sourceTweetIds,
              usageObservation: recoveryMatch.observation,
              officialNoticeTweetId: cluster.representativeNoticeId,
              officialNoticeAt: cluster.representativeNoticeAt,
            });
            if (estimateResult.error) {
              console.warn("[Tibo Warning] Reset execution estimate write failed", {
                reason: "database_error",
              });
            }
          }
        }
      } catch {
        console.warn("[Tibo Warning] Codex recovery reconciliation unavailable", {
          reason: "request_failed",
        });
      }
    }

    const formalAdoption = buildFormalAdoptionResult(newlyAdopted, formalCandidate);

    if (newlyAdopted) {
      console.info("[Tibo Formal Adoption]", {
        tweetId,
        signalType: selectedClassification.signalType,
        confidence: selectedClassification.confidence,
        sourceUrl: tweetUrl,
        adoptedAt: new Date().toISOString(),
      });
    }

    // Display-name generation is deliberately best-effort. The formal reset
    // row is already durable, and a naming failure must never turn collection
    // into a failed webhook delivery.
    if (formalCandidate.is_reply !== true && isFormalTiboResetSignal(formalCandidate)) {
      try {
        await ensureResetDisplayNameForEvent(
          convertTiboResetSignalToHistoryEvent(formalCandidate),
          {
            sourcePostText: text.trim(),
            sourceTweetId: tweetId,
            apiKey: process.env.GEMINI_API_KEY?.trim() || null,
            model: RANDOM_RESET_NAME_MODEL,
            timeoutMs: 8_000,
          },
        );
      } catch {
        console.warn("[Webhook Warning] Reset display-name generation skipped", {
          reason: "best_effort_failed",
        });
      }
    }

    // 9. Purge Next.js Cache
    try {
      revalidateTag("radar-data");
    } catch (e) {
      console.warn("[Webhook Warning] Cache revalidation skipped:", e);
    }

    return NextResponse.json({
      success: true,
      ...classificationResponse,
      formalAdoption,
    });
  } catch {
    console.error("[Webhook Error] Request processing failed.");
    return NextResponse.json({ error: "Internal Error" }, { status: 500 });
  }
}
