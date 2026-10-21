import { getLocalRadarData } from "../lib/radar";
import { getTiboContextSafetyDecision, type TiboContextSafetyInput } from "../lib/radar/tiboContextSafety";
import type { TiboEvidenceContext } from "../lib/radar/tiboEvidenceContext";
import { formatTiboEvidenceInput } from "../lib/radar/tiboEvidencePrompt";
import {
  classifyTiboTweet,
  type ClassificationResult,
  type ClassificationSignalType,
} from "../lib/radar/classification";
import {
  applyTiboClassificationSafetyGuard,
  buildGeminiPrompt,
  type GeminiClassificationOutput,
} from "../lib/radar/geminiClassification";
import {
  selectTiboClassification,
  type SelectedTiboClassification,
} from "../lib/radar/tiboClassificationMode";
import {
  parseTeaserStrengthAssessment,
  type ResetTeaserStatus,
} from "../lib/radar/teaserStrength";
import {
  getTemporalNoticeExpiry,
  parseTiboTemporalSemantics,
  resolveTiboTemporalSchedule,
  TIBO_SOURCE_TIME_ZONE,
  type TemporalKind,
  type TemporalPrecision,
  type TemporalResolutionStatus,
  type TiboTemporalResolution,
} from "../lib/radar/tiboTemporal";
import {
  convertTiboResetSignalToHistoryEvent,
  findBankedDistributionEvents,
  findRelatedBankedDistributionNotices,
  getNoticeBackedHistoryInputs,
  isFormalTiboResetSignal,
  type TiboNoticeSignal,
  type FormalTiboResetSignal,
} from "../lib/radar/tiboHistory";
import {
  attachTiboFormalReplyAdmissionProof,
  createTiboFormalReplyAdmissionProof,
} from "../lib/radar/tiboFormalReplyAdmission";
import { toPublicRadarSnapshot } from "../lib/radar/publicDto";
import type { ActiveTiboSignal, PublicRadarSnapshot, RadarData } from "../lib/radar/types";
import type { ResetExecutionEstimate } from "../lib/radar/resetExecution";

export type TiboScenarioExpected = {
  signalType?: ClassificationSignalType;
  temporalDirection?: "future" | "completed_now" | "historical" | "unclear";
  teaserStrength?: "strong" | "weak" | "none";
  temporalResolutionStatus?: TemporalResolutionStatus;
  temporalPrecision?: TemporalPrecision;
  expectedStartAt?: string | null;
  expectedEndAt?: string | null;
  noticeTimingStatus?: "known" | "unknown";
  resetMeaningMethod?: "forced" | "regular_scheduled" | "banked_distribution" | "personal" | "unknown";
  resetMeaningScope?: "all_paid_users" | "all_users" | "affected_users" | "single_account" | "unknown";
  shouldCreateActiveNotice?: boolean;
  shouldCreateTeaser?: boolean;
  shouldCreateResetHistoryEvent?: boolean;
  shouldAffectProbability?: boolean;
  shouldRemainActive?: boolean;
  shouldBeDeduplicated?: boolean;
  shouldBeRejected?: boolean;
  historyRecordKind?: string | null;
};

export type TiboScenarioBankedHistoryContext = {
  officialNotice: TiboNoticeSignal;
  estimate: ResetExecutionEstimate;
  observedAt: string;
};

export type TiboScenarioBaseline = {
  ruleSignalType: ClassificationSignalType;
  geminiSignalType: ClassificationSignalType;
  manualSignalType: ClassificationSignalType;
  manualTeaserStrength?: "strong" | "weak" | "none";
};

