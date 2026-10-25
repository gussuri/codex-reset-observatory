import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import {
  CODEX_USAGE_SOURCE_KEY,
  MAX_USAGE_COMPARISON_GAP_MS,
  RESET_AT_MEANINGFUL_FORWARD_SEC,
  type CodexUsageSnapshot,
} from "../lib/codexUsageRecovery";

export const MONITOR_RECOVERY_CANDIDATE_SCHEMA_VERSION = 2;
const LEGACY_MONITOR_RECOVERY_CANDIDATE_SCHEMA_VERSION = 1;
export const MONITOR_RECOVERY_CANDIDATE_TTL_MS = MAX_USAGE_COMPARISON_GAP_MS;
export const MONITOR_RECOVERY_CANDIDATE_SOURCE = CODEX_USAGE_SOURCE_KEY;
export const RESET_AT_JITTER_TOLERANCE_SEC = 30;
const RESET_AT_JITTER_TOLERANCE_MS = RESET_AT_JITTER_TOLERANCE_SEC * 1000;
const MIN_SCHEDULE_DISAMBIGUATION_MS = 60_000;
const SCHEDULE_USAGE_INCREASE_PP = 1;
const MAX_BANKED_RESET_AVAILABLE_COUNT = 1_000;
const MAX_CLOCK_SKEW_MS = 30_000;

export type MonitorRecoveryScheduleMode =
  | "undetermined"
  | "fixed"
  | "rolling"
  | "fixed_after_usage"
  | "legacy_fixed";

export type PendingRecoveryCandidateRecord = {
  preRecoveryBaseline: CodexUsageSnapshot;
  firstEvidenceSnapshot: CodexUsageSnapshot;
  candidateStartedAtMs: number;
  lastObservation: CodexUsageSnapshot;
  observationCount: number;
  scheduleMode?: MonitorRecoveryScheduleMode;
  lastRollingObservation?: CodexUsageSnapshot;
  scheduleFreezeObservation?: CodexUsageSnapshot;
  lastSuccessfulPostAtMs?: number;
  lastKnownBankedResetAvailableCount?: number | null;
};

export type RestoredMonitorRecoveryCandidate = PendingRecoveryCandidateRecord & {
  scheduleMode: MonitorRecoveryScheduleMode;
  lastSuccessfulPostAtMs: number;
  lastKnownBankedResetAvailableCount: number | null;
};

export type RecoveryCandidateDiscardReason = "corrupt" | "stale" | "identity_mismatch" | "inconsistent";

export type MonitorRecoveryCandidateLoadResult = {
  candidate: RestoredMonitorRecoveryCandidate | null;
  discardedReason?: RecoveryCandidateDiscardReason;
};

export class MonitorRecoveryCandidateStoreError extends Error {
  constructor(readonly reason: "recovery_candidate_read_failed" | "recovery_candidate_write_failed" | "recovery_candidate_delete_failed") {
    super(reason);
    this.name = "MonitorRecoveryCandidateStoreError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeSnapshot(value: unknown): CodexUsageSnapshot | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.observedAt !== "string" ||
    !Number.isFinite(Date.parse(value.observedAt)) ||
    value.limitId !== "codex" ||
    typeof value.planType !== "string" ||
    value.planType.trim() === "" ||
    value.planType.length > 100 ||
    typeof value.usedPercent !== "number" ||
    !Number.isFinite(value.usedPercent) ||
    value.usedPercent < 0 ||
    value.usedPercent > 100 ||
    value.windowDurationMins !== 10_080 ||
    typeof value.resetsAt !== "number" ||
    !Number.isSafeInteger(value.resetsAt) ||
    value.resetsAt <= 0
  ) {
    return null;
  }

  const snapshot: CodexUsageSnapshot = {
    observedAt: value.observedAt,
    limitId: "codex",
    planType: value.planType,
    usedPercent: value.usedPercent,
    windowDurationMins: 10_080,
    resetsAt: value.resetsAt,
  };

  if ("bankedResetAvailableCount" in value) {
    const count = value.bankedResetAvailableCount;
    if (count !== null && (
      typeof count !== "number" ||
      !Number.isSafeInteger(count) ||
      count < 0 ||
      count > MAX_BANKED_RESET_AVAILABLE_COUNT
    )) return null;
    snapshot.bankedResetAvailableCount = count;
  }

  return snapshot;
}

