import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";

import {
  CODEX_USAGE_SOURCE_KEY,
  USAGE_TIBO_MATCH_WINDOW_MS,
  canCorroborateTiboReset,
  evaluateCodexUsageRecovery,
  isCodexUsageAuthorizationValid,
  parseCodexUsageWebhookPayload,
  shouldCreateNoticeBackedEstimate,
  type CodexUsageSnapshot,
} from "@/lib/codexUsageRecovery";
import {
  confirmNearestCodexRecoveryObservation,
  findFormalTiboResetCluster,
  findRecentFormalTiboReset,
  insertObservedRegularResetEvent,
  insertCodexRecoveryObservation,
  promoteDeferredTiboReset,
  readCodexUsageMonitorState,
  upsertBankedDistributionEstimate,
  upsertResetExecutionEstimate,
  upsertCodexUsageMonitorState,
} from "@/lib/codexUsageRecoveryStore";
import {
  getActiveOfficialNotice,
  type ActiveOfficialNotice,
} from "@/lib/radar/probability";
import {
  collectBankedDistributionSignals,
  collectOfficialTiboNoticeSignals,
  findRelatedBankedDistributionNotices,
  findRelatedTiboNoticeCluster,
  selectRepresentativeTiboNotice,
  type BankedDistributionSignal,
  type TiboNoticeSignal,
} from "@/lib/radar/tiboHistory";
import {
  isBankedObservationWithinNoticeWindow,
  isBroadBankedDistributionNotice,
} from "@/lib/radar/bankedReset";
import type { ActiveTiboSignal, RadarData } from "@/lib/radar/types";

const NOTICE_COLUMNS = "tweet_id,text,tweet_url,tweet_created_at,expires_at,signal_type,confidence,verification_status,is_reply,ai_temporal_expression,ai_temporal_kind,ai_temporal_precision,expected_start_at,expected_end_at,temporal_resolution_status,ai_temporal_timezone,ai_temporal_confidence";
const REGULAR_COLUMNS = "schedule_key,window_start_at,window_end_at,representative_at,scheduled_at,completed_at,cycle_type,reset_method,scope,record_kind,status,correction_reason,corrected_at";

function getSupabaseServiceClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

function toTiboNoticeSignal(notice: ActiveOfficialNotice): TiboNoticeSignal {
  return {
    tweet_id: notice.id,
    text: notice.text ?? notice.title ?? "",
    tweet_url: notice.source ?? "",
    tweet_created_at: notice.observedAt,
    signal_type: "official_notice",
    confidence: 1,
    verification_status: "auto_unverified",
    expected_start_at: notice.expectedAt,
    expected_end_at: notice.expectedEndAt,
    ai_temporal_precision: notice.temporalPrecision ?? null,
    ai_temporal_timezone: notice.temporalTimezone ?? null,
    temporal_resolution_status: notice.temporalResolutionStatus ?? null,
  };
}

type OfficialNoticeLookup = {
  active: boolean;
  noticeSignal: ActiveOfficialNotice | null;
  bankedNoticeSignal: ActiveOfficialNotice | null;
  noticeSignals: TiboNoticeSignal[];
  bankedNoticeSignals: BankedDistributionSignal[];
  error: unknown;
};

async function hasActiveOfficialNotice(
  client: SupabaseClient<any>,
  observedAt: Date,
): Promise<OfficialNoticeLookup> {
  const [tiboResult, regularResult] = await Promise.all([
    client
      .from("tibo_signals")
      .select(NOTICE_COLUMNS)
      .in("signal_type", ["official_notice", "reset_executed", "irrelevant"])
      .or("is_reply.is.null,is_reply.eq.false")
      .neq("verification_status", "rejected")
      .limit(1000),
    client
      .from("regular_reset_events")
      .select(REGULAR_COLUMNS)
      .limit(1000),
  ]);

  if (tiboResult.error || regularResult.error) {
    return {
      active: false,
      noticeSignal: null,
      bankedNoticeSignal: null,
      noticeSignals: [],
      bankedNoticeSignals: [],
      error: tiboResult.error ?? regularResult.error,
    };
  }

  const signals = (tiboResult.data ?? []) as unknown as ActiveTiboSignal[];
  const data: RadarData = {
    active_tibo_signals: signals,
    formal_tibo_resets: signals
      .filter((signal) => signal.signal_type === "reset_executed")
      .map((signal) => ({
        ...signal,
        text: signal.text ?? "",
        tweet_url: signal.tweet_url ?? "",
        confidence: signal.confidence ?? null,
        verification_status: signal.verification_status ?? "auto_unverified",
      })),
    regular_reset_events: regularResult.data as RadarData["regular_reset_events"],
  };
  const activeNotice = getActiveOfficialNotice(data, null, observedAt);
  const activeBankedNotice = getActiveOfficialNotice(
    {
      ...data,
      active_tibo_signals: signals.filter((signal) => isBroadBankedDistributionNotice(signal.text)),
    },
    null,
    observedAt,
  );
  const noticeSignals = collectOfficialTiboNoticeSignals(signals, []);
  const bankedSignals = collectBankedDistributionSignals(signals, []);
  const bankedNoticeSignals = findRelatedBankedDistributionNotices(
    bankedSignals,
    activeBankedNotice?.id ?? "",
    observedAt.toISOString(),
  );
  return {
    active: Boolean(activeNotice),
    noticeSignal: activeNotice ?? null,
    bankedNoticeSignal: activeBankedNotice ?? null,
    noticeSignals,
    bankedNoticeSignals,
    error: null,
  };
}

