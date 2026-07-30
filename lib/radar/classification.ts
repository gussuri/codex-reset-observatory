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

/**
 * Tibo氏のポストテキストを分類・解析し、シグナル種別・信頼度スコアを算出する
 */
export function classifyTiboTweet(
  text: string,
  url: string = "",
): ClassificationResult {
  const normalized = text.toLowerCase();

  const isReply =
    url.includes("/status/") &&
    (text.startsWith("@") || normalized.includes("reply"));
  const isQuote = normalized.includes("quote") || false;

  // 1. 即時実施・完了報告 (reset_executed)
  const executedPatterns = [
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

  // 2. 今後の実施予告 (official_notice)
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
      // 過去表現の除外チェック
      if (
        normalized.includes("yesterday") ||
        normalized.includes("last week") ||
        normalized.includes("was reset")
      ) {
        return {
          signalType: "irrelevant",
          confidence: 0.3,
          reason: `Contains past reset reference with notice keyword: "${pattern}"`,
          isReply,
          isQuote,
        };
      }

      return {
        signalType: "official_notice",
        confidence: 0.96,
        reason: `Matched official notice pattern: "${pattern}"`,
        isReply,
        isQuote,
      };
    }
  }

  // 3. 将来の可能性の示唆 (teaser)
  const teaserPatterns = [
    "should we reset",
    "reset button",
    "capacity boost",
    "working on reset",
    "thinking about a reset",
    "cooking something",
    "sol model caps",
  ];

  for (const pattern of teaserPatterns) {
    if (normalized.includes(pattern)) {
      return {
        signalType: "teaser",
        confidence: 0.85,
        reason: `Matched teaser pattern: "${pattern}"`,
        isReply,
        isQuote,
      };
    }
  }

  // 4. デフォルト (irrelevant)
  return {
    signalType: "irrelevant",
    confidence: 0.2,
    reason: "No reset notice or execution patterns matched.",
    isReply,
    isQuote,
  };
}
