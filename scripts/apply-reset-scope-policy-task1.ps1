$ErrorActionPreference = "Stop"

function Replace-Exact {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Old,
    [Parameter(Mandatory = $true)][string]$New
  )

  $text = [System.IO.File]::ReadAllText($Path)
  if (-not $text.Contains($Old)) {
    throw "Expected text was not found in $Path"
  }
  $updated = $text.Replace($Old, $New)
  [System.IO.File]::WriteAllText($Path, $updated, [System.Text.UTF8Encoding]::new($false))
}

$resetScopePath = "lib/radar/resetScope.ts"
$resetScopeContent = @'
import type { ResetScopeType } from "./types";

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
  /一部|対象ユーザー|不具合対象|任意リセット未使用|some users?|affected users?|selected users?|limited users?|specific users?|subset|部分用户|受影响用户/i;

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
'@
[System.IO.File]::WriteAllText($resetScopePath, $resetScopeContent, [System.Text.UTF8Encoding]::new($false))

Replace-Exact -Path "lib/radar/types.ts" -Old @'
export type ResetScopeType =
  | "全有料プラン"
  | "全ユーザー"
  | "任意リセット未使用アカウント";
'@ -New @'
export type ResetScopeType =
  | "全有料プラン"
  | "一部ユーザー";
'@

Replace-Exact -Path "lib/radar/types.ts" -Old @'
  scope: ResetScopeType | string;
'@ -New @'
  scope?: ResetScopeType | string;
'@

Replace-Exact -Path "lib/radar/tiboHistory.ts" -Old @'
import {
  inferResetCycleType,
  hasExplicitResetReasonEvidence,
  normalizeResetReasonType,
} from "./resetReason";
'@ -New @'
import {
  inferResetCycleType,
  hasExplicitResetReasonEvidence,
  normalizeResetReasonType,
} from "./resetReason";
import { normalizeResetScope } from "./resetScope";
'@

Replace-Exact -Path "lib/radar/tiboHistory.ts" -Old @'
function getScope(texts: ReadonlyArray<string>) {
  const applicableClauses = getApplicableScopeClauses(texts);
  const hasBroadApplicability = applicableClauses.some((clause) => hasExplicitBroadResetApplicability(clause));
  const hasNarrowApplicability = applicableClauses.some((clause) => isExplicitNarrowScope(clause));

  if (hasBroadApplicability && hasNarrowApplicability) return "Codex / ChatGPT Work";
  if (hasNarrowApplicability) return "一部ユーザー";
  if (hasBroadApplicability) return "全有料プラン";
  return "Codex / ChatGPT Work";
}
'@ -New @'
function getScope(texts: ReadonlyArray<string>) {
  const applicableClauses = getApplicableScopeClauses(texts);
  const hasBroadApplicability = applicableClauses.some((clause) => hasExplicitBroadResetApplicability(clause));
  const hasNarrowApplicability = applicableClauses.some((clause) => isExplicitNarrowScope(clause));

  if (hasBroadApplicability && hasNarrowApplicability) return undefined;
  if (hasNarrowApplicability) return normalizeResetScope("一部ユーザー");
  if (hasBroadApplicability) return normalizeResetScope("全有料プラン");
  return undefined;
}
'@

Replace-Exact -Path "lib/radar/tiboHistory.ts" -Old @'
  return relatedReasons.find((reason) => reason === "詫びリセット") ??
    relatedReasons.find((reason) => reason === "ご祝儀リセット");
}
'@ -New @'
  return relatedReasons.find((reason) => reason === "詫びリセット") ??
    relatedReasons.find((reason) => reason === "ご祝儀リセット") ??
    "ご祝儀リセット";
}
'@

Replace-Exact -Path "lib/radar.ts" -Old @'
import {
  inferResetCycleType,
  normalizeResetReasonType,
  type ResetReasonContext,
} from "./radar/resetReason";
'@ -New @'
import {
  inferResetCycleType,
  normalizeResetReasonType,
  type ResetReasonContext,
} from "./radar/resetReason";
import { normalizeResetScope } from "./radar/resetScope";
'@

Replace-Exact -Path "lib/radar.ts" -Old @'
    const resetMethod = getRegularResetMethod(item);
    const scope = getRegularResetScope(item, resetMethod);
'@ -New @'
    const resetMethod = getRegularResetMethod(item);
    const scope = normalizeResetScope(getRegularResetScope(item, resetMethod));
'@

Replace-Exact -Path "lib/radar.ts" -Old @'
      scope: translateDynamic(scope, locale),
'@ -New @'
      scope: scope ? translateDynamic(scope, locale) : "",
'@

Replace-Exact -Path "lib/radar.ts" -Old @'
    const reason = getHistoryReasonTypeValue(item);
    const noticePresentation = getHistoryNoticePresentation(item.details.noticeType);
    const storedNoticeToExecution = item.details.noticeToExecution?.trim();
