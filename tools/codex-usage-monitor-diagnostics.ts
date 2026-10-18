import fs from "node:fs";
import path from "node:path";

import { getMonitorPendingPostsPath } from "./codex-usage-monitor-persistence";

export const DEFAULT_MONITOR_DIAGNOSTIC_MAX_BYTES = 1024 * 1024;
export const DEFAULT_MONITOR_DIAGNOSTIC_GENERATIONS = 3;
const MAX_DIAGNOSTIC_GENERATIONS = 10;
export const MAX_MONITOR_DIAGNOSTIC_BANKED_RESET_COUNT = 1_000;

export type MonitorDiagnosticEvent = { event: string } & Record<string, unknown>;

export type MonitorDiagnosticSink = (event: MonitorDiagnosticEvent) => void;

type DiagnosticRow = Record<string, string | number> & {
  schemaVersion: 1;
  event: string;
  at: string;
};

const EVENT_FIELDS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  diagnostic_poll_started: ["trigger", "startedAt"],
  diagnostic_rpc_completed: ["trigger", "readCompletedAt", "rpcDurationMs"],
  diagnostic_rpc_failed: ["trigger", "rpcDurationMs", "errorCode"],
  diagnostic_snapshot_rejected: ["reason", "readCompletedAt", "rpcDurationMs"],
  diagnostic_snapshot_selected: [
    "readCompletedAt", "upstreamGeneratedAt", "observedAt", "usedPercent", "resetsAt",
    "planType", "windowDurationMins", "bankedResetDisplayCount", "bankedResetCountSource", "rpcDurationMs",
  ],
  diagnostic_comparison_evaluated: [
    "trigger", "reason", "evaluationStatus", "previousUsedPercent", "usedPercent",
    "previousResetsAt", "resetsAt", "usageDelta", "resetsAtDeltaSec", "comparisonGapMs", "postReason",
  ],
  diagnostic_webhook_result: ["status", "reason", "category", "httpStatus", "errorCode", "recoveryOutcome", "postObservedAt"],
  recovery_candidate_started: ["observedAt", "usedPercent", "resetsAt", "planType", "windowDurationMins", "bankedResetDisplayCount", "bankedResetCountSource"],
  recovery_candidate_confirmed: ["observedAt", "usedPercent", "resetsAt", "firstObservedAt", "delayMs"],
  recovery_candidate_cancelled: ["reason", "observedAt", "usedPercent", "resetsAt"],
});

const TRIGGERS = new Set(["poll", "notification", "initial"]);
const PLANS = new Set(["free", "plus", "pro", "team", "enterprise", "unknown", "other"]);
const BANKED_SOURCES = new Set(["explicit", "last_known", "unavailable"]);
const COMPARISON_REASONS = new Set([
  "initial_baseline", "banked_reset_count_change", "no_baseline", "structure_change",
  "stale_observation", "comparison_gap", "usage_condition_unmet", "time_condition_unmet",
  "both_conditions_unmet", "candidate_confirmation_waiting", "heartbeat_due",
  "candidate_started", "candidate_confirmed", "candidate_cancelled", "usage_reverted", "reset_at_reverted",
]);
const EVALUATION_STATUSES = new Set(["none", "started", "confirmed", "pending_unconfirmed", "pending_burst", "cancelled"]);
const CANCELLATIONS = new Set(["usage_reverted", "reset_at_reverted", "structure_change", "comparison_gap", "stale_observation"]);
const POST_REASONS = new Set(["initial", "recovery_candidate", "banked_reset_count_change", "structure_change", "heartbeat"]);
export const MONITOR_DIAGNOSTIC_RECOVERY_OUTCOMES = Object.freeze([
  "confirmed", "teaser_corroborated", "rebase", "ignored_stale", "baseline", "invalid", "no_recovery",
  "structure_change", "initial", "recovery_candidate", "banked_reset_count_change", "heartbeat",
  "recovery_observed_unconfirmed", "notice_lookup_deferred", "personal_reset",
  "banked_distribution_observed", "banked_grant_observed_pending_association", "observed_unconfirmed",
  "unauthorized_initial", "unauthorized_banked_reset_count_change", "unauthorized_structure_change",
  "unauthorized_heartbeat", "unauthorized_undefined", "missing", "unknown",
] as const);
const RECOVERY_OUTCOMES = new Set<string>(MONITOR_DIAGNOSTIC_RECOVERY_OUTCOMES);
const WEBHOOK_CATEGORIES = new Set(["rate_limited", "server_error", "authentication", "invalid_request", "client_error", "invalid_response", "transport"]);
const ERROR_CODES = new Set([
  "app_server_request_timeout", "app_server_write_failed", "app_server_rpc_error", "app_server_spawn_failed",
  "app_server_initialize_failed", "app_server_rpc_unhealthy", "app_server_stopped", "invalid_weekly_window",
  "webhook_timeout", "webhook_requires_https", "invalid_webhook_url", "unknown", "AbortError",
  "ETIMEDOUT", "ECONNRESET", "EPIPE", "ENOENT",
]);

