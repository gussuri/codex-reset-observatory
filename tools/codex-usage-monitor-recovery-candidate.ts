import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import {
  CODEX_USAGE_SOURCE_KEY,
  MAX_USAGE_COMPARISON_GAP_MS,
  RESET_AT_MEANINGFUL_FORWARD_SEC,
  type CodexUsageSnapshot,
} from "../lib/codexUsageRecovery";

export const MONITOR_RECOVERY_CANDIDATE_SCHEMA_VERSION = 1;
export const MONITOR_RECOVERY_CANDIDATE_TTL_MS = MAX_USAGE_COMPARISON_GAP_MS;
export const MONITOR_RECOVERY_CANDIDATE_SOURCE = CODEX_USAGE_SOURCE_KEY;
const RESET_AT_JITTER_TOLERANCE_SEC = 30;
const MAX_BANKED_RESET_AVAILABLE_COUNT = 1_000;
const MAX_CLOCK_SKEW_MS = 30_000;

export type PendingRecoveryCandidateRecord = {
  preRecoveryBaseline: CodexUsageSnapshot;
  firstEvidenceSnapshot: CodexUsageSnapshot;
  candidateStartedAtMs: number;
  lastObservation: CodexUsageSnapshot;
  observationCount: number;
  lastSuccessfulPostAtMs?: number;
  lastKnownBankedResetAvailableCount?: number | null;
};

export type RestoredMonitorRecoveryCandidate = PendingRecoveryCandidateRecord & {
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

function normalizeCandidate(value: unknown, nowMs: number): {
  candidate: RestoredMonitorRecoveryCandidate | null;
  discardedReason?: RecoveryCandidateDiscardReason;
} {
  if (!isRecord(value)) return { candidate: null, discardedReason: "corrupt" };

  const baseline = normalizeSnapshot(value.preRecoveryBaseline);
  const firstEvidence = normalizeSnapshot(value.firstEvidenceSnapshot);
  const lastObservation = normalizeSnapshot(value.lastObservation);
  const candidateStartedAtMs = value.candidateStartedAtMs;
  const observationCount = value.observationCount;
  const lastSuccessfulPostAtMs = value.lastSuccessfulPostAtMs;
  const lastKnownBankedResetAvailableCount = value.lastKnownBankedResetAvailableCount;
  if (
    !baseline ||
    !firstEvidence ||
    !lastObservation ||
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
  if (
    !sameIdentity(baseline, firstEvidence) ||
    !sameIdentity(baseline, lastObservation)
  ) return { candidate: null, discardedReason: "identity_mismatch" };

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
    evidenceToLastMs < 0 ||
    evidenceToLastMs > MONITOR_RECOVERY_CANDIDATE_TTL_MS ||
    observationCount < 1 ||
    baseline.usedPercent - firstEvidence.usedPercent < 1 ||
    baseline.usedPercent - lastObservation.usedPercent < 1 ||
    resetsAtAdvance < RESET_AT_MEANINGFUL_FORWARD_SEC ||
    Math.abs(lastObservation.resetsAt - firstEvidence.resetsAt) > RESET_AT_JITTER_TOLERANCE_SEC
  ) return { candidate: null, discardedReason: "inconsistent" };

  return {
    candidate: {
      preRecoveryBaseline: baseline,
      firstEvidenceSnapshot: firstEvidence,
      candidateStartedAtMs,
      lastObservation,
      observationCount,
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

      if (!isRecord(envelope) || envelope.schemaVersion !== MONITOR_RECOVERY_CANDIDATE_SCHEMA_VERSION) {
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

      const result = normalizeCandidate(envelope.candidate, nowMs);
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
        ...(runtimeState ?? {}),
      };
      const normalized = normalizeCandidate(candidateWithRuntimeState, nowMs);
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
