import type { TeaserStrength } from "./teaserStrength";
import type { TiboSecondarySignal } from "./tiboSecondarySignal";

import type { TiboVerificationStatus } from "./tiboHistory";
import type { TiboCodexOperationalState } from "./codexOperationalStatus";
import {
  mergeTiboEditIdentity,
  type TiboEditIdentityFields,
} from "./tiboEditIdentity";
import type {
  TemporalKind,
  TemporalPrecision,
  TemporalResolutionSource,
  TemporalResolutionStatus,
} from "./tiboTemporal";

export type ExistingTiboWebhookState = TiboEditIdentityFields & {
  tweet_id?: string | null;
  text?: string | null;
  detected_at?: string | null;
  expires_at?: string | null;
  verification_status?: TiboVerificationStatus | null;
  signal_type?: string | null;
  confidence?: number | null;
  classification_reason?: string | null;
  classification_source?: string | null;
  teaser_strength?: TeaserStrength | null;
  secondary_signal?: TiboSecondarySignal | null;
  is_reply?: boolean | null;
  reply_to_handles?: string[] | null;
  reply_context_text?: string | null;
  source_timeline?: string | null;
  is_quote?: boolean | null;
  quote_context_text?: string | null;
  quote_tweet_url?: string | null;
  quote_author_handle?: string | null;
  temporal_expression?: string | null;
  temporal_kind?: TemporalKind | null;
  temporal_precision?: TemporalPrecision | null;
  temporal_timezone?: string | null;
  temporal_confidence?: number | null;
  temporal_resolution_source?: TemporalResolutionSource | null;
  expected_start_at?: string | null;
  expected_end_at?: string | null;
  temporal_resolution_status?: TemporalResolutionStatus | null;
  temporal_resolution_version?: string | null;
  codex_operational_status?: TiboCodexOperationalState | null;
  codex_operational_confidence?: number | null;
  codex_operational_evidence_quote?: string | null;
  codex_operational_reason_ja?: string | null;
  codex_operational_expires_at?: string | null;
};

type TiboWebhookPayload = TiboEditIdentityFields & {
  tweet_id?: string;
  text?: string | null;
  detected_at: string;
  expires_at?: string | null;
  verification_status: TiboVerificationStatus;
  signal_type?: string | null;
  confidence?: number | null;
  classification_reason?: string | null;
  classification_source?: string | null;
  teaser_strength?: TeaserStrength | null;
  secondary_signal?: TiboSecondarySignal | null;
  is_reply?: boolean | null;
  reply_to_handles?: string[] | null;
  reply_context_text?: string | null;
  source_timeline?: string | null;
  is_quote?: boolean | null;
  quote_context_text?: string | null;
  quote_tweet_url?: string | null;
  quote_author_handle?: string | null;
  temporal_expression?: string | null;
  temporal_kind?: TemporalKind | null;
  temporal_precision?: TemporalPrecision | null;
  temporal_timezone?: string | null;
  temporal_confidence?: number | null;
  temporal_resolution_source?: TemporalResolutionSource | null;
  expected_start_at?: string | null;
  expected_end_at?: string | null;
  temporal_resolution_status?: TemporalResolutionStatus | null;
  temporal_resolution_version?: string | null;
  codex_operational_status?: TiboCodexOperationalState | null;
  codex_operational_confidence?: number | null;
  codex_operational_evidence_quote?: string | null;
  codex_operational_reason_ja?: string | null;
  codex_operational_expires_at?: string | null;
};

function keepExisting<T>(existing: T | undefined, incoming: T) {
  return existing === undefined ? incoming : existing;
}

function preserveSecondaryManualOverride(
  incoming: TiboSecondarySignal | null | undefined,
  existing: TiboSecondarySignal | null | undefined,
) {
  const manualOverride = existing?.manualOverride;
  if (!manualOverride || manualOverride.source !== "manual") return incoming;

  // Gemini may legitimately return no secondary signal on a later pass. A
  // previously reviewed secondary correction must still survive that pass.
  if (!incoming) return existing;
  return { ...incoming, manualOverride };
}

function isNonNoneOperationalStatus(
  value: TiboCodexOperationalState | null | undefined,
): value is Exclude<TiboCodexOperationalState, "none"> {
  return value === "investigating" || value === "active" || value === "recovered";
}

