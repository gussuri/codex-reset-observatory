export const TIBO_TEASER_STRENGTHS = ["strong", "weak", "none"] as const;

export type TeaserStrength = (typeof TIBO_TEASER_STRENGTHS)[number];

export function isTeaserStrength(value: unknown): value is TeaserStrength {
  return typeof value === "string" &&
    (TIBO_TEASER_STRENGTHS as readonly string[]).includes(value);
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