export function normalizeMonitorDiagnosticErrorCode(value: unknown) {
  return typeof value === "string" && ERROR_CODES.has(value) ? value : "unknown";
}

export function normalizeMonitorDiagnosticRecoveryOutcome(value: unknown) {
  if (value === undefined || value === null) return "missing";
  return typeof value === "string" && RECOVERY_OUTCOMES.has(value) ? value : "unknown";
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.length <= 32 &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) &&
    Number.isFinite(Date.parse(value));
}

function safeNumber(value: unknown, min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY) {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max ? value : null;
}

function normalizePlan(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.toLowerCase();
  return PLANS.has(normalized) ? normalized : "other";
}

function projectEvent(input: unknown, at: string): DiagnosticRow | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const source = input as Record<string, unknown>;
  const name = source.event;
  if (typeof name !== "string" || !Object.hasOwn(EVENT_FIELDS, name)) return null;
  const row: Record<string, string | number> = { schemaVersion: 1, event: name, at };
  for (const key of EVENT_FIELDS[name]!) {
    const value = source[key];
    switch (key) {
      case "trigger":
        if (typeof value === "string" && TRIGGERS.has(value)) row[key] = value;
        break;
      case "reason":
        if ((name === "diagnostic_comparison_evaluated" || name === "diagnostic_snapshot_rejected") && typeof value === "string" && (COMPARISON_REASONS.has(value) || value === "invalid_weekly_window")) row[key] = value;
        else if (name === "recovery_candidate_cancelled" && typeof value === "string" && CANCELLATIONS.has(value)) row[key] = value;
        else if (name === "diagnostic_webhook_result" && typeof value === "string" && POST_REASONS.has(value)) row[key] = value;
        break;
      case "postReason":
        if (typeof value === "string" && POST_REASONS.has(value)) row[key] = value;
        break;
      case "evaluationStatus":
        if (typeof value === "string" && EVALUATION_STATUSES.has(value)) row[key] = value;
        break;
      case "status":
        if (name === "diagnostic_webhook_result" && (value === "success" || value === "failure")) row[key] = value;
        break;
      case "recoveryOutcome":
        if (name === "diagnostic_webhook_result") row[key] = normalizeMonitorDiagnosticRecoveryOutcome(value);
        break;
      case "category":
        if (typeof value === "string" && WEBHOOK_CATEGORIES.has(value)) row[key] = value;
        break;
      case "errorCode":
        row[key] = normalizeMonitorDiagnosticErrorCode(value);
        break;
      case "planType":
        if (name === "diagnostic_snapshot_selected") {
          const plan = normalizePlan(value);
          if (plan) row[key] = plan;
        } else if (name === "recovery_candidate_started") {
          const plan = normalizePlan(value);
          if (plan) row[key] = plan;
        }
        break;
      case "bankedResetCountSource":
        if (typeof value === "string" && BANKED_SOURCES.has(value)) row[key] = value;
        break;
      case "readCompletedAt":
      case "startedAt":
      case "observedAt":
      case "firstObservedAt":
      case "postObservedAt":
        if (isTimestamp(value)) row[key] = value;
        break;
      case "upstreamGeneratedAt":
        row[key] = "unknown";
        break;
      case "usedPercent":
      case "previousUsedPercent":
        {
          const number = safeNumber(value, 0, 100);
          if (number !== null) row[key] = number;
        }
        break;
      case "resetsAt":
      case "previousResetsAt":
        {
          const number = safeNumber(value, 1, Number.MAX_SAFE_INTEGER);
          if (number !== null && Number.isSafeInteger(number)) row[key] = number;
        }
        break;
      case "windowDurationMins":
        {
          const number = safeNumber(value, 1, 1_000_000);
          if (number !== null && Number.isSafeInteger(number)) row[key] = number;
        }
        break;
      case "bankedResetDisplayCount":
        {
          const number = safeNumber(value, 0, MAX_MONITOR_DIAGNOSTIC_BANKED_RESET_COUNT);
          if (number !== null && Number.isSafeInteger(number)) row[key] = number;
        }
        break;
      case "rpcDurationMs":
      case "delayMs":
      case "comparisonGapMs":
      case "httpStatus":
        {
          const number = safeNumber(value, 0, key === "httpStatus" ? 599 : 86_400_000);
          if (number !== null && Number.isSafeInteger(number) && (key !== "httpStatus" || number >= 100)) row[key] = number;
        }
        break;
      case "usageDelta":
      case "resetsAtDeltaSec":
        {
          const number = safeNumber(value, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
          if (number !== null) row[key] = number;
        }
        break;
      default:
        break;
    }
  }
  return row as DiagnosticRow;
}

function readBoundedTail(filePath: string, maxBytes: number) {
  const stat = fs.statSync(filePath);
  const length = Math.min(stat.size, maxBytes);
  const buffer = Buffer.alloc(length);
  const fd = fs.openSync(filePath, "r");
  try {
    fs.readSync(fd, buffer, 0, length, Math.max(0, stat.size - length));
    return buffer.toString("utf8");
  } finally {
    fs.closeSync(fd);
  }
}

