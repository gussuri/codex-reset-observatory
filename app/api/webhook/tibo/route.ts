import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { LOCAL_RESET_HISTORY } from "@/data/resetHistory";
import { classifyTiboTweet, isCurrentUsageResetAnnouncement } from "@/lib/radar/classification";
import { classifyWithGemini } from "@/lib/radar/geminiClassification";
import {
  buildTiboClassificationResponse,
  classifyTiboWithSingleTransientRetry,
  normalizeTiboClassificationMode,
  selectTiboClassification,
  shouldRunGeminiClassification,
} from "@/lib/radar/tiboClassificationMode";
import {
  convertTiboResetSignalToHistoryEvent,
  isFormalTiboResetSignal,
  type FormalTiboResetSignal,
} from "@/lib/radar/tiboHistory";
import { invalidateRadarCache } from "@/lib/radar/cacheInvalidation";
import {
  confirmNearestCodexRecoveryObservation,
  findNearestCodexRecoveryObservation,
  findFormalTiboResetCluster,
  readCodexUsageMonitorState,
  readResetExecutionEstimates,
  upsertResetExecutionEstimate,
} from "@/lib/codexUsageRecoveryStore";
import { USAGE_TIBO_MATCH_WINDOW_MS } from "@/lib/codexUsageRecovery";
import { getUsageMonitorCoverageAtEvent } from "@/lib/codexUsageMonitorCoverage";
import {
  buildFormalAdoptionResult,
  hasExistingFormalResetCluster,
  shouldDeferFormalTiboReset,
} from "@/lib/radar/formalAdoption";
import { preserveTiboWebhookState } from "@/lib/radar/tiboWebhookState";
import { getCodexOperationalExpiryAt } from "@/lib/radar/codexOperationalStatus";
import type { TiboSecondarySignal } from "@/lib/radar/tiboSecondarySignal";
import {
  parseTiboReplyMetadata,
  type TiboReplyMetadata,
} from "@/lib/radar/tiboReplyMetadata";
import {
  parseTiboSourceContextEnrichment,
  storeTiboSourceContextEnrichment,
  TIBO_SOURCE_CONTEXT_ENRICHMENT_KIND,
} from "@/lib/radar/tiboSourceContext";
import {
  buildTiboEvidenceContext,
  hasRetryableTiboEvidenceOmission,
  type TiboEvidencePost,
  type TiboEvidenceContext,
} from "@/lib/radar/tiboEvidenceContext";
import { formatTiboEvidenceInput } from "@/lib/radar/tiboEvidencePrompt";
import {
  createTiboEvidenceLookup,
  type TiboEvidenceStoreClient,
} from "@/lib/radar/tiboEvidenceStore";
import { getTiboContextSafetyDecision } from "@/lib/radar/tiboContextSafety";
import {
  attachTiboFormalReplyAdmissionProof,
  createTiboFormalReplyAdmissionProof,
  getCurrentTiboFormalReplyAdmissionProof,
} from "@/lib/radar/tiboFormalReplyAdmission";
import { getEffectiveTeaserStrength } from "@/lib/radar/teaserStrength";
import { translateWithGeminiWithRetry } from "@/lib/radar/geminiTranslation";
import {
  isTiboTranslationValid,
  normalizeTiboTranslationValue,
} from "@/lib/radar/tiboTranslationValidation";
import {
  ensureResetDisplayNameForEvent,
} from "@/lib/radar/resetDisplayNameStore";
import { ensureResetEventMetadataForEvent } from "@/lib/radar/resetEventMetadataStore";
import { RANDOM_RESET_NAME_MODEL } from "@/lib/radar/randomResetNaming";
import {
  buildResetDisplayNameSourceContext,
  type ResetDisplayNameSourceRow,
} from "@/lib/radar/resetDisplayNameSourceContext";
import { isBearerAuthorizationValid } from "@/lib/security/bearerAuth";
import {
  getTemporalNoticeExpiry,
  parseTiboTemporalSemantics,
  resolveTiboTemporalSchedule,
  TIBO_SOURCE_TIME_ZONE,
} from "@/lib/radar/tiboTemporal";
import { resolveTiboPostEditHistory } from "@/lib/radar/xPostEditHistory";
import {
  createUntrustedTiboEditIdentity,
  getTrustedTiboEditIdentity,
  mergeTiboEditIdentity,
  reconcileTiboEditChainMetadata,
  toTiboEditIdentityFields,
  type TiboEditIdentityStore,
} from "@/lib/radar/tiboEditIdentity";
import {
  collapseTrustedTiboEditChains,
  toEffectiveTiboLogicalPostRow,
  type TiboLogicalPost,
  type TiboLogicalPostRow,
} from "@/lib/radar/tiboLogicalPost";
import {
  claimTiboFormalAdoption,
  readTiboFormalAdoptions,
  type TiboFormalAdoptionRecord,
  type TiboFormalAdoptionClaimResult,
} from "@/lib/radar/tiboFormalAdoptionStore";
import {
  resolveTiboResetEventIdentity,
  type TiboResetEventIdentityResolution,
} from "@/lib/radar/tiboResetEventIdentity";
import { isMissingTiboOptionalColumnError } from "@/lib/radar/tiboSchemaCompatibility";
import {
  isResetDisplayNameCandidateNoticeAfterAdoption,
  isResetDisplayNameCandidateOperationEnabled,
  readResetDisplayNameCandidateActivation,
} from "@/lib/radar/resetDisplayNameCandidateActivation";
import {
  isExecutionBearingResetDisplayNameNotice,
  type ResetDisplayNameCandidateSeed,
} from "@/lib/radar/resetDisplayNameCandidateTypes";
import {
  upsertResetDisplayNameCandidateSeed,
  type ResetDisplayNameCandidateStoreClient,
} from "@/lib/radar/resetDisplayNameCandidateStore";
import {
  hasFutureBankedDistributionIntent,
  isBankedDistributionCompletionSignal,
  isBankedDistributionNotice,
  isRecurringConditionalBankedDistributionNotice,
} from "@/lib/radar/bankedReset";

// Keep the webhook bounded while accepting X long-form/note text. The former
// 2,000-character ceiling rejected fully expanded posts before classification.
const MAX_TIBO_SOURCE_TEXT_LENGTH = 25_000;

function normalizeStoredTranslation(
  value: unknown,
  sourceText: string,
  locale: "ja" | "zh",
) {
  const normalized = normalizeTiboTranslationValue(value);
  return normalized && isTiboTranslationValid(sourceText, normalized, locale)
    ? normalized
    : null;
}

const FORMAL_FLOW_STATUSES = new Set(["claimed_new", "existing", "reconciled"]);

function isTiboSignalType(value: unknown): value is FormalTiboResetSignal["signal_type"] {
  return value === "official_notice" ||
    value === "reset_executed" ||
    value === "teaser" ||
    value === "irrelevant";
}

function toLogicalPostRow(value: unknown): TiboLogicalPostRow | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  if (
    typeof source.tweet_id !== "string" ||
    typeof source.tweet_created_at !== "string" ||
    typeof source.text !== "string" ||
    !isTiboSignalType(source.signal_type)
  ) {
    return null;
  }

  return attachTiboFormalReplyAdmissionProof({
    ...source,
    tweet_id: source.tweet_id,
    text: source.text,
    tweet_url: typeof source.tweet_url === "string" ? source.tweet_url : null,
    tweet_created_at: source.tweet_created_at,
    signal_type: source.signal_type,
    confidence: typeof source.confidence === "number" ? source.confidence : null,
    classification_reason: typeof source.classification_reason === "string"
      ? source.classification_reason
      : null,
    classification_source: typeof source.classification_source === "string"
      ? source.classification_source
      : null,
    verification_status: typeof source.verification_status === "string"
      ? source.verification_status
      : null,
    logical_post_id: typeof source.logical_post_id === "string"
      ? source.logical_post_id
      : null,
    edit_history_tweet_ids: Array.isArray(source.edit_history_tweet_ids)
      ? source.edit_history_tweet_ids.filter((id): id is string => typeof id === "string")
      : null,
    edit_version: typeof source.edit_version === "number" ? source.edit_version : null,
    edit_metadata_source: source.edit_metadata_source === "x_api" || source.edit_metadata_source === "none"
      ? source.edit_metadata_source
      : null,
  } as TiboLogicalPostRow & Record<string, unknown>);
}

function toFormalTiboResetSignal(value: TiboLogicalPostRow | Record<string, unknown>): FormalTiboResetSignal | null {
  const row = toLogicalPostRow(value);
  if (!row || !row.tweet_url || !row.verification_status || row.confidence === null) return null;
  return {
    ...row,
    tweet_url: row.tweet_url,
    confidence: row.confidence,
    verification_status: row.verification_status as FormalTiboResetSignal["verification_status"],
  } as FormalTiboResetSignal;
}

function getStaticHistoryEvidence() {
  return LOCAL_RESET_HISTORY
    .map((item) => ({
      eventKey: item.id?.trim() || item.guid?.trim() || "",
      sourceTweetIds: item.sourceTweetIds ?? [],
      sourceUrl: item.source_url ?? null,
      eventKind: item.recordKind === "banked_distribution"
        ? "banked_distribution" as const
        : item.recordKind === "confirmed_global"
          ? "forced_reset" as const
          : "unknown" as const,
    }))
    .filter((item) => item.eventKey.length > 0);
}