export type TiboScenarioMockGeminiOutput = Partial<
  Pick<
    GeminiClassificationOutput,
    | "signalType"
    | "confidence"
    | "temporalDirection"
    | "evidenceQuote"
    | "reasonJa"
    | "teaserStrength"
    | "teaserStrengthConfidence"
    | "teaserStrengthEvidenceQuote"
    | "teaserStrengthReasonJa"
    | "noticeTimingStatus"
    | "resetMeaning"
    | "contextualResetAssessment"
    | "contextualResetTweetId"
    | "futureSignal"
    | "temporalExpression"
    | "temporalKind"
    | "temporalPrecision"
    | "weekday"
    | "relativeDayOffset"
    | "relativeAmount"
    | "relativeUnit"
    | "explicitDateParts"
    | "explicitTimeParts"
    | "daypart"
    | "rangeKind"
    | "explicitTimezone"
    | "temporalConfidence"
  >
>;

export type TiboScenario = {
  id: string;
  category: string;
  description: string;
  tweetText: string;
  tweetCreatedAt: string;
  tweetUrl: string;
  isReply?: boolean;
  replyParentTweetId?: string | null;
  replyParentTweetUrl?: string | null;
  replyToHandles?: string[];
  replyContextText?: string | null;
  validatedSourceContext?: TiboEvidenceContext | null;
  sourceContextRevisionHashes?: string[];
  sourceContextClassifiedRevisionHashes?: string[];
  sourceContextGeneration?: number;
  tiboEvidenceInput?: string | null;
  isQuote?: boolean;
  quoteAuthorHandle?: string | null;
  quoteContextText?: string | null;
  quoteTweetUrl?: string | null;
  sourceTimeline?: "profile" | "with_replies";
  expected: TiboScenarioExpected;
  ambiguous?: boolean;
  pipeline?: boolean;
  metamorphicGroup?: string;
  regressionGroup?: string;
  baseline?: TiboScenarioBaseline;
  mockGeminiOutput?: TiboScenarioMockGeminiOutput;
  bankedHistoryContext?: TiboScenarioBankedHistoryContext;
};

export type TiboScenarioFixture = {
  schemaVersion: number;
  scenarios: TiboScenario[];
};

export type TiboScenarioRun = {
  scenario: TiboScenario;
  now: Date;
  ruleResult: ClassificationResult;
  geminiResult: GeminiClassificationOutput | null;
  selected: SelectedTiboClassification;
  teaserStatus: ResetTeaserStatus;
  temporalResolution: TiboTemporalResolution | null;
  activeSignal: ActiveTiboSignal;
  formalSignal: FormalTiboResetSignal;
  formalAccepted: boolean;
  historyEvent: ReturnType<typeof convertTiboResetSignalToHistoryEvent> | null;
  radarData: RadarData;
  publicSnapshot: PublicRadarSnapshot;
};

function defaultEvidence(text: string) {
  const firstLine = text.split(/\r?\n/, 1)[0]?.trim() ?? text.trim();
  return firstLine.slice(0, 240) || null;
}

