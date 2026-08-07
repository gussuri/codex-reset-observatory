export const TIBO_TEASER_STRENGTHS = ["strong", "weak", "none"] as const;

export type TeaserStrength = (typeof TIBO_TEASER_STRENGTHS)[number];
export type ResetTeaserStatus = TeaserStrength | "unknown";

const RESET_TEASER_LOOKBACK_MS = 48 * 60 * 60 * 1000;

export type ResetTeaserSignal = {
  tweet_created_at: string;
  teaser_strength?: TeaserStrength | null;
  verification_status?: string | null;
  is_reply?: boolean | null;
  expires_at?: string | null;
};

export function isTeaserStrength(value: unknown): value is TeaserStrength {
  return typeof value === "string" &&
    (TIBO_TEASER_STRENGTHS as readonly string[]).includes(value);
}

function getTimestamp(value: string | Date | null | undefined) {
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? time : null;
  }

  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

/**
 * Aggregates the UI-only teaser state without changing the meaning of any
 * active signal, expiry, or probability input.
 */
export function aggregateResetTeaserStatus(
  signals: readonly ResetTeaserSignal[] | null | undefined,
  latestResetAt: string | Date | null | undefined,
  now: Date = new Date(),
): ResetTeaserStatus {
  const nowTime = now.getTime();
  if (!Number.isFinite(nowTime)) return "none";

  const latestResetTime = getTimestamp(latestResetAt);
  const cutoffTime = nowTime - RESET_TEASER_LOOKBACK_MS;
  let hasEligiblePost = false;
  let hasWeak = false;
  let hasNone = false;

  for (const signal of signals ?? []) {
    const createdTime = getTimestamp(signal.tweet_created_at);
    if (
      createdTime === null ||
      createdTime > nowTime ||
      createdTime < cutoffTime ||
      (latestResetTime !== null && createdTime <= latestResetTime) ||
      signal.verification_status === "rejected"
    ) {
      continue;
    }

    hasEligiblePost = true;
    if (signal.teaser_strength === "strong") return "strong";
    if (signal.teaser_strength === "weak") {
      hasWeak = true;
    } else if (signal.teaser_strength === "none") {
      hasNone = true;
    }
  }

  if (hasWeak) return "weak";
  if (hasNone) return "none";
  return hasEligiblePost ? "unknown" : "none";
}

export type TeaserStrengthAssessment = {
  teaserStrength: TeaserStrength | null;
  teaserStrengthConfidence: number | null;
  teaserStrengthEvidenceQuote: string | null;
  teaserStrengthReasonJa: string | null;
};

function getExactEvidenceQuote(value: unknown, sourceText: string) {
  if (typeof value !== "string" || value.length > 300) return null;

  const quote = value.trim();
  if (!quote) return null;
  return sourceText.toLowerCase().includes(quote.toLowerCase()) ? quote : null;
}

export function parseTeaserStrengthAssessment(
  value: unknown,
  sourceText: string,
): TeaserStrengthAssessment {
  if (!value || typeof value !== "object") {
    return {
      teaserStrength: null,
      teaserStrengthConfidence: null,
      teaserStrengthEvidenceQuote: null,
      teaserStrengthReasonJa: null,
    };
  }

  const parsed = value as Record<string, unknown>;
  const teaserStrength = isTeaserStrength(parsed.teaserStrength)
    ? parsed.teaserStrength
    : null;
  if (!teaserStrength) {
    return {
      teaserStrength: null,
      teaserStrengthConfidence: null,
      teaserStrengthEvidenceQuote: null,
      teaserStrengthReasonJa: null,
    };
  }

  const confidence = parsed.teaserStrengthConfidence;
  const teaserStrengthConfidence = typeof confidence === "number" &&
      Number.isFinite(confidence) &&
      confidence >= 0 &&
      confidence <= 1
    ? confidence
    : null;

  return {
    teaserStrength,
    teaserStrengthConfidence,
    teaserStrengthEvidenceQuote: getExactEvidenceQuote(
      parsed.teaserStrengthEvidenceQuote,
      sourceText,
    ),
    teaserStrengthReasonJa:
      typeof parsed.teaserStrengthReasonJa === "string"
        ? parsed.teaserStrengthReasonJa.slice(0, 500)
        : null,
  };
}
