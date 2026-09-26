import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

import type { PendingMonitorPost } from "./codex-usage-monitor";

const PENDING_POSTS_SCHEMA_VERSION = 1;
export const MAX_PENDING_POST_DELIVERY_ATTEMPTS_PER_RUN = 3;
const PENDING_POST_REASONS = new Set([
  "initial",
  "recovery_candidate",
  "banked_reset_count_change",
  "structure_change",
]);

export class PendingMonitorPostStoreError extends Error {
  constructor(readonly reason: "pending_posts_corrupt" | "pending_posts_read_failed" | "pending_posts_write_failed") {
    super(reason);
    this.name = "PendingMonitorPostStoreError";
  }
}

export type PendingMonitorPostLockFailure =
  | "pending_posts_lock_owned"
  | "pending_posts_lock_corrupt"
  | "pending_posts_lock_failed"
  | "pending_posts_lock_race";

export class PendingMonitorPostLockError extends Error {
  constructor(readonly reason: PendingMonitorPostLockFailure) {
    super(reason);
    this.name = "PendingMonitorPostLockError";
  }
}

type PendingMonitorPostLockRecord = {
  schemaVersion: 1;
  pid: number;
  token: string;
  acquiredAt: string;
};

function parsePendingMonitorPostLock(raw: string): PendingMonitorPostLockRecord | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    if (
      record.schemaVersion !== 1 ||
      typeof record.pid !== "number" ||
      !Number.isSafeInteger(record.pid) ||
      record.pid <= 0 ||
      typeof record.token !== "string" ||
      !/^[0-9a-f-]{36}$/i.test(record.token) ||
      typeof record.acquiredAt !== "string" ||
      !Number.isFinite(Date.parse(record.acquiredAt))
    ) {
      return null;
    }
    return record as PendingMonitorPostLockRecord;
  } catch {
    return null;
  }
}

function isProcessAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ESRCH") return false;
    if (code === "EPERM") return true;
    throw new PendingMonitorPostLockError("pending_posts_lock_failed");
  }
}

/**
 * Atomically leases the monitor outbox across every entrypoint. A live or
 * unreadable owner is never displaced. Dead-PID lock files are moved aside
 * atomically before a new owner tries to create the canonical lock.
 */