export function buildFixedGeminiOutput(scenario: TiboScenario): GeminiClassificationOutput {
  const expectedSignal = scenario.expected.signalType ?? "irrelevant";
  const expectedDirection = scenario.expected.temporalDirection ?? "unclear";
  const expectedTeaser = scenario.expected.teaserStrength ?? null;
  const mock = scenario.mockGeminiOutput ?? {};
  const evidenceQuote = mock.evidenceQuote ?? defaultEvidence(scenario.tweetText);

  return {
    signalType: mock.signalType ?? expectedSignal,
    confidence: mock.confidence ?? 0.98,
    temporalDirection: mock.temporalDirection ?? expectedDirection,
    evidenceQuote,
    reasonJa: mock.reasonJa ?? `Scenario fixture: ${scenario.description}`,
    resetTypeJa: null,
    contextualResetAssessment: mock.contextualResetAssessment ?? "unknown",
    contextualResetTweetId: mock.contextualResetTweetId ?? null,
    noticeTimingStatus: mock.noticeTimingStatus ?? null,
    resetMeaning: mock.resetMeaning ?? null,
    noticeToExecution: null,
    teaserStrength: mock.teaserStrength ?? expectedTeaser,
    teaserStrengthConfidence: mock.teaserStrengthConfidence ?? (expectedTeaser ? 0.92 : null),
    teaserStrengthEvidenceQuote:
      mock.teaserStrengthEvidenceQuote ?? (expectedTeaser ? defaultEvidence(scenario.tweetText) : null),
    teaserStrengthReasonJa:
      mock.teaserStrengthReasonJa ?? (expectedTeaser ? "Fixture-defined UI-only teaser strength." : null),
    futureSignal: mock.futureSignal ?? null,
    temporalExpression: mock.temporalExpression ?? null,
    temporalKind: mock.temporalKind ?? (scenario.expected.temporalResolutionStatus ? "vague" : "none"),
    temporalPrecision: mock.temporalPrecision ?? scenario.expected.temporalPrecision ?? "unknown",
    weekday: mock.weekday ?? null,
    relativeDayOffset: mock.relativeDayOffset ?? null,
    relativeAmount: mock.relativeAmount ?? null,
    relativeUnit: mock.relativeUnit ?? null,
    explicitDateParts: mock.explicitDateParts ?? null,
    explicitTimeParts: mock.explicitTimeParts ?? null,
    daypart: mock.daypart ?? null,
    rangeKind: mock.rangeKind ?? null,
    explicitTimezone: mock.explicitTimezone ?? null,
    temporalConfidence: mock.temporalConfidence ?? (scenario.expected.temporalResolutionStatus ? 0.9 : 0),
    model: "fixture-gemini",
    status: "success",
    classifiedAt: scenario.tweetCreatedAt,
  };
}

export function getScenarioNow(scenario: TiboScenario) {
  const created = new Date(scenario.tweetCreatedAt);
  const offset = scenario.expected.temporalResolutionStatus === "resolved" ? 30 * 60_000 : 60 * 60_000;
  return new Date(created.getTime() + offset);
}

function buildActiveSignal(
  scenario: TiboScenario,
  selected: SelectedTiboClassification,
  geminiResult: GeminiClassificationOutput | null,
  temporalResolution: TiboTemporalResolution | null,
) {
  const createdAt = scenario.tweetCreatedAt;
  const expiresAt = temporalResolution
    ? getTemporalNoticeExpiry(temporalResolution, createdAt)
    : new Date(Date.parse(createdAt) + 24 * 60 * 60_000).toISOString();
  const teaser = geminiResult
    ? parseTeaserStrengthAssessment(geminiResult, scenario.tweetText)
    : null;

  return {
    tweet_id: scenario.tweetUrl.match(/\/status\/(\d+)/)?.[1] ?? scenario.id,
    signal_type: selected.signalType,
    text: scenario.tweetText,
    tweet_url: scenario.tweetUrl,
    tweet_created_at: createdAt,
    detected_at: createdAt,
    expires_at: expiresAt ?? undefined,
    verification_status: scenario.expected.shouldBeRejected ? "rejected" : "auto_unverified",
    confidence: selected.confidence,
    classification_reason: selected.reason,
    teaser_strength: teaser?.teaserStrength ?? null,
    ai_temporal_expression: geminiResult?.temporalExpression ?? null,
    ai_temporal_kind: geminiResult?.temporalKind ?? null,
    ai_temporal_precision: geminiResult?.temporalPrecision ?? null,
    ai_temporal_timezone: temporalResolution?.timezone ?? null,
    ai_temporal_confidence: temporalResolution?.confidence ?? null,
    expected_start_at: temporalResolution?.expectedStartAt ?? null,
    expected_end_at: temporalResolution?.expectedEndAt ?? null,
    temporal_resolution_status: temporalResolution?.status ?? null,
    temporal_resolution_version: temporalResolution?.version ?? null,
    is_reply: scenario.isReply ?? false,
    is_quote: scenario.isQuote ?? false,
    quote_context_text: scenario.quoteContextText ?? null,
    quote_tweet_url: scenario.quoteTweetUrl ?? null,
    quote_author_handle: scenario.quoteAuthorHandle ?? null,
    reply_to_handles: scenario.replyToHandles ?? null,
    reply_context_text: scenario.replyContextText ?? null,
  } satisfies ActiveTiboSignal;
}