export function preserveTiboWebhookState<T extends TiboWebhookPayload>(
  payload: T,
  existing: ExistingTiboWebhookState | null | undefined,
  receivedAt: string,
): T {
  // The webhook lookup is keyed by tweet_id. Keep the guard explicit so a
  // reviewed decision cannot accidentally bleed into a distinct edit version
  // if this helper is ever called with a mismatched row.
  const sameTweetId = !existing?.tweet_id || !payload.tweet_id || existing.tweet_id === payload.tweet_id;
  const existingState = sameTweetId ? existing : undefined;
  const preserved = {
    ...payload,
    detected_at: existingState?.detected_at ?? receivedAt,
    verification_status: existingState?.verification_status ?? "auto_unverified",
  } as TiboWebhookPayload;

  const hasEditIdentity = [
    payload.logical_post_id,
    payload.edit_history_tweet_ids,
    payload.edit_version,
    payload.edit_metadata_source,
    existingState?.logical_post_id,
    existingState?.edit_history_tweet_ids,
    existingState?.edit_version,
    existingState?.edit_metadata_source,
  ].some((value) => value !== undefined);
  if (hasEditIdentity) {
    const identity = mergeTiboEditIdentity(
      existingState,
      {
        logical_post_id: payload.logical_post_id,
        edit_history_tweet_ids: payload.edit_history_tweet_ids,
        edit_version: payload.edit_version,
        edit_metadata_source: payload.edit_metadata_source,
      },
      payload.tweet_id ?? "",
    );
    Object.assign(preserved, identity.identity);
  }

  if (payload.secondary_signal !== undefined || existingState?.secondary_signal !== undefined) {
    preserved.secondary_signal = preserveSecondaryManualOverride(
      payload.secondary_signal,
      existingState?.secondary_signal,
    );
  }

  // The operational axis is independent from reset classification. Preserve a
  // previously valid Tibo assertion when a retry has no stronger assessment.
  if (
    isNonNoneOperationalStatus(existingState?.codex_operational_status) &&
    !isNonNoneOperationalStatus(preserved.codex_operational_status) &&
    (
      typeof preserved.text !== "string" ||
      typeof existingState.codex_operational_evidence_quote !== "string" ||
      preserved.text.includes(existingState.codex_operational_evidence_quote)
    )
  ) {
    preserved.codex_operational_status = existingState.codex_operational_status;
    preserved.codex_operational_confidence = existingState.codex_operational_confidence;
    preserved.codex_operational_evidence_quote = existingState.codex_operational_evidence_quote;
    preserved.codex_operational_reason_ja = existingState.codex_operational_reason_ja;
    preserved.codex_operational_expires_at = existingState.codex_operational_expires_at;
  }

  if (
    existingState?.is_quote === true &&
    !payload.quote_context_text &&
    !payload.quote_tweet_url
  ) {
    preserved.is_quote = true;
    preserved.quote_context_text = existingState.quote_context_text ?? null;
    preserved.quote_tweet_url = existingState.quote_tweet_url ?? null;
    preserved.quote_author_handle = existingState.quote_author_handle ?? null;
  }

  const isReviewed = existingState?.verification_status === "confirmed" ||
    existingState?.verification_status === "rejected";
  const isProtected = isReviewed || existingState?.classification_source === "manual";

  const incomingHasResolvedSchedule = payload.temporal_resolution_status === "resolved";
  const existingHasResolvedSchedule =
    existingState?.temporal_resolution_status === "resolved" ||
    Boolean(existingState?.expected_start_at && existingState?.expected_end_at);

  const shouldPreserveTemporal =
    existingHasResolvedSchedule &&
    (!incomingHasResolvedSchedule || isProtected);

  if (shouldPreserveTemporal && existingState) {
    preserved.temporal_expression = existingState.temporal_expression ?? null;
    preserved.temporal_kind = existingState.temporal_kind ?? null;
    preserved.temporal_precision = existingState.temporal_precision ?? null;
    preserved.temporal_timezone = existingState.temporal_timezone ?? null;
    preserved.temporal_confidence = existingState.temporal_confidence ?? null;
    preserved.temporal_resolution_source = existingState.temporal_resolution_source ?? null;
    preserved.expected_start_at = existingState.expected_start_at ?? null;
    preserved.expected_end_at = existingState.expected_end_at ?? null;
    preserved.temporal_resolution_status = existingState.temporal_resolution_status ?? null;
    preserved.temporal_resolution_version = existingState.temporal_resolution_version ?? null;
    if (existingState.expires_at) {
      preserved.expires_at = existingState.expires_at;
    }
  }

  if (isProtected) {
    return {
      ...preserved,
      signal_type: keepExisting(existingState?.signal_type, preserved.signal_type),
      confidence: keepExisting(existingState?.confidence, preserved.confidence),
      classification_reason: keepExisting(existingState?.classification_reason, preserved.classification_reason),
      classification_source: keepExisting(existingState?.classification_source, preserved.classification_source),
      teaser_strength: keepExisting(existingState?.teaser_strength, preserved.teaser_strength),
      expires_at: keepExisting(existingState?.expires_at, preserved.expires_at),
      secondary_signal: preserved.secondary_signal,
      is_reply: keepExisting(existingState?.is_reply, preserved.is_reply),
      reply_to_handles: keepExisting(existingState?.reply_to_handles, preserved.reply_to_handles),
      reply_context_text: keepExisting(existingState?.reply_context_text, preserved.reply_context_text),
      source_timeline: keepExisting(existingState?.source_timeline, preserved.source_timeline),
      is_quote: keepExisting(existingState?.is_quote, preserved.is_quote),
      quote_context_text: keepExisting(existingState?.quote_context_text, preserved.quote_context_text),
      quote_tweet_url: keepExisting(existingState?.quote_tweet_url, preserved.quote_tweet_url),
      quote_author_handle: keepExisting(existingState?.quote_author_handle, preserved.quote_author_handle),
    } as T;
  }

  return preserved as T;
}
