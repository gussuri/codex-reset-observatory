import type { CodexRecoveryObservation } from "../../lib/codexUsageRecovery";
import type { FormalTiboResetSignal } from "../../lib/radar/tiboHistory";

type MonitorRecoverySignal = Pick<FormalTiboResetSignal, "tweet_id" | "tweet_created_at">;

export function monitorRecoveryObservationFor(
  signal: MonitorRecoverySignal,
  overrides: Partial<CodexRecoveryObservation> = {},
): CodexRecoveryObservation {
  const observedAt = overrides.observedAt ?? signal.tweet_created_at;
  return {
    id: `test-monitor-${signal.tweet_id}`,
    sourceKey: "local-codex-app-server",
    observedAt,
    previousObservedAt: new Date(Date.parse(observedAt) - 2 * 60_000).toISOString(),
    previousUsedPercent: 100,
    currentUsedPercent: 0,
    previousResetsAt: 1_700_000_000,
    currentResetsAt: 1_700_003_600,
    matchedTiboTweetId: signal.tweet_id,
    confidence: "strong",
    cycleHint: "unexpected",
    status: "observed",
    createdAt: observedAt,
    updatedAt: observedAt,
    ...overrides,
  };
}

export function monitorRecoveryObservationsFor(
  signals: ReadonlyArray<MonitorRecoverySignal>,
) {
  return signals.map((signal) => monitorRecoveryObservationFor(signal));
}