function sameIdentity(left: CodexUsageSnapshot, right: CodexUsageSnapshot) {
  return left.limitId === right.limitId &&
    left.planType === right.planType &&
    left.windowDurationMins === right.windowDurationMins;
}

function isFixedScheduleMatch(first: CodexUsageSnapshot, current: CodexUsageSnapshot) {
  return Math.abs(current.resetsAt - first.resetsAt) <= RESET_AT_JITTER_TOLERANCE_SEC;
}

export function isRollingWeeklyScheduleMatch(first: CodexUsageSnapshot, current: CodexUsageSnapshot) {
  const firstAt = Date.parse(first.observedAt);
  const currentAt = Date.parse(current.observedAt);
  if (!Number.isFinite(firstAt) || !Number.isFinite(currentAt) || currentAt < firstAt) return false;

  const weeklyWindowMs = first.windowDurationMins * 60_000;
  const firstOffsetMs = first.resetsAt * 1000 - firstAt;
  const currentOffsetMs = current.resetsAt * 1000 - currentAt;
  const expectedResetAdvanceMs = currentAt - firstAt;
  const actualResetAdvanceMs = (current.resetsAt - first.resetsAt) * 1000;
  return Math.abs(firstOffsetMs - weeklyWindowMs) <= RESET_AT_JITTER_TOLERANCE_MS &&
    Math.abs(currentOffsetMs - weeklyWindowMs) <= RESET_AT_JITTER_TOLERANCE_MS &&
    Math.abs(actualResetAdvanceMs - expectedResetAdvanceMs) <= RESET_AT_JITTER_TOLERANCE_MS;
}

function isPositiveRollingStep(previous: CodexUsageSnapshot, current: CodexUsageSnapshot) {
  const previousAt = Date.parse(previous.observedAt);
  const currentAt = Date.parse(current.observedAt);
  const elapsedMs = currentAt - previousAt;
  const resetAdvanceMs = (current.resetsAt - previous.resetsAt) * 1000;
  return Number.isFinite(previousAt) && Number.isFinite(currentAt) && elapsedMs > 0 && resetAdvanceMs > 0 &&
    Math.abs(resetAdvanceMs - elapsedMs) <= RESET_AT_JITTER_TOLERANCE_MS;
}

function isFixedAfterUsageTransition(
  previousRolling: CodexUsageSnapshot,
  current: CodexUsageSnapshot,
) {
  const previousAt = Date.parse(previousRolling.observedAt);
  const currentAt = Date.parse(current.observedAt);
  return Number.isFinite(previousAt) && Number.isFinite(currentAt) &&
    currentAt - previousAt > RESET_AT_JITTER_TOLERANCE_MS &&
    Math.abs(current.resetsAt - previousRolling.resetsAt) <= RESET_AT_JITTER_TOLERANCE_SEC &&
    current.usedPercent - previousRolling.usedPercent >= SCHEDULE_USAGE_INCREASE_PP;
}

function isShortFreezeAmbiguousObservation(
  previousRolling: CodexUsageSnapshot,
  current: CodexUsageSnapshot,
) {
  const previousAt = Date.parse(previousRolling.observedAt);
  const currentAt = Date.parse(current.observedAt);
  const elapsedMs = currentAt - previousAt;
  return Number.isFinite(previousAt) && Number.isFinite(currentAt) &&
    elapsedMs > 0 && elapsedMs <= RESET_AT_JITTER_TOLERANCE_MS &&
    Math.abs(current.resetsAt - previousRolling.resetsAt) <= RESET_AT_JITTER_TOLERANCE_SEC &&
    current.usedPercent > previousRolling.usedPercent &&
    !isPositiveRollingStep(previousRolling, current);
}

export type MonitorRecoveryScheduleAdvance = {
  schedule: Pick<PendingRecoveryCandidateRecord, "scheduleMode" | "lastRollingObservation" | "scheduleFreezeObservation">;
  confirmationEligible: boolean;
};

