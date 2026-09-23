import type { CodexOperationalStatus } from "./types";

export type TiboCodexOperationalState = "investigating" | "active" | "recovered" | "none";

export type ParsedCodexOperationalAssessment = {
  codex_operational_status: TiboCodexOperationalState | null;
  codex_operational_confidence: number | null;
  codex_operational_evidence_quote: string | null;
  codex_operational_reason_ja: string | null;
};

export type TiboCodexOperationalSignal = {
  tweet_id?: string;
  tweet_created_at?: string | null;
  verification_status?: string | null;
  codex_operational_status?: string | null;
  codex_operational_expires_at?: string | null;
};

const CODEX_OPERATIONAL_NON_NONE_STATES = new Set<TiboCodexOperationalState>([
  "investigating",
  "active",
  "recovered",
]);
const CODEX_OPERATIONAL_TTL_MS = 12 * 60 * 60 * 1000;

function emptyAssessment(): ParsedCodexOperationalAssessment {
  return {
    codex_operational_status: null,
    codex_operational_confidence: null,
    codex_operational_evidence_quote: null,
    codex_operational_reason_ja: null,
  };
}

function isOperationalState(value: unknown): value is TiboCodexOperationalState {
  return value === "none" || CODEX_OPERATIONAL_NON_NONE_STATES.has(value as TiboCodexOperationalState);
}

/**
 * Parses the independent, display-only operational axis. Invalid operational
 * output is discarded without affecting the primary reset classification.
 */
export function parseCodexOperationalAssessment(
  value: unknown,
  authorText: string,
): ParsedCodexOperationalAssessment {
  if (!value || typeof value !== "object" || Array.isArray(value)) return emptyAssessment();

  const parsed = value as Record<string, unknown>;
  const status = parsed.codexOperationalStatus;
  const confidence = parsed.codexOperationalConfidence;
  if (
    !isOperationalState(status) ||
    typeof confidence !== "number" ||
    !Number.isFinite(confidence) ||
    confidence < 0 ||
    confidence > 1
  ) {
    return emptyAssessment();
  }

  const evidenceQuote = parsed.codexOperationalEvidenceQuote;
  let validEvidenceQuote: string | null = null;
  if (status !== "none") {
    if (
      typeof evidenceQuote !== "string" ||
      evidenceQuote.trim().length === 0 ||
      evidenceQuote.length > 300 ||
      !authorText.includes(evidenceQuote.trim())
    ) {
      return emptyAssessment();
    }
    validEvidenceQuote = evidenceQuote.trim();
  }

  const reason = parsed.codexOperationalReasonJa;
  return {
    codex_operational_status: status,
    codex_operational_confidence: confidence,
    codex_operational_evidence_quote: validEvidenceQuote,
    codex_operational_reason_ja: typeof reason === "string" && reason.trim()
      ? reason.trim().slice(0, 500)
      : null,
  };
}

export function getCodexOperationalExpiryAt(
  status: TiboCodexOperationalState | null | undefined,
  tweetCreatedAt: string,
): string | null {
  if (!status || status === "none") return null;
  const createdAt = Date.parse(tweetCreatedAt);
  return Number.isFinite(createdAt)
    ? new Date(createdAt + CODEX_OPERATIONAL_TTL_MS).toISOString()
    : null;
}

function isNonNoneOperationalState(value: unknown): value is Exclude<TiboCodexOperationalState, "none"> {
  return value === "investigating" || value === "active" || value === "recovered";
}

/** Returns the newest still-eligible Tibo operational assertion. */
export function getLatestTiboCodexOperationalSignal<T extends TiboCodexOperationalSignal>(
  signals: ReadonlyArray<T>,
  now: Date,
): T | null {
  const nowTime = now.getTime();
  if (!Number.isFinite(nowTime)) return null;

  return signals
    .filter((signal) => {
      if (signal.verification_status === "rejected") return false;
      if (!isNonNoneOperationalState(signal.codex_operational_status)) return false;

      const createdAt = Date.parse(signal.tweet_created_at ?? "");
      const persistedExpiry = Date.parse(signal.codex_operational_expires_at ?? "");
      if (!Number.isFinite(createdAt) || !Number.isFinite(persistedExpiry)) return false;
      if (createdAt > nowTime) return false;

      // Cap eligibility at twelve hours from the source post even if a stored
      // timestamp is malformed or was written with a longer lifetime.
      const effectiveExpiry = Math.min(persistedExpiry, createdAt + CODEX_OPERATIONAL_TTL_MS);
      return nowTime < effectiveExpiry;
    })
    .slice()
    .sort((left, right) => {
      const timeDifference = Date.parse(right.tweet_created_at ?? "") - Date.parse(left.tweet_created_at ?? "");
      if (timeDifference !== 0) return timeDifference;
      return (right.tweet_id ?? "").localeCompare(left.tweet_id ?? "");
    })[0] ?? null;
}

export function resolveCodexOperationalStatusForDisplay(
  openAIStatus: CodexOperationalStatus | null | undefined,
  tiboSignals: ReadonlyArray<TiboCodexOperationalSignal>,
  now: Date,
): CodexOperationalStatus {
  if (openAIStatus === "active") return "active";

  const latestTiboSignal = getLatestTiboCodexOperationalSignal(tiboSignals, now);
  const tiboStatus = latestTiboSignal?.codex_operational_status;
  if (tiboStatus === "active") return "active";
  if (tiboStatus === "investigating") return "investigating";
  if (tiboStatus === "recovered" || openAIStatus === "recovered") return "recovered";
  return openAIStatus ?? "unknown";
}