function buildFormalSignal(
  activeSignal: ActiveTiboSignal,
  selected: SelectedTiboClassification,
  geminiResult: GeminiClassificationOutput | null,
  scenario: TiboScenario,
): FormalTiboResetSignal {
  return {
    ...activeSignal,
    text: activeSignal.text ?? scenario.tweetText,
    tweet_url: activeSignal.tweet_url ?? scenario.tweetUrl,
    tweet_created_at: activeSignal.tweet_created_at,
    signal_type: selected.signalType,
    confidence: selected.confidence,
    verification_status: scenario.expected.shouldBeRejected ? "rejected" : "auto_unverified",
    classification_source: selected.classificationSource,
    rule_signal_type: activeSignal.signal_type,
    ai_signal_type: geminiResult?.signalType ?? null,
    ai_confidence: geminiResult?.confidence ?? null,
    ai_classification_status: geminiResult?.status ?? "skipped",
    ai_temporal_direction: geminiResult?.temporalDirection ?? null,
    ai_notice_timing_status: geminiResult?.noticeTimingStatus ?? null,
    ai_evidence_quote: geminiResult?.evidenceQuote ?? null,
    ai_reset_type_ja: geminiResult?.resetTypeJa ?? null,
    ai_notice_to_execution: geminiResult?.noticeToExecution ?? null,
    ai_teaser_strength: activeSignal.teaser_strength ?? null,
    ai_teaser_strength_confidence: geminiResult?.teaserStrengthConfidence ?? null,
    ai_teaser_strength_evidence_quote: geminiResult?.teaserStrengthEvidenceQuote ?? null,
    ai_teaser_strength_reason_ja: geminiResult?.teaserStrengthReasonJa ?? null,
    ai_temporal_expression: activeSignal.ai_temporal_expression ?? null,
    ai_temporal_kind: activeSignal.ai_temporal_kind ?? null,
    ai_temporal_precision: activeSignal.ai_temporal_precision ?? null,
    ai_temporal_timezone: activeSignal.ai_temporal_timezone ?? null,
    ai_temporal_confidence: activeSignal.ai_temporal_confidence ?? null,
    expected_start_at: activeSignal.expected_start_at ?? null,
    expected_end_at: activeSignal.expected_end_at ?? null,
    temporal_resolution_status: activeSignal.temporal_resolution_status ?? null,
    temporal_resolution_version: activeSignal.temporal_resolution_version ?? null,
    is_reply: scenario.isReply ?? false,
    is_quote: scenario.isQuote ?? false,
    quote_context_text: scenario.quoteContextText ?? null,
    quote_tweet_url: scenario.quoteTweetUrl ?? null,
    quote_author_handle: scenario.quoteAuthorHandle ?? null,
    reply_to_handles: scenario.replyToHandles ?? null,
    reply_context_text: scenario.replyContextText ?? null,
    source_timeline: scenario.sourceTimeline ?? "profile",
    source_context_revision_hashes: scenario.sourceContextRevisionHashes ?? [],
    source_context_classified_revision_hashes: scenario.sourceContextClassifiedRevisionHashes ?? [],
    source_context_generation: scenario.sourceContextGeneration ?? 0,
  };
}