export function advanceMonitorRecoverySchedule(
  candidate: PendingRecoveryCandidateRecord,
  current: CodexUsageSnapshot,
): MonitorRecoveryScheduleAdvance | null {
  const mode = candidate.scheduleMode ?? "legacy_fixed";
  const first = candidate.firstEvidenceSnapshot;
  const fixedMatch = isFixedScheduleMatch(first, current);
  const rollingMatch = isRollingWeeklyScheduleMatch(first, current);

  if (mode === "undetermined") {
    if (fixedMatch && rollingMatch) return { schedule: { scheduleMode: "undetermined" }, confirmationEligible: true };
    const elapsedSinceFirstMs = Date.parse(current.observedAt) - Date.parse(first.observedAt);
    if (fixedMatch && elapsedSinceFirstMs >= MIN_SCHEDULE_DISAMBIGUATION_MS) {
      return { schedule: { scheduleMode: "fixed" }, confirmationEligible: true };
    }
    if (fixedMatch) return { schedule: { scheduleMode: "undetermined" }, confirmationEligible: true };
    if (rollingMatch && current.resetsAt > first.resetsAt) {
      return { schedule: { scheduleMode: "rolling", lastRollingObservation: current }, confirmationEligible: true };
    }
    return null;
  }

  if (mode === "fixed" || mode === "legacy_fixed") {
    return fixedMatch ? { schedule: { scheduleMode: mode }, confirmationEligible: true } : null;
  }

  if (mode === "rolling") {
    const lastRolling = candidate.lastRollingObservation;
    if (!lastRolling) return null;
    if (rollingMatch) {
      const positiveRollingStep = isPositiveRollingStep(lastRolling, current);
      return {
        schedule: {
          scheduleMode: "rolling",
          lastRollingObservation: positiveRollingStep ? current : lastRolling,
        },
        confirmationEligible: !isShortFreezeAmbiguousObservation(lastRolling, current),
      };
    }
    if (isFixedAfterUsageTransition(lastRolling, current)) {
      return {
        schedule: {
          scheduleMode: "fixed_after_usage",
          lastRollingObservation: lastRolling,
          scheduleFreezeObservation: current,
        },
        confirmationEligible: true,
      };
    }
    return null;
  }

  const freeze = candidate.scheduleFreezeObservation;
  return freeze && isFixedScheduleMatch(freeze, current)
    ? {
        schedule: {
          scheduleMode: "fixed_after_usage",
          lastRollingObservation: candidate.lastRollingObservation,
          scheduleFreezeObservation: freeze,
        },
        confirmationEligible: true,
      }
    : null;
}

function sameSnapshot(left: CodexUsageSnapshot, right: CodexUsageSnapshot) {
  return left.observedAt === right.observedAt &&
    left.limitId === right.limitId &&
    left.planType === right.planType &&
    left.usedPercent === right.usedPercent &&
    left.windowDurationMins === right.windowDurationMins &&
    left.resetsAt === right.resetsAt &&
    left.bankedResetAvailableCount === right.bankedResetAvailableCount;
}

