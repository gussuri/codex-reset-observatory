import type { RadarViewModel } from "@/lib/radar/types";
import type { ProbabilityCalculationAudit } from "@/lib/radar/probability";

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
  };
}