function getDynamicHistoryEvidence(rows: readonly TiboLogicalPostRow[]) {
  return rows
    .filter((row) => isFormalTiboResetSignal(row as FormalTiboResetSignal))
    .filter((row) => !isBankedDistributionCompletionSignal(row.text))
    .map((row) => {
      const proof = getCurrentTiboFormalReplyAdmissionProof(row as FormalTiboResetSignal);
      return {
        eventKey: `tibo-reset-${proof?.contextualResetTweetId ?? row.tweet_id}`,
        sourceTweetIds: proof?.pathTweetIds ?? row.edit_history_tweet_ids ?? [row.tweet_id],
        sourceUrl: proof?.path.at(-1)?.tweetUrl ?? row.tweet_url ?? null,
        eventKind: "forced_reset" as const,
      };
    });
}

function hasFormalRawVersion(logicalPost: TiboLogicalPost<TiboLogicalPostRow>) {
  return logicalPost.rawVersions.some((row) =>
    isFormalTiboResetSignal(row as FormalTiboResetSignal),
  );
}

function getClaimSource(
  resolution: TiboResetEventIdentityResolution,
  ledger: TiboFormalAdoptionRecord | null,
) {
  if (ledger) return ledger.claimSource;
  switch (resolution.matchedEvidence?.kind) {
    case "existing_estimate":
      return "existing_estimate" as const;
    case "existing_history":
      return "existing_history" as const;
    case "existing_dynamic":
      return "existing_dynamic" as const;
    default:
      return "new_adoption" as const;
  }
}

function getFormalCandidateForDisplay(
  logicalPost: TiboLogicalPost<TiboLogicalPostRow>,
) {
  const row = toEffectiveTiboLogicalPostRow(logicalPost);
  return row ? toFormalTiboResetSignal(row) : null;
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

  const isTimedSignal =
    futureSignal.signalType === "official_notice" ||
    futureSignal.signalType === "teaser";
  const temporalSemantics = isTimedSignal
    ? parseTiboTemporalSemantics(futureSignal, sourceText)
    : null;
  const temporalResolution = isTimedSignal
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

function hasTiboSourceRelation(metadata: TiboReplyMetadata) {
  return metadata.isReply === true || metadata.isQuote === true ||
    Boolean(metadata.replyContextText || metadata.quoteContextText || metadata.quoteTweetUrl);
}

function hasValidatedConnectedSourceEvidence(context: Awaited<ReturnType<typeof buildTiboEvidenceContext>>) {
  return context.status !== "invalid_target" &&
    (context.relatedPosts.length > 0 || context.omissions.length > 0);
}

function getTiboEvidenceLookup(client: ReturnType<typeof getSupabaseServiceClient>) {
  return createTiboEvidenceLookup(client as unknown as TiboEvidenceStoreClient);
}

async function serializeTiboEvidenceContext(
  target: TiboEvidencePost,
  lookup: ReturnType<typeof getTiboEvidenceLookup>,
) {
  // The target row is fetched separately for identity validation; the builder
  // limits only the additional related-post lookups.
  const context = await buildTiboEvidenceContext(target, lookup);
  return {
    context,
    input: hasValidatedConnectedSourceEvidence(context) ? formatTiboEvidenceInput(context) : null,
  };
}

function getTiboPostIdentity(tweetUrl: string) {
  try {
    const url = new URL(tweetUrl);
    if (url.protocol !== "https:" || !/^(x|twitter)\.com$/i.test(url.hostname)
      || url.username || url.password || url.port || url.search || url.hash) return null;
    const match = url.pathname.match(/^\/([A-Za-z0-9_]{1,15})\/status\/(\d+)\/?$/);
    return match ? { authorHandle: `@${match[1]!.toLowerCase()}`, tweetId: match[2]! } : null;
  } catch {
    return null;
  }
}

async function loadStoredTiboEvidence(
  client: ReturnType<typeof getSupabaseServiceClient>,
  tweetId: string,
  text: string,
  tweetUrl: string,
  createdAt: string,
) {
  const lookup = getTiboEvidenceLookup(client);
  try {
    const rows = await lookup(tweetId);
    if (rows.length !== 1) return null;
    const target = rows[0]!;
    const suppliedIdentity = getTiboPostIdentity(tweetUrl);
    const storedIdentity = getTiboPostIdentity(target.tweetUrl);
    if (!suppliedIdentity || !storedIdentity || suppliedIdentity.tweetId !== tweetId
      || suppliedIdentity.authorHandle !== "@thsottiaux"
      || storedIdentity.tweetId !== tweetId || storedIdentity.authorHandle !== "@thsottiaux"
      || target.text.trim() !== text.trim()
      || Date.parse(target.createdAt) !== Date.parse(createdAt)) {
      return null;
    }
    const sourceContextGeneration = target.sourceContextGeneration;
    if (!Number.isSafeInteger(sourceContextGeneration) || (sourceContextGeneration ?? -1) < 0) {
      return null;
    }
    const evidence = await serializeTiboEvidenceContext(target, lookup);
    return {
      input: evidence.input,
      context: evidence.context,
      sourceContextRevisionHashes: target.sourceContextRevisionHashes ?? [],
      sourceContextClassifiedRevisionHashes: target.sourceContextClassifiedRevisionHashes ?? [],
      sourceContextGeneration,
    };
  } catch {
    console.warn("[Webhook Warning] Tibo source evidence lookup failed", {
      reason: "lookup_failed",
    });
    return null;
  }
}

type TiboSourceContextRevisionSnapshot =
  | { status: "row"; revisionHashes: string[]; generation: number }
  | { status: "missing" }
  | { status: "schema_unavailable" }
  | { status: "lookup_failed" };

async function loadTiboSourceContextRevisionSnapshot(
  client: ReturnType<typeof getSupabaseServiceClient>,
  tweetId: string,
): Promise<TiboSourceContextRevisionSnapshot> {
  try {
    const { data, error } = await client
      .from("tibo_signals")
      .select("tweet_id,source_context_revision_hashes,source_context_generation")
      .eq("tweet_id", tweetId)
      .maybeSingle();
    if (error) {
      return isMissingTiboOptionalColumnError(error)
        ? { status: "schema_unavailable" }
        : { status: "lookup_failed" };
    }
    if (!data || (Array.isArray(data) && data.length === 0)) return { status: "missing" };
    const snapshot = Array.isArray(data) ? data[0] : data;
    if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
      return { status: "lookup_failed" };
    }
    if (!Number.isSafeInteger(snapshot.source_context_generation) || snapshot.source_context_generation < 0) {
      return { status: "schema_unavailable" };
    }
    return {
      status: "row",
      revisionHashes: Array.isArray(snapshot.source_context_revision_hashes)
        ? snapshot.source_context_revision_hashes.filter((value: unknown): value is string => typeof value === "string")
        : [],
      generation: snapshot.source_context_generation,
    };
  } catch {
    return { status: "lookup_failed" };
  }
}

async function fetchCanonicalTiboSourceRows(
  supabase: ReturnType<typeof getSupabaseServiceClient>,
  sourceTweetIds: readonly string[],
): Promise<ResetDisplayNameSourceRow[]> {
  const tweetIds = Array.from(new Set(
    sourceTweetIds.map((tweetId) => tweetId.trim()).filter(Boolean),
  ));
  if (tweetIds.length === 0) return [];

  try {
    const result = await supabase
      .from("tibo_signals")
      .select("tweet_id,text,tweet_created_at,is_reply,verification_status")
      .in("tweet_id", tweetIds)
      .limit(32);
    if (result.error) {
      console.warn("[Webhook Warning] Canonical Tibo naming context lookup failed", {
        reason: "lookup_failed",
      });
      return [];
    }

    return (result.data ?? []).flatMap((row) => {
      if (
        !row ||
        typeof row.tweet_id !== "string" ||
        typeof row.text !== "string"
      ) {
        return [];
      }
      return [{
        tweet_id: row.tweet_id,
        text: row.text,
        tweet_created_at: typeof row.tweet_created_at === "string"
          ? row.tweet_created_at
          : null,
        is_reply: row.is_reply === true,
        verification_status: typeof row.verification_status === "string"
          ? row.verification_status
          : null,
      }];
    });
  } catch {
    console.warn("[Webhook Warning] Canonical Tibo naming context lookup failed", {
      reason: "request_failed",
    });
    return [];
  }
}

