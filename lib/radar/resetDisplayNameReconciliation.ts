import { getCanonicalResetHistoryForDisplayNameReconciliation } from "../radar";
import { fetchCurrentRadarData } from "../radarFetch";
import {
  getCanonicalResetDisplayNameEventKey,
  isAutoNameableCanonicalEvent,
} from "./resetDisplayNameEligibility";
import { getCompletedResetTimestamp } from "./probability";
import {
  buildResetDisplayNameSourceContext,
  type ResetDisplayNameSourceRow,
} from "./resetDisplayNameSourceContext";
import {
  ensureResetDisplayNameForEvent,
  hashResetDisplayNameInput,
  shouldPreserveExistingAcceptedResetDisplayName,
  shouldReuseResetDisplayNameResult,
  type ResetDisplayNameGenerationOutcome,
} from "./resetDisplayNameStore";
import {
  RANDOM_RESET_NAME_MODEL,
  toRandomResetNameInput,
} from "./randomResetNaming";
import type { RadarData, ResetDisplayNameRecord, WindowEventLike } from "./types";

export { isAutoNameableCanonicalEvent } from "./resetDisplayNameEligibility";

const DEFAULT_MAX_GEMINI_REQUESTS = 3;

export type ResetDisplayNameReconciliationOutcome = {
  eventKey: string | null;
  sourceTweetId: string | null;
  sourceReady: boolean;
  attempted: boolean;
  status: string;
  displayName: string | null;
};

export type ResetDisplayNameReconciliationResult = {
  scanned: number;
  candidates: number;
  attempted: number;
  geminiRequests: number;
  writes: number;
  invalidated: boolean;
  outcomes: ResetDisplayNameReconciliationOutcome[];
};

export type ResetDisplayNameReconciliationOptions = {
  data?: RadarData;
  canonicalHistory?: ReadonlyArray<WindowEventLike>;
  sourceRows?: ReadonlyArray<ResetDisplayNameSourceRow>;
  now?: Date;
  apiKey?: string | null;
  model?: string;
  timeoutMs?: number;
  maxGeminiRequests?: number;
  dryRun?: boolean;
  fetchData?: (now: Date) => Promise<RadarData>;
  ensure?: typeof ensureResetDisplayNameForEvent;
  invalidateRadarData?: () => void | Promise<void>;
};

type ReconciliationCandidate = {
  item: WindowEventLike;
  eventKey: string;
  completedAt: number;
  sourceTweetId: string | null;
  sourcePostText: string | null;
  inputHash: string;
  existing: ResetDisplayNameRecord | null;
};

function getText(value: unknown) {
  return typeof value === "string" ? value : null;
}

function toSourceRow(value: unknown): ResetDisplayNameSourceRow | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const tweetId = getText(row.tweet_id)?.trim();
  const text = getText(row.text)?.trim();
  if (!tweetId || !text) return null;

  return {
    tweet_id: tweetId,
    text,
    tweet_created_at: getText(row.tweet_created_at),
    is_reply: row.is_reply === true,
    verification_status: getText(row.verification_status),
  };
}

function sourceRowScore(row: ResetDisplayNameSourceRow) {
  const timestamp = row.tweet_created_at ? Date.parse(row.tweet_created_at) : Number.NaN;
  return [
    row.is_reply === true ? 0 : 1,
    row.verification_status === "rejected" ? 0 : 1,
    row.text.trim() ? 1 : 0,
    Number.isFinite(timestamp) ? 1 : 0,
    row.text.length,
  ];
}

function isBetterSourceRow(candidate: ResetDisplayNameSourceRow, current: ResetDisplayNameSourceRow) {
  const candidateScore = sourceRowScore(candidate);
  const currentScore = sourceRowScore(current);
  for (let index = 0; index < candidateScore.length; index += 1) {
    if (candidateScore[index] !== currentScore[index]) {
      return candidateScore[index] > currentScore[index];
    }
  }
  return candidate.text.localeCompare(current.text) < 0;
}

function normalizeSourceRows(rows: readonly ResetDisplayNameSourceRow[]) {
  const rowsByTweetId = new Map<string, ResetDisplayNameSourceRow>();
  for (const row of rows) {
    const tweetId = row.tweet_id.trim();
    if (!tweetId) continue;
    const normalized = { ...row, tweet_id: tweetId };
    const current = rowsByTweetId.get(tweetId);
    if (!current || isBetterSourceRow(normalized, current)) {
      rowsByTweetId.set(tweetId, normalized);
    }
  }
  return Array.from(rowsByTweetId.values()).sort((left, right) =>
    left.tweet_id.localeCompare(right.tweet_id),
  );
}

