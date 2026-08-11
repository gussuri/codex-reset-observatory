export type ClassificationSignalType =
  | "official_notice"
  | "reset_executed"
  | "teaser"
  | "irrelevant";

export type ClassificationResult = {
  signalType: ClassificationSignalType;
  confidence: number;
  reason: string;
  isReply: boolean;
  isQuote: boolean;
};

export type TiboReplyClassificationMetadata = {
  isReply?: boolean;
  isQuote?: boolean;
};

/**
 * Tibo氏のポストテキストを分類・解析し、シグナル種別・信頼度スコアを算出する
 * Supabase実データ分析に基づく高精度ルールエンジン
 */
export function classifyTiboTweet(
  text: string,
  url: string = "",
  metadata?: TiboReplyClassificationMetadata,
): ClassificationResult {
  const normalized = text.toLowerCase();

  const isReply = typeof metadata?.isReply === "boolean"
    ? metadata.isReply
    : url.includes("/status/") &&
      (text.startsWith("@") || normalized.includes("reply"));
  const isQuote = typeof metadata?.isQuote === "boolean"
    ? metadata.isQuote
    : normalized.includes("quote") || false;

  // 1. 否定・過去・昔話回想パターンの先頭評価 (Negative / Past / Retrospective Exclusion -> irrelevant)
  const negativeOrPastPatterns = [
    "already reset everyone yesterday",
    "reset was completed last week",
    "no reset tonight",
    "not going to reset",
    "don't think we should reset",
    "dont think we should reset",
    "no reset scheduled",
    "won't be a reset",
    "wont be a reset",
    "one day we created the reset button",
    "created the reset button a long time ago",
    "remember when we built the reset button",
    "remember when we created the reset button",
    "rest is history",
  ];

  for (const pattern of negativeOrPastPatterns) {
    if (normalized.includes(pattern)) {
      return {
        signalType: "irrelevant",
        confidence: 0.1,
        reason: `Matched negative, past, or retrospective pattern: "${pattern}"`,
        isReply,
        isQuote,
      };
    }
  }

  // 2. 即時実施・完了報告 (reset_executed)
  const executedPatterns = [
    "i've reset usage limits",
    "i have reset usage limits",
    "i've reset the usage limits",
    "i reset usage limits for all paid users",
    "reset usage limits",
    "just reset",
    "reset is complete",
    "reset completed",
    "limits have been reset",
    "reset done",
    "already reset",
    "reset everyone's limits",
    "rate limits are reset",
    "fresh limits for everyone",
    "reset all paid users",
    "reset for all users",
  ];

  for (const pattern of executedPatterns) {
    if (normalized.includes(pattern)) {
      return {
        signalType: "reset_executed",
        confidence: 0.98,
        reason: `Matched immediate reset execution pattern: "${pattern}"`,
        isReply,
        isQuote,
      };
    }
  }

  // 3. 今後の実施予告 (official_notice)
  const noticePatterns = [
    "reset in ",
    "reset tonight",
    "reset tomorrow",
    "reset scheduled",
    "full reset coming",
    "reset at ",
    "reset within ",
    "will reset",
    "going to reset",
    "preparing a reset",
  ];

  for (const pattern of noticePatterns) {
    if (normalized.includes(pattern)) {
      return {
        signalType: "official_notice",
        confidence: 0.96,
        reason: `Matched official notice pattern: "${pattern}"`,
        isReply,
        isQuote,
      };
    }
  }

  // 4. 将来の可能性の示唆 (teaser) - 未来志向表現の同居を必須化
  const teaserBaseKeywords = [
    "reset button",
    "capacity boost",
    "working on reset",
    "thinking about a reset",
    "cooking something",
    "sol model caps",
    "resets",
  ];

  const futureIndicators = [
    "incoming",
    "soon",
    "should we",
    "tonight",
    "tomorrow",
    "cooking something",
    "working on",
    "next",
    "later",
    "there will be",
    "getting faster",
  ];

  const matchedBase = teaserBaseKeywords.find((kw) => normalized.includes(kw));

  if (matchedBase) {
    // Check if future-oriented indicator co-occurs
    const hasFutureIndicator = futureIndicators.some((ind) => normalized.includes(ind));

    if (hasFutureIndicator) {
      return {
        signalType: "teaser",
        confidence: 0.85,
        reason: `Matched teaser keyword "${matchedBase}" with future indicator`,
        isReply,
        isQuote,
      };
    }
  }

  // 5. デフォルト (irrelevant)
  return {
    signalType: "irrelevant",
    confidence: 0.2,
    reason: "No reset notice or execution patterns matched.",
    isReply,
    isQuote,
  };
}