function uniqueNonEmptyTweetIds(values: readonly string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

async function seedResetDisplayNameCandidateIfEligible(
  supabase: ReturnType<typeof getSupabaseServiceClient>,
  candidate: FormalTiboResetSignal,
  editHistoryMetadata: {
    trusted: boolean;
    logicalPostId: string;
    editHistoryTweetIds: string[];
  },
) {
  const activation = readResetDisplayNameCandidateActivation(process.env);
  if (!isResetDisplayNameCandidateOperationEnabled(activation, "seed") || !activation.adoptionAt) {
    return;
  }

  // The cutoff is anchored to the persisted signal's creation timestamp. Do
  // not substitute webhook receipt time or any resolved notice timestamp.
  if (!isResetDisplayNameCandidateNoticeAfterAdoption(candidate.tweet_created_at, activation.adoptionAt)) {
    return;
  }

  const isHistoricalOnly = (candidate.temporal_kind as unknown) === "historical" ||
    (candidate.ai_temporal_kind as unknown) === "historical";
  const isPresentationOnlyOngoingBanked = isRecurringConditionalBankedDistributionNotice(candidate.text);
  const hasFutureBankedDistribution = hasFutureBankedDistributionIntent(candidate.text);
  const isBankedDistribution = isBankedDistributionNotice(candidate.text);
  if (!isExecutionBearingResetDisplayNameNotice({
    signalType: candidate.signal_type,
    verificationStatus: candidate.verification_status,
    isReply: candidate.is_reply === true,
    isHistoricalOnly,
    isPresentationOnlyOngoingBanked,
    hasFutureBankedDistributionIntent: hasFutureBankedDistribution,
  })) {
    return;
  }

  const trustedNoticeIds = editHistoryMetadata.trusted
    ? editHistoryMetadata.editHistoryTweetIds
    : [candidate.tweet_id];
  const seed: ResetDisplayNameCandidateSeed = {
    candidateEventKind: isBankedDistribution ? "banked_distribution" : "reset_execution",
    officialNoticeTweetId: candidate.tweet_id,
    logicalPostId: editHistoryMetadata.trusted ? editHistoryMetadata.logicalPostId : null,
    noticeTweetIds: uniqueNonEmptyTweetIds([candidate.tweet_id, ...trustedNoticeIds]),
    sourceTweetIds: uniqueNonEmptyTweetIds([candidate.tweet_id, ...trustedNoticeIds]),
  };

  try {
    await upsertResetDisplayNameCandidateSeed(
      supabase as unknown as ResetDisplayNameCandidateStoreClient,
      seed,
    );
  } catch {
    // Candidate naming is auxiliary. A seed failure must never change the
    // webhook's persisted signal or formal adoption behavior.
    console.warn("[Webhook Warning] Reset display name candidate seed failed", {
      reason: "best_effort_failed",
    });
  }
}

async function handleTiboWebhookPost(
  req: NextRequest,
  internalOptions: {
    tiboEvidenceInput?: string | null;
    tiboEvidenceContext?: TiboEvidenceContext | null;
    skipTranslation?: boolean;
    sourceContextRevisionHashes?: string[];
    sourceContextGeneration?: number;
  } = {},
) {
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
      text.length > MAX_TIBO_SOURCE_TEXT_LENGTH
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
    if (internalOptions.sourceContextRevisionHashes &&
      (!Number.isSafeInteger(internalOptions.sourceContextGeneration) ||
        (internalOptions.sourceContextGeneration ?? -1) < 0)) {
      return NextResponse.json({ error: "Source context generation unavailable" }, { status: 503 });
    }

    if (body.kind === TIBO_SOURCE_CONTEXT_ENRICHMENT_KIND) {
      const enrichmentResult = parseTiboSourceContextEnrichment(body);
      if (!enrichmentResult.ok) {
        return NextResponse.json({ error: "Invalid source context enrichment" }, { status: 400 });
      }

      try {
        const supabase = getSupabaseServiceClient();
        const result = await storeTiboSourceContextEnrichment(supabase, enrichmentResult.value);
        if (result.status === "root_missing") {
          return NextResponse.json({ error: "Source root row is not available yet" }, { status: 503 });
        }
        if (result.status === "root_mismatch" || result.status === "conflict" || result.status === "revision_limit") {
          return NextResponse.json({ error: "Source context enrichment was not applied", status: result.status }, { status: 409 });
        }
        if (result.status === "applied" || result.status === "duplicate") {
          // A duplicate may be a replay after the context merge succeeded but
          // classification or its persistence failed. Consult the durable
          // completion marker instead of treating duplicate as completion.
          const storedEvidence = await loadStoredTiboEvidence(
            supabase,
            enrichmentResult.value.tweetId,
            enrichmentResult.value.text,
            enrichmentResult.value.tweetUrl,
            enrichmentResult.value.tweetCreatedAt,
          );
          const sourceContextRevisionHashes = storedEvidence?.sourceContextRevisionHashes;
          if (!storedEvidence || !Array.isArray(sourceContextRevisionHashes)
            || !Number.isSafeInteger(storedEvidence.sourceContextGeneration)
            || (storedEvidence.sourceContextGeneration ?? -1) < 0
            || sourceContextRevisionHashes.length === 0
            || sourceContextRevisionHashes.some((hash) => !/^[a-f0-9]{64}$/.test(hash))) {
            return NextResponse.json({ error: "Source context classification state unavailable" }, { status: 503 });
          }
          if (hasRetryableTiboEvidenceOmission(storedEvidence.context)) {
            console.warn("[Webhook Warning] Tibo source context dependency is not available yet", {
              reason: "retryable_dependency_omission",
            });
            return NextResponse.json({ error: "Source context dependency is not available yet" }, { status: 503 });
          }
          const classified = new Set(storedEvidence.sourceContextClassifiedRevisionHashes);
          if (sourceContextRevisionHashes.every((hash) => classified.has(hash))) {
            return NextResponse.json({ success: true, status: result.status }, { status: 200 });
          }

          const replayBody = {
            tweetId: enrichmentResult.value.tweetId,
            text: enrichmentResult.value.text,
            tweetUrl: enrichmentResult.value.tweetUrl,
            tweetCreatedAt: enrichmentResult.value.tweetCreatedAt,
            ...replyMetadata,
          };
          const replayResponse = await handleTiboWebhookPost(
            new NextRequest(req.url, {
              method: "POST",
              headers: new Headers(req.headers),
              body: JSON.stringify(replayBody),
            }),
            {
              skipTranslation: true,
              tiboEvidenceInput: storedEvidence.input,
              tiboEvidenceContext: storedEvidence.context,
              sourceContextRevisionHashes,
              sourceContextGeneration: storedEvidence.sourceContextGeneration,
            },
          );
          if (!replayResponse.ok) {
            console.warn("[Webhook Warning] Tibo source context reclassification failed", {
              reason: "reclassification_failed",
              status: replayResponse.status,
            });
            return NextResponse.json({ error: "Source context classification unavailable" }, { status: 503 });
          }
        }
        return NextResponse.json({ success: true, status: result.status }, { status: 200 });
      } catch {
        // Missing schema, schema-cache lag, and database errors stay retryable.
        console.warn("[Webhook Warning] Tibo source context storage unavailable", {
          reason: "source_context_store_unavailable",
        });
        return NextResponse.json({ error: "Source context storage unavailable" }, { status: 503 });
      }
    }

    const editHistoryMetadata = await resolveTiboPostEditHistory(tweetId);

    // 3. Existing Rule Classification
    const ruleResult = classifyTiboTweet(text, tweetUrl, replyMetadata);

    const hasEvidenceOverride = Object.prototype.hasOwnProperty.call(internalOptions, "tiboEvidenceInput");
    let tiboEvidenceInput = hasEvidenceOverride ? internalOptions.tiboEvidenceInput ?? null : null;
    let tiboEvidenceContext = hasEvidenceOverride ? internalOptions.tiboEvidenceContext ?? null : null;
    let normalSourceContextRevisionSnapshot: TiboSourceContextRevisionSnapshot | null = null;
    if (!hasEvidenceOverride && hasTiboSourceRelation(replyMetadata)) {
      try {
        const storedEvidence = await loadStoredTiboEvidence(
          getSupabaseServiceClient(),
          tweetId,
          text,
          tweetUrl,
          createdDate.toISOString(),
        );
        tiboEvidenceInput = storedEvidence?.input ?? null;
        tiboEvidenceContext = storedEvidence?.context ?? null;
        if (storedEvidence) {
          normalSourceContextRevisionSnapshot = {
            status: "row",
            revisionHashes: storedEvidence.sourceContextRevisionHashes,
            generation: storedEvidence.sourceContextGeneration!,
          };
        }
      } catch {
        // Source evidence is auxiliary. Keep the existing classification path
        // available when the canonical source-context read is unavailable.
        console.warn("[Webhook Warning] Tibo source evidence lookup unavailable", {
          reason: "lookup_failed",
        });
      }
    }
    if (!internalOptions.sourceContextRevisionHashes && !normalSourceContextRevisionSnapshot) {
      normalSourceContextRevisionSnapshot = await loadTiboSourceContextRevisionSnapshot(
        getSupabaseServiceClient(),
        tweetId,
      );
      if (normalSourceContextRevisionSnapshot.status === "lookup_failed") {
        console.warn("[Webhook Warning] Tibo source context revision lookup failed", {
          reason: "lookup_failed",
        });
        return NextResponse.json({ error: "Tibo state lookup unavailable" }, { status: 503 });
      }
    }

    // 4. Gemini Classification (Optional based on GEMINI_CLASSIFICATION_MODE)
    const mode = normalizeTiboClassificationMode(process.env.GEMINI_CLASSIFICATION_MODE);

    let aiResult = null;
    if (shouldRunGeminiClassification(mode)) {
      try {
        aiResult = await classifyTiboWithSingleTransientRetry(() => classifyWithGemini(
          {
            text,
            tweetCreatedAt,
            sourceTimeZone: TIBO_SOURCE_TIME_ZONE,
            ...replyMetadata,
            ...(tiboEvidenceInput ? { tiboEvidenceInput } : {}),
          },
          { mode },
        ));
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

    if (internalOptions.sourceContextRevisionHashes
      && (!aiResult || aiResult.status !== "success")) {
      console.warn("[Webhook Warning] Tibo source context classification did not complete", {
        reason: aiResult?.status ?? "classification_skipped",
      });
      return NextResponse.json({ error: "Source context classification did not complete" }, { status: 503 });
    }

    const selectedClassification = selectTiboClassification(mode, ruleResult, aiResult);
    if (internalOptions.sourceContextRevisionHashes
      && selectedClassification.classificationSource === "rule_fallback") {
      return NextResponse.json({ error: "Source context classification fell back to rules" }, { status: 503 });
    }
    if (internalOptions.sourceContextRevisionHashes && tiboEvidenceContext
      && hasRetryableTiboEvidenceOmission(tiboEvidenceContext)) {
      return NextResponse.json({ error: "Source context dependency is not available yet" }, { status: 503 });
    }
    const contextSafetyDecision = getTiboContextSafetyDecision({
      authorText: text,
      isReply: replyMetadata.isReply,
      isQuote: replyMetadata.isQuote,
      replyContextText: replyMetadata.replyContextText,
      replyParentTweetId: replyMetadata.replyParentTweetId,
      replyParentTweetUrl: replyMetadata.replyParentTweetUrl,
      quoteContextText: replyMetadata.quoteContextText,
      quoteAuthorHandle: replyMetadata.quoteAuthorHandle,
      quoteTweetUrl: replyMetadata.quoteTweetUrl,
      selectedSignalType: selectedClassification.signalType,
      aiTeaserStrength: aiResult?.teaserStrength,
      evidenceQuote: aiResult?.evidenceQuote,
      temporalDirection: aiResult?.temporalDirection,
      noticeTimingStatus: aiResult?.noticeTimingStatus,
      contextualResetAssessment: aiResult?.contextualResetAssessment,
      contextualResetTweetId: aiResult?.contextualResetTweetId,
      resetMeaning: aiResult?.resetMeaning,
      targetTweetId: tweetId,
      targetTweetUrl: tweetUrl,
      targetTweetCreatedAt: createdDate.toISOString(),
      validatedSourceContext: tiboEvidenceContext,
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

    const hasForwardTimingSignal =
      effectiveClassification.signalType === "official_notice" ||
      effectiveClassification.signalType === "teaser";
    const temporalSemantics = hasForwardTimingSignal
      ? parseTiboTemporalSemantics(aiResult, text)
      : null;
    const temporalResolution = hasForwardTimingSignal
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
    const rawAiAudit = aiResult?.rawAudit;

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

    const isQuote = ruleResult.isQuote || replyMetadata.isQuote === true;
    const effectiveTeaserStrength =
      effectiveClassification.signalType === "teaser"
        ? (contextSafetyDecision?.teaserStrength ??
           aiResult?.teaserStrength ??
           getEffectiveTeaserStrength({
             signal_type: effectiveClassification.signalType,
             confidence: effectiveClassification.confidence,
             text: text,
             is_reply: ruleResult.isReply,
             is_quote: isQuote,
             reply_context_text: replyMetadata.replyContextText,
             quote_context_text: replyMetadata.quoteContextText,
             ai_teaser_strength: aiResult?.teaserStrength ?? null,
           }))
        : (contextSafetyDecision?.teaserStrength ?? null);

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
      teaser_strength: effectiveTeaserStrength,
      secondary_signal: secondarySignal,
      is_reply: ruleResult.isReply,
      reply_to_handles: replyMetadata.replyToHandles ?? null,
      reply_context_text: replyMetadata.replyContextText ?? null,
      source_timeline: replyMetadata.sourceTimeline ?? null,
      is_quote: isQuote,
      quote_context_text: replyMetadata.quoteContextText ?? null,
      quote_tweet_url: replyMetadata.quoteTweetUrl ?? null,
      quote_author_handle: replyMetadata.quoteAuthorHandle ?? null,
      logical_post_id: editHistoryMetadata.logicalPostId,
      edit_history_tweet_ids: editHistoryMetadata.editHistoryTweetIds,
      edit_version: editHistoryMetadata.editVersion,
      edit_metadata_source: editHistoryMetadata.editMetadataSource,

      // Audit columns
      rule_signal_type: ruleResult.signalType,
      rule_confidence: ruleResult.confidence,
      ai_signal_type: rawAiAudit ? rawAiAudit.signalType : aiResult?.signalType ?? null,
      ai_confidence: aiResult?.confidence ?? null,
      ai_temporal_direction: rawAiAudit ? rawAiAudit.temporalDirection : aiResult?.temporalDirection || null,
      ai_notice_timing_status: aiResult?.noticeTimingStatus ?? null,
      ai_evidence_quote: aiResult?.evidenceQuote || null,
      ai_reason_ja: rawAiAudit ? rawAiAudit.reasonJa : aiResult?.reasonJa || null,
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
      codex_operational_status: aiResult?.codexOperationalStatus ?? null,
      codex_operational_confidence: aiResult?.codexOperationalConfidence ?? null,
      codex_operational_evidence_quote: aiResult?.codexOperationalEvidenceQuote ?? null,
      codex_operational_reason_ja: aiResult?.codexOperationalReasonJa ?? null,
      codex_operational_expires_at: getCodexOperationalExpiryAt(
        aiResult?.codexOperationalStatus ?? null,
        createdDate.toISOString(),
      ),
      classification_source: selectedClassification.classificationSource,
    };

    const translationResult = internalOptions.skipTranslation
      ? null
      : await translateWithGeminiWithRetry({
          text: text.trim(),
          tweetCreatedAt: createdDate.toISOString(),
        });
    if (
      translationResult &&
      translationResult.status !== "success" &&
      translationResult.status !== "skipped" &&
      translationResult.status !== "model_not_configured"
    ) {
      console.warn("[Webhook Warning] Tibo translation unavailable", {
        reason: translationResult.status,
      });
    }

    // 7. Load existing state before the upsert. State lookup is fail-closed
    // so an unknown existing state can never be overwritten.
    // Query runs after async translation so the snapshot is as fresh as possible.
    const supabase = getSupabaseServiceClient();
    let existingSignal: (Partial<FormalTiboResetSignal> & {
      source_context_revision_hashes?: string[] | null;
      source_context_classified_revision_hashes?: string[] | null;
    }) | null = null;
    try {
      const { data, error: lookupError } = await supabase
        .from("tibo_signals")
        .select("tweet_id,text,tweet_url,tweet_created_at,detected_at,expires_at,signal_type,confidence,classification_reason,verification_status,classification_source,rule_signal_type,rule_confidence,ai_signal_type,ai_confidence,ai_classification_status,ai_temporal_direction,ai_notice_timing_status,ai_evidence_quote,teaser_strength,secondary_signal,is_reply,reply_to_handles,reply_context_text,source_timeline,translated_text_ja,translated_text_zh,ai_teaser_strength,ai_teaser_strength_confidence,ai_teaser_strength_evidence_quote,ai_teaser_strength_reason_ja,logical_post_id,edit_history_tweet_ids,edit_version,edit_metadata_source,codex_operational_status,codex_operational_confidence,codex_operational_evidence_quote,codex_operational_reason_ja,codex_operational_expires_at,temporal_expression,temporal_kind,temporal_precision,temporal_timezone,temporal_confidence,temporal_resolution_source,expected_start_at,expected_end_at,temporal_resolution_status,temporal_resolution_version,is_quote,quote_context_text,quote_tweet_url,quote_author_handle,source_context_revision_hashes,source_context_classified_revision_hashes,source_context_generation,formal_reply_admission_proof")
        .eq("tweet_id", tweetId)
        .maybeSingle();

      if (lookupError) {
        // Optional Tibo schema migrations or schema-cache propagation may lag
        // application deployment. Keep the existing state lookup usable during
        // that window, while all real lookup failures remain fail-closed.
        if (isMissingTiboOptionalColumnError(lookupError)) {
          const revisionAwareLegacyLookup = await supabase
            .from("tibo_signals")
            .select("tweet_id,text,tweet_url,tweet_created_at,detected_at,signal_type,confidence,classification_reason,verification_status,classification_source,rule_signal_type,rule_confidence,ai_signal_type,ai_confidence,ai_classification_status,ai_temporal_direction,ai_notice_timing_status,ai_evidence_quote,is_reply,reply_to_handles,reply_context_text,source_timeline,source_context_revision_hashes,source_context_classified_revision_hashes,source_context_generation")
            .eq("tweet_id", tweetId)
            .maybeSingle();
          const legacyLookup = revisionAwareLegacyLookup.error &&
              isMissingTiboOptionalColumnError(revisionAwareLegacyLookup.error)
            ? await supabase
                .from("tibo_signals")
                .select("tweet_id,text,tweet_url,tweet_created_at,detected_at,signal_type,confidence,classification_reason,verification_status,classification_source,is_reply,reply_to_handles,reply_context_text,source_timeline")
                .eq("tweet_id", tweetId)
                .maybeSingle()
            : revisionAwareLegacyLookup;
          if (legacyLookup.error) {
            console.warn("[Webhook Warning] Existing Tibo state lookup failed", {
              reason: "lookup_failed",
            });
            return NextResponse.json(
              { error: "Tibo state lookup unavailable" },
              { status: 503 },
            );
          }
          existingSignal = (Array.isArray(legacyLookup.data) && legacyLookup.data.length === 0
            ? null
            : legacyLookup.data) as (Partial<FormalTiboResetSignal> & {
              source_context_revision_hashes?: string[] | null;
              source_context_classified_revision_hashes?: string[] | null;
            }) | null;
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
        existingSignal = (Array.isArray(data) && data.length === 0
          ? null
          : data) as (Partial<FormalTiboResetSignal> & {
            source_context_revision_hashes?: string[] | null;
            source_context_classified_revision_hashes?: string[] | null;
          }) | null;
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

    const incomingEditIdentity = toTiboEditIdentityFields(editHistoryMetadata);
    const editIdentityMerge = mergeTiboEditIdentity(
      existingSignal,
      incomingEditIdentity,
      tweetId,
    );
    let editIdentityForPayload = editIdentityMerge.identity;
    let editIdentityFlowBlocked = editIdentityMerge.status === "conflict";

    if (editHistoryMetadata.trusted) {
      const reconciliation = await reconcileTiboEditChainMetadata(
        supabase as unknown as TiboEditIdentityStore,
        tweetId,
        incomingEditIdentity,
      );
      if (reconciliation.status === "conflict") {
        editIdentityFlowBlocked = true;
        console.warn("[Tibo Warning] Conflicting edit-chain metadata; incoming identity was not applied", {
          reason: "identity_conflict",
        });
        editIdentityForPayload = getTrustedTiboEditIdentity(existingSignal, tweetId) ??
          (existingSignal?.edit_metadata_source === "x_api"
            ? editIdentityMerge.identity
            : createUntrustedTiboEditIdentity(tweetId));
      } else if (
        reconciliation.status === "reconciled" ||
        reconciliation.status === "unchanged"
      ) {
        editIdentityForPayload = reconciliation.identity;
      } else if (reconciliation.status === "error") {
        editIdentityFlowBlocked = true;
        console.warn("[Tibo Warning] Edit-chain metadata reconciliation unavailable", {
          reason: "identity_lookup_failed",
        });
      }
    }

    const existingTranslationJa = normalizeStoredTranslation(existingSignal?.translated_text_ja, text, "ja");
    const existingTranslationZh = normalizeStoredTranslation(existingSignal?.translated_text_zh, text, "zh");

    const formalReplySourceContextRevisionHashes = internalOptions.sourceContextRevisionHashes ??
      (normalSourceContextRevisionSnapshot?.status === "row"
        ? normalSourceContextRevisionSnapshot.revisionHashes
        : null);
    const formalReplySourceContextGeneration = internalOptions.sourceContextGeneration ??
      (normalSourceContextRevisionSnapshot?.status === "row"
        ? normalSourceContextRevisionSnapshot.generation
        : Number.isSafeInteger(existingSignal?.source_context_generation)
          ? existingSignal?.source_context_generation ?? 0
          : 0);
    const formalReplySourceContextIsCurrentAndClassified = Boolean(
      formalReplySourceContextRevisionHashes?.length &&
      tiboEvidenceContext?.status === "complete" &&
      tiboEvidenceContext.omissions.length === 0 &&
      (internalOptions.sourceContextRevisionHashes || (
        Array.isArray(existingSignal?.source_context_revision_hashes) &&
        existingSignal.source_context_revision_hashes.length === formalReplySourceContextRevisionHashes.length &&
        existingSignal.source_context_revision_hashes.every((hash, index) =>
          hash === formalReplySourceContextRevisionHashes[index],
        ) &&
        formalReplySourceContextRevisionHashes.every((hash) =>
          existingSignal?.source_context_classified_revision_hashes?.includes(hash),
        )
      ))
    );
    const canCreateFormalReplyProof = Boolean(
      formalReplySourceContextIsCurrentAndClassified &&
      !editIdentityFlowBlocked &&
      existingSignal?.classification_source !== "manual" &&
      existingSignal?.verification_status !== "confirmed" &&
      existingSignal?.verification_status !== "rejected" &&
      replyMetadata.isReply === true &&
      replyMetadata.isQuote !== true &&
      selectedClassification.classificationSource === "gemini" &&
      selectedClassification.signalType === "reset_executed" &&
      selectedClassification.confidence >= 0.95 &&
      aiResult?.status === "success" &&
      aiResult.signalType === "reset_executed" &&
      contextSafetyDecision === null
    );
    const formalReplyAdmissionProof = canCreateFormalReplyProof && aiResult
      ? createTiboFormalReplyAdmissionProof({
          authorText: text,
          isReply: replyMetadata.isReply,
          isQuote: replyMetadata.isQuote,
          replyContextText: replyMetadata.replyContextText,
          replyParentTweetId: replyMetadata.replyParentTweetId,
          replyParentTweetUrl: replyMetadata.replyParentTweetUrl,
          quoteContextText: replyMetadata.quoteContextText,
          quoteAuthorHandle: replyMetadata.quoteAuthorHandle,
          quoteTweetUrl: replyMetadata.quoteTweetUrl,
          selectedSignalType: selectedClassification.signalType,
          aiTeaserStrength: aiResult.teaserStrength,
          evidenceQuote: aiResult.evidenceQuote,
          temporalDirection: aiResult.temporalDirection,
          contextualResetAssessment: aiResult.contextualResetAssessment,
          contextualResetTweetId: aiResult.contextualResetTweetId,
          resetMeaning: aiResult.resetMeaning,
          targetTweetId: tweetId,
          targetTweetUrl: tweetUrl,
          targetTweetCreatedAt: createdDate.toISOString(),
          validatedSourceContext: tiboEvidenceContext,
        }, formalReplySourceContextRevisionHashes ?? [], formalReplySourceContextGeneration)
      : null;

    const locallyClassifiedContextRevisions = formalReplyAdmissionProof
      ? Array.from(new Set([
          ...(existingSignal?.source_context_classified_revision_hashes ?? []),
          ...(internalOptions.sourceContextRevisionHashes ?? []),
        ]))
      : null;

    const payloadWithTranslations = {
      ...payload,
      ...editIdentityForPayload,
      formal_reply_admission_proof: formalReplyAdmissionProof,
      source_context_generation: formalReplySourceContextGeneration,
      ...(internalOptions.sourceContextRevisionHashes
        ? {
            source_context_revision_hashes: internalOptions.sourceContextRevisionHashes,
            ...(locallyClassifiedContextRevisions
              ? { source_context_classified_revision_hashes: locallyClassifiedContextRevisions }
              : {}),
          }
        : {}),
      translated_text_ja: existingTranslationJa ?? translationResult?.textJa ?? null,
      translated_text_zh: existingTranslationZh ?? translationResult?.textZh ?? null,
    };
    let persistedPayload = preserveTiboWebhookState(
      payloadWithTranslations,
      existingSignal,
      receivedAt,
    );

    const initialFormalCandidate = toFormalTiboResetSignal(persistedPayload);
    if (!initialFormalCandidate) {
      return NextResponse.json({ error: "Invalid Tibo classification payload" }, { status: 500 });
    }
    let formalCandidate = initialFormalCandidate;
    let preflightRecoveryLookup: Awaited<ReturnType<typeof findNearestCodexRecoveryObservation>> | null = null;

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
          preflightRecoveryLookup = recoveryLookup;
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
              formal_reply_admission_proof: null,
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

    // 8. Persist classification. Context reclassification is conditional on
    // the source revision set still matching the evidence snapshot used by
    // Gemini. The filter and update run atomically in Postgres, so a newer
    // enrichment cannot be overwritten by an older model response.
    const normalExpectedRevisions = !internalOptions.sourceContextRevisionHashes &&
      normalSourceContextRevisionSnapshot?.status === "row"
      ? normalSourceContextRevisionSnapshot.revisionHashes
      : null;
    const normalExpectedGeneration = !internalOptions.sourceContextRevisionHashes &&
      normalSourceContextRevisionSnapshot?.status === "row"
      ? normalSourceContextRevisionSnapshot.generation
      : null;
    if (!internalOptions.sourceContextRevisionHashes &&
      normalSourceContextRevisionSnapshot?.status === "missing" && existingSignal) {
      console.warn("[Webhook Warning] Tibo signal appeared during classification", {
        reason: "initial_insert_race",
      });
      return NextResponse.json({ error: "Tibo signal changed during classification" }, { status: 503 });
    }
    const writeNormalSignal = (value: typeof persistedPayload) => {
      if (normalExpectedRevisions !== null) {
        return supabase
          .from("tibo_signals")
          .update(value)
          .eq("tweet_id", tweetId)
          .eq("source_context_revision_hashes", `{${normalExpectedRevisions.join(",")}}`)
          .eq("source_context_generation", normalExpectedGeneration)
          .select("tweet_id");
      }
      return normalSourceContextRevisionSnapshot?.status === "missing"
        ? supabase.from("tibo_signals").insert(value)
        : supabase.from("tibo_signals").upsert(value, { onConflict: "tweet_id" });
    };
    const persistedDatabasePayload = { ...persistedPayload };
    if (internalOptions.sourceContextRevisionHashes) {
      // Mark this revision classified only after formal side effects have
      // completed. The in-memory candidate can use the successful CAS result,
      // while readers still fail closed until the durable marker is written.
      delete persistedDatabasePayload.source_context_classified_revision_hashes;
    }
    let persistenceResult: { error: unknown; data?: unknown } = { error: null };
    if (internalOptions.sourceContextRevisionHashes) {
      const expectedRevisions = `{${internalOptions.sourceContextRevisionHashes.join(",")}}`;
      const contextUpdateResult = await supabase
        .from("tibo_signals")
        .update(persistedDatabasePayload)
        .eq("tweet_id", tweetId)
        .eq("source_context_revision_hashes", expectedRevisions)
        .eq("source_context_generation", internalOptions.sourceContextGeneration)
        .select("tweet_id");
      if (contextUpdateResult.error) {
        console.warn("[Webhook Warning] Tibo source context classification save failed", {
          reason: "conditional_save_failed",
        });
        return NextResponse.json({ error: "Source context classification save unavailable" }, { status: 503 });
      }
      if (!Array.isArray(contextUpdateResult.data) || contextUpdateResult.data.length !== 1) {
        console.warn("[Webhook Warning] Tibo source context changed during classification", {
          reason: "revision_set_changed",
        });
        return NextResponse.json({ error: "Source context changed during classification" }, { status: 503 });
      }
      persistenceResult = contextUpdateResult;
    } else {
      persistenceResult = await writeNormalSignal(persistedDatabasePayload);
    }

    if (!internalOptions.sourceContextRevisionHashes
      && persistenceResult.error && isMissingTiboOptionalColumnError(persistenceResult.error)) {
      const {
        translated_text_ja: _translatedTextJa,
        translated_text_zh: _translatedTextZh,
        teaser_strength: _teaserStrength,
        ai_teaser_strength: _aiTeaserStrength,
        ai_teaser_strength_confidence: _aiTeaserStrengthConfidence,
        ai_teaser_strength_evidence_quote: _aiTeaserStrengthEvidenceQuote,
        ai_teaser_strength_reason_ja: _aiTeaserStrengthReasonJa,
        ai_temporal_expression: _aiTemporalExpression,
        ai_notice_timing_status: _aiNoticeTimingStatus,
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
        codex_operational_status: _codexOperationalStatus,
        codex_operational_confidence: _codexOperationalConfidence,
        codex_operational_evidence_quote: _codexOperationalEvidenceQuote,
        codex_operational_reason_ja: _codexOperationalReasonJa,
        codex_operational_expires_at: _codexOperationalExpiresAt,
        formal_reply_admission_proof: _formalReplyAdmissionProof,
        source_context_generation: _sourceContextGeneration,
        quote_context_text: _quoteContextText,
        quote_tweet_url: _quoteTweetUrl,
        quote_author_handle: _quoteAuthorHandle,
        logical_post_id: _logicalPostId,
        edit_history_tweet_ids: _editHistoryTweetIds,
        edit_version: _editVersion,
        edit_metadata_source: _editMetadataSource,
        secondary_signal: _secondarySignal,
        ...legacyPayload
      } = persistedPayload;
      persistenceResult = await writeNormalSignal(legacyPayload as typeof persistedPayload);
    }

    if (persistenceResult.error) {
      if (!internalOptions.sourceContextRevisionHashes
        && normalSourceContextRevisionSnapshot?.status === "missing"
        && (persistenceResult.error as { code?: unknown })?.code === "23505") {
        return NextResponse.json({ error: "Tibo signal changed during classification" }, { status: 503 });
      }
      console.error("[Webhook Error] Tibo signal save failed", {
        reason: "database_error",
      });
      return NextResponse.json({ error: "Database error" }, { status: 500 });
    }

    const savedNormalRows = persistenceResult.data;
    if (!internalOptions.sourceContextRevisionHashes && normalExpectedRevisions !== null
      && (!Array.isArray(savedNormalRows) || savedNormalRows.length !== 1)) {
      console.warn("[Webhook Warning] Tibo source context changed during normal classification", {
        reason: "revision_set_changed",
      });
      return NextResponse.json({ error: "Source context changed during classification" }, { status: 503 });
    }

    // Make the durable source row visible even when a later best-effort formal
    // enrichment has to return a retryable error.
    try {
      await invalidateRadarCache("tibo");
    } catch {
      console.warn("[Webhook Warning] Tibo cache revalidation skipped", {
        reason: "runtime_context",
      });
    }

    await seedResetDisplayNameCandidateIfEligible(
      supabase,
      formalCandidate,
      editHistoryMetadata,
    );

    const isBankedCompletion = isBankedDistributionCompletionSignal(formalCandidate.text);
    const shouldResolveFormalFlow = !isBankedCompletion && (
      isFormalTiboResetSignal(formalCandidate) ||
      editHistoryMetadata.trusted ||
      existingSignal?.signal_type === "reset_executed"
    );
    let logicalPost: TiboLogicalPost<TiboLogicalPostRow> | null = null;
    let effectiveFormalCandidate: FormalTiboResetSignal | null = null;
    let adoptionResolution: TiboResetEventIdentityResolution | null = null;
    let adoptionClaim: TiboFormalAdoptionClaimResult | null = null;
    let matchedLedger: TiboFormalAdoptionRecord | null = null;
    let formalFlowError: unknown = null;
    let formalFlowRecoveryLookup = preflightRecoveryLookup;
    let formalFlowCluster: Awaited<ReturnType<typeof findFormalTiboResetCluster>> | null = null;
    let formalFlowSourceTweetIds: string[] = [];
    let formalEnrichmentFailed = false;

    if (shouldResolveFormalFlow && !editIdentityFlowBlocked) {
      const incomingRow = toLogicalPostRow(persistedPayload);
      if (!incomingRow) {
        formalFlowError = new Error("Invalid persisted Tibo signal row");
      } else {
        let existingChainRows: TiboLogicalPostRow[] = [];
        const flowIdentity = getTrustedTiboEditIdentity(
          editIdentityForPayload,
          tweetId,
        );
        if (editIdentityForPayload.edit_metadata_source === "x_api" && !flowIdentity) {
          formalFlowError = new Error("Trusted Tibo edit identity is invalid");
        } else if (flowIdentity) {
          try {
            const chainResult = await supabase
              .from("tibo_signals")
              .select("*")
              .in("tweet_id", flowIdentity.edit_history_tweet_ids);
            if (chainResult.error) {
              formalFlowError = chainResult.error;
            } else {
              existingChainRows = (chainResult.data ?? [])
                .map(toLogicalPostRow)
                .filter((row): row is TiboLogicalPostRow => Boolean(row));
            }
          } catch (error) {
            formalFlowError = error;
          }
        }

        if (!formalFlowError) {
          const rawRows = [
            incomingRow,
            ...existingChainRows.filter((row) => row.tweet_id !== incomingRow.tweet_id),
          ];
          const collapsed = collapseTrustedTiboEditChains(rawRows);
          if (collapsed.conflicts.length > 0) {
            console.warn("[Tibo Warning] Logical edit-chain conflict; formal side effects skipped", {
              reason: "identity_conflict",
            });
          } else {
            logicalPost = collapsed.posts.find((post) =>
              post.rawVersions.some((row) => row.tweet_id === incomingRow.tweet_id),
            ) ?? null;
            if (!logicalPost) {
              formalFlowError = new Error("Tibo logical post could not be resolved");
            } else {
              effectiveFormalCandidate = getFormalCandidateForDisplay(logicalPost);
              const hasFormalVersionInPost = hasFormalRawVersion(logicalPost);
              const existingDynamicRows = existingChainRows.filter((row) =>
                row.tweet_id !== incomingRow.tweet_id && row.signal_type === "reset_executed",
              );
              const dynamicEvents = getDynamicHistoryEvidence(existingDynamicRows);

              const existingSameTweet = toLogicalPostRow({
                ...createUntrustedTiboEditIdentity(tweetId),
                ...(existingSignal ?? {}),
                tweet_id: existingSignal?.tweet_id ?? tweetId,
                text: existingSignal?.text ?? "",
                tweet_url: existingSignal?.tweet_url ?? tweetUrl,
                tweet_created_at: existingSignal?.tweet_created_at ?? createdDate.toISOString(),
                signal_type: existingSignal?.signal_type ?? "irrelevant",
                confidence: existingSignal?.confidence ?? null,
                classification_reason: existingSignal?.classification_reason ?? null,
                classification_source: existingSignal?.classification_source ?? null,
                verification_status: existingSignal?.verification_status ?? "auto_unverified",
              });
              if (existingSameTweet?.signal_type === "reset_executed") {
                dynamicEvents.push(...getDynamicHistoryEvidence([existingSameTweet]));
              }

              // Preserve the legacy five-minute suppression only for self
              // identities. Trusted X edit identities use the authoritative
              // chain instead of time or text as identity evidence.
              if (
                !logicalPost.authoritative &&
                effectiveFormalCandidate &&
                isFormalTiboResetSignal(effectiveFormalCandidate)
              ) {
                const createdTime = Date.parse(effectiveFormalCandidate.tweet_created_at);
                if (Number.isFinite(createdTime)) {
                  try {
                    const nearbyResult = await supabase
                      .from("tibo_signals")
                      .select("tweet_id,text,tweet_url,tweet_created_at,signal_type,confidence,verification_status,classification_source,rule_signal_type,rule_confidence,ai_signal_type,ai_confidence,ai_classification_status,ai_temporal_direction,ai_evidence_quote,is_reply,is_quote,source_context_revision_hashes,source_context_classified_revision_hashes,source_context_generation,formal_reply_admission_proof")
                      .eq("signal_type", "reset_executed")
                      .neq("tweet_id", tweetId)
                      .gte("tweet_created_at", new Date(createdTime - 5 * 60 * 1000).toISOString())
                      .lte("tweet_created_at", new Date(createdTime + 5 * 60 * 1000).toISOString())
                      .limit(20);
                    if (!nearbyResult.error && hasExistingFormalResetCluster(
                      effectiveFormalCandidate,
                      (nearbyResult.data ?? []).map((row) =>
                        attachTiboFormalReplyAdmissionProof(row as Record<string, unknown>) as FormalTiboResetSignal,
                      ),
                    )) {
                      dynamicEvents.push({
                        eventKey: `tibo-reset-${tweetId}`,
                        sourceTweetIds: [tweetId],
                        sourceUrl: tweetUrl,
                        eventKind: "forced_reset",
                      });
                    }
                  } catch {
                    console.warn("[Tibo Warning] Legacy formal cluster lookup unavailable", {
                      reason: "lookup_failed",
                    });
                  }
                }
              }

              const flowTweetCreatedAt = effectiveFormalCandidate?.tweet_created_at ??
                logicalPost.effectiveContent?.tweet_created_at ??
                formalCandidate.tweet_created_at;
              if (hasFormalVersionInPost || (
                effectiveFormalCandidate &&
                isFormalTiboResetSignal(effectiveFormalCandidate)
              )) {
                if (!formalFlowRecoveryLookup) {
                  formalFlowRecoveryLookup = await findNearestCodexRecoveryObservation(
                    supabase,
                    flowTweetCreatedAt,
                    USAGE_TIBO_MATCH_WINDOW_MS,
                  );
                }
                if (formalFlowRecoveryLookup.error) {
                  formalFlowError = formalFlowRecoveryLookup.error;
                }
              }

              if (!formalFlowError && (hasFormalVersionInPost || effectiveFormalCandidate)) {
                const [ledgerResult, estimateResult] = await Promise.all([
                  readTiboFormalAdoptions(supabase),
                  readResetExecutionEstimates(supabase),
                ]);
                if (ledgerResult.error) {
                  formalFlowError = ledgerResult.error;
                } else if (estimateResult.error) {
                  formalFlowError = estimateResult.error;
                } else {
                  const evidence = {
                    recoveryObservationId: formalFlowRecoveryLookup?.observation?.id ?? null,
                    adoptionLedgers: ledgerResult.ledgers,
                    estimates: estimateResult.rows.map((estimate) => ({
                      resetEventKey: estimate.resetEventKey,
                      recoveryObservationId: estimate.recoveryObservationId ?? null,
                      tiboSourceTweetIds: estimate.tiboSourceTweetIds,
                      executionTimeSource: estimate.executionTimeSource,
                      estimatorVersion: estimate.estimatorVersion,
                      displayExecutionAt: estimate.displayExecutionAt,
                      officialNoticeTweetId: estimate.officialNoticeTweetId ?? null,
                    })),
                    staticHistory: getStaticHistoryEvidence(),
                    dynamicEvents,
                    sourceTweetIds: [
                      ...logicalPost.sourceTweetIds,
                      ...(effectiveFormalCandidate
                        ? getCurrentTiboFormalReplyAdmissionProof(effectiveFormalCandidate)?.pathTweetIds ?? []
                        : []),
                    ],
                    verifiedContextTweetIds: effectiveFormalCandidate
                      ? getCurrentTiboFormalReplyAdmissionProof(effectiveFormalCandidate)?.pathTweetIds ?? []
                      : [],
                    verifiedContextResetTweetId: effectiveFormalCandidate
                      ? getCurrentTiboFormalReplyAdmissionProof(effectiveFormalCandidate)?.contextualResetTweetId ?? null
                      : null,
                    candidateCreatedAt: flowTweetCreatedAt,
                  };
                  adoptionResolution = resolveTiboResetEventIdentity(logicalPost, evidence);
                  matchedLedger = adoptionResolution.resetEventKey
                    ? ledgerResult.ledgers.find((ledger) =>
                      ledger.resetEventKey === adoptionResolution!.resetEventKey,
                    ) ?? null
                    : null;

                  if (adoptionResolution.reason === "ambiguous_existing_claims") {
                    console.info("[Tibo Webhook] Formal adoption held pending resolution of ambiguous existing execution estimate", {
                      logicalPostId: logicalPost.logicalPostId,
                      flowTweetCreatedAt,
                    });
                  }

                  const effectiveIsFormal = Boolean(
                    effectiveFormalCandidate &&
                    isFormalTiboResetSignal(effectiveFormalCandidate),
                  );
                  const resolvedResetEventKey = adoptionResolution.resetEventKey;
                  const shouldReconcileExisting = adoptionResolution.status === "existing" &&
                    adoptionResolution.matchedEvidence !== null &&
                    adoptionResolution.matchedEvidence.kind !== "verified_context" &&
                    hasFormalVersionInPost &&
                    logicalPost.manualState.kind !== "conflict";
                  const shouldClaim = !editIdentityMerge.status.includes("conflict") &&
                    resolvedResetEventKey !== null &&
                    (
                      (adoptionResolution.status === "new" && effectiveIsFormal) ||
                      shouldReconcileExisting
                    );

                  if (shouldClaim && resolvedResetEventKey) {
                    const matchedEstimate = estimateResult.rows.find((estimate) =>
                      estimate.resetEventKey === resolvedResetEventKey,
                    );
                    const matchedStaticHistory = getStaticHistoryEvidence().filter((item) =>
                      item.eventKey === resolvedResetEventKey,
                    );
                    const matchedDynamicEvents = dynamicEvents.filter((item) =>
                      item.eventKey === resolvedResetEventKey,
                    );
                    formalFlowSourceTweetIds = Array.from(new Set([
                      ...adoptionResolution.sourceTweetIds,
                      ...(matchedLedger?.sourceTweetIds ?? []),
                      ...(matchedEstimate?.tiboSourceTweetIds ?? []),
                      ...matchedStaticHistory.flatMap((item) => item.sourceTweetIds),
                      ...matchedDynamicEvents.flatMap((item) => item.sourceTweetIds ?? []),
                    ]));
                    const resolvedClassification = logicalPost.effectiveClassification.status === "resolved"
                      ? logicalPost.effectiveClassification
                      : null;
                    const representativeTweetId = matchedLedger?.representativeTweetId ??
                      matchedEstimate?.tiboPrimaryTweetId ??
                      matchedStaticHistory.flatMap((item) => item.sourceTweetIds)[0] ??
                      matchedDynamicEvents.flatMap((item) => item.sourceTweetIds ?? [])[0] ??
                      resolvedClassification?.representativeTweetId ??
                      logicalPost.effectiveContent?.tweet_id ??
                      tweetId;
                    adoptionClaim = await claimTiboFormalAdoption(supabase, {
                      logicalPostId: adoptionResolution.logicalPostId,
                      logicalPostTweetIds: adoptionResolution.logicalPostTweetIds,
                      resetEventKey: resolvedResetEventKey,
                      representativeTweetId,
                      sourceTweetIds: formalFlowSourceTweetIds,
                      claimSource: getClaimSource(adoptionResolution, matchedLedger),
                      identitySource: adoptionResolution.authoritative ? "x_api" : "none",
                      adoptedAt: getClaimSource(adoptionResolution, matchedLedger) === "new_adoption"
                        ? receivedAt
                        : null,
                      claimedAt: receivedAt,
                    });
                    if (adoptionClaim.status === "error") {
                      formalFlowError = adoptionClaim.error ?? new Error("Formal adoption claim failed");
                    }
                  }
                }
              }
            }
          }
        }
      }
    }

    const formalCandidateForResponse = effectiveFormalCandidate ?? formalCandidate;
    const canEnrichFormalEvent = Boolean(
      adoptionClaim &&
      FORMAL_FLOW_STATUSES.has(adoptionClaim.status) &&
      adoptionResolution?.canRunFormalEnrichments &&
      effectiveFormalCandidate &&
      isFormalTiboResetSignal(effectiveFormalCandidate),
    );

    if (canEnrichFormalEvent && effectiveFormalCandidate && adoptionResolution?.resetEventKey) {
      try {
        const recoveryMatch = await confirmNearestCodexRecoveryObservation(
          supabase,
          effectiveFormalCandidate.tweet_id,
          effectiveFormalCandidate.tweet_created_at,
          USAGE_TIBO_MATCH_WINDOW_MS,
          receivedAt,
          logicalPost?.sourceTweetIds ?? [effectiveFormalCandidate.tweet_id],
        );
        if (recoveryMatch.error) {
          formalEnrichmentFailed = true;
          console.warn("[Tibo Warning] Codex recovery reconciliation unavailable", {
            reason: "lookup_failed",
          });
        } else if (recoveryMatch.observation) {
          const formalVersion = logicalPost?.rawVersions.find((row) =>
            row.tweet_id === effectiveFormalCandidate.tweet_id,
          );
          const trustedEditIdentity = formalVersion
            ? getTrustedTiboEditIdentity(formalVersion, effectiveFormalCandidate.tweet_id)
            : null;
          formalFlowCluster = await findFormalTiboResetCluster(
            supabase,
            effectiveFormalCandidate.tweet_id,
            effectiveFormalCandidate.tweet_created_at,
            undefined,
            {
              tweet_id: effectiveFormalCandidate.tweet_id,
              tweet_created_at: effectiveFormalCandidate.tweet_created_at,
              confidence: effectiveFormalCandidate.confidence ?? 0,
            },
            trustedEditIdentity,
          );
          if (formalFlowCluster.error) {
            formalEnrichmentFailed = true;
          } else {
            const enrichedSourceTweetIds = Array.from(new Set([
              ...adoptionResolution.logicalPostTweetIds,
              ...formalFlowCluster.sourceTweetIds,
            ]));
            const sourceProvenanceChanged =
              enrichedSourceTweetIds.length !== formalFlowSourceTweetIds.length ||
              enrichedSourceTweetIds.some((sourceId) => !formalFlowSourceTweetIds.includes(sourceId));
            if (
              sourceProvenanceChanged &&
              adoptionClaim?.record &&
              adoptionResolution.resetEventKey
            ) {
              const provenanceClaim = await claimTiboFormalAdoption(supabase, {
                logicalPostId: adoptionResolution.logicalPostId,
                logicalPostTweetIds: adoptionResolution.logicalPostTweetIds,
                resetEventKey: adoptionResolution.resetEventKey,
                representativeTweetId: adoptionClaim.record.representativeTweetId,
                sourceTweetIds: enrichedSourceTweetIds,
                claimSource: adoptionClaim.record.claimSource,
                identitySource: adoptionResolution.authoritative ? "x_api" : "none",
                adoptedAt: null,
                claimedAt: receivedAt,
              });
              if (provenanceClaim.status === "error" || provenanceClaim.status === "conflict") {
                formalEnrichmentFailed = true;
                console.warn("[Tibo Warning] Formal adoption provenance reconciliation unavailable", {
                  reason: provenanceClaim.status,
                });
              } else {
                formalFlowSourceTweetIds = enrichedSourceTweetIds;
              }
            }

            if (!formalEnrichmentFailed) {
              formalFlowSourceTweetIds = enrichedSourceTweetIds;
              const isExecutionAnnouncement = isCurrentUsageResetAnnouncement(effectiveFormalCandidate.text);
              const estimateResult = await upsertResetExecutionEstimate(supabase, {
                resetEventKey: adoptionResolution.resetEventKey,
                tiboProvenanceResolved: true,
                tiboAnnouncedAt: isExecutionAnnouncement
                  ? effectiveFormalCandidate.tweet_created_at
                  : formalFlowCluster.announcedAt ?? effectiveFormalCandidate.tweet_created_at,
                tiboPrimaryTweetId: effectiveFormalCandidate.tweet_id,
                tiboSourceTweetIds: enrichedSourceTweetIds,
                usageObservation: recoveryMatch.observation,
                officialNoticeTweetId: isExecutionAnnouncement
                  ? effectiveFormalCandidate.tweet_id
                  : formalFlowCluster.representativeNoticeId,
                officialNoticeAt: isExecutionAnnouncement
                  ? effectiveFormalCandidate.tweet_created_at
                  : formalFlowCluster.representativeNoticeAt,
              });
              if (estimateResult.error) {
                formalEnrichmentFailed = true;
                console.warn("[Tibo Warning] Reset execution estimate write failed", {
                  reason: "database_error",
                });
              }
            }
          }
        }

        if (!formalEnrichmentFailed) {
          try {
            const displayNameSourceTweetIds = Array.from(new Set([
              ...(adoptionResolution?.logicalPostTweetIds ?? []),
              ...(formalFlowCluster?.sourceTweetIds ?? []),
            ]));
            const canonicalSourceRows = await fetchCanonicalTiboSourceRows(
              supabase,
              displayNameSourceTweetIds,
            );
            const sourcePostText = buildResetDisplayNameSourceContext({
              effectiveFormalCandidate,
              sourceTweetIds: displayNameSourceTweetIds,
              sourceRows: canonicalSourceRows,
            });
            const displayNameItem = {
              ...convertTiboResetSignalToHistoryEvent(effectiveFormalCandidate),
              id: adoptionResolution.resetEventKey,
              source_url: effectiveFormalCandidate.tweet_url,
              sourceTweetIds: displayNameSourceTweetIds,
            };
            const displayNameResult = await ensureResetDisplayNameForEvent(
              displayNameItem,
              {
                canonicalEventKey: adoptionResolution.resetEventKey,
                sourcePostText,
                sourceTweetId: effectiveFormalCandidate.tweet_id,
                apiKey: process.env.GEMINI_API_KEY?.trim() || null,
                model: RANDOM_RESET_NAME_MODEL,
                timeoutMs: 8_000,
              },
            );
            // Display-name generation remains best-effort. The raw signal and
            // formal ledger are already durable, so a naming-model failure must
            // not turn an otherwise successful webhook into a retry storm.
            if (displayNameResult.status === "api_error") {
              console.warn("[Webhook Warning] Reset display-name generation skipped", {
                reason: "best_effort_failed",
              });
            }

            const eventMetadataResult = await ensureResetEventMetadataForEvent(
              displayNameItem,
              {
                canonicalEventKey: adoptionResolution.resetEventKey,
                sourcePostText,
                sourceTweetId: effectiveFormalCandidate.tweet_id,
                apiKey: process.env.GEMINI_API_KEY?.trim() || null,
                model: RANDOM_RESET_NAME_MODEL,
                timeoutMs: 8_000,
              },
            );
            if (["api_error", "read_error", "write_error", "generation_error"].includes(eventMetadataResult.status)) {
              console.warn("[Webhook Warning] Reset event metadata generation skipped", {
                reason: "best_effort_failed",
              });
            }
          } catch {
            console.warn("[Webhook Warning] Reset display-name generation skipped", {
              reason: "best_effort_failed",
            });
          }
        }
      } catch {
        formalEnrichmentFailed = true;
        console.warn("[Tibo Warning] Codex recovery reconciliation unavailable", {
          reason: "request_failed",
        });
      }
    }

    if (formalFlowError) {
      console.warn("[Tibo Warning] Formal adoption flow unavailable after raw save", {
        reason: "retryable_database_error",
      });
      return NextResponse.json(
        { error: "Formal adoption flow unavailable" },
        { status: 503 },
      );
    }

    if (formalEnrichmentFailed) {
      console.warn("[Tibo Warning] Formal adoption enrichment unavailable after ledger claim", {
        reason: "retryable_enrichment_error",
      });
      return NextResponse.json(
        { error: "Formal adoption enrichment unavailable" },
        { status: 503 },
      );
    }

    if (internalOptions.sourceContextRevisionHashes) {
      const expectedRevisions = `{${internalOptions.sourceContextRevisionHashes.join(",")}}`;
      const markerUpdateResult = await supabase
        .from("tibo_signals")
        .update({
          source_context_classified_revision_hashes: internalOptions.sourceContextRevisionHashes,
        })
        .eq("tweet_id", tweetId)
        .eq("source_context_revision_hashes", expectedRevisions)
        .eq("source_context_generation", internalOptions.sourceContextGeneration)
        .select("tweet_id");
      if (markerUpdateResult.error) {
        console.warn("[Webhook Warning] Tibo source context completion marker save failed", {
          reason: "conditional_save_failed",
        });
        return NextResponse.json({ error: "Source context classification save unavailable" }, { status: 503 });
      }
      if (!Array.isArray(markerUpdateResult.data) || markerUpdateResult.data.length !== 1) {
        console.warn("[Webhook Warning] Tibo source context changed before completion", {
          reason: "revision_set_changed",
        });
        return NextResponse.json({ error: "Source context changed during classification" }, { status: 503 });
      }
    }

    const newlyAdopted = adoptionClaim?.status === "claimed_new";
    const formalAdoption = buildFormalAdoptionResult(newlyAdopted, formalCandidateForResponse);

    if (newlyAdopted) {
      console.info("[Tibo Formal Adoption]", {
        tweetId: formalCandidateForResponse.tweet_id,
        signalType: formalCandidateForResponse.signal_type,
        confidence: formalCandidateForResponse.confidence,
        sourceUrl: formalCandidateForResponse.tweet_url,
        adoptedAt: new Date().toISOString(),
      });
    }

    // 9. Purge Next.js Cache
    try {
      await invalidateRadarCache("tibo-event");
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

export async function POST(req: NextRequest) {
  return handleTiboWebhookPost(req);
}
