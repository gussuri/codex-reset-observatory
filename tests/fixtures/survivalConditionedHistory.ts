import type { RecoveryResetBoundary } from "../../lib/radar/recoveryBoundary";
import type { WindowEventLike } from "../../lib/radar/types";

const HOUR_MS = 60 * 60 * 1000;
const ANCHOR_TIME = Date.parse("2026-04-01T00:00:00.000Z");

// Frozen diagnostic fixture only. It mirrors the canonical support shape
// (37 random boundaries, 36 completed intervals, Tmax 221h) without reading
// from or standing in for runtime Production history.
export const SURVIVAL_CANONICAL_INTERVAL_HOURS = [
  221, 168, 144, 120, 96, 72, 48, 60, 84, 108, 132, 96,
  72, 54, 90, 120, 66, 84, 102, 78, 126, 96, 60, 88,
  114, 72, 108, 90, 132, 66, 84, 120, 96, 72, 104, 80,
] as const;

function resetBoundary(id: string, time: number): RecoveryResetBoundary {
  return {
    id,
    resetAt: new Date(time).toISOString(),
    isRandom: true,
    isRegular: false,
    sourceIds: [id],
  };
}

export function frozenCanonicalSurvivalBoundaries(extraIntervals: number[] = []) {
  const intervals = [...SURVIVAL_CANONICAL_INTERVAL_HOURS, ...extraIntervals];
  const boundaries = [resetBoundary("canonical-survival-r0", ANCHOR_TIME)];
  let time = ANCHOR_TIME;
  intervals.forEach((interval, index) => {
    time += interval * HOUR_MS;
    boundaries.push(resetBoundary(`canonical-survival-r${index + 1}`, time));
  });
  return boundaries;
}

export function frozenCanonicalSurvivalStaticHistory(extraIntervals: number[] = []): WindowEventLike[] {
  return frozenCanonicalSurvivalBoundaries(extraIntervals).map((boundary) => ({
    id: boundary.id,
    recordKind: "confirmed_global",
    title: boundary.id,
    kind: "reset_completed",
    status: "closed",
    scope: "全有料プラン",
    closed_at: boundary.resetAt,
    completed_at: boundary.resetAt,
    details: {
      cycleType: "ランダムリセット",
      resetMethod: "強制リセット",
      scope: "全有料プラン",
      noticeToExecution: "0分",
    },
  }));
}