function attachCurrentScenarioReplyProof(
  formalSignal: FormalTiboResetSignal,
  contextSafetyInput: TiboContextSafetyInput,
  contextSafetyDecision: ReturnType<typeof getTiboContextSafetyDecision>,
  selected: SelectedTiboClassification,
  geminiResult: GeminiClassificationOutput,
  scenario: TiboScenario,
) {
  if (contextSafetyDecision !== null || scenario.isReply !== true || scenario.isQuote === true
    || selected.signalType !== "reset_executed" || selected.classificationSource !== "gemini"
    || geminiResult.status !== "success" || geminiResult.signalType !== "reset_executed"
    || (geminiResult.confidence ?? 0) < 0.95 || geminiResult.temporalDirection !== "completed_now") {
    return formalSignal;
  }

  const proof = createTiboFormalReplyAdmissionProof(
    contextSafetyInput,
    scenario.sourceContextRevisionHashes ?? [],
    scenario.sourceContextGeneration ?? 0,
  );
  return proof
    ? attachTiboFormalReplyAdmissionProof(formalSignal, proof) as FormalTiboResetSignal
    : formalSignal;
}

export function runTiboScenario(scenario: TiboScenario, now = getScenarioNow(scenario)): TiboScenarioRun {
  const ruleResult = classifyTiboTweet(scenario.tweetText, scenario.tweetUrl, {
    isReply: scenario.isReply,
    isQuote: scenario.isQuote,
  });
  const geminiResult = scenario.pipeline
    ? applyTiboClassificationSafetyGuard(scenario.tweetText, buildFixedGeminiOutput(scenario))
    : null;
  const selected = selectTiboClassification(scenario.pipeline ? "primary" : "off", ruleResult, geminiResult);
  const semantics = geminiResult ? parseTiboTemporalSemantics(geminiResult, scenario.tweetText) : null;
  const temporalResolution = (selected.signalType === "official_notice" || selected.signalType === "teaser") && semantics
    ? resolveTiboTemporalSchedule(semantics, scenario.tweetCreatedAt, TIBO_SOURCE_TIME_ZONE)
    : null;
  const activeSignal = buildActiveSignal(scenario, selected, geminiResult, temporalResolution);
  const formalSignal = buildFormalSignal(activeSignal, selected, geminiResult, scenario);
  const formalAccepted = isFormalTiboResetSignal(formalSignal);
  const historyEvent = formalAccepted ? convertTiboResetSignalToHistoryEvent(formalSignal) : null;
  const recentSignals = [activeSignal];
  const radarData = getLocalRadarData({
    calculationNow: now,
    checkedAt: now.toISOString(),
    activeTiboSignals: selected.signalType === "irrelevant" ? [] : [activeSignal],
    recentTiboSignals: recentSignals,
    formalTiboResets: formalAccepted ? [formalSignal] : [],
    rejectedTiboResets: scenario.expected.shouldBeRejected
      ? [{ tweet_id: activeSignal.tweet_id, tweet_url: activeSignal.tweet_url, tweet_created_at: activeSignal.tweet_created_at }]
      : [],
  });
  const publicSnapshot = toPublicRadarSnapshot(radarData, "ja", {
    calculationNow: now,
    limitHistory: false,
  });

  return {
    scenario,
    now,
    ruleResult,
    geminiResult,
    selected,
    teaserStatus: publicSnapshot.resetTeaserStatus ?? "unknown",
    temporalResolution,
    activeSignal,
    formalSignal,
    formalAccepted,
    historyEvent,
    radarData,
    publicSnapshot,
  };
}

export function buildGeminiScenarioInput(scenario: TiboScenario) {
  return {
    text: scenario.tweetText,
    tweetCreatedAt: scenario.tweetCreatedAt,
    isReply: scenario.isReply,
    replyToHandles: scenario.replyToHandles,
    replyContextText: scenario.replyContextText ?? null,
    sourceTimeline: scenario.sourceTimeline,
    isQuote: scenario.isQuote,
    quoteAuthorHandle: scenario.quoteAuthorHandle ?? null,
    quoteContextText: scenario.quoteContextText ?? null,
    quoteTweetUrl: scenario.quoteTweetUrl ?? null,
    tiboEvidenceInput: scenario.validatedSourceContext
      ? formatTiboEvidenceInput(scenario.validatedSourceContext)
      : scenario.tiboEvidenceInput ?? null,
    sourceTimeZone: TIBO_SOURCE_TIME_ZONE,
  };
}