function collectSourceRows(data: RadarData): ResetDisplayNameSourceRow[] {
  const values: unknown[] = [
    ...(data.formal_tibo_resets ?? []),
    ...(data.active_tibo_signals ?? []),
    ...(data.recent_tibo_signals ?? []),
  ];
  const rowsByTweetId = new Map<string, ResetDisplayNameSourceRow>();

  const add = (value: unknown) => {
    const row = toSourceRow(value);
    if (row) {
      const current = rowsByTweetId.get(row.tweet_id);
      if (!current || isBetterSourceRow(row, current)) {
        rowsByTweetId.set(row.tweet_id, row);
      }
    }

    if (!value || typeof value !== "object") return;
    const related = value as {
      related_notice?: unknown;
      related_notices?: unknown[];
    };
    if (related.related_notice) add(related.related_notice);
    for (const notice of related.related_notices ?? []) add(notice);
  };

  for (const value of values) add(value);
  return normalizeSourceRows(Array.from(rowsByTweetId.values()));
}

function getCanonicalSourceTweetIds(item: WindowEventLike) {
  return Array.from(new Set([
    ...(item.sourceTweetIds ?? []),
    item.officialNoticeTweetId,
  ].filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.trim())));
}

function compareSourceRows(left: ResetDisplayNameSourceRow, right: ResetDisplayNameSourceRow) {
  const leftTime = left.tweet_created_at ? Date.parse(left.tweet_created_at) : Number.NaN;
  const rightTime = right.tweet_created_at ? Date.parse(right.tweet_created_at) : Number.NaN;
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
    return leftTime - rightTime;
  }
  if (Number.isFinite(leftTime) && !Number.isFinite(rightTime)) return -1;
  if (!Number.isFinite(leftTime) && Number.isFinite(rightTime)) return 1;
  return left.tweet_id.localeCompare(right.tweet_id);
}

function resolveCandidateSource(
  sourceTweetIds: readonly string[],
  sourceRows: readonly ResetDisplayNameSourceRow[],
) {
  const canonicalIds = new Set(sourceTweetIds);
  return sourceRows
    .filter((row) => canonicalIds.has(row.tweet_id.trim()))
    .filter((row) => row.is_reply !== true && row.verification_status !== "rejected" && row.text.trim())
    .slice()
    .sort(compareSourceRows)[0] ?? null;
}

function getApiKey(options: ResetDisplayNameReconciliationOptions) {
  if (options.apiKey !== undefined) return options.apiKey?.trim() || null;
  return process.env.GEMINI_API_KEY?.trim() || null;
}

function getMaxGeminiRequests(value: number | undefined) {
  if (!Number.isInteger(value)) return DEFAULT_MAX_GEMINI_REQUESTS;
  return Math.max(0, Math.min(DEFAULT_MAX_GEMINI_REQUESTS, value as number));
}

function isSupabaseReadUnavailable(data: RadarData) {
  const state = data.data_health?.sources.supabaseSignals.state;
  const resetDisplayNamesState = data.reset_display_names_health?.state;
  return (
    state === "misconfigured" ||
    state === "degraded" ||
    resetDisplayNamesState === "misconfigured" ||
    resetDisplayNamesState === "degraded"
  );
}

function outcome(
  candidate: Pick<ReconciliationCandidate, "eventKey" | "sourceTweetId" | "sourcePostText">,
  status: string,
  attempted = false,
  displayName: string | null = null,
): ResetDisplayNameReconciliationOutcome {
  return {
    eventKey: candidate.eventKey,
    sourceTweetId: candidate.sourceTweetId,
    sourceReady: Boolean(candidate.sourcePostText),
    attempted,
    status,
    displayName,
  };
}

