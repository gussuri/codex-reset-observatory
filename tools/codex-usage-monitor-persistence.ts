import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { PendingMonitorPost } from "./codex-usage-monitor";

const PENDING_POSTS_SCHEMA_VERSION = 1;
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
