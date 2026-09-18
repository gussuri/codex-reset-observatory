import type { WindowEventLike } from "./types";
import { isExcludedResetEventKey } from "@/data/resetHistory";
import {
  BROAD_BANKED_RANDOM_CLOCK_V2_POLICY_VERSION,
  BROAD_BANKED_RANDOM_CLOCK_V2_REGIME_POLICY,
  LEGACY_RANDOM_RESET_ELIGIBILITY_POLICY,
  type RandomResetEligibilityPolicy,
} from "@/data/shadowProbabilityConfig";
import { normalizeResetScope } from "./resetScope";

export type { RandomResetEligibilityPolicy } from "@/data/shadowProbabilityConfig";

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

function isPendingStatus(item: WindowEventLike) {
  const status = item.status?.toLowerCase();
  return status === "open" ||
    status === "active" ||
    status === "pending" ||
    status === "scheduled" ||
    status === "announced";
}

/**
 * Policy-aware random-boundary eligibility. The legacy helper above is kept
 * intentionally unchanged because it is also used by public/legacy paths.
 */
export function isEligibleRandomResetEventWithPolicy(
  item: WindowEventLike,
  completedAt: number | null,
  nowTime: number,
  policy: RandomResetEligibilityPolicy = LEGACY_RANDOM_RESET_ELIGIBILITY_POLICY,
) {
  if (policy === LEGACY_RANDOM_RESET_ELIGIBILITY_POLICY) {
    return isEligibleRandomResetEvent(item, completedAt, nowTime);
  }

  if (
    isExcludedResetEventKey(item.id) ||
    item.recordKind !== "confirmed_global" && item.recordKind !== "banked_distribution" ||
    item.randomResetTargetScope === "conditional" ||
    item.status?.toLowerCase() === "rejected" ||
    item.status?.toLowerCase() === "voided" ||
    isPendingStatus(item) ||
    !Number.isFinite(completedAt) ||
    !Number.isFinite(nowTime) ||
    completedAt! > nowTime ||
    !isBroadResetScope(item)
  ) {
    return false;
  }

  const cycleType = item.details?.cycleType;
  if (item.recordKind === "confirmed_global") {
    return cycleType === "ランダムリセット";
  }
  return cycleType === "ランダムリセット" || cycleType === "定期リセット";
}

export function getRandomResetEligibilityPolicyVersion(
  policy: RandomResetEligibilityPolicy,
) {
  return policy === BROAD_BANKED_RANDOM_CLOCK_V2_REGIME_POLICY
    ? BROAD_BANKED_RANDOM_CLOCK_V2_POLICY_VERSION
    : LEGACY_RANDOM_RESET_ELIGIBILITY_POLICY;
}
