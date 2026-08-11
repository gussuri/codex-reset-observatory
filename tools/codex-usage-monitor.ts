import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  parseCodexRateLimitsResponse,
  type CodexUsageSnapshot,
} from "../lib/codexUsageRecovery";

export const DEFAULT_MONITOR_POLL_INTERVAL_MS = 120_000;
export const MIN_MONITOR_POLL_INTERVAL_MS = 60_000;
export const NOTIFICATION_DEBOUNCE_MS = 2_000;
export const APP_SERVER_REQUEST_TIMEOUT_MS = 15_000;
export const MONITOR_WEBHOOK_TIMEOUT_MS = 15_000;
export const MAX_JSON_LINE_LENGTH = 1_000_000;

const RESTART_BACKOFF_MS = [5_000, 30_000, 120_000] as const;
const DEFAULT_WEBHOOK_URL = "https://codex.gussuriworks.com/api/webhook/codex-usage";

type JsonObject = Record<string, unknown>;
type MessageHandler = (message: JsonObject) => void;
type MalformedHandler = () => void;

export function createJsonLineParser(
  onMessage: MessageHandler,
  onMalformed: MalformedHandler,
) {
  let buffer = "";

  return {
    push(chunk: string | Buffer) {
      buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");
      if (buffer.length > MAX_JSON_LINE_LENGTH) {
        buffer = "";
        onMalformed();
        return;
      }

      let newlineIndex = buffer.indexOf("\n");
      while (newlineIndex >= 0) {
        const line = buffer.slice(0, newlineIndex).replace(/\r$/, "").trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (line) {
          try {
            const parsed: unknown = JSON.parse(line);
            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
              onMalformed();
            } else {
              onMessage(parsed as JsonObject);
            }
          } catch {
            onMalformed();
          }
        }
        newlineIndex = buffer.indexOf("\n");
      }
    },
  };
}

export function createNotificationDebouncer(callback: () => void, delayMs: number) {
  let timer: ReturnType<typeof setTimeout> | null = null;

  return {
    schedule() {
      if (timer !== null) return;
      timer = setTimeout(() => {
        timer = null;
        callback();
      }, Math.max(0, delayMs));
    },
    cancel() {
      if (timer === null) return;
      clearTimeout(timer);
      timer = null;
    },
  };
}

export function getMonitorPollIntervalMs(rawValue: string | undefined) {
  if (rawValue === undefined || rawValue.trim() === "") {
    return DEFAULT_MONITOR_POLL_INTERVAL_MS;
  }
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_MONITOR_POLL_INTERVAL_MS;
  }
  return Math.max(MIN_MONITOR_POLL_INTERVAL_MS, Math.floor(parsed));
}

export function getRestartBackoffMs(attempt: number) {
  const index = Number.isFinite(attempt)
    ? Math.min(Math.max(0, Math.floor(attempt)), RESTART_BACKOFF_MS.length - 1)
    : 0;
  return RESTART_BACKOFF_MS[index];
}

export function toSafeMonitorPayload(snapshot: CodexUsageSnapshot) {
  return {
    observedAt: snapshot.observedAt,
    limitId: snapshot.limitId,
    planType: snapshot.planType,
    usedPercent: snapshot.usedPercent,
    windowDurationMins: snapshot.windowDurationMins,
    resetsAt: snapshot.resetsAt,
  };
}

export function getSafeMonitorErrorCode(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (/^[a-z0-9_]{1,80}$/.test(message)) return message;
  if (error && typeof error === "object") {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && code.length <= 80) return code;
    const name = (error as { name?: unknown }).name;
    if (typeof name === "string" && name.length <= 80) return name;
  }
  return "unknown";
}

function getCodexCliPath(env: NodeJS.ProcessEnv) {
  if (env.CODEX_CLI_PATH?.trim()) return env.CODEX_CLI_PATH;
  if (env.LOCALAPPDATA) {
    return path.join(env.LOCALAPPDATA, "OpenAI", "Codex", "bin", "codex.exe");
  }
  return "codex";
}

