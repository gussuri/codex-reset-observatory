import type { TeaserStrength } from "./teaserStrength";
import type { TiboSecondarySignal } from "./tiboSecondarySignal";

import type { TiboVerificationStatus } from "./tiboHistory";
import {
  mergeTiboEditIdentity,
  type TiboEditIdentityFields,
} from "./tiboEditIdentity";

export type ExistingTiboWebhookState = TiboEditIdentityFields & {
  tweet_id?: string | null;
  detected_at?: string | null;
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
};

type TiboWebhookPayload = TiboEditIdentityFields & {
  tweet_id?: string;
  detected_at: string;
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

  const isReviewed = existingState?.verification_status === "confirmed" ||
    existingState?.verification_status === "rejected";
  if (isReviewed || existingState?.classification_source === "manual") {
    return {
      ...preserved,
      signal_type: keepExisting(existingState?.signal_type, preserved.signal_type),
      confidence: keepExisting(existingState?.confidence, preserved.confidence),
      classification_reason: keepExisting(existingState?.classification_reason, preserved.classification_reason),
      classification_source: keepExisting(existingState?.classification_source, preserved.classification_source),
      teaser_strength: keepExisting(existingState?.teaser_strength, preserved.teaser_strength),
      secondary_signal: preserved.secondary_signal,
      is_reply: keepExisting(existingState?.is_reply, preserved.is_reply),
      reply_to_handles: keepExisting(existingState?.reply_to_handles, preserved.reply_to_handles),
      reply_context_text: keepExisting(existingState?.reply_context_text, preserved.reply_context_text),
      source_timeline: keepExisting(existingState?.source_timeline, preserved.source_timeline),
    } as T;
  }

  return preserved as T;
}