export function buildScenarioPrompt(scenario: TiboScenario) {
  return buildGeminiPrompt(buildGeminiScenarioInput(scenario));
}
export type TiboScenarioPipelineResult = {
  ruleResult: ClassificationResult;
  selected: SelectedTiboClassification;
  contextSafetyDecision: ReturnType<typeof getTiboContextSafetyDecision>;
  effectiveSignalType: ClassificationSignalType;
  effectiveTeaserStrength: GeminiClassificationOutput["teaserStrength"] | null;
  formalSignal: FormalTiboResetSignal;
  formalAccepted: boolean;
  historyEvent: ReturnType<typeof convertTiboResetSignalToHistoryEvent> | null;
  bankedHistoryEvent: ReturnType<typeof findBankedDistributionEvents>[number] | null;
};

/**
 * Run classification selection and context safety with an explicit model result.
 * Fixed-output pipeline tests use this helper; the live evaluator still calls
 * classifyWithGemini directly and records its output separately.
 */
export function runTiboScenarioPipeline(
  scenario: TiboScenario,
  geminiResult: GeminiClassificationOutput,
  modeValue = "primary",
): TiboScenarioPipelineResult {
  const ruleResult = classifyTiboTweet(scenario.tweetText, scenario.tweetUrl, {
    isReply: scenario.isReply,
    isQuote: scenario.isQuote,
  });
  const selected = selectTiboClassification(modeValue, ruleResult, geminiResult);
  const targetTweetId = scenario.tweetUrl.match(/\/status\/(\d+)/)?.[1] ?? scenario.id;
  const contextSafetyInput: TiboContextSafetyInput = {
    authorText: scenario.tweetText,
    isReply: scenario.isReply,
    isQuote: scenario.isQuote,
    replyContextText: scenario.replyContextText,
    replyParentTweetId: scenario.replyParentTweetId,
    replyParentTweetUrl: scenario.replyParentTweetUrl,
    quoteContextText: scenario.quoteContextText,
    quoteAuthorHandle: scenario.quoteAuthorHandle,
    quoteTweetUrl: scenario.quoteTweetUrl,
    selectedSignalType: selected.signalType,
    aiTeaserStrength: geminiResult.teaserStrength,
    evidenceQuote: geminiResult.evidenceQuote,
    temporalDirection: geminiResult.temporalDirection,
    noticeTimingStatus: geminiResult.noticeTimingStatus,
    contextualResetAssessment: geminiResult.contextualResetAssessment,
    contextualResetTweetId: geminiResult.contextualResetTweetId,
    resetMeaning: geminiResult.resetMeaning,
    targetTweetId,
    targetTweetUrl: scenario.tweetUrl,
    targetTweetCreatedAt: scenario.tweetCreatedAt,
    validatedSourceContext: scenario.validatedSourceContext,
  };
  const contextSafetyDecision = getTiboContextSafetyDecision(contextSafetyInput);
  const effectiveSelected = contextSafetyDecision
    ? {
        ...selected,
        signalType: contextSafetyDecision.signalType,
        reason: contextSafetyDecision.reasonJa,
      }
    : selected;
  const semantics = geminiResult.status === "success"
    ? parseTiboTemporalSemantics(geminiResult, scenario.tweetText)
    : null;
  const temporalResolution =
    (effectiveSelected.signalType === "official_notice" || effectiveSelected.signalType === "teaser") && semantics
      ? resolveTiboTemporalSchedule(semantics, scenario.tweetCreatedAt, TIBO_SOURCE_TIME_ZONE)
      : null;
  const activeSignal = buildActiveSignal(scenario, effectiveSelected, geminiResult, temporalResolution);
  const formalSignal = attachCurrentScenarioReplyProof(
    buildFormalSignal(activeSignal, effectiveSelected, geminiResult, scenario),
    contextSafetyInput,
    contextSafetyDecision,
    effectiveSelected,
    geminiResult,
    scenario,
  );
  const formalAccepted = isFormalTiboResetSignal(formalSignal);
  const bankedHistoryEvent = buildScenarioBankedHistoryEvent(
    scenario,
    geminiResult,
    effectiveSelected.signalType,
    formalSignal,
  );

  return {
    ruleResult,
    selected,
    contextSafetyDecision,
    effectiveSignalType: effectiveSelected.signalType,
    effectiveTeaserStrength: contextSafetyDecision?.teaserStrength ?? geminiResult.teaserStrength ?? null,
    formalSignal,
    formalAccepted,
    historyEvent: formalAccepted ? convertTiboResetSignalToHistoryEvent(formalSignal) : null,
    bankedHistoryEvent,
  };
}

