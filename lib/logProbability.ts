import type { RadarViewModel } from "@/lib/radar/types";
import type { ProbabilityCalculationAudit } from "@/lib/radar/probability";
import type { PublishedProbabilityCalculation } from "@/lib/radar/publishedProbability";
import type { ShadowProbabilityResult } from "@/lib/radar/shadowProbability";

export function hasOfficialNoticeForLog(
  viewModel: Pick<RadarViewModel, "activeWindow">,
) {
  return viewModel.activeWindow.active && viewModel.activeWindow.kind === "official";
}

export function buildProbabilityDebugInfo(
  base: Record<string, unknown>,
  calculation: ProbabilityCalculationAudit,
  generatedAt: string | null | undefined,
  calculatedAt: Date,
  shadowProbability?: ShadowProbabilityResult | null,
  publishedProbability?: PublishedProbabilityCalculation,
) {
  const calculatedAtIso = calculatedAt.toISOString();

  return {
    ...base,
    generated_at: generatedAt ?? null,
    calculated_at: calculatedAtIso,
    probabilityModel: {
      version: calculation.modelVersion,
      generatedAt: generatedAt ?? null,
      calculatedAt: calculatedAtIso,
      inputs: calculation.inputSnapshot,
      breakdown: calculation.breakdown,
    },
    ...(shadowProbability
      ? { shadowProbabilityModel: shadowProbability }
      : {}),
    ...(publishedProbability
      ? {
          publishedProbabilityModel: {
            version: publishedProbability.adoptedModel,
            source: publishedProbability.source,
            probability24h: publishedProbability.probability24h,
            probability48h: publishedProbability.probability48h,
            fallbackReason: publishedProbability.fallbackReason,
            confidence: publishedProbability.shadow?.confidence.level ?? null,
            completedIntervalCount: publishedProbability.shadow?.confidence.completedIntervalCount ?? null,
            totalExposureDays: publishedProbability.shadow?.confidence.totalExposureDays ?? null,
          },
        }
      : {}),
  };
}
