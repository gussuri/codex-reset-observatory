import type { ClassificationSignalType } from "./classification";
import { getTiboClassificationSafetyDecision } from "./classification";
import type { TeaserStrength } from "./teaserStrength";
import { isBankedDistributionCompletionSignal, isBankedDistributionNotice } from "./bankedReset";
import {
  hasRetryableTiboEvidenceOmission,
  type TiboEvidenceContext,
  type TiboEvidenceNode,
} from "./tiboEvidenceContext";
import { isTiboHandle } from "./tiboHandle";

export type TiboContextSafetyInput = {
  authorText: string;
  replyContextText?: string | null;
  quoteContextText?: string | null;
  quoteAuthorHandle?: string | null;
  quoteTweetUrl?: string | null;
  selectedSignalType: ClassificationSignalType;
  aiTeaserStrength?: TeaserStrength | null;
  evidenceQuote?: string | null;
  temporalDirection?: "future" | "completed_now" | "historical" | "unclear" | null;
  targetTweetId?: string | null;
  targetTweetUrl?: string | null;
  targetTweetCreatedAt?: string | null;
  validatedSourceContext?: TiboEvidenceContext | null;
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
    }
  | {
      signalType: "reset_executed";
      teaserStrength?: TeaserStrength | null;
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
const FUTURE_CUE_PATTERN = /\b(?:tomorrow|tonight|later|soon|next\s+(?:day|week|month|year)|(?:in|within)\s+(?:the\s+)?(?:next\s+\d+|next|an?|one|two|\d+)\s+(?:minute|minutes|hour|hours|day|days|week|weeks))\b/i;
const ELLIPTICAL_FUTURE_EVENT_PATTERN = /\b(?:land(?:s|ed|ing)?|arriv(?:e|es|ed|ing)|com(?:e|es|ing))\b/i;
const ELLIPTICAL_EVENT_NEGATION_PATTERN = /\b(?:not|never|no\s+longer|cancel(?:led|ed)?|canceled)\b[^.!?]{0,70}\b(?:land(?:s|ed|ing)?|arriv(?:e|es|ed|ing)|com(?:e|es|ing))\b/i;
const AMBIGUOUS_FUTURE_NOUN_PATTERN = /\b(?:surprise|something|news|announcement|update)\b/i;
const DIFFERENT_EVENT_CONTEXT_PATTERN = /\b(?:separately|separate\s+(?:event|announcement|rollout)|unrelated|another\s+event|different\s+event)\b/i;
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

function getTweetIdentity(value: string | null | undefined) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !/^(?:x|twitter)\.com$/i.test(url.hostname)
      || url.username || url.password || url.port || url.search || url.hash) return null;
    const match = url.pathname.match(/^\/([A-Za-z0-9_]{1,15})\/status\/(\d+)\/?$/);
    return match ? { tweetId: match[2]!, authorHandle: `@${match[1]!.toLowerCase()}` } : null;
  } catch {
    return null;
  }
}

function getValidatedPath(
  context: TiboEvidenceContext,
  targetTweetId: string,
  relatedTweetId: string,
): TiboEvidenceNode[] | null {
  const nodes = new Map<string, TiboEvidenceNode>();
  if (context.target) nodes.set(context.target.tweetId, context.target);
  for (const post of context.relatedPosts) nodes.set(post.tweetId, post);
  const queue: Array<{ tweetId: string; path: TiboEvidenceNode[] }> = [];
  const target = nodes.get(targetTweetId);
  if (!target) return null;
  queue.push({ tweetId: targetTweetId, path: [target] });

  while (queue.length) {
    const current = queue.shift()!;
    if (current.tweetId === relatedTweetId) return current.path;
    if (current.path.length > 2) continue;
    for (const edge of context.edges) {
      if (edge.fromTweetId !== current.tweetId) continue;
      const next = nodes.get(edge.toTweetId);
      if (!next || current.path.some((node) => node.tweetId === next.tweetId)) continue;
      queue.push({ tweetId: next.tweetId, path: [...current.path, next] });
    }
  }
  return null;
}