async function persistCorroboratedBankedDistribution(
  client: SupabaseClient<any>,
  snapshot: CodexUsageSnapshot,
  lookup: OfficialNoticeLookup | null,
) {
  const notice = lookup?.bankedNoticeSignal;
  const relatedNotices = lookup?.bankedNoticeSignals?.length
    ? lookup.bankedNoticeSignals
    : notice
      ? [toTiboNoticeSignal(notice)]
      : [];
  const officialNotices = relatedNotices.filter(
    (signal): signal is TiboNoticeSignal => signal.signal_type === "official_notice",
  );
  const representativeNotice = selectRepresentativeTiboNotice(officialNotices) ??
    (notice ? toTiboNoticeSignal(notice) : null);
  const firstAnnouncement = officialNotices[0] ?? representativeNotice;
  if (
    snapshot.bankedResetCountChange !== true ||
    typeof snapshot.bankedResetAvailableCount !== "number" ||
    snapshot.bankedResetAvailableCount < 1 ||
    !notice?.isBankedDistribution ||
    !isBroadBankedDistributionNotice(notice.text) ||
    !isBankedObservationWithinNoticeWindow(notice, snapshot.observedAt)
  ) {
    return { observed: false, error: null };
  }

  const result = await upsertBankedDistributionEstimate(client, {
    resetEventKey: `banked-reset-${firstAnnouncement?.tweet_id ?? notice.id}`,
    displayExecutionAt: snapshot.observedAt,
    tiboAnnouncedAt: firstAnnouncement?.tweet_created_at ?? notice.observedAt,
    tiboPrimaryTweetId: representativeNotice?.tweet_id ?? notice.id,
    tiboSourceTweetIds: relatedNotices.map((item) => item.tweet_id),
    officialNoticeTweetId: representativeNotice?.tweet_id ?? notice.id,
    officialNoticeAt: representativeNotice?.tweet_created_at ?? notice.observedAt,
  });
  return { observed: true, error: result.error };
}

function recoveryResponse(status: string) {
  return NextResponse.json({ accepted: true, recovery: status });
}

