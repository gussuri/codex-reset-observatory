export type TiboCodexOperationalStatus =
  | "none"
  | "investigating"
  | "active"
  | "recovered";

export type PublicCodexOperationalStatus = TiboCodexOperationalStatus | "unknown";

export type CodexOperationalAssessment = {
  status: TiboCodexOperationalStatus | null;
  confidence: number | null;
  evidenceQuote: string | null;
  reasonJa: string | null;
};

export const TIBO_OPERATIONAL_TTL_MS = 12 * 60 * 60 * 1000;

const OPERATIONAL_STATUSES = new Set<TiboCodexOperationalStatus>([
  "none",
  "investigating",
  "active",
  "recovered",
]);

function emptyAssessment(): CodexOperationalAssessment {
  return {
    status: null,
    confidence: null,
    evidenceQuote: null,
    reasonJa: null,
  };
}

function isOperationalStatus(value: unknown): value is TiboCodexOperationalStatus {
  return typeof value === "string" && OPERATIONAL_STATUSES.has(value as TiboCodexOperationalStatus);
}

function normalizeEvidenceQuote(value: unknown, authorText: string) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || value.length > 300) return undefined;

  const quote = value.trim();
  if (!quote) return null;
  if (!authorText.toLowerCase().includes(quote.toLowerCase())) return undefined;
  return quote;
}

export function parseCodexOperationalAssessment(
  value: Record<string, unknown> | null | undefined,
  authorText: string,
): CodexOperationalAssessment {
  if (!value || !isOperationalStatus(value.codexOperationalStatus)) {
    return emptyAssessment();
  }

  const confidence = value.codexOperationalConfidence;
  if (
    typeof confidence !== "number" ||
    !Number.isFinite(confidence) ||
    confidence < 0 ||
    confidence > 1
  ) {
    return emptyAssessment();
  }

  const evidenceQuote = normalizeEvidenceQuote(
    value.codexOperationalEvidenceQuote,
    authorText,
  );
  if (evidenceQuote === undefined) return emptyAssessment();

  const reasonJa = typeof value.codexOperationalReasonJa === "string"
    ? value.codexOperationalReasonJa.trim().slice(0, 500) || null
    : null;

  return {
    status: value.codexOperationalStatus,
    confidence,
    evidenceQuote,
    reasonJa,
  };
}

export function getTiboOperationalExpiry(tweetCreatedAt: string) {
  const createdAt = Date.parse(tweetCreatedAt);
  if (!Number.isFinite(createdAt)) return null;
  return new Date(createdAt + TIBO_OPERATIONAL_TTL_MS).toISOString();
}