export async function reconcileResetDisplayNames(
  options: ResetDisplayNameReconciliationOptions = {},
): Promise<ResetDisplayNameReconciliationResult> {
  const now = options.now ?? new Date();
  const data = options.data ?? await (
    options.fetchData ?? ((calculationNow: Date) => fetchCurrentRadarData({
      bypassCache: true,
      calculationNow,
    }))
  )(now);
  const history = options.canonicalHistory ?? getCanonicalResetHistoryForDisplayNameReconciliation(data);
  const sourceRows = options.sourceRows
    ? normalizeSourceRows(options.sourceRows)
    : collectSourceRows(data);
  const namesByKey = new Map<string, ResetDisplayNameRecord>();
  for (const record of data.reset_display_names ?? []) {
    const eventKey = record.event_key?.trim();
    if (eventKey && !namesByKey.has(eventKey)) namesByKey.set(eventKey, record);
  }

  const results: ResetDisplayNameReconciliationResult = {
    scanned: history.length,
    candidates: 0,
    attempted: 0,
    geminiRequests: 0,
    writes: 0,
    invalidated: false,
    outcomes: [],
  };

  if (isSupabaseReadUnavailable(data)) {
    results.outcomes.push({
      eventKey: null,
      sourceTweetId: null,
      sourceReady: false,
      attempted: false,
      status: "data_unavailable",
      displayName: null,
    });
    return results;
  }

  const candidates: ReconciliationCandidate[] = [];
  const seenEventKeys = new Set<string>();
  for (const item of history) {
    const eventKey = getCanonicalResetDisplayNameEventKey(item);
    if (!eventKey) {
      results.outcomes.push({
        eventKey: null,
        sourceTweetId: null,
        sourceReady: false,
        attempted: false,
        status: "missing_canonical_key",
        displayName: null,
      });
      continue;
    }
    if (seenEventKeys.has(eventKey)) continue;
    seenEventKeys.add(eventKey);

    if (!isAutoNameableCanonicalEvent(item, now)) {
      results.outcomes.push({
        eventKey,
        sourceTweetId: null,
        sourceReady: false,
        attempted: false,
        status: "not_nameable",
        displayName: null,
      });
      continue;
    }

    const completedAt = getCompletedResetTimestamp(item);
    if (completedAt === null) continue;
    const sourceTweetIds = getCanonicalSourceTweetIds(item);
    const effectiveSource = resolveCandidateSource(sourceTweetIds, sourceRows);
    const sourcePostText = effectiveSource
      ? buildResetDisplayNameSourceContext({
          effectiveFormalCandidate: effectiveSource,
          sourceTweetIds,
          sourceRows,
        })
      : null;
    const input = toRandomResetNameInput(item, completedAt);
    input.sourcePostText = sourcePostText;

    candidates.push({
      item,
      eventKey,
      completedAt,
      sourceTweetId: effectiveSource?.tweet_id ?? null,
      sourcePostText,
      inputHash: hashResetDisplayNameInput(input, sourcePostText),
      existing: namesByKey.get(eventKey) ?? null,
    });
  }

  candidates.sort((left, right) => {
    if (left.completedAt !== right.completedAt) return right.completedAt - left.completedAt;
    return left.eventKey.localeCompare(right.eventKey);
  });
  results.candidates = candidates.length;

  const model = options.model ?? RANDOM_RESET_NAME_MODEL;
  const apiKey = getApiKey(options);
  const maxGeminiRequests = getMaxGeminiRequests(options.maxGeminiRequests);
  const ensure = options.ensure ?? ensureResetDisplayNameForEvent;
  let wrote = false;

  for (const candidate of candidates) {
    const existingManualName = candidate.existing?.manual_name_ja?.trim();
    if (existingManualName) {
      results.outcomes.push(outcome(candidate, "manual", false, existingManualName));
      continue;
    }
    if (shouldPreserveExistingAcceptedResetDisplayName(candidate.existing)) {
      results.outcomes.push(outcome(
        candidate,
        "preserved_legacy_accepted",
        false,
        candidate.existing?.ai_name_ja ?? null,
      ));
      continue;
    }
    if (!candidate.sourcePostText) {
      results.outcomes.push(outcome(
        candidate,
        candidate.existing?.ai_status === "accepted" ? "preserved_existing" : "source_unavailable",
        false,
        candidate.existing?.ai_status === "accepted" ? candidate.existing.ai_name_ja : null,
      ));
      continue;
    }
    if (shouldReuseResetDisplayNameResult(candidate.existing, candidate.inputHash, model)) {
      results.outcomes.push(outcome(
        candidate,
        candidate.existing?.ai_status ?? "reused",
        false,
        candidate.existing?.ai_name_ja ?? null,
      ));
      continue;
    }
    if (!apiKey) {
      results.outcomes.push(outcome(candidate, "api_error"));
      continue;
    }
    if (results.geminiRequests >= maxGeminiRequests) {
      results.outcomes.push(outcome(candidate, "gemini_cap_reached"));
      continue;
    }
    if (options.dryRun) {
      results.outcomes.push(outcome(candidate, "dry_run"));
      continue;
    }

    results.geminiRequests += 1;
    results.attempted += 1;
    let generation: ResetDisplayNameGenerationOutcome;
    try {
      generation = await ensure(candidate.item, {
        canonicalEventKey: candidate.eventKey,
        existingRecord: candidate.existing,
        sourcePostText: candidate.sourcePostText,
        sourceTweetId: candidate.sourceTweetId,
        now,
        apiKey,
        model,
        timeoutMs: options.timeoutMs,
      });
    } catch {
      results.outcomes.push(outcome(candidate, "api_error", true));
      continue;
    }

    if (!generation.skipped) {
      results.writes += 1;
      wrote = true;
    }
    results.outcomes.push(outcome(
      candidate,
      generation.status,
      true,
      generation.displayName,
    ));
  }

  if (wrote && options.invalidateRadarData) {
    try {
      await options.invalidateRadarData();
      results.invalidated = true;
    } catch {
      results.invalidated = false;
    }
  }

  return results;
}