function normalizeCandidate(value: unknown, nowMs: number, schemaVersion: number): {
  candidate: RestoredMonitorRecoveryCandidate | null;
  discardedReason?: RecoveryCandidateDiscardReason;
} {
  if (!isRecord(value)) return { candidate: null, discardedReason: "corrupt" };

  const baseline = normalizeSnapshot(value.preRecoveryBaseline);
  const firstEvidence = normalizeSnapshot(value.firstEvidenceSnapshot);
  const lastObservation = normalizeSnapshot(value.lastObservation);
  const lastRollingObservation = schemaVersion === MONITOR_RECOVERY_CANDIDATE_SCHEMA_VERSION && value.lastRollingObservation !== undefined
    ? normalizeSnapshot(value.lastRollingObservation)
    : null;
  const scheduleFreezeObservation = schemaVersion === MONITOR_RECOVERY_CANDIDATE_SCHEMA_VERSION && value.scheduleFreezeObservation !== undefined
    ? normalizeSnapshot(value.scheduleFreezeObservation)
    : null;
  const candidateStartedAtMs = value.candidateStartedAtMs;
  const observationCount = value.observationCount;
  const lastSuccessfulPostAtMs = value.lastSuccessfulPostAtMs;
  const lastKnownBankedResetAvailableCount = value.lastKnownBankedResetAvailableCount;
  const scheduleModeValue = schemaVersion === LEGACY_MONITOR_RECOVERY_CANDIDATE_SCHEMA_VERSION
    ? "legacy_fixed"
    : value.scheduleMode;
  if (
    !baseline ||
    !firstEvidence ||
    !lastObservation ||
    schemaVersion === LEGACY_MONITOR_RECOVERY_CANDIDATE_SCHEMA_VERSION && (
      "scheduleMode" in value || "lastRollingObservation" in value || "scheduleFreezeObservation" in value
    ) ||
    schemaVersion === MONITOR_RECOVERY_CANDIDATE_SCHEMA_VERSION && (
      ![
        "undetermined", "fixed", "rolling", "fixed_after_usage", "legacy_fixed",
      ].includes(String(scheduleModeValue)) ||
      value.lastRollingObservation !== undefined && !lastRollingObservation ||
      value.scheduleFreezeObservation !== undefined && !scheduleFreezeObservation
    ) ||
    typeof candidateStartedAtMs !== "number" ||
    !Number.isSafeInteger(candidateStartedAtMs) ||
    candidateStartedAtMs <= 0 ||
    typeof observationCount !== "number" ||
    !Number.isSafeInteger(observationCount) ||
    observationCount < 1 ||
    typeof lastSuccessfulPostAtMs !== "number" ||
    !Number.isSafeInteger(lastSuccessfulPostAtMs) ||
    lastSuccessfulPostAtMs <= 0 ||
    typeof lastKnownBankedResetAvailableCount !== "number" && lastKnownBankedResetAvailableCount !== null ||
    typeof lastKnownBankedResetAvailableCount === "number" && (
      !Number.isSafeInteger(lastKnownBankedResetAvailableCount) ||
      lastKnownBankedResetAvailableCount < 0 ||
      lastKnownBankedResetAvailableCount > MAX_BANKED_RESET_AVAILABLE_COUNT
    )
  ) return { candidate: null, discardedReason: "corrupt" };

  const baselineAt = Date.parse(baseline.observedAt);
  const firstAt = Date.parse(firstEvidence.observedAt);
  const lastAt = Date.parse(lastObservation.observedAt);
  const identitySnapshots = [
    baseline,
    firstEvidence,
    lastObservation,
    ...(lastRollingObservation ? [lastRollingObservation] : []),
    ...(scheduleFreezeObservation ? [scheduleFreezeObservation] : []),
  ];
  if (identitySnapshots.some((item) => !sameIdentity(baseline, item))) {
    return { candidate: null, discardedReason: "identity_mismatch" };
  }

  if (
    !Number.isFinite(nowMs) ||
    candidateStartedAtMs > nowMs + MAX_CLOCK_SKEW_MS ||
    firstAt > nowMs + MAX_CLOCK_SKEW_MS ||
    nowMs - candidateStartedAtMs > MONITOR_RECOVERY_CANDIDATE_TTL_MS ||
    nowMs - firstAt > MONITOR_RECOVERY_CANDIDATE_TTL_MS
  ) return { candidate: null, discardedReason: "stale" };

  const startToEvidenceMs = Math.abs(candidateStartedAtMs - firstAt);
  const baselineToEvidenceMs = firstAt - baselineAt;
  const evidenceToLastMs = lastAt - firstAt;
  const resetsAtAdvance = firstEvidence.resetsAt - baseline.resetsAt;
  if (
    startToEvidenceMs > MAX_CLOCK_SKEW_MS ||
    lastSuccessfulPostAtMs > nowMs + MAX_CLOCK_SKEW_MS ||
    baselineToEvidenceMs <= 0 ||
    baselineToEvidenceMs > MONITOR_RECOVERY_CANDIDATE_TTL_MS ||
    evidenceToLastMs < 0 ||
    evidenceToLastMs > MONITOR_RECOVERY_CANDIDATE_TTL_MS ||
    observationCount < 1 ||
    baseline.usedPercent - firstEvidence.usedPercent < 1 ||
    baseline.usedPercent - lastObservation.usedPercent < 1 ||
    resetsAtAdvance < RESET_AT_MEANINGFUL_FORWARD_SEC ||
    lastObservation.resetsAt - baseline.resetsAt < RESET_AT_MEANINGFUL_FORWARD_SEC - RESET_AT_JITTER_TOLERANCE_SEC
  ) return { candidate: null, discardedReason: "inconsistent" };

  const scheduleMode = scheduleModeValue as MonitorRecoveryScheduleMode;
  if (schemaVersion === LEGACY_MONITOR_RECOVERY_CANDIDATE_SCHEMA_VERSION) {
    if (!isFixedScheduleMatch(firstEvidence, lastObservation)) {
      return { candidate: null, discardedReason: "inconsistent" };
    }
  } else {
    const fixedMatch = isFixedScheduleMatch(firstEvidence, lastObservation);
    const rollingMatch = isRollingWeeklyScheduleMatch(firstEvidence, lastObservation);
    if (scheduleMode === "undetermined") {
      if (observationCount === 1) {
        if (!sameSnapshot(firstEvidence, lastObservation)) {
          return { candidate: null, discardedReason: "inconsistent" };
        }
      } else {
        const elapsedSinceFirstMs = lastAt - firstAt;
        if (!(fixedMatch && rollingMatch) && !(fixedMatch && elapsedSinceFirstMs < MIN_SCHEDULE_DISAMBIGUATION_MS)) {
          return { candidate: null, discardedReason: "inconsistent" };
        }
      }
      if (lastRollingObservation || scheduleFreezeObservation) {
        return { candidate: null, discardedReason: "inconsistent" };
      }
    } else if (scheduleMode === "fixed") {
      if (observationCount < 2 || !fixedMatch || rollingMatch || lastAt - firstAt < MIN_SCHEDULE_DISAMBIGUATION_MS || lastRollingObservation || scheduleFreezeObservation) {
        return { candidate: null, discardedReason: "inconsistent" };
      }
    } else if (scheduleMode === "rolling") {
      if (
        observationCount < 2 ||
        !lastRollingObservation ||
        scheduleFreezeObservation ||
        !isRollingWeeklyScheduleMatch(firstEvidence, lastRollingObservation) ||
        !rollingMatch ||
        Date.parse(lastRollingObservation.observedAt) <= firstAt ||
        Date.parse(lastRollingObservation.observedAt) > lastAt ||
        lastAt - Date.parse(lastRollingObservation.observedAt) > MONITOR_RECOVERY_CANDIDATE_TTL_MS ||
        lastRollingObservation.resetsAt - baseline.resetsAt < RESET_AT_MEANINGFUL_FORWARD_SEC - RESET_AT_JITTER_TOLERANCE_SEC ||
        baseline.usedPercent - lastRollingObservation.usedPercent < 1
      ) return { candidate: null, discardedReason: "inconsistent" };
    } else if (scheduleMode === "fixed_after_usage") {
      if (
        observationCount < 3 ||
        !lastRollingObservation ||
        !scheduleFreezeObservation ||
        Date.parse(lastRollingObservation.observedAt) <= firstAt ||
        Date.parse(scheduleFreezeObservation.observedAt) <= Date.parse(lastRollingObservation.observedAt) ||
        Date.parse(scheduleFreezeObservation.observedAt) > lastAt ||
        Date.parse(lastRollingObservation.observedAt) - firstAt > MONITOR_RECOVERY_CANDIDATE_TTL_MS ||
        Date.parse(scheduleFreezeObservation.observedAt) - Date.parse(lastRollingObservation.observedAt) > MONITOR_RECOVERY_CANDIDATE_TTL_MS ||
        lastAt - Date.parse(scheduleFreezeObservation.observedAt) > MONITOR_RECOVERY_CANDIDATE_TTL_MS ||
        !isRollingWeeklyScheduleMatch(firstEvidence, lastRollingObservation) ||
        !isFixedAfterUsageTransition(lastRollingObservation, scheduleFreezeObservation) ||
        !isFixedScheduleMatch(scheduleFreezeObservation, lastObservation) ||
        lastRollingObservation.resetsAt - baseline.resetsAt < RESET_AT_MEANINGFUL_FORWARD_SEC - RESET_AT_JITTER_TOLERANCE_SEC ||
        scheduleFreezeObservation.resetsAt - baseline.resetsAt < RESET_AT_MEANINGFUL_FORWARD_SEC - RESET_AT_JITTER_TOLERANCE_SEC ||
        baseline.usedPercent - lastRollingObservation.usedPercent < 1 ||
        baseline.usedPercent - scheduleFreezeObservation.usedPercent < 1
      ) return { candidate: null, discardedReason: "inconsistent" };
    } else if (
      !isFixedScheduleMatch(firstEvidence, lastObservation) ||
      lastRollingObservation ||
      scheduleFreezeObservation
    ) {
      return { candidate: null, discardedReason: "inconsistent" };
    }
  }

  return {
    candidate: {
      preRecoveryBaseline: baseline,
      firstEvidenceSnapshot: firstEvidence,
      candidateStartedAtMs,
      lastObservation,
      observationCount,
      scheduleMode,
      ...(lastRollingObservation ? { lastRollingObservation } : {}),
      ...(scheduleFreezeObservation ? { scheduleFreezeObservation } : {}),
      lastSuccessfulPostAtMs,
      lastKnownBankedResetAvailableCount,
    },
  };
}

