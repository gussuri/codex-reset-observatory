import type { ClassificationSignalType } from "./classification";
import type { TeaserStrength } from "./teaserStrength";

export type TiboContextSafetyInput = {
  authorText: string;
  replyContextText?: string | null;
  quoteContextText?: string | null;
  selectedSignalType: ClassificationSignalType;
  aiTeaserStrength?: TeaserStrength | null;
  ruleSignalType?: ClassificationSignalType | null;
  ruleConfidence?: number | null;
  isReply?: boolean | null;
};

export type TiboContextSafetyDecision =
  | {
      signalType: "irrelevant";
      teaserStrength: "none";
      reasonJa: string;
    }
  | {
      signalType: "irrelevant";
      teaserStrength: "weak";
      reasonJa: string;
    }
  | {
      signalType: "teaser";
      teaserStrength: "weak";
      reasonJa: string;
    }
  | {
      signalType: "teaser";
      teaserStrength: "strong";
      reasonJa: string;
    };

// Keep this deliberately narrow: ordinary "got" or "received" statements
// must not be treated as physical-item receipts without an item noun.
const ITEM_RECEIPT_PATTERN = /\b(?:me\s+receiving|i\s+(?:am|'m)\s+receiving|i\s+received|i\s+got|i\s+was\s+(?:gifted|given))\s+(?:(?:this|that|a|an|the)\s+)?(?:(?:very|important|fancy|new|special|nice)\s+){0,3}(?:item|gift|present|package|box)\b/i;

const EXPLICIT_RESET_CONTEXT_PATTERN = /\b(?:reset(?:s|ting)?|usage[-\s]+limits?|rate[-\s]+limits?|quotas?|allowances?|fresh[-\s]+limits?|topped\s+up|limit\s+reset)\b/i;
const PHYSICAL_ITEM_SHOWCASE_PATTERN = /\bfor\s+scale\b/i;
const PHYSICAL_ITEM_SHOWCASE_CUE_PATTERN = /\b(?:not\s+used\s+yet|(?:would\s+you\s+)?look\s+at\s+(?:this|that))\b/i;
const USAGE_LIMIT_CONTEXT_PATTERN = /\b(?:usage|quota|rate\s+limit|allowance|capacity)\b/i;
const PERSON_TARGETED_RESET_PATTERN = /\b(?!codex\b|usage\b|quota\b|limits?\b|allowances?\b)[a-z][a-z'-]{1,30}\s+is\s+in\s+need\s+of\s+(?:a\s+)?reset\b/i;
const HISTORICAL_RESET_CONTEXT_PATTERN = /\b(?:previously\s+promised\s+a\s+reset|one\s+day\s+(?:we|i)\s+(?:created|made)\s+the\s+reset\s+button|remember\s+when|long\s+time\s+ago|rest\s+is\s+history|(?:last\s+)?(?:year|month)s?\s+ago)\b/i;
const FUTURE_CUE_PATTERN = /\b(?:tomorrow|tonight|later|soon|next\s+(?:day|week|month|year)|in\s+(?:the\s+)?(?:next|an?|one|two|\d+)\s+(?:minute|minutes|hour|hours|day|days|week|weeks))\b/i;
const AMBIGUOUS_FUTURE_NOUN_PATTERN = /\b(?:surprise|something|news|announcement|update)\b/i;
const RESET_BUTTON_REUSE_ACTION_PATTERN =
  /\b(?:find|press|hit|use|reuse)\s+(?:it|the\s+reset\s+button)\b|\b(?:dust\s+it\s+up|bring\s+it\s+back|take\s+it\s+out)\b/i;
const NEGATED_RESET_BUTTON_REUSE_PATTERN =
  /\b(?:can(?:not|'t)|won't|will\s+not|not\s+going\s+to)\b[^.!?]{0,80}\b(?:find|press|hit|use|reuse|dust|bring|take)\b/i;
const NON_USAGE_RESET_BUTTON_CONTEXT_PATTERN =
  /\b(?:keyboard|laptop|phone|router|server|device|controller|console|game|car|factory\s+reset)\b/i;
const CODEX_UPDATE_CONTEXT_PATTERN = /\b(?:codex|chatgpt\s+work)\b/i;
const UPDATE_ACTION_PATTERN = /\b(?:update(?:s|d|ing)?|change(?:s|d|ing)?|bring\s+back|come\s+back|return(?:s|ed|ing)?|restore(?:s|d|ing)?|reintroduc(?:e|es|ed|ing)|roll\s+out|ship(?:s|ped|ping)?|launch(?:es|ed|ing)?|(?:be|is|are)\s+back)\b/i;
const EXPLICIT_FUTURE_RESET_INTENT_PATTERNS = [
  /\b(?:will|going\s+to|plan(?:s|ned)?\s+to|i['’]ll|we['’]ll)\b[^.!?]{0,100}\b(?:reset|resetting|usage[-\s]+limits?|quotas?|allowances?)\b/i,
  /\b(?:reset|resetting)\b[^.!?]{0,60}\b(?:tomorrow|tonight|later|soon|next\s+(?:day|week|month|year)|on\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|in\s+(?:the\s+)?(?:next|an?|one|two|\d+)\s+(?:minute|minutes|hour|hours|day|days|week|weeks))\b/i,
  /\b(?:reset|resetting)\b.{0,80}\b(?:landing|coming|arriving)\b/i,
];

function normalizeContext(value: string | null | undefined) {
  return typeof value === "string"
    ? value.toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, " ").trim()
    : "";
}

function hasExplicitFutureResetIntent(text: string) {
  return EXPLICIT_FUTURE_RESET_INTENT_PATTERNS.some((pattern) => pattern.test(text));
}

function hasNearFutureResetButtonReuseIntent(text: string) {
  const resetButtonIndex = text.search(/\breset\s+button\b/i);
  if (resetButtonIndex < 0) return false;

  const tail = text.slice(resetButtonIndex, resetButtonIndex + 280);
  return (
    FUTURE_CUE_PATTERN.test(tail) &&
    RESET_BUTTON_REUSE_ACTION_PATTERN.test(tail) &&
    !NEGATED_RESET_BUTTON_REUSE_PATTERN.test(tail) &&
    !NON_USAGE_RESET_BUTTON_CONTEXT_PATTERN.test(text)
  );
}

function hasUpcomingCodexUpdate(text: string) {
  return CODEX_UPDATE_CONTEXT_PATTERN.test(text) &&
    FUTURE_CUE_PATTERN.test(text) &&
    UPDATE_ACTION_PATTERN.test(text);
}

/**
 * Apply narrow post-classification context guards without rewriting the AI audit fields.
 * An upcoming Codex update is only a weak auxiliary signal; it never proves a reset.
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

  if (
    input.selectedSignalType === "irrelevant" &&
    input.ruleSignalType === "teaser" &&
    typeof input.ruleConfidence === "number" &&
    input.ruleConfidence >= 0.85 &&
    input.isReply !== true &&
    hasNearFutureResetButtonReuseIntent(authorText)
  ) {
    return {
      signalType: "teaser",
      teaserStrength: "weak",
      reasonJa: "Context safety guard: 過去のreset buttonへの言及に加えて、その同じbuttonを近い将来に再び使う意図があるため、弱い匂わせとして扱います。",
    };
  }

  const hasResetSignal = input.selectedSignalType !== "irrelevant" ||
    input.aiTeaserStrength === "strong" ||
    input.aiTeaserStrength === "weak";
  const hasUpcomingUpdate = hasUpcomingCodexUpdate(context);

  if (!hasResetSignal && !hasUpcomingUpdate) return null;

  if (
    input.selectedSignalType === "official_notice" &&
    HISTORICAL_RESET_CONTEXT_PATTERN.test(context) &&
    FUTURE_CUE_PATTERN.test(context) &&
    AMBIGUOUS_FUTURE_NOUN_PATTERN.test(context) &&
    !hasExplicitFutureResetIntent(context)
  ) {
    return {
      signalType: "teaser",
      teaserStrength: "strong",
      reasonJa: "Context safety guard: 未来の出来事がリセットだとは明示されていないため、公式予告ではなく強い匂わせとして扱います。",
    };
  }

  if (
    PERSON_TARGETED_RESET_PATTERN.test(authorText) &&
    !USAGE_LIMIT_CONTEXT_PATTERN.test(context)
  ) {
    return {
      signalType: "irrelevant",
      teaserStrength: "none",
      reasonJa: "Context safety guard: 人物へのリセット言及で、利用枠リセットの文脈がないため、無関係として扱います。",
    };
  }

  if (
    HISTORICAL_RESET_CONTEXT_PATTERN.test(context) &&
    !hasExplicitFutureResetIntent(context)
  ) {
    return {
      signalType: "irrelevant",
      teaserStrength: "none",
      reasonJa: "Context safety guard: 過去のリセットへの言及で、現在または未来のリセット意図がないため、無関係として扱います。",
    };
  }

  if (
    PHYSICAL_ITEM_SHOWCASE_PATTERN.test(authorText) &&
    PHYSICAL_ITEM_SHOWCASE_CUE_PATTERN.test(authorText) &&
    !EXPLICIT_RESET_CONTEXT_PATTERN.test(context)
  ) {
    return {
      signalType: "irrelevant",
      teaserStrength: "none",
      reasonJa: "Context safety guard: 物品の展示・受領を示す投稿ですが、利用枠リセットの明示的な根拠がないため、無関係として扱います。",
    };
  }

  if (ITEM_RECEIPT_PATTERN.test(authorText)) {
    if (EXPLICIT_RESET_CONTEXT_PATTERN.test(context)) return null;

    return {
      signalType: "irrelevant",
      teaserStrength: "none",
      reasonJa: "Context safety guard: 物品の受領を示す投稿ですが、本文・返信元・引用文脈に利用枠リセットの明示的な根拠がないため、無関係として扱います。",
    };
  }

  if (
    hasUpcomingUpdate &&
    !hasExplicitFutureResetIntent(context) &&
    input.selectedSignalType !== "reset_executed"
  ) {
    return {
      signalType: "irrelevant",
      teaserStrength: "weak",
      reasonJa: "Context safety guard: Codexの将来の更新を示す投稿ですが、リセット自体は明示していないため、弱い匂わせとして記録します。",
    };
  }

  return null;
}
