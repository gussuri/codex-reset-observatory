import type { RadarViewModel } from "@/lib/radar/types";

export function hasOfficialNoticeForLog(
  viewModel: Pick<RadarViewModel, "activeWindow">,
) {
  return viewModel.activeWindow.active && viewModel.activeWindow.kind === "official";
}
