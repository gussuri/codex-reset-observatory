import type { WindowEventLike } from "./types";

const BROAD_SCOPE_PATTERN = /全|all|every|global|codex\s*\/\s*chatgpt/i;
const NARROW_SCOPE_PATTERN = /特定|対象ユーザー|不具合対象|個人|一部|限定|単一|specific|affected|individual|subset|single|limited/i;

export function isBroadResetScope(item: WindowEventLike) {
  const scope = item.scope ?? item.details?.scope ?? "";
  if (!scope.trim()) return false;

  const normalizedScope = scope.trim().toLowerCase();
  return BROAD_SCOPE_PATTERN.test(normalizedScope) && !NARROW_SCOPE_PATTERN.test(normalizedScope);
}

export function isEligibleRandomResetEvent(
  item: WindowEventLike,
  completedAt: number | null,
  nowTime: number,
) {
  if (item.recordKind !== "confirmed_global" && item.recordKind !== "banked_distribution") {
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
