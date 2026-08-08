import type { WindowEventLike } from "./types";

export type RegularResetScheduleDefinition = {
  schedule_id: string;
  anchor_window_start_at: string;
  anchor_window_end_at: string;
  anchor_representative_at: string;
  cycle_days: number;
  cycle_type: "定期リセット";
  reset_method: string;
  scope: string;
};

export const DEFAULT_REGULAR_RESET_SCHEDULE: RegularResetScheduleDefinition = {
  schedule_id: "weekly-regular-reset",
  anchor_window_start_at: "2026-08-08T03:30:00.000Z",
  anchor_window_end_at: "2026-08-08T03:45:00.000Z",
  anchor_representative_at: "2026-08-08T03:32:00.000Z",
  cycle_days: 7,
  cycle_type: "定期リセット",
  reset_method: "強制リセット",
  scope: "任意リセット未使用アカウント",
};

export type RegularResetEventStatus = "completed" | "corrected" | "voided";

export type RegularResetEventRow = {
  schedule_key: string;
  window_start_at: string;
  window_end_at: string;
  representative_at: string;
  scheduled_at: string;
  completed_at: string;
  cycle_type: "定期リセット";
  reset_method: string;
  scope: string;
  record_kind: "regular_completed";
  status: RegularResetEventStatus;
  correction_reason?: string | null;
  corrected_at?: string | null;
};

const MAX_SCHEDULED_OCCURRENCES = 520;

function parseFiniteDate(value: string): Date | null {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function createScheduledRow(
  definition: RegularResetScheduleDefinition,
  offsetDays: number,
): RegularResetEventRow {
  const anchorWindowStart = parseFiniteDate(definition.anchor_window_start_at);
  const anchorWindowEnd = parseFiniteDate(definition.anchor_window_end_at);
  const anchorRepresentative = parseFiniteDate(definition.anchor_representative_at);

  if (!anchorWindowStart || !anchorWindowEnd || !anchorRepresentative) {
    throw new Error("Invalid regular reset schedule definition");
  }

  const representativeAt = addDays(anchorRepresentative, offsetDays);
  const scheduledAt = representativeAt.toISOString();

  return {
    schedule_key: `${definition.schedule_id}:${scheduledAt}`,
    window_start_at: addDays(anchorWindowStart, offsetDays).toISOString(),
    window_end_at: addDays(anchorWindowEnd, offsetDays).toISOString(),
    representative_at: scheduledAt,
    scheduled_at: scheduledAt,
    completed_at: scheduledAt,
    cycle_type: definition.cycle_type,
    reset_method: definition.reset_method,
    scope: definition.scope,
    record_kind: "regular_completed",
    status: "completed",
  };
}

/**
 * Returns only scheduled occurrences whose representative time has arrived.
 * The route persists these rows idempotently; this function never mutates data.
 */
export function getDueRegularResetEventRows(
  now: Date,
  definition: RegularResetScheduleDefinition = DEFAULT_REGULAR_RESET_SCHEDULE,
): RegularResetEventRow[] {
  const nowMs = now.getTime();
  const anchor = parseFiniteDate(definition.anchor_representative_at);

  if (!Number.isFinite(nowMs) || !anchor || definition.cycle_days <= 0) {
    return [];
  }

  const rows: RegularResetEventRow[] = [];
  let offsetDays = 0;

  while (rows.length < MAX_SCHEDULED_OCCURRENCES) {
    const row = createScheduledRow(definition, offsetDays);
    if (new Date(row.representative_at).getTime() > nowMs) {
      break;
    }

    rows.push(row);
    offsetDays += definition.cycle_days;
  }

  return rows;
}

export function toRegularResetHistoryEvent(
  row: RegularResetEventRow,
): WindowEventLike {
  const windowStart = parseFiniteDate(row.window_start_at);
  const windowEnd = parseFiniteDate(row.window_end_at);
  const windowMinutes =
    windowStart && windowEnd
      ? Math.max(0, Math.round((windowEnd.getTime() - windowStart.getTime()) / 60000))
      : 0;
  const isVoided = row.status === "voided";
  const summary = "定期リセットが予定時刻に実施されました。";

  return {
    id: `regular-reset-${row.schedule_key.replace(/[^a-zA-Z0-9_-]+/g, "-")}`,
    recordKind: "regular_completed",
    title: "定期リセット",
    kind: "reset_completed",
    status: isVoided ? "voided" : "closed",
    opened_at: row.window_start_at,
    closed_at: row.completed_at,
    completed_at: row.completed_at,
    window_minutes: windowMinutes,
    window_human: "定期実施",
    scope: row.scope,
    summary,
    source_url: null,
    details: {
      cycleType: row.cycle_type,
      reasonType: "定期更新",
      resetMethod: row.reset_method,
      scope: row.scope,
      noticeToExecution: "0分（定期）",
      noticeType: "なし",
      note: summary,
    },
  };
}