function makeFilePath(directory: string, generation: number) {
  return path.join(directory, `monitor-diagnostics.${generation}.jsonl`);
}

export function getMonitorDiagnosticDirectory(env: NodeJS.ProcessEnv = process.env) {
  return path.join(path.dirname(getMonitorPendingPostsPath(env)), "diagnostics");
}

export function createMonitorDiagnosticSink(options: {
  directory: string;
  maxBytes?: number;
  generations?: number;
}): MonitorDiagnosticSink {
  const maxBytes = options.maxBytes ?? DEFAULT_MONITOR_DIAGNOSTIC_MAX_BYTES;
  const generations = options.generations ?? DEFAULT_MONITOR_DIAGNOSTIC_GENERATIONS;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 64) throw new RangeError("maxBytes must be an integer of at least 64");
  if (!Number.isSafeInteger(generations) || generations < 1 || generations > MAX_DIAGNOSTIC_GENERATIONS) {
    throw new RangeError(`generations must be an integer from 1 to ${MAX_DIAGNOSTIC_GENERATIONS}`);
  }
  const directory = path.resolve(options.directory);
  let disabled = false;
  let warned = false;
  let initialized = false;
  const warnOnce = () => {
    if (warned) return;
    warned = true;
    try { process.stderr.write("[Codex usage monitor] diagnostic_write_failed\n"); } catch { /* stderr is optional */ }
  };
  const disable = () => { disabled = true; warnOnce(); };
  const cleanupTemps = () => {
    for (let index = 0; index < MAX_DIAGNOSTIC_GENERATIONS; index += 1) {
      const temp = `${makeFilePath(directory, index)}.tmp`;
      try { fs.rmSync(temp, { force: true }); } catch { /* cleanup is best effort */ }
    }
  };
  const repairFile = (filePath: string) => {
    if (!fs.existsSync(filePath)) return;
    const content = readBoundedTail(filePath, maxBytes);
    const repaired: string[] = [];
    let usedBytes = 0;
    const lines = content.split("\n");
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const line = lines[index]!.replace(/\r$/, "");
      if (!line) continue;
      try {
        const parsed: unknown = JSON.parse(line);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
        const entry = parsed as Record<string, unknown>;
        if (entry.schemaVersion !== 1 || !isTimestamp(entry.at)) continue;
        const row = projectEvent(entry, entry.at);
        if (!row) continue;
        const safeLine = `${JSON.stringify(row)}\n`;
        const bytes = Buffer.byteLength(safeLine, "utf8");
        if (bytes > maxBytes || usedBytes + bytes > maxBytes) continue;
        repaired.push(safeLine);
        usedBytes += bytes;
      } catch { /* discard only the corrupt row */ }
    }
    repaired.reverse();
    const replacement = `${filePath}.tmp`;
    try {
      if (repaired.length === 0) {
        fs.rmSync(filePath, { force: true });
      } else {
        fs.writeFileSync(replacement, repaired.join(""), { encoding: "utf8", mode: 0o600 });
        fs.rmSync(filePath, { force: true });
        fs.renameSync(replacement, filePath);
      }
    } finally {
      fs.rmSync(replacement, { force: true });
    }
  };

  const initialize = () => {
    if (initialized || disabled) return;
    initialized = true;
    try {
      fs.mkdirSync(directory, { recursive: true });
      cleanupTemps();
      for (let index = 0; index < MAX_DIAGNOSTIC_GENERATIONS; index += 1) {
        if (index >= generations) fs.rmSync(makeFilePath(directory, index), { force: true });
        else repairFile(makeFilePath(directory, index));
      }
    } catch {
      disable();
    }
  };

  return (event) => {
    if (disabled) return;
    const row = projectEvent(event, new Date().toISOString());
    if (!row) return;
    const line = `${JSON.stringify(row)}\n`;
    const lineBytes = Buffer.byteLength(line, "utf8");
    if (lineBytes > maxBytes) return;
    initialize();
    if (disabled) return;
    const current = makeFilePath(directory, 0);
    try {
      const currentBytes = fs.existsSync(current) ? fs.statSync(current).size : 0;
      if (currentBytes + lineBytes > maxBytes) {
        if (generations === 1) {
          fs.writeFileSync(`${current}.tmp`, line, { encoding: "utf8", mode: 0o600 });
          fs.rmSync(current, { force: true });
          fs.renameSync(`${current}.tmp`, current);
        } else {
          for (let index = generations - 1; index >= 1; index -= 1) {
            const from = makeFilePath(directory, index - 1);
            const to = makeFilePath(directory, index);
            fs.rmSync(to, { force: true });
            if (fs.existsSync(from)) fs.renameSync(from, to);
          }
          fs.appendFileSync(current, line, { encoding: "utf8", mode: 0o600 });
        }
      } else {
        fs.appendFileSync(current, line, { encoding: "utf8", mode: 0o600 });
      }
    } catch {
      disable();
    }
  };
}