function hasValidatedEllipticalNoticeEvidence(input: TiboContextSafetyInput, authorText: string) {
  const exactSourceText = typeof input.authorText === "string" ? input.authorText : "";
  if (
    input.selectedSignalType !== "official_notice" ||
    input.temporalDirection !== "future" ||
    !input.evidenceQuote ||
    !exactSourceText.includes(input.evidenceQuote.trim()) ||
    !ELLIPTICAL_FUTURE_EVENT_PATTERN.test(authorText) ||
    !FUTURE_CUE_PATTERN.test(authorText) ||
    ELLIPTICAL_EVENT_NEGATION_PATTERN.test(authorText) ||
    DIFFERENT_EVENT_CONTEXT_PATTERN.test(authorText) ||
    /\b(?:my|my own|my account|my personal|individual(?:ly)?|for myself)\b/i.test(authorText)
  ) return false;

  const context = input.validatedSourceContext;
  const targetTweetId = input.targetTweetId?.trim();
  const targetTweetUrl = getTweetIdentity(input.targetTweetUrl);
  const targetCreatedAt = Date.parse(input.targetTweetCreatedAt ?? "");
  if (
    !context ||
    !context.target ||
    context.status === "invalid_target" ||
    hasRetryableTiboEvidenceOmission(context) ||
    !targetTweetId ||
    !targetTweetUrl ||
    targetTweetUrl.tweetId !== targetTweetId ||
    targetTweetUrl.authorHandle !== "@thsottiaux" ||
    context.target.tweetId !== targetTweetId ||
    !isTiboHandle(context.target.authorHandle) ||
    normalizeContext(context.target.text.trim()) !== authorText ||
    !Number.isFinite(targetCreatedAt) ||
    Date.parse(context.target.createdAt) !== targetCreatedAt
  ) return false;

  const directReplyContext = normalizeContext(input.replyContextText);
  const directQuoteContext = normalizeContext(input.quoteContextText);
  const resetContextPosts = context.relatedPosts.filter((post) =>
    EXPLICIT_RESET_CONTEXT_PATTERN.test(normalizeContext(post.text)),
  );
  if (resetContextPosts.length !== 1) return false;

  const resetContextPost = resetContextPosts[0]!;
  const resetContextText = normalizeContext(resetContextPost.text);
  if (
    !isTiboHandle(resetContextPost.authorHandle) ||
    !USAGE_LIMIT_CONTEXT_PATTERN.test(resetContextText) ||
    isBankedDistributionNotice(resetContextPost.text) ||
    isBankedDistributionCompletionSignal(resetContextPost.text) ||
    DIFFERENT_EVENT_CONTEXT_PATTERN.test(resetContextPost.text) ||
    /\b(?:banked|my\s+(?:own\s+)?account|for\s+myself|individual\s+users?)\b/i.test(resetContextText) ||
    getTiboClassificationSafetyDecision(resetContextPost.text, "official_notice").signalType !== "official_notice"
  ) return false;

  const path = getValidatedPath(context, targetTweetId, resetContextPost.tweetId);
  if (!path || path.length < 2 || path.length > 3 || path.some((node) => !isTiboHandle(node.authorHandle))) return false;
  const firstEdge = context.edges.find((edge) => edge.fromTweetId === targetTweetId && edge.toTweetId === path[1]!.tweetId);
  if (!firstEdge) return false;
  if (firstEdge.relation === "reply" && directReplyContext !== normalizeContext(path[1]!.text)) return false;
  if (firstEdge.relation === "quote" && (
    directQuoteContext !== normalizeContext(path[1]!.text) ||
    !isTiboHandle(input.quoteAuthorHandle) ||
    getTweetIdentity(input.quoteTweetUrl)?.tweetId !== path[1]!.tweetId
  )) return false;

  return true;
}

/**
 * Apply narrow post-classification context guards without rewriting the AI audit fields.
 * The guard can suppress or downgrade a result, but never creates a stronger signal.
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

  if (!hasResetSignal) return null;

  if (
    getTiboClassificationSafetyDecision(input.authorText, input.selectedSignalType).reasonCode === "explicit_negation" ||
    (input.selectedSignalType !== "irrelevant" && ELLIPTICAL_EVENT_NEGATION_PATTERN.test(authorText))
  ) {
    return {
      signalType: "irrelevant",
      teaserStrength: "none",
      reasonJa: "Context safety guard: 本文がresetの予告または実施を否定しているため、無関係として扱います。",
    };
  }

  const isTiboSelfQuote =
    Boolean(isTiboHandle(input.quoteAuthorHandle) || isTiboHandle(input.quoteTweetUrl)) &&
    Boolean(input.quoteContextText && EXPLICIT_RESET_CONTEXT_PATTERN.test(normalizeContext(input.quoteContextText)));

  const externalContexts = [
    input.replyContextText,
    isTiboSelfQuote ? null : input.quoteContextText,
  ].filter(Boolean);

  const contextOnlyResetClaim =
    !isTiboSelfQuote &&
    !EXPLICIT_RESET_CONTEXT_PATTERN.test(authorText) &&
    externalContexts.some((value) =>
      EXPLICIT_RESET_CONTEXT_PATTERN.test(normalizeContext(value)),
    );
  if (
    contextOnlyResetClaim &&
    input.selectedSignalType !== "teaser" &&
    !hasValidatedEllipticalNoticeEvidence(input, authorText)
  ) {
    return {
      signalType: "irrelevant",
      teaserStrength: "none",
      reasonJa: "Context safety guard: resetの根拠は返信元または引用文脈にのみあり、Tibo本人の本文にはないため無関係として扱います。",
    };
  }

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

  return null;
}
