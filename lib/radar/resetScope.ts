import type { ResetScopeType } from "./types";

export type RegularResetScope = "全有料プラン" | "任意リセット未使用アカウント";

const BROAD_SCOPE_VALUES = new Set([
  "全有料プラン",
  "全ユーザー",
  "all paid plans",
  "all paid users",
  "all users",
  "所有付费套餐",
  "所有付费用户",
  "所有用户",
]);

const NARROW_SCOPE_PATTERN =
  /一部|対象ユーザー|不具合対象|任意リセット未使用|任意リセット(?:を)?(?:使っていない|使用していない)|限定(?:ユーザー|アカウント)|特定(?:の)?(?:ユーザー|アカウント)|some users?|affected users?|selected users?|limited users?|specific users?|subset|部分用户|受影响用户/i;

const REGULAR_UNUSED_SCOPE_VALUES = new Set([
  "任意リセット未使用アカウント",
  "任意リセットを使っていないアカウント",
  "Accounts without a Banked Reset",
  "未使用任意重置的账户",
]);

/**
 * Public reset scope has exactly two non-empty values. Legacy/internal labels
 * are normalized at the presentation boundary; ambiguous values stay blank.
 */
export function normalizeResetScope(
  value: string | null | undefined,
): ResetScopeType | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;

  if (BROAD_SCOPE_VALUES.has(normalized.toLowerCase())) {
    return "全有料プラン";
  }
  if (NARROW_SCOPE_PATTERN.test(normalized)) {
    return "一部ユーザー";
  }
  return undefined;
}

/**
 * Regular reset scopes describe the scheduled target, not the public random
 * reset scope taxonomy. Keep the concrete unused-account target separate from
 * the generic narrow-user normalization used by Tibo/random events.
 */
export function normalizeRegularResetScope(
  value: string | null | undefined,
): RegularResetScope | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;

  if (BROAD_SCOPE_VALUES.has(normalized.toLowerCase())) {
    return "全有料プラン";
  }
  if (REGULAR_UNUSED_SCOPE_VALUES.has(normalized)) {
    return "任意リセット未使用アカウント";
  }
  return undefined;
}
