import { getTiboClassificationSafetyDecision } from "./classification";

/**
 * Confidence for a direct, unambiguously timed official notice remains 0.95.
 * A separately verified Gemini classification of an unscheduled announcement
 * uses 0.8 only to represent that a notice exists; it never grants a time
 * window or a reset execution.
 */
export const UNSCHEDULED_OFFICIAL_NOTICE_CONFIDENCE = 0.8;

export type TiboUnscheduledOfficialNoticeCandidate = {
  text?: string | null;
  signal_type?: string | null;
  confidence?: number | null;
  verification_status?: string | null;
  classification_source?: string | null;
  is_reply?: boolean | null;
  is_quote?: boolean | null;
  ai_signal_type?: string | null;
  ai_classification_status?: string | null;
  ai_temporal_direction?: string | null;
  ai_notice_timing_status?: string | null;
  ai_evidence_quote?: string | null;
  ai_notice_to_execution?: string | null;
  ai_temporal_expression?: string | null;
  ai_temporal_kind?: string | null;
  ai_temporal_precision?: string | null;
  ai_temporal_timezone?: string | null;
  ai_temporal_confidence?: number | null;
  temporal_resolution_status?: string | null;
  temporal_expression?: string | null;
  expected_start_at?: string | null;
  expected_end_at?: string | null;
};

/** Admit only an explicitly un-timed, semantically grounded usage-limit notice. */
export function isTiboUnscheduledOfficialNoticeEligible(
  signal: TiboUnscheduledOfficialNoticeCandidate,
) {
  const text = typeof signal.text === "string" ? signal.text : "";
  const quote = typeof signal.ai_evidence_quote === "string" ? signal.ai_evidence_quote.trim() : "";
  const confidence = signal.confidence;

  if (
    signal.signal_type !== "official_notice" ||
    signal.verification_status === "rejected" ||
    signal.is_reply === true ||
    signal.is_quote === true ||
    signal.classification_source !== "gemini" ||
    signal.ai_signal_type !== "official_notice" ||
    signal.ai_classification_status !== "success" ||
    signal.ai_temporal_direction !== "unclear" ||
    signal.ai_notice_timing_status !== "unknown" ||
    signal.temporal_resolution_status !== "unresolved" ||
    typeof confidence !== "number" ||
    !Number.isFinite(confidence) ||
    confidence < UNSCHEDULED_OFFICIAL_NOTICE_CONFIDENCE ||
    !quote ||
    !text.includes(quote) ||
    getTiboClassificationSafetyDecision(text, "official_notice").signalType !== "official_notice"
  ) {
    return false;
  }

  return ![
    signal.ai_notice_to_execution,
    signal.ai_temporal_expression,
    signal.ai_temporal_kind,
    signal.ai_temporal_precision,
    signal.ai_temporal_timezone,
    signal.temporal_expression,
    signal.expected_start_at,
    signal.expected_end_at,
  ].some((value) => typeof value === "string" && value.trim().length > 0) &&
    signal.ai_temporal_confidence == null;
}