function validateWebhookUrl(rawUrl: string) {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("invalid_webhook_url");
  }
  const localHttp = url.protocol === "http:" &&
    (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1");
  if (url.protocol !== "https:" && !localHttp) {
    throw new Error("webhook_requires_https");
  }
  return url.toString();
}

export type CodexUsageMonitorConfig = {
  secret: string;
  webhookUrl: string;
  codexCliPath: string;
  pollIntervalMs: number;
};

export function getMonitorConfig(env: NodeJS.ProcessEnv = process.env): CodexUsageMonitorConfig {
  const secret = env.CODEX_USAGE_MONITOR_SECRET?.trim();
  if (!secret) throw new Error("monitor_secret_missing");

  return {
    secret,
    webhookUrl: validateWebhookUrl(env.CODEX_USAGE_WEBHOOK_URL?.trim() || DEFAULT_WEBHOOK_URL),
    codexCliPath: getCodexCliPath(env),
    pollIntervalMs: getMonitorPollIntervalMs(env.CODEX_USAGE_POLL_INTERVAL_MS),
  };
}

export type MonitorLogger = (event: string, details?: Record<string, unknown>) => void;

export type MonitorEventWriter = (line: string) => void;

export function createJsonMonitorLogger(
  writeLine: MonitorEventWriter = (line) => process.stdout.write(`${line}\n`),
): MonitorLogger {
  return (event, details = {}) => {
    const safeDetails: Record<string, unknown> = {};
    const allowedKeys = event === "snapshot_sent"
      ? ["observedAt", "usedPercent", "resetsAt", "planType", "windowDurationMins"]
      : event === "snapshot_failed"
        ? ["reason"]
        : event === "session_restart"
          ? ["reason", "backoffMs"]
          : event === "error"
            ? ["reason"]
            : event === "snapshot_rejected"
              ? ["reason"]
              : [];

    for (const key of allowedKeys) {
      const value = details[key];
      if (typeof value === "string" || typeof value === "number") {
        safeDetails[key] = value;
      }
    }

    writeLine(JSON.stringify({
      event,
      at: new Date().toISOString(),
      ...safeDetails,
    }));
  };
}

function defaultLogger(event: string, details: Record<string, unknown> = {}) {
  console.info(`[Codex usage monitor] ${event}`, details);
}