'@ -New @'
    const reason = getHistoryReasonTypeValue(item);
    const scope = normalizeResetScope(item.details.scope ?? item.scope);
    const noticePresentation = getHistoryNoticePresentation(item.details.noticeType);
    const storedNoticeToExecution = item.details.noticeToExecution?.trim();
'@

Replace-Exact -Path "lib/radar.ts" -Old @'
      scope: translateDynamic(item.details.scope, locale),
'@ -New @'
      scope: scope ? translateDynamic(scope, locale) : "",
'@

Replace-Exact -Path "lib/radar.ts" -Old @'
  const astraCorrection = getAstraBankedHistoryCorrection(item);
  const scope = item.scope ? translateDynamic(item.scope, locale) : translateDynamic("不明", locale);
'@ -New @'
  const astraCorrection = getAstraBankedHistoryCorrection(item);
  const normalizedScope = normalizeResetScope(item.scope);
  const scope = normalizedScope ? translateDynamic(normalizedScope, locale) : "";
'@

Replace-Exact -Path "lib/radar.ts" -Old @'
        scope: isRegular
          ? details.scope
          : translateDynamic(item.scope, locale),
'@ -New @'
        scope: details.scope,
'@

Replace-Exact -Path "components/ResetHistoryDetails.tsx" -Old @'
import { translateUI, translateDynamic } from "@/lib/radar/i18n";
'@ -New @'
import { translateUI, translateDynamic } from "@/lib/radar/i18n";
import { normalizeResetScope } from "@/lib/radar/resetScope";
'@

Replace-Exact -Path "components/ResetHistoryDetails.tsx" -Old @'
const ALL_PAID_PLAN_SCOPES = new Set(["全有料プラン", "All paid plans", "所有付费套餐"]);

function isAllPaidPlanScope(value: string | null | undefined) {
  return Boolean(value && ALL_PAID_PLAN_SCOPES.has(value.trim()));
}

'@ -New ""

Replace-Exact -Path "components/ResetHistoryDetails.tsx" -Old @'
  const rawScope = details.scope?.trim() || item.scope?.trim() || "";
  const isAllPaid = isAllPaidPlanScope(rawScope);
  const shouldShowScope = Boolean(rawScope && !isAllPaid && isMeaningfulValue(rawScope));
'@ -New @'
  const rawScope = details.scope?.trim() || item.scope?.trim() || "";
  const canonicalScope = normalizeResetScope(rawScope);
  const shouldShowScope = canonicalScope === "一部ユーザー";
'@

Replace-Exact -Path "tests/tiboFormalHistory.test.ts" -Old @'
  assert.equal(event.details?.reasonType, undefined);
  assert.equal(event.scope, "Codex / ChatGPT Work");
  assert.equal(event.details?.scope, "Codex / ChatGPT Work");
'@ -New @'
  assert.equal(event.details?.reasonType, "ご祝儀リセット");
  assert.equal(event.scope, undefined);
  assert.equal(event.details?.scope, undefined);
'@

Replace-Exact -Path "tests/tiboFormalHistory.test.ts" -Old @'
  assert.equal(event.details?.reasonType, undefined);
});

test("keeps explicit celebration evidence on the completion signal", () => {
'@ -New @'
  assert.equal(event.details?.reasonType, "ご祝儀リセット");
});

test("keeps explicit celebration evidence on the completion signal", () => {
'@

Replace-Exact -Path "tests/tiboFormalHistory.test.ts" -Old @'
  assert.notEqual(event.scope, "全有料プラン");
  assert.equal(event.scope, "Codex / ChatGPT Work");
'@ -New @'
  assert.notEqual(event.scope, "全有料プラン");
  assert.equal(event.scope, undefined);
'@

$normalizerTest = @'
import assert from "node:assert/strict";
import test from "node:test";

import { normalizeResetScope } from "../lib/radar/resetScope";

test("normalizes broad reset scope to all paid plans", () => {
  assert.equal(normalizeResetScope("全有料プラン"), "全有料プラン");
  assert.equal(normalizeResetScope("全ユーザー"), "全有料プラン");
  assert.equal(normalizeResetScope("All paid plans"), "全有料プラン");
});

test("normalizes legacy narrow reset scope to partial users", () => {
  assert.equal(normalizeResetScope("一部ユーザー"), "一部ユーザー");
  assert.equal(normalizeResetScope("任意リセット未使用アカウント"), "一部ユーザー");
  assert.equal(normalizeResetScope("不具合対象ユーザー（約50万人）"), "一部ユーザー");
  assert.equal(normalizeResetScope("Some users"), "一部ユーザー");
});

test("drops ambiguous or product-name-only scope labels", () => {
  assert.equal(normalizeResetScope("Codex / ChatGPT Work"), undefined);
  assert.equal(normalizeResetScope("Astra users"), undefined);
  assert.equal(normalizeResetScope(""), undefined);
  assert.equal(normalizeResetScope(undefined), undefined);
});
'@
[System.IO.File]::WriteAllText("tests/resetScopeNormalizer.test.ts", $normalizerTest, [System.Text.UTF8Encoding]::new($false))

Write-Host "Task 1 scope/reason policy patch applied."
