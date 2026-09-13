import type { WindowEventLike } from "./types";
import { isExcludedResetEventKey } from "@/data/resetHistory";
import { normalizeResetScope } from "./resetScope";

export function isBroadResetScope(item: WindowEventLike) {
  const scope = item.scope?.trim() || item.details?.scope?.trim() || "";
  if (!scope.trim()) {
    return item.recordKind === "confirmed_global";
  }

  return normalizeResetScope(scope) === "全有料プラン";
}

export function isEligibleRandomResetEvent(
  item: WindowEventLike,
  completedAt: number | null,
  nowTime: number,
) {
  if (isExcludedResetEventKey(item.id)) {
    return false;
  }
  if (item.recordKind !== "confirmed_global" && item.recordKind !== "banked_distribution") {
    return false;
  }
  if (item.randomResetTargetScope === "conditional") {
    return false;
  }
  if (item.details?.cycleType !== "ランダムリセット") {
    return false;
  }
  if (!isBroadResetScope(item)) {
    return false;
  }
  return (
    Number.isFinite(completedAt) &&
    Number.isFinite(nowTime) &&
    completedAt! <= nowTime
  );
}
