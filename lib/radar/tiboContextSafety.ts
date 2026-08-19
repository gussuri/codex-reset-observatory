import type { ClassificationSignalType } from "./classification";
import type { TeaserStrength } from "./teaserStrength";

export type TiboContextSafetyInput = {
  authorText: string;
  replyContextText?: string | null;
  quoteContextText?: string | null;
  selectedSignalType: ClassificationSignalType;
  aiTeaserStrength?: TeaserStrength | null;
};

export type TiboContextSafetyDecision = {
  signalType: "irrelevant";
  teaserStrength: "none";
  reasonJa: string;
};

// Keep this deliberately narrow: ordinary "got" or "received" statements
// must not be treated as physical-item receipts without an item noun.
const ITEM_RECEIPT_PATTERN = /\b(?:me\s+receiving|i\s+(?:am|'m)\s+receiving|i\s+received|i\s+got|i\s+was\s+(?:gifted|given))\s+(?:(?:this|that|a|an|the)\s+)?(?:(?:very|important|fancy|new|special|nice)\s+){0,3}(?:item|gift|present|package|box)\b/i;

const EXPLICIT_RESET_CONTEXT_PATTERN = /\b(?:reset(?:s|ting)?|usage[-\s]+limits?|rate[-\s]+limits?|quotas?|allowances?|fresh[-\s]+limits?|topped\s+up|limit\s+reset)\b/i;

function normalizeContext(value: string | null | undefined) {
  return typeof value === "string"
    ? value.toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, " ").trim()
    : "";
}

/**
 * Suppress the narrow physical-item false positive after classifier selection.
 * The AI fields remain available for audit; only the effective state is changed.
 */
export function getTiboContextSafetyDecision(
  input: TiboContextSafetyInput,
): TiboContextSafetyDecision | null {
  const authorText = normalizeContext(input.authorText);
  const context = [
    authorText,
    normalizeContext(input.replyContextText),
    normalizeContext(input.quoteContextText),
  ].filter(Boolean).join("\n");

  const hasResetSignal = input.selectedSignalType !== "irrelevant" ||
    input.aiTeaserStrength === "strong" ||
    input.aiTeaserStrength === "weak";

  if (!hasResetSignal || !ITEM_RECEIPT_PATTERN.test(authorText)) return null;
  if (EXPLICIT_RESET_CONTEXT_PATTERN.test(context)) return null;

  return {
    signalType: "irrelevant",
    teaserStrength: "none",
    reasonJa: "Context safety guard: 物品の受領を示す投稿ですが、本文・返信元・引用文脈に利用枠リセットの明示的な根拠がないため、無関係として扱います。",
  };
}