function waitFor(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

async function postUsageSnapshot(
  config: CodexUsageMonitorConfig,
  snapshot: CodexUsageSnapshot,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MONITOR_WEBHOOK_TIMEOUT_MS);
  try {
    const response = await fetch(config.webhookUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${config.secret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(toSafeMonitorPayload(snapshot)),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`webhook_http_${response.status}`);
  } finally {
    clearTimeout(timeout);
  }
}

type PendingRequest = {
  resolve: (message: JsonObject) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

async function runAppServerSession(
  config: CodexUsageMonitorConfig,
  logger: MonitorLogger,
  signal: AbortSignal,
) {
  if (signal.aborted) return;

  let child: ChildProcessWithoutNullStreams;
  try {
    child = spawn(config.codexCliPath, ["app-server"], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
  } catch {
    throw new Error("app_server_spawn_failed");
  }

  logger("app_server_started");

  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let initialized = false;
    let nextRequestId = 1;
    let refreshInFlight = false;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    const pending = new Map<string, PendingRequest>();

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      if (pollTimer !== null) clearInterval(pollTimer);
      notificationDebouncer.cancel();
      pending.forEach((request) => {
        clearTimeout(request.timeout);
        request.reject(error ?? new Error("app_server_stopped"));
      });
      pending.clear();
      signal.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve();
    };

    const abort = () => {
      try { child.kill(); } catch { /* process is already gone */ }
      finish();
    };
    signal.addEventListener("abort", abort, { once: true });

    const sendNotification = (method: string, params: JsonObject = {}) => {
      if (settled || !child.stdin.writable) return;
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
    };

    const sendRequest = (method: string, params: JsonObject = {}) => new Promise<JsonObject>((resolveRequest, rejectRequest) => {
      const id = String(nextRequestId++);
      const timeout = setTimeout(() => {
        pending.delete(id);
        rejectRequest(new Error("app_server_request_timeout"));
      }, APP_SERVER_REQUEST_TIMEOUT_MS);
      pending.set(id, {
        resolve: resolveRequest,
        reject: rejectRequest,
        timeout,
      });
      try {
        child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
      } catch {
        clearTimeout(timeout);
        pending.delete(id);
        rejectRequest(new Error("app_server_write_failed"));
      }
    });

    const refresh = async () => {
      if (settled || !initialized || refreshInFlight) return;
      refreshInFlight = true;
      try {
        const response = await sendRequest("account/rateLimits/read");
        const snapshot = parseCodexRateLimitsResponse(response, new Date());
        if (!snapshot) {
          logger("snapshot_rejected", { reason: "invalid_weekly_window" });
          return;
        }
        await postUsageSnapshot(config, snapshot);
        logger("snapshot_sent", {
          observedAt: snapshot.observedAt,
          usedPercent: snapshot.usedPercent,
          resetsAt: snapshot.resetsAt,
          planType: snapshot.planType,
          windowDurationMins: snapshot.windowDurationMins,
        });
      } catch (error) {
        logger("snapshot_failed", { reason: getSafeMonitorErrorCode(error) });
      } finally {
        refreshInFlight = false;
      }
    };

    const notificationDebouncer = createNotificationDebouncer(() => {
      void refresh();
    }, NOTIFICATION_DEBOUNCE_MS);

    const parser = createJsonLineParser(
      (message) => {
        const messageId = message.id;
        if (typeof messageId === "string" || typeof messageId === "number") {
          const id = String(messageId);
          const request = pending.get(id);
          if (request) {
            pending.delete(id);
            clearTimeout(request.timeout);
            if (message.error && typeof message.error === "object") {
              request.reject(new Error("app_server_rpc_error"));
            } else {
              request.resolve(message);
            }
            return;
          }
        }

        if (message.method === "account/rateLimits/updated") {
          notificationDebouncer.schedule();
        }
      },
      () => {
        logger("malformed_json", { action: "restart" });
        try { child.kill(); } catch { /* process is already gone */ }
      },
    );

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => parser.push(chunk));
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", () => {
      // Never forward app-server stderr: it may contain private diagnostics.
    });
    child.once("error", (error: NodeJS.ErrnoException) => finish(
      new Error(error.code === "ENOENT" ? "codex_cli_not_found" : "app_server_process_error"),
    ));
    child.once("close", () => {
      if (signal.aborted) finish();
      else finish(new Error("app_server_exited"));
    });

    const initialize = async () => {
      try {
        await sendRequest("initialize", {
          clientInfo: {
            name: "codex-reset-observatory-usage-monitor",
            title: "Codex Reset Observatory usage monitor",
            version: "1.0.0",
          },
          capabilities: { experimentalApi: false },
        });
        if (settled) return;
        sendNotification("initialized");
        initialized = true;
        await refresh();
        if (settled) return;
        pollTimer = setInterval(() => { void refresh(); }, config.pollIntervalMs);
      } catch (error) {
        const reason = getSafeMonitorErrorCode(error);
        finish(new Error(reason === "unknown" ? "app_server_initialize_failed" : reason));
      }
    };

    void initialize();
  });
}

export async function runCodexUsageMonitor(
  env: NodeJS.ProcessEnv = process.env,
  options: { signal?: AbortSignal; logger?: MonitorLogger } = {},
) {
  const config = getMonitorConfig(env);
  const signal = options.signal ?? new AbortController().signal;
  const logger = options.logger ?? defaultLogger;
  let restartAttempt = 0;

  while (!signal.aborted) {
    try {
      await runAppServerSession(config, logger, signal);
      restartAttempt = 0;
    } catch (error) {
      logger("session_restart", {
        reason: getSafeMonitorErrorCode(error),
        backoffMs: getRestartBackoffMs(restartAttempt),
      });
      await waitFor(getRestartBackoffMs(restartAttempt), signal);
      restartAttempt = Math.min(restartAttempt + 1, RESTART_BACKOFF_MS.length - 1);
    }
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  runCodexUsageMonitor(process.env, { signal: controller.signal }).catch((error) => {
    console.error("[Codex usage monitor] stopped", { reason: getSafeMonitorErrorCode(error) });
    process.exitCode = 1;
  });
}