function buildScenarioBankedHistoryEvent(
  scenario: TiboScenario,
  geminiResult: GeminiClassificationOutput,
  effectiveSignalType: ClassificationSignalType,
  completionSignal: FormalTiboResetSignal,
) {
  const context = scenario.bankedHistoryContext;
  if (
    !context ||
    geminiResult.status !== "success" ||
    effectiveSignalType !== "irrelevant" ||
    geminiResult.resetMeaning?.method !== "banked_distribution" ||
    geminiResult.resetMeaning.scope !== "affected_users"
  ) {
    return null;
  }

  const officialNotice: ActiveTiboSignal = {
    tweet_id: context.officialNotice.tweet_id,
    text: context.officialNotice.text,
    tweet_url: context.officialNotice.tweet_url,
    tweet_created_at: context.officialNotice.tweet_created_at,
    detected_at: context.officialNotice.tweet_created_at,
    signal_type: "official_notice",
    confidence: context.officialNotice.confidence ?? undefined,
    verification_status: context.officialNotice.verification_status,
  };
  const canonicalOfficialNotice: FormalTiboResetSignal = {
    tweet_id: context.officialNotice.tweet_id,
    text: context.officialNotice.text,
    tweet_url: context.officialNotice.tweet_url,
    tweet_created_at: context.officialNotice.tweet_created_at,
    signal_type: "official_notice",
    confidence: context.officialNotice.confidence ?? null,
    verification_status: context.officialNotice.verification_status,
  };
  const bankedCompletion: ActiveTiboSignal = {
    tweet_id: completionSignal.tweet_id,
    text: completionSignal.text,
    tweet_url: completionSignal.tweet_url,
    tweet_created_at: completionSignal.tweet_created_at,
    detected_at: completionSignal.detected_at ?? completionSignal.tweet_created_at,
    signal_type: "irrelevant",
    confidence: completionSignal.confidence ?? undefined,
    verification_status: completionSignal.verification_status,
    is_reply: completionSignal.is_reply === true,
  };
  const inputs = getNoticeBackedHistoryInputs({
    ...getLocalRadarData(),
    canonical_tibo_signals: [canonicalOfficialNotice, completionSignal],
    recent_tibo_signals: [officialNotice, bankedCompletion],
    active_tibo_signals: [],
    formal_tibo_resets: [],
    rejected_tibo_resets: [],
    codex_recovery_observations: [],
    codex_usage_recovery: null,
    reset_execution_estimates: [context.estimate],
  });
  const relatedSignals = findRelatedBankedDistributionNotices(
    inputs.bankedSignals,
    context.officialNotice.tweet_id,
    context.observedAt,
  );
  if (!relatedSignals.some((signal) => signal.tweet_id === completionSignal.tweet_id)) return null;

  return findBankedDistributionEvents(inputs.bankedSignals, inputs.estimates)
    .find((event) => event.id === context.estimate.resetEventKey) ?? null;
}
