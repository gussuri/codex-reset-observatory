import { isBearerAuthorizationValid } from "./security/bearerAuth";

export const CODEX_WEEKLY_WINDOW_MINUTES = 7 * 24 * 60;
export const MAX_USAGE_COMPARISON_GAP_MS = 10 * 60 * 1000;
export const RESET_AT_MEANINGFUL_FORWARD_SEC = 60 * 60;
export const REGULAR_RESET_PROXIMITY_MS = 60 * 60 * 1000;
export const UNCONFIRMED_RECOVERY_ACTIVE_MS = 90 * 60 * 1000;
export const USAGE_TIBO_MATCH_WINDOW_MS = 90 * 60 * 1000;
export const CODEX_USAGE_SOURCE_KEY = "local-codex-app-server";

export type CodexUsageSnapshot = {
  observedAt: string;
  limitId: "codex";
  planType: string;
  usedPercent: number;
  windowDurationMins: typeof CODEX_WEEKLY_WINDOW_MINUTES;
  resetsAt: number;
};

export type CodexRecoveryCycleHint = "regular" | "unexpected" | "unknown";
export type CodexRecoveryConfidence = "strong" | "medium";
export type CodexRecoveryStatus = "observed" | "confirmed" | "rejected";

export type CodexRecoveryObservation = {
  id?: string;
  sourceKey: string;
  observedAt: string;
  previousObservedAt?: string | null;
  previousUsedPercent: number;
  currentUsedPercent: number;
  previousResetsAt: number;
  currentResetsAt: number;
  cycleHint: CodexRecoveryCycleHint;
  confidence: CodexRecoveryConfidence;
  status: CodexRecoveryStatus;
  matchedTiboTweetId?: string | null;
  confirmedAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type PublicRecoveryObservation = {
  status: "observed_unconfirmed";
  observedAt: string;
  confidence: "strong";
  cycleHint: Exclude<CodexRecoveryCycleHint, "regular">;
};

export type CodexUsageRecoveryDecision =
  | { kind: "baseline" }
  | { kind: "stale" }
  | { kind: "rebase" }
  | { kind: "invalid" }
  | { kind: "no_recovery" }
  | {
      kind: "recovery";
      nearRegularSchedule: boolean;
      cycleHint: CodexRecoveryCycleHint;
      confidence: CodexRecoveryConfidence;
      previous: CodexUsageSnapshot;
      current: CodexUsageSnapshot;
    };

const MAX_PLAN_TYPE_LENGTH = 64;
const MAX_LIMIT_ID_LENGTH = 64;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getFiniteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function getPositiveInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

function getObservedTime(value: Date | string | undefined) {
  const date = value instanceof Date ? value : new Date(value ?? Date.now());
  return Number.isFinite(date.getTime()) ? date : null;
}

function readWindow(value: unknown) {
  if (!isRecord(value)) return null;

  const usedPercent = getFiniteNumber(value.usedPercent ?? value.used_percent);
  const windowDurationMins = getPositiveInteger(
    value.windowDurationMins ?? value.window_duration_mins,
  );
  const resetsAt = getPositiveInteger(value.resetsAt ?? value.resets_at);
  if (
    usedPercent === null ||
    usedPercent < 0 ||
    usedPercent > 100 ||
    windowDurationMins === null ||
    resetsAt === null
  ) {
    return null;
  }

  return { usedPercent, windowDurationMins, resetsAt };
}

function getRateLimitSnapshots(root: Record<string, unknown>) {
  const result = isRecord(root.result) ? root.result : root;
  const byLimitId = result.rateLimitsByLimitId ?? result.rate_limits_by_limit_id;
  if (isRecord(byLimitId)) {
    return Object.entries(byLimitId).map(([key, value]) => ({
      key,
      value: isRecord(value) ? value : null,
    }));
  }

  const rateLimits = result.rateLimits ?? result.rate_limits;
  return [{ key: null, value: isRecord(rateLimits) ? rateLimits : null }];
}

/**
 * Extract only the weekly Codex quota from an app-server response. The
 * app-server exposes primary/secondary windows, so the weekly duration is
 * selected by value rather than by position.
 */
export function parseCodexRateLimitsResponse(
  value: unknown,
  observedAt: Date | string = new Date(),
): CodexUsageSnapshot | null {
  if (!isRecord(value)) return null;
  const observedDate = getObservedTime(observedAt);
  if (!observedDate) return null;

  const snapshots = getRateLimitSnapshots(value);
  const candidates: Array<{
    key: string | null;
    limitId: string | null;
    planType: string;
    window: { usedPercent: number; windowDurationMins: number; resetsAt: number };
  }> = [];

  for (const snapshot of snapshots) {
    if (!snapshot.value) return null;
    const limitIdValue = snapshot.value.limitId ?? snapshot.value.limit_id ?? snapshot.key;
    const limitId = typeof limitIdValue === "string" && limitIdValue.length <= MAX_LIMIT_ID_LENGTH
      ? limitIdValue
      : null;
    const planValue = snapshot.value.planType ?? snapshot.value.plan_type;
    const planType = typeof planValue === "string" && planValue.length <= MAX_PLAN_TYPE_LENGTH
      ? planValue || "unknown"
      : "unknown";

    for (const windowKey of ["primary", "secondary"] as const) {
      const rawWindow = snapshot.value[windowKey];
      if (rawWindow === null || rawWindow === undefined) continue;
      const window = readWindow(rawWindow);
      if (!window) return null;
      if (window.windowDurationMins === CODEX_WEEKLY_WINDOW_MINUTES) {
        candidates.push({ key: snapshot.key, limitId, planType, window });
      }
    }
  }

  const codexCandidates = candidates.filter((candidate) => candidate.limitId === "codex");
  const selected = codexCandidates.length === 1
    ? codexCandidates[0]
    : codexCandidates.length > 1
      ? null
      : candidates.length === 1
        ? candidates[0]
        : null;
  if (!selected) return null;

  return {
    observedAt: observedDate.toISOString(),
    limitId: "codex",
    planType: selected.planType,
    usedPercent: selected.window.usedPercent,
    windowDurationMins: CODEX_WEEKLY_WINDOW_MINUTES,
    resetsAt: selected.window.resetsAt,
  };
}

function isValidPlanType(value: unknown): value is string {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_PLAN_TYPE_LENGTH &&
    /^[a-z0-9_-]+$/i.test(value);
}

/** Validates the exact public-to-webhook shape without retaining extra fields. */
export function parseCodexUsageWebhookPayload(
  value: unknown,
  now: Date = new Date(),
): CodexUsageSnapshot | null {
  if (!isRecord(value)) return null;
  const allowed = new Set([
    "observedAt",
    "limitId",
    "planType",
    "usedPercent",
    "windowDurationMins",
    "resetsAt",
  ]);
  if (Object.keys(value).some((key) => !allowed.has(key))) return null;

  const observedAt = typeof value.observedAt === "string" ? new Date(value.observedAt) : null;
  const nowTime = now.getTime();
  if (!observedAt || !Number.isFinite(observedAt.getTime()) || !Number.isFinite(nowTime)) return null;
  if (observedAt.getTime() > nowTime + 5 * 60 * 1000) return null;
  if (value.limitId !== "codex") return null;
  if (!isValidPlanType(value.planType)) return null;
  if (typeof value.usedPercent !== "number" || !Number.isFinite(value.usedPercent) || value.usedPercent < 0 || value.usedPercent > 100) return null;
  if (value.windowDurationMins !== CODEX_WEEKLY_WINDOW_MINUTES) return null;
  const resetsAt = getPositiveInteger(value.resetsAt);
  if (resetsAt === null) return null;

  return {
    observedAt: observedAt.toISOString(),
    limitId: "codex",
    planType: value.planType,
    usedPercent: value.usedPercent,
    windowDurationMins: CODEX_WEEKLY_WINDOW_MINUTES,
    resetsAt,
  };
}

export function isCodexUsageAuthorizationValid(
  authorizationHeader: string | null,
  expectedSecret: string | undefined,
) {
  return isBearerAuthorizationValid(authorizationHeader, expectedSecret);
}

export function evaluateCodexUsageRecovery(
  previous: CodexUsageSnapshot | null | undefined,
  current: CodexUsageSnapshot,
  options: { activeOfficialNotice?: boolean } = {},
): CodexUsageRecoveryDecision {
  if (!previous) return { kind: "baseline" };

  const previousTime = Date.parse(previous.observedAt);
  const currentTime = Date.parse(current.observedAt);
  if (!Number.isFinite(previousTime) || !Number.isFinite(currentTime)) return { kind: "invalid" };
  if (currentTime <= previousTime) return { kind: "stale" };
  if (currentTime - previousTime > MAX_USAGE_COMPARISON_GAP_MS) return { kind: "rebase" };

  const usageDecrease = previous.usedPercent - current.usedPercent;
  const resetsAtAdvance = current.resetsAt - previous.resetsAt;
  if (usageDecrease < 1 || resetsAtAdvance < RESET_AT_MEANINGFUL_FORWARD_SEC) {
    return { kind: "no_recovery" };
  }

  const nearRegularSchedule = Math.abs(currentTime - previous.resetsAt * 1000) <= REGULAR_RESET_PROXIMITY_MS;
  const activeOfficialNotice = options.activeOfficialNotice === true;
  const cycleHint: CodexRecoveryCycleHint = nearRegularSchedule
    ? activeOfficialNotice ? "unknown" : "regular"
    : "unexpected";
  const confidence: CodexRecoveryConfidence = activeOfficialNotice ? "strong" : "medium";

  return {
    kind: "recovery",
    nearRegularSchedule,
    cycleHint,
    confidence,
    previous,
    current,
  };
}

export function getPublicRecoveryObservation(
  observation: CodexRecoveryObservation | null | undefined,
  now: Date = new Date(),
  latestResetAt?: string | null,
): PublicRecoveryObservation | null {
  if (!observation || observation.status !== "observed" || observation.confidence !== "strong" || observation.cycleHint === "regular") {
    return null;
  }

  const observedTime = Date.parse(observation.observedAt);
  const nowTime = now.getTime();
  if (!Number.isFinite(observedTime) || !Number.isFinite(nowTime) || observedTime > nowTime) return null;
  if (nowTime - observedTime > UNCONFIRMED_RECOVERY_ACTIVE_MS) return null;

  if (latestResetAt) {
    const resetTime = Date.parse(latestResetAt);
    if (Number.isFinite(resetTime) && resetTime >= observedTime - 60 * 1000) {
      return null;
    }
  }

  return {
    status: "observed_unconfirmed",
    observedAt: new Date(observedTime).toISOString(),
    confidence: "strong",
    cycleHint: observation.cycleHint,
  };
}

export function doesTiboResetMatchUsageObservation(
  observation: CodexRecoveryObservation | null | undefined,
  tiboTweetCreatedAt: string,
) {
  if (!observation || observation.status !== "observed" || observation.cycleHint === "regular") return false;
  const observedTime = Date.parse(observation.observedAt);
  const tweetTime = Date.parse(tiboTweetCreatedAt);
  return Number.isFinite(observedTime) && Number.isFinite(tweetTime) &&
    Math.abs(tweetTime - observedTime) <= USAGE_TIBO_MATCH_WINDOW_MS;
}