export async function POST(request: Request) {
  const expectedSecret = process.env.CODEX_USAGE_MONITOR_SECRET;
  if (!expectedSecret) {
    return NextResponse.json({ error: "Usage monitor is not configured" }, { status: 503 });
  }

  if (!isCodexUsageAuthorizationValid(request.headers.get("authorization"), expectedSecret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const now = new Date();
  const snapshot = parseCodexUsageWebhookPayload(body, now);
  if (!snapshot) {
    return NextResponse.json({ error: "Invalid usage snapshot" }, { status: 400 });
  }

  const client = getSupabaseServiceClient();
  if (!client) {
    return NextResponse.json({ error: "Usage monitor storage is not configured" }, { status: 503 });
  }

  try {
    const previousResult = await readCodexUsageMonitorState(client);
    if (previousResult.error) {
      console.warn("[Codex usage] state lookup failed", { reason: "database_error" });
      return NextResponse.json({ error: "Usage monitor state unavailable" }, { status: 503 });
    }

    const bankedNotice = snapshot.bankedResetCountChange === true
      ? await hasActiveOfficialNotice(client, new Date(snapshot.observedAt))
      : null;
    if (bankedNotice?.error) {
      console.warn("[Codex usage] BANKED notice lookup failed", { reason: "database_error" });
      return NextResponse.json({ error: "Usage monitor corroboration unavailable" }, { status: 503 });
    }

    const initialDecision = evaluateCodexUsageRecovery(previousResult.row, snapshot);
    if (initialDecision.kind === "stale") return recoveryResponse("ignored_stale");

    if (
      initialDecision.kind === "baseline" ||
      initialDecision.kind === "rebase" ||
      initialDecision.kind === "invalid" ||
      initialDecision.kind === "no_recovery"
    ) {
      const bankedResult = await persistCorroboratedBankedDistribution(
        client,
        snapshot,
        bankedNotice,
      );
      if (bankedResult.error) {
        console.warn("[Codex usage] BANKED distribution estimate write failed", { reason: "database_error" });
        return NextResponse.json({ error: "Usage monitor storage unavailable" }, { status: 503 });
      }
      const stateError = await upsertCodexUsageMonitorState(client, snapshot, now.toISOString(), previousResult.state);
      if (stateError) {
        console.warn("[Codex usage] state update failed", { reason: "database_error" });
        return NextResponse.json({ error: "Usage monitor state unavailable" }, { status: 503 });
      }
      console.info("[Codex usage] snapshot accepted", {
        source: CODEX_USAGE_SOURCE_KEY,
        recovery: initialDecision.kind,
        bankedDistributionObserved: bankedResult.observed,
      });
      if (bankedResult.observed) {
        try {
          revalidateTag("radar-data");
        } catch {
          console.warn("[Codex usage] cache revalidation skipped", { reason: "runtime_context" });
        }
      }
      return recoveryResponse(bankedResult.observed ? "banked_distribution_observed" : initialDecision.kind);
    }

    const notice = bankedNotice ?? await hasActiveOfficialNotice(client, new Date(snapshot.observedAt));
    if (notice.error) {
      console.warn("[Codex usage] official notice lookup failed", { reason: "database_error" });
      return NextResponse.json({ error: "Usage monitor corroboration unavailable" }, { status: 503 });
    }

    const decision = evaluateCodexUsageRecovery(previousResult.row, snapshot, {
      activeOfficialNotice: notice.active,
    });
    if (decision.kind !== "recovery") {
      const stateError = await upsertCodexUsageMonitorState(client, snapshot, now.toISOString(), previousResult.state);
      if (stateError) return NextResponse.json({ error: "Usage monitor state unavailable" }, { status: 503 });
      return recoveryResponse(decision.kind);
    }

    // A recovery near the regular schedule is not Tibo evidence. This also
    // covers the `unknown` near-regular case where an official notice exists:
    // a notice must not turn a regular quota recovery into a Tibo confirmation.
    const matchingTibo = !canCorroborateTiboReset(decision)
      ? { tweetId: null, tweetCreatedAt: null, needsPromotion: false, confidence: null, error: null }
      : await findRecentFormalTiboReset(
          client,
          snapshot.observedAt,
          USAGE_TIBO_MATCH_WINDOW_MS,
        );
    if (matchingTibo.error) {
      console.warn("[Codex usage] Tibo match lookup failed", { reason: "database_error" });
      return NextResponse.json({ error: "Usage monitor corroboration unavailable" }, { status: 503 });
    }

    if (matchingTibo.tweetId && matchingTibo.needsPromotion) {
      const promotion = await promoteDeferredTiboReset(
        client,
        matchingTibo.tweetId,
        matchingTibo.confidence ?? 0.95,
      );
      if (promotion.error) {
        console.warn("[Codex usage] deferred Tibo reset promotion failed", { reason: "database_error" });
        return NextResponse.json({ error: "Usage monitor corroboration unavailable" }, { status: 503 });
      }
    }

    const confirmedAt = matchingTibo.tweetId ? now.toISOString() : null;
    const observationResult = await insertCodexRecoveryObservation(client, {
      sourceKey: CODEX_USAGE_SOURCE_KEY,
      observedAt: snapshot.observedAt,
      previousObservedAt: decision.previous.observedAt,
      previousUsedPercent: decision.previous.usedPercent,
      currentUsedPercent: decision.current.usedPercent,
      previousResetsAt: decision.previous.resetsAt,
      currentResetsAt: decision.current.resetsAt,
      cycleHint: decision.cycleHint,
      confidence: decision.confidence,
      status: matchingTibo.tweetId ? "confirmed" : "observed",
      matchedTiboTweetId: matchingTibo.tweetId,
      confirmedAt,
    });
    if (observationResult.error) {
      console.warn("[Codex usage] recovery observation write failed", { reason: "database_error" });
      return NextResponse.json({ error: "Usage monitor storage unavailable" }, { status: 503 });
    }

    if (decision.nearRegularSchedule) {
      const regularError = await insertObservedRegularResetEvent(
        client,
        new Date(decision.previous.resetsAt * 1000).toISOString(),
        snapshot.observedAt,
      );
      if (regularError) {
        console.warn("[Codex usage] regular reset completion write failed", { reason: "database_error" });
        return NextResponse.json({ error: "Usage monitor storage unavailable" }, { status: 503 });
      }
    }

    // local-codex-app-server observes one account's personal weekly window.
    // Keep its recovery observation for audit. A near-regular recovery is
    // recorded as the canonical regular boundary, but it never promotes a
    // personal recovery into a Tibo/global random reset.
    const noticeSignal = notice.noticeSignal;
    if (matchingTibo.tweetId && matchingTibo.tweetCreatedAt && observationResult.observation) {
      try {
        const cluster = await findFormalTiboResetCluster(
          client,
          matchingTibo.tweetId,
          matchingTibo.tweetCreatedAt,
        );
        if (!cluster.error) {
          const estimateResult = await upsertResetExecutionEstimate(client, {
            resetEventKey: `tibo-reset-${cluster.primaryTweetId}`,
            tiboAnnouncedAt: cluster.announcedAt,
            tiboPrimaryTweetId: cluster.representativeTweetId,
            tiboSourceTweetIds: cluster.sourceTweetIds,
            usageObservation: observationResult.observation,
            officialNoticeTweetId: cluster.representativeNoticeId,
            officialNoticeAt: cluster.representativeNoticeAt,
          });
          if (estimateResult.error) {
            console.warn("[Codex usage] reset execution estimate write failed", { reason: "database_error" });
          }
        }
      } catch {
        console.warn("[Codex usage] reset execution estimate skipped", { reason: "request_failed" });
      }
    } else if (shouldCreateNoticeBackedEstimate(noticeSignal, decision, observationResult.observation)) {
      try {
        const noticeSignals = notice.noticeSignals.length > 0
          ? notice.noticeSignals
          : [toTiboNoticeSignal(noticeSignal)];
        const relatedNoticeSignals = findRelatedTiboNoticeCluster(
          noticeSignals,
          noticeSignal.id,
          snapshot.observedAt,
        );
        const normalizedRelatedNoticeSignals = relatedNoticeSignals.length > 0
          ? relatedNoticeSignals
          : [toTiboNoticeSignal(noticeSignal)];
        const representativeNotice = selectRepresentativeTiboNotice(normalizedRelatedNoticeSignals)!;
        const firstAnnouncement = normalizedRelatedNoticeSignals[0] ?? representativeNotice;
        const estimateResult = await upsertResetExecutionEstimate(client, {
          resetEventKey: `tibo-reset-${firstAnnouncement.tweet_id}`,
          tiboAnnouncedAt: firstAnnouncement.tweet_created_at,
          tiboPrimaryTweetId: representativeNotice.tweet_id,
          tiboSourceTweetIds: normalizedRelatedNoticeSignals.map((relatedNotice) => relatedNotice.tweet_id),
          usageObservation: observationResult.observation,
          officialNoticeTweetId: representativeNotice.tweet_id,
          officialNoticeAt: representativeNotice.tweet_created_at,
        });
        if (estimateResult.error) {
          console.warn("[Codex usage] notice-backed reset execution estimate write failed", { reason: "database_error" });
        }
      } catch {
        console.warn("[Codex usage] notice-backed reset execution estimate skipped", { reason: "request_failed" });
      }
    }

    const bankedResult = await persistCorroboratedBankedDistribution(
      client,
      snapshot,
      notice,
    );
    if (bankedResult.error) {
      console.warn("[Codex usage] BANKED distribution estimate write failed", { reason: "database_error" });
      return NextResponse.json({ error: "Usage monitor storage unavailable" }, { status: 503 });
    }

    const stateError = await upsertCodexUsageMonitorState(client, snapshot, now.toISOString(), previousResult.state);
    if (stateError) {
      console.warn("[Codex usage] state update failed", { reason: "database_error" });
      return NextResponse.json({ error: "Usage monitor state unavailable" }, { status: 503 });
    }

    console.info("[Codex usage] recovery observation accepted", {
      cycleHint: decision.cycleHint,
      confidence: decision.confidence,
      matchedTibo: Boolean(matchingTibo.tweetId),
      bankedDistributionObserved: bankedResult.observed,
    });
    try {
      revalidateTag("radar-data");
    } catch {
      console.warn("[Codex usage] cache revalidation skipped", { reason: "runtime_context" });
    }
    return recoveryResponse(
      bankedResult.observed
        ? "banked_distribution_observed"
        : matchingTibo.tweetId
          ? "confirmed"
          : "observed_unconfirmed",
    );
  } catch {
    console.warn("[Codex usage] request failed", { reason: "request_failed" });
    return NextResponse.json({ error: "Usage monitor unavailable" }, { status: 503 });
  }
}
