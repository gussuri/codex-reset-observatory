import type { ClassificationResult } from "./classification";
import type {
  GeminiClassificationOutput,
  GeminiClassificationStatus,
} from "./geminiClassification";

export type TiboClassificationMode = "off" | "shadow" | "primary" | "hybrid";

export type TiboClassificationSource = "rule" | "shadow" | "gemini" | "rule_fallback";

export type SelectedTiboClassification = {
  signalType: ClassificationResult["signalType"];
  confidence: number;
  reason: string;
  classificationSource: TiboClassificationSource;
};

export type TiboClassificationResponse = {
  signalType: ClassificationResult["signalType"];
  confidence: number;
  classificationSource: TiboClassificationSource;
  aiStatus: GeminiClassificationStatus;
  ruleSignalType: ClassificationResult["signalType"];
  aiSignalType: GeminiClassificationOutput["signalType"];
};

export function normalizeTiboClassificationMode(value?: string): TiboClassificationMode {
  switch (value?.toLowerCase()) {
    case "shadow":
      return "shadow";
    case "primary":
      return "primary";
    case "hybrid":
      return "hybrid";
    case "off":
    case undefined:
    case "":
      return "off";
    default:
      return "off";
  }
}

export function shouldRunGeminiClassification(value?: string) {
  return normalizeTiboClassificationMode(value) !== "off";
}

function isValidGeminiClassification(
  result: GeminiClassificationOutput | null | undefined,
): result is GeminiClassificationOutput & {
  signalType: NonNullable<GeminiClassificationOutput["signalType"]>;
  confidence: number;
  reasonJa: string;
  status: "success";
} {
  return Boolean(
    result &&
      result.status === "success" &&
      result.signalType &&
      typeof result.confidence === "number" &&
      Number.isFinite(result.confidence) &&
      result.confidence >= 0 &&
      result.confidence <= 1 &&
      typeof result.reasonJa === "string" &&
      result.reasonJa.trim().length > 0,
  );
}

export function selectTiboClassification(
  modeValue: string | undefined,
  ruleResult: ClassificationResult,
  aiResult: GeminiClassificationOutput | null | undefined,
): SelectedTiboClassification {
  const mode = normalizeTiboClassificationMode(modeValue);

  if (mode === "primary" || mode === "hybrid") {
    if (isValidGeminiClassification(aiResult)) {
      return {
        signalType: aiResult.signalType,
        confidence: aiResult.confidence,
        reason: aiResult.reasonJa.trim(),
        classificationSource: "gemini",
      };
    }

    return {
      signalType: ruleResult.signalType,
      confidence: ruleResult.confidence,
      reason: ruleResult.reason,
      classificationSource: "rule_fallback",
    };
  }

  return {
    signalType: ruleResult.signalType,
    confidence: ruleResult.confidence,
    reason: ruleResult.reason,
    classificationSource: mode === "shadow" ? "shadow" : "rule",
  };
}

export function buildTiboClassificationResponse(
  modeValue: string | undefined,
  ruleResult: ClassificationResult,
  aiResult: GeminiClassificationOutput | null | undefined,
): TiboClassificationResponse {
  const selected = selectTiboClassification(modeValue, ruleResult, aiResult);

  return {
    signalType: selected.signalType,
    confidence: selected.confidence,
    classificationSource: selected.classificationSource,
    aiStatus: aiResult?.status ?? "skipped",
    ruleSignalType: ruleResult.signalType,
    aiSignalType: aiResult?.signalType ?? null,
  };
}
