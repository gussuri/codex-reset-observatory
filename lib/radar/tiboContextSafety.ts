import type { ClassificationSignalType } from "./classification";
import { getTiboClassificationSafetyDecision } from "./classification";
import type { TeaserStrength } from "./teaserStrength";
import {
  type TiboEvidenceContext,
  type TiboEvidenceNode,
} from "./tiboEvidenceContext";
import { isTiboHandle } from "./tiboHandle";

export type TiboContextualResetAssessment =
  | "same_global_reset"
  | "same_banked_distribution"
  | "same_personal_reset"
  | "different_event"
  | "negated"
  | "uncertain"
  | "not_applicable"
  | "unknown";

export type TiboContextSafetyInput = {
  authorText: string;
  isReply?: boolean;
  isQuote?: boolean;
  replyContextText?: string | null;
  replyParentTweetId?: string | null;
  replyParentTweetUrl?: string | null;
  quoteContextText?: string | null;
  quoteAuthorHandle?: string | null;
  quoteTweetUrl?: string | null;
  selectedSignalType: ClassificationSignalType;
  aiTeaserStrength?: TeaserStrength | null;
  evidenceQuote?: string | null;
  temporalDirection?: "future" | "completed_now" | "historical" | "unclear" | null;
  contextualResetAssessment?: TiboContextualResetAssessment | null;
  contextualResetTweetId?: string | null;
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
const PERSON_TARGETED_RESET_PATTERN = /\b(?!codex\b|usage\b|quota\b|limits?\b|allowances?\b)[a-z][a-z'-]{1,30}\s+is\s+in\s+need\s+of\s+(?:a\s+)?reset\b/i;
const HISTORICAL_RESET_CONTEXT_PATTERN = /\b(?:previously\s+promised\s+a\s+reset|one\s+day\s+(?:we|i)\s+(?:created|made)\s+the\s+reset\s+button|remember\s+when|long\s+time\s+ago|rest\s+is\s+history|(?:last\s+)?(?:year|month)s?\s+ago)\b/i;
const FUTURE_CUE_PATTERN = /\b(?:tomorrow|tonight|later|soon|next\s+(?:day|week|month|year)|(?:in|within)\s+(?:the\s+)?(?:next\s+\d+|next|an?|one|two|\d+)\s+(?:minute|minutes|hour|hours|day|days|week|weeks))\b/i;
const AMBIGUOUS_FUTURE_NOUN_PATTERN = /\b(?:surprise|something|news|announcement|update)\b/i;
const EXPLICIT_FUTURE_RESET_INTENT_PATTERNS = [
  /\b(?:will|going\s+to|plan(?:s|ned)?\s+to|i['’]ll|we['’]ll)\b[^.!?]{0,100}\b(?:reset|resetting|usage[-\s]+limits?|quotas?|allowances?)\b/i,
  /\b(?:reset|resetting)\b[^.!?]{0,60}\b(?:tomorrow|tonight|later|soon|next\s+(?:day|week|month|year)|on\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|in\s+(?:the\s+)?(?:next|an?|one|two|\d+)\s+(?:minute|minutes|hour|hours|day|days|week|weeks))\b/i,
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
  const allNodes = [context.target, ...context.relatedPosts].filter((node): node is TiboEvidenceNode => Boolean(node));
  if (new Set(allNodes.map((node) => node.tweetId)).size !== allNodes.length) return null;
  for (const node of allNodes) {
    const identity = getTweetIdentity(node.tweetUrl);
    if (
      !/^\d{1,30}$/.test(node.tweetId) ||
      identity?.tweetId !== node.tweetId ||
      identity.authorHandle !== node.authorHandle ||
      !Number.isFinite(Date.parse(node.createdAt))
    ) return null;
    nodes.set(node.tweetId, node);
  }
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

function hasValidatedContextualResetReference(input: TiboContextSafetyInput, authorText: string) {
  if (input.selectedSignalType !== "official_notice" && input.selectedSignalType !== "reset_executed") return false;
  if (input.selectedSignalType === "official_notice" && input.temporalDirection !== "future") return false;
  if (input.selectedSignalType === "reset_executed" && input.temporalDirection !== "completed_now") return false;

  const evidenceQuote = input.evidenceQuote?.trim();
  if (!evidenceQuote || !input.authorText.includes(evidenceQuote)) return false;

  const context = input.validatedSourceContext;
  const targetTweetId = input.targetTweetId?.trim();
  const targetTweetUrl = getTweetIdentity(input.targetTweetUrl);
  const targetCreatedAt = Date.parse(input.targetTweetCreatedAt ?? "");
  const contextTargetUrl = getTweetIdentity(context?.target?.tweetUrl);
  const contextTargetCreatedAt = Date.parse(context?.target?.createdAt ?? "");
  if (
    !context ||
    context.version !== "tibo-evidence-context-v1" ||
    context.status !== "complete" ||
    !context.target ||
    context.omissions.length > 0 ||
    !targetTweetId ||
    !targetTweetUrl ||
    targetTweetUrl.tweetId !== targetTweetId ||
    targetTweetUrl.authorHandle !== "@thsottiaux" ||
    context.target.tweetId !== targetTweetId ||
    contextTargetUrl?.tweetId !== targetTweetId ||
    contextTargetUrl.authorHandle !== context.target.authorHandle ||
    !isTiboHandle(context.target.authorHandle) ||
    normalizeContext(context.target.text.trim()) !== authorText ||
    !Number.isFinite(targetCreatedAt) ||
    !Number.isFinite(contextTargetCreatedAt) ||
    contextTargetCreatedAt !== targetCreatedAt
  ) return false;

  const contextualResetTweetId = input.contextualResetTweetId?.trim();
  if (!contextualResetTweetId || !/^\d{1,30}$/.test(contextualResetTweetId)) return false;
  const path = getValidatedPath(context, targetTweetId, contextualResetTweetId);
  if (!path || path.length < 2 || path.length > 3 || path.some((node) => !isTiboHandle(node.authorHandle))) return false;
  const pathEdges = path.slice(1).map((node, index) => {
    const fromTweetId = path[index]!.tweetId;
    const matching = context.edges.filter((edge) => edge.fromTweetId === fromTweetId && edge.toTweetId === node.tweetId);
    return matching.length === 1 ? matching[0]! : null;
  });
  if (pathEdges.some((edge) => !edge)) return false;
  if (path.some((node, index) => index > 0 && Date.parse(node.createdAt) > Date.parse(path[index - 1]!.createdAt))) return false;

  const firstEdge = pathEdges[0]!;
  if (firstEdge.relation === "reply" && (
    input.isReply !== true ||
    normalizeContext(input.replyContextText) !== normalizeContext(path[1]!.text) ||
    input.replyParentTweetId !== path[1]!.tweetId ||
    getTweetIdentity(input.replyParentTweetUrl)?.tweetId !== path[1]!.tweetId ||
    getTweetIdentity(input.replyParentTweetUrl)?.authorHandle !== path[1]!.authorHandle
  )) return false;
  if (firstEdge.relation === "quote" && (
    input.isQuote !== true ||
    normalizeContext(input.quoteContextText) !== normalizeContext(path[1]!.text) ||
    !isTiboHandle(input.quoteAuthorHandle) ||
    getTweetIdentity(input.quoteTweetUrl)?.tweetId !== path[1]!.tweetId ||
    getTweetIdentity(input.quoteTweetUrl)?.authorHandle !== path[1]!.authorHandle
  )) return false;
  if (firstEdge.relation !== "reply" && firstEdge.relation !== "quote") return false;

  return true;
}

/** Return only a fully verified, same-author reply path to an AI-identified global reset. */
export function getValidatedTiboSameGlobalReplyPath(input: TiboContextSafetyInput) {
  if (
    input.isReply !== true ||
    input.isQuote === true ||
    input.contextualResetAssessment !== "same_global_reset" ||
    input.selectedSignalType !== "reset_executed" ||
    input.temporalDirection !== "completed_now"
  ) return null;

  const targetTweetId = input.targetTweetId?.trim();
  const contextualTweetId = input.contextualResetTweetId?.trim();
  const context = input.validatedSourceContext;
  if (!targetTweetId || !contextualTweetId || !context) return null;
  if (!hasValidatedContextualResetReference(input, normalizeContext(input.authorText))) return null;

  const path = getValidatedPath(context, targetTweetId, contextualTweetId);
  if (!path || path.length < 2 || path.length > 3 || path.some((node) => !isTiboHandle(node.authorHandle))) {
    return null;
  }
  if (path[0]!.tweetId !== targetTweetId || path.at(-1)!.tweetId !== contextualTweetId) return null;
  if (input.replyParentTweetId !== path[1]!.tweetId) return null;

  const pathEdges = path.slice(1).map((node, index) => {
    const matches = context.edges.filter((edge) =>
      edge.fromTweetId === path[index]!.tweetId && edge.toTweetId === node.tweetId,
    );
    return matches.length === 1 ? matches[0]! : null;
  });
  if (pathEdges.some((edge) => edge?.relation !== "reply")) return null;

  const targetTime = Date.parse(path[0]!.createdAt);
  if (path.some((node, index) =>
    index > 0 && Date.parse(node.createdAt) >= Date.parse(path[index - 1]!.createdAt),
  )) return null;
  if (!Number.isFinite(targetTime)) return null;

  return path;
}

function hasExternalSourceContext(input: TiboContextSafetyInput) {
  return input.isReply === true ||
    input.isQuote === true ||
    Boolean(input.replyContextText || input.quoteContextText) ||
    Boolean(input.validatedSourceContext?.relatedPosts.length);
}

function hasExactTargetSpeechEvidence(input: TiboContextSafetyInput) {
  const evidenceQuote = input.evidenceQuote?.trim();
  if (!evidenceQuote || !input.authorText.includes(evidenceQuote)) return false;
  if (input.selectedSignalType === "official_notice") return input.temporalDirection === "future";
  if (input.selectedSignalType === "reset_executed") return input.temporalDirection === "completed_now";
  return false;
}

function contextRelationMustBeSuppressed(input: TiboContextSafetyInput) {
  if (input.selectedSignalType !== "official_notice" && input.selectedSignalType !== "reset_executed") return false;
  if (!hasExternalSourceContext(input)) return false;
  if (input.contextualResetAssessment === "not_applicable") return !hasExactTargetSpeechEvidence(input);
  if (input.contextualResetAssessment === "same_global_reset") {
    return !hasValidatedContextualResetReference(input, normalizeContext(input.authorText));
  }
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

  const hasResetSignal = input.selectedSignalType !== "irrelevant" ||
    input.aiTeaserStrength === "strong" ||
    input.aiTeaserStrength === "weak";

  if (!hasResetSignal) return null;

  if (
    getTiboClassificationSafetyDecision(input.authorText, input.selectedSignalType).reasonCode === "explicit_negation" ||
    input.contextualResetAssessment === "negated"
  ) {
    return {
      signalType: "irrelevant",
      teaserStrength: "none",
      reasonJa: "Context safety guard: 本文がresetの予告または実施を否定しているため、無関係として扱います。",
    };
  }

  if (contextRelationMustBeSuppressed(input)) {
    return {
      signalType: "irrelevant",
      teaserStrength: "none",
      reasonJa: "Context safety guard: the AI did not identify a verified same-event global reset reference for this post.",
    };
  }

  const contextualResetAccepted = input.contextualResetAssessment === "same_global_reset" &&
    hasValidatedContextualResetReference(input, authorText);
  const context = contextualResetAccepted || (
    hasExternalSourceContext(input) && input.contextualResetAssessment === "not_applicable"
  )
    ? authorText
    : [
        authorText,
        normalizeContext(input.replyContextText),
        normalizeContext(input.quoteContextText),
      ].filter(Boolean).join("\n");

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

  if (PERSON_TARGETED_RESET_PATTERN.test(authorText)) {
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