export function getMonitorRecoveryCandidatePath(queuePath: string) {
  return path.join(path.dirname(queuePath), "pending-recovery-candidate.json");
}

export function createMonitorRecoveryCandidateStore(filePath: string) {
  const discardFile = () => {
    try {
      fs.unlinkSync(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw new MonitorRecoveryCandidateStoreError("recovery_candidate_delete_failed");
      }
    }
  };

  return {
    load(nowMs = Date.now()): MonitorRecoveryCandidateLoadResult {
      let raw: string;
      try {
        raw = fs.readFileSync(filePath, "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return { candidate: null };
        throw new MonitorRecoveryCandidateStoreError("recovery_candidate_read_failed");
      }

      let envelope: unknown;
      try {
        envelope = JSON.parse(raw);
      } catch {
        discardFile();
        return { candidate: null, discardedReason: "corrupt" };
      }

      if (
        !isRecord(envelope) ||
        envelope.schemaVersion !== MONITOR_RECOVERY_CANDIDATE_SCHEMA_VERSION &&
          envelope.schemaVersion !== LEGACY_MONITOR_RECOVERY_CANDIDATE_SCHEMA_VERSION
      ) {
        discardFile();
        return { candidate: null, discardedReason: "corrupt" };
      }
      if (
        envelope.source !== MONITOR_RECOVERY_CANDIDATE_SOURCE ||
        !isRecord(envelope.identity)
      ) {
        discardFile();
        return { candidate: null, discardedReason: "identity_mismatch" };
      }

      const result = normalizeCandidate(envelope.candidate, nowMs, envelope.schemaVersion);
      if (!result.candidate) {
        discardFile();
        return { candidate: null, discardedReason: result.discardedReason ?? "corrupt" };
      }

      const identity = envelope.identity;
      const baseline = result.candidate.preRecoveryBaseline;
      if (
        identity.limitId !== baseline.limitId ||
        identity.planType !== baseline.planType ||
        identity.windowDurationMins !== baseline.windowDurationMins
      ) {
        discardFile();
        return { candidate: null, discardedReason: "identity_mismatch" };
      }

      return { candidate: result.candidate };
    },

    save(
      candidate: PendingRecoveryCandidateRecord,
      nowMs = Date.now(),
      runtimeState?: {
        lastSuccessfulPostAtMs: number;
        lastKnownBankedResetAvailableCount: number | null;
      },
    ) {
      const candidateWithRuntimeState = {
        ...candidate,
        scheduleMode: candidate.scheduleMode ?? "legacy_fixed",
        ...(runtimeState ?? {}),
      };
      const normalized = normalizeCandidate(candidateWithRuntimeState, nowMs, MONITOR_RECOVERY_CANDIDATE_SCHEMA_VERSION);
      if (!normalized.candidate) {
        throw new MonitorRecoveryCandidateStoreError("recovery_candidate_write_failed");
      }

      const value = normalized.candidate;
      const envelope = {
        schemaVersion: MONITOR_RECOVERY_CANDIDATE_SCHEMA_VERSION,
        source: MONITOR_RECOVERY_CANDIDATE_SOURCE,
        identity: {
          limitId: value.preRecoveryBaseline.limitId,
          planType: value.preRecoveryBaseline.planType,
          windowDurationMins: value.preRecoveryBaseline.windowDurationMins,
        },
        candidate: value,
      };
      const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
      let descriptor: number | null = null;
      try {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        descriptor = fs.openSync(temporaryPath, "wx", 0o600);
        fs.writeFileSync(descriptor, JSON.stringify(envelope), "utf8");
        fs.fsyncSync(descriptor);
        fs.closeSync(descriptor);
        descriptor = null;
        fs.renameSync(temporaryPath, filePath);
      } catch {
        if (descriptor !== null) {
          try { fs.closeSync(descriptor); } catch { /* best-effort close */ }
        }
        try { fs.unlinkSync(temporaryPath); } catch { /* best-effort temp cleanup */ }
        throw new MonitorRecoveryCandidateStoreError("recovery_candidate_write_failed");
      }
    },

    clear() {
      discardFile();
    },
  };
}

export type MonitorRecoveryCandidateStore = ReturnType<typeof createMonitorRecoveryCandidateStore>;