export function acquirePendingMonitorPostLock(queuePath: string) {
  const lockPath = `${queuePath}.lock`;
  const lockDirectory = path.dirname(lockPath);
  try {
    fs.mkdirSync(lockDirectory, { recursive: true });
  } catch {
    throw new PendingMonitorPostLockError("pending_posts_lock_failed");
  }

  const createLease = (record: PendingMonitorPostLockRecord) => ({
    path: lockPath,
    release() {
      let raw: string;
      try {
        raw = fs.readFileSync(lockPath, "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
        throw new PendingMonitorPostLockError("pending_posts_lock_failed");
      }
      const current = parsePendingMonitorPostLock(raw);
      if (current?.token !== record.token) return;
      try {
        fs.unlinkSync(lockPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          throw new PendingMonitorPostLockError("pending_posts_lock_failed");
        }
      }
    },
  });

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const record: PendingMonitorPostLockRecord = {
      schemaVersion: 1,
      pid: process.pid,
      token: randomUUID(),
      acquiredAt: new Date().toISOString(),
    };
    const temporaryPath = `${lockPath}.${record.pid}.${record.token}.tmp`;
    let descriptor: number | null = null;
    let canonicalAlreadyExists = false;
    try {
      descriptor = fs.openSync(temporaryPath, "wx", 0o600);
      fs.writeFileSync(descriptor, JSON.stringify(record), "utf8");
      fs.fsyncSync(descriptor);
      fs.closeSync(descriptor);
      descriptor = null;
      try {
        // The complete owner record is installed with one create-if-absent
        // hard-link operation, so a crash cannot leave a half-written owner.
        fs.linkSync(temporaryPath, lockPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") canonicalAlreadyExists = true;
        else throw error;
      }
      try { fs.unlinkSync(temporaryPath); } catch { /* a completed canonical lock remains valid */ }
      if (!canonicalAlreadyExists) return createLease(record);
    } catch (error) {
      if (descriptor !== null) {
        try { fs.closeSync(descriptor); } catch { /* best-effort close */ }
      }
      try { fs.unlinkSync(temporaryPath); } catch { /* no temporary lock was left behind */ }
      if (error instanceof PendingMonitorPostLockError) throw error;
      throw new PendingMonitorPostLockError("pending_posts_lock_failed");
    }

    let existing: PendingMonitorPostLockRecord | null;
    try {
      existing = parsePendingMonitorPostLock(fs.readFileSync(lockPath, "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw new PendingMonitorPostLockError("pending_posts_lock_failed");
    }
    if (!existing) throw new PendingMonitorPostLockError("pending_posts_lock_corrupt");
    if (isProcessAlive(existing.pid)) throw new PendingMonitorPostLockError("pending_posts_lock_owned");

    const stalePath = `${lockPath}.stale.${process.pid}.${randomUUID()}`;
    try {
      fs.renameSync(lockPath, stalePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw new PendingMonitorPostLockError("pending_posts_lock_failed");
    }
    try {
      fs.unlinkSync(stalePath);
    } catch {
      // The queue remains protected by the canonical lock path on the next attempt.
    }
  }

  throw new PendingMonitorPostLockError("pending_posts_lock_race");
}

function normalizePendingPost(value: unknown): PendingMonitorPost | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const post = value as Record<string, unknown>;
  if (typeof post.reason !== "string" || !PENDING_POST_REASONS.has(post.reason)) return null;
  if (!post.snapshot || typeof post.snapshot !== "object" || Array.isArray(post.snapshot)) return null;

  const snapshot = post.snapshot as Record<string, unknown>;
  if (
    typeof snapshot.observedAt !== "string" ||
    !Number.isFinite(Date.parse(snapshot.observedAt)) ||
    snapshot.limitId !== "codex" ||
    typeof snapshot.planType !== "string" ||
    snapshot.planType.trim() === "" ||
    snapshot.planType.length > 100 ||
    typeof snapshot.usedPercent !== "number" ||
    !Number.isFinite(snapshot.usedPercent) ||
    snapshot.usedPercent < 0 ||
    snapshot.usedPercent > 100 ||
    snapshot.windowDurationMins !== 10080 ||
    typeof snapshot.resetsAt !== "number" ||
    !Number.isSafeInteger(snapshot.resetsAt) ||
    snapshot.resetsAt < 0
  ) {
    return null;
  }

  const normalizedSnapshot: PendingMonitorPost["snapshot"] = {
    observedAt: snapshot.observedAt,
    limitId: "codex",
    planType: snapshot.planType,
    usedPercent: snapshot.usedPercent,
    windowDurationMins: 10080,
    resetsAt: snapshot.resetsAt,
  };

  if ("bankedResetAvailableCount" in snapshot) {
    const count = snapshot.bankedResetAvailableCount;
    if (
      count !== null &&
      (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0 || count > 1_000)
    ) {
      return null;
    }
    normalizedSnapshot.bankedResetAvailableCount = count;
  }

  return {
    reason: post.reason as PendingMonitorPost["reason"],
    snapshot: normalizedSnapshot,
  };
}

function normalizePendingPosts(value: unknown): PendingMonitorPost[] | null {
  if (!Array.isArray(value)) return null;
  const normalized = value.map(normalizePendingPost);
  if (normalized.some((post) => post === null)) return null;
  return normalized as PendingMonitorPost[];
}

export function getMonitorPendingPostsPath(env: NodeJS.ProcessEnv = process.env) {
  const localAppData = env.LOCALAPPDATA?.trim();
  const xdgStateHome = env.XDG_STATE_HOME?.trim();
  const home = env.USERPROFILE?.trim() || env.HOME?.trim() || os.homedir();
  const stateDirectory = localAppData
    ? path.join(localAppData, "CodexUsageMonitor")
    : xdgStateHome
      ? path.join(xdgStateHome, "codex-usage-monitor")
      : path.join(home, ".local", "state", "codex-usage-monitor");
  return path.join(stateDirectory, "pending-posts.json");
}

export function createPendingMonitorPostStore(filePath: string) {
  return {
    load(): PendingMonitorPost[] {
      let raw: string;
      try {
        raw = fs.readFileSync(filePath, "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw new PendingMonitorPostStoreError("pending_posts_read_failed");
      }

      let envelope: unknown;
      try {
        envelope = JSON.parse(raw);
      } catch {
        throw new PendingMonitorPostStoreError("pending_posts_corrupt");
      }

      if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) {
        throw new PendingMonitorPostStoreError("pending_posts_corrupt");
      }
      const candidate = envelope as Record<string, unknown>;
      if (candidate.schemaVersion !== PENDING_POSTS_SCHEMA_VERSION) {
        throw new PendingMonitorPostStoreError("pending_posts_corrupt");
      }
      const pendingPosts = normalizePendingPosts(candidate.pendingPosts);
      if (!pendingPosts) throw new PendingMonitorPostStoreError("pending_posts_corrupt");
      return pendingPosts;
    },

    save(pendingPosts: PendingMonitorPost[]) {
      const normalized = normalizePendingPosts(pendingPosts);
      if (!normalized) throw new PendingMonitorPostStoreError("pending_posts_corrupt");

      const directory = path.dirname(filePath);
      const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
      let fileDescriptor: number | null = null;
      try {
        fs.mkdirSync(directory, { recursive: true });
        fileDescriptor = fs.openSync(temporaryPath, "wx", 0o600);
        fs.writeFileSync(fileDescriptor, JSON.stringify({
          schemaVersion: PENDING_POSTS_SCHEMA_VERSION,
          pendingPosts: normalized,
        }), "utf8");
        fs.fsyncSync(fileDescriptor);
        fs.closeSync(fileDescriptor);
        fileDescriptor = null;
        fs.renameSync(temporaryPath, filePath);
      } catch {
        if (fileDescriptor !== null) {
          try { fs.closeSync(fileDescriptor); } catch { /* best-effort close */ }
        }
        try { fs.unlinkSync(temporaryPath); } catch { /* no temporary file was created */ }
        throw new PendingMonitorPostStoreError("pending_posts_write_failed");
      }
    },
  };
}

export type PendingMonitorPostStore = ReturnType<typeof createPendingMonitorPostStore>;

export type PendingMonitorPostQueueAccess = {
  list: () => PendingMonitorPost[];
  enqueue: (post: PendingMonitorPost) => boolean;
  deliverOldest: (
    deliver: (post: PendingMonitorPost) => Promise<{ accepted: boolean } | null>,
  ) => Promise<Awaited<ReturnType<typeof deliverPendingMonitorPost>>>;
};

/** Serializes queue reads, new observations, sends, and acknowledgements. */
export function createPendingMonitorPostQueue(store: PendingMonitorPostStore) {
  let pendingPosts = store.load();
  let operationTail: Promise<void> = Promise.resolve();

  const access: PendingMonitorPostQueueAccess = {
    list: () => [...pendingPosts],
    enqueue(post) {
      if (pendingPosts.some((pending) =>
        (pending.reason === "initial" && post.reason === "initial") ||
        (pending.reason === post.reason && pending.snapshot.observedAt === post.snapshot.observedAt)
      )) {
        return false;
      }
      const next = [...pendingPosts, post];
      store.save(next);
      pendingPosts = next;
      return true;
    },
    async deliverOldest(deliver) {
      const result = await deliverPendingMonitorPost(
        pendingPosts,
        deliver,
        (next) => store.save(next),
      );
      if (result.accepted) pendingPosts = result.pendingPosts;
      return result;
    },
  };

  return {
    withExclusive<T>(operation: (queue: PendingMonitorPostQueueAccess) => Promise<T> | T) {
      const result = operationTail.then(() => operation(access));
      operationTail = result.then(() => undefined, () => undefined);
      return result;
    },
    waitForIdle() {
      return operationTail;
    },
  };
}

export function createPendingPostDeliveryLimiter(
  minimumIntervalMs: number,
  maxAttempts = MAX_PENDING_POST_DELIVERY_ATTEMPTS_PER_RUN,
) {
  let currentKey: string | null = null;
  let attempts = 0;
  let lastAttemptAt: number | null = null;

  return {
    tryBegin(key: string, nowMs = Date.now()): "ready" | "wait" | "limit" {
      if (currentKey !== key) {
        currentKey = key;
        attempts = 0;
        lastAttemptAt = null;
      }
      if (attempts >= maxAttempts) return "limit";
      if (lastAttemptAt !== null && nowMs - lastAttemptAt < minimumIntervalMs) return "wait";
      attempts += 1;
      lastAttemptAt = nowMs;
      return "ready";
    },
    reset() {
      currentKey = null;
      attempts = 0;
      lastAttemptAt = null;
    },
  };
}

export async function deliverPendingMonitorPost(
  pendingPosts: PendingMonitorPost[],
  deliver: (post: PendingMonitorPost) => Promise<{ accepted: boolean } | null>,
  persist: (pendingPosts: PendingMonitorPost[]) => void,
) {
  const head = pendingPosts[0];
  if (!head) {
    return {
      attempted: false,
      accepted: false,
      response: null,
      pendingPosts: [],
    };
  }

  const response = await deliver(head);
  if (response?.accepted !== true) {
    return {
      attempted: true,
      accepted: false,
      response,
      pendingPosts: [...pendingPosts],
    };
  }

  const remaining = pendingPosts.slice(1);
  // Keep the durable head until the server confirms acceptance. If this write
  // fails after acceptance, replay is safe because the server uses the stable
  // observedAt/resetsAt identity and idempotent writes.
  persist(remaining);
  return {
    attempted: true,
    accepted: true,
    response,
    pendingPosts: remaining,
  };
}
