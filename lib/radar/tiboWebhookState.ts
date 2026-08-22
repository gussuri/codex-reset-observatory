import type { TeaserStrength } from "./teaserStrength";
import type { TiboCodexOperationalStatus } from "./codexOperationalStatus";
import type { TiboVerificationStatus } from "./tiboHistory";

export type ExistingTiboWebhookState = {
  detected_at?: string | null;
  verification_status?: TiboVerificationStatus | null;
  signal_type?: string | null;
  confidence?: number | null;
  classification_reason?: string | null;
  classification_source?: string | null;
  teaser_strength?: TeaserStrength | null;
  is_reply?: boolean | null;
  reply_to_handles?: string[] | null;
  reply_context_text?: string | null;
  source_timeline?: string | null;
  codex_operational_status?: TiboCodexOperationalStatus | null;
  codex_operational_confidence?: number | null;
  codex_operational_evidence_quote?: string | null;
  codex_operational_reason_ja?: string | null;
  codex_operational_expires_at?: string | null;
};

type TiboWebhookPayload = {
  detected_at: string;
  verification_status: TiboVerificationStatus;
  signal_type?: string | null;
  confidence?: number | null;
  classification_reason?: string | null;
  classification_source?: string | null;
  teaser_strength?: TeaserStrength | null;
  is_reply?: boolean | null;
  reply_to_handles?: string[] | null;
  reply_context_text?: string | null;
  source_timeline?: string | null;
  codex_operational_status?: TiboCodexOperationalStatus | null;
  codex_operational_confidence?: number | null;
  codex_operational_evidence_quote?: string | null;
  codex_operational_reason_ja?: string | null;
  codex_operational_expires_at?: string | null;
};

function keepExisting<T>(existing: T | undefined, incoming: T) {
  return existing === undefined ? incoming : existing;
}

function preserveOperationalAssessment(
  payload: TiboWebhookPayload,
  existing: ExistingTiboWebhookState | null | undefined,
) {
  if (
    payload.codex_operational_status !== null
    && payload.codex_operational_status !== undefined
  ) {
    return payload;
  }

  if (
    existing?.codex_operational_status === null
    || existing?.codex_operational_status === undefined
  ) {
    return payload;
  }

  return {
    ...payload,
    codex_operational_status: existing.codex_operational_status,
    codex_operational_confidence: existing.codex_operational_confidence ?? null,
    codex_operational_evidence_quote: existing.codex_operational_evidence_quote ?? null,
    codex_operational_reason_ja: existing.codex_operational_reason_ja ?? null,
    codex_operational_expires_at: existing.codex_operational_expires_at ?? null,
  };
}

export function preserveTiboWebhookState<T extends TiboWebhookPayload>(
  payload: T,
  existing: ExistingTiboWebhookState | null | undefined,
  receivedAt: string,
): T {
  const preserved = preserveOperationalAssessment({
    ...payload,
    detected_at: existing?.detected_at ?? receivedAt,
    verification_status: existing?.verification_status ?? "auto_unverified",
  }, existing);

  if (existing?.classification_source === "manual") {
    return {
      ...preserved,
      signal_type: keepExisting(existing.signal_type, preserved.signal_type),
      confidence: keepExisting(existing.confidence, preserved.confidence),
      classification_reason: keepExisting(existing.classification_reason, preserved.classification_reason),
      classification_source: "manual",
      teaser_strength: keepExisting(existing.teaser_strength, preserved.teaser_strength),
      is_reply: keepExisting(existing.is_reply, preserved.is_reply),
      reply_to_handles: keepExisting(existing.reply_to_handles, preserved.reply_to_handles),
      reply_context_text: keepExisting(existing.reply_context_text, preserved.reply_context_text),
      source_timeline: keepExisting(existing.source_timeline, preserved.source_timeline),
    } as T;
  }

  return preserved as T;
}
