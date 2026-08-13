import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";

import {
  CODEX_USAGE_SOURCE_KEY,
  USAGE_TIBO_MATCH_WINDOW_MS,
  evaluateCodexUsageRecovery,
  isCodexUsageAuthorizationValid,
  parseCodexUsageWebhookPayload,
  type CodexUsageSnapshot,
} from "@/lib/codexUsageRecovery";
import {
  confirmNearestCodexRecoveryObservation,
  findFormalTiboResetCluster,
  findRecentFormalTiboReset,
  insertCodexRecoveryObservation,
  readCodexUsageMonitorState,
  upsertResetExecutionEstimate,
  upsertCodexUsageMonitorState,
} from "@/lib/codexUsageRecoveryStore";
import { getActiveOfficialNotice } from "@/lib/radar/probability";
import type { ActiveTiboSignal, RadarData } from "@/lib/radar/types";

const NOTICE_COLUMNS = "tweet_id,text,tweet_url,tweet_created_at,expires_at,signal_type,confidence,verification_status,is_reply,ai_temporal_precision,expected_start_at,expected_end_at,temporal_resolution_status,ai_temporal_timezone,ai_temporal_confidence";
const REGULAR_COLUMNS = "schedule_key,window_start_at,window_end_at,representative_at,scheduled_at,completed_at,cycle_type,reset_method,scope,record_kind,status,correction_reason,corrected_at";

function getSupabaseServiceClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

async function hasActiveOfficialNotice(
  client: SupabaseClient<any>,
  observedAt: Date,
) {
  const [tiboResult, regularResult] = await Promise.all([
    client
      .from("tibo_signals")
      .select(NOTICE_COLUMNS)
      .in("signal_type", ["official_notice", "reset_executed"])
      .or("is_reply.is.null,is_reply.eq.false")
      .neq("verification_status", "rejected")
      .limit(1000),
    client
      .from("regular_reset_events")
      .select(REGULAR_COLUMNS)
      .limit(1000),
  ]);

  if (tiboResult.error || regularResult.error) {
    return { active: false, error: tiboResult.error ?? regularResult.error };
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
  return {
    active: Boolean(activeNotice),
    noticeSignal: activeNotice ?? null,
    error: null,
  };
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

    const initialDecision = evaluateCodexUsageRecovery(previousResult.row, snapshot);
    if (initialDecision.kind === "stale") return recoveryResponse("ignored_stale");

    if (
      initialDecision.kind === "baseline" ||
      initialDecision.kind === "rebase" ||
      initialDecision.kind === "invalid" ||
      initialDecision.kind === "no_recovery"
    ) {
      const stateError = await upsertCodexUsageMonitorState(client, snapshot, now.toISOString());
      if (stateError) {
        console.warn("[Codex usage] state update failed", { reason: "database_error" });
        return NextResponse.json({ error: "Usage monitor state unavailable" }, { status: 503 });
      }
      console.info("[Codex usage] snapshot accepted", {
        source: CODEX_USAGE_SOURCE_KEY,
        recovery: initialDecision.kind,
      });
      return recoveryResponse(initialDecision.kind);
    }

    const notice = await hasActiveOfficialNotice(client, new Date(snapshot.observedAt));
    if (notice.error) {
      console.warn("[Codex usage] official notice lookup failed", { reason: "database_error" });
      return NextResponse.json({ error: "Usage monitor corroboration unavailable" }, { status: 503 });
    }

    const decision = evaluateCodexUsageRecovery(previousResult.row, snapshot, {
      activeOfficialNotice: notice.active,
    });
    if (decision.kind !== "recovery") {
      const stateError = await upsertCodexUsageMonitorState(client, snapshot, now.toISOString());
      if (stateError) return NextResponse.json({ error: "Usage monitor state unavailable" }, { status: 503 });
      return recoveryResponse(decision.kind);
    }

    const matchingTibo = await findRecentFormalTiboReset(
      client,
      snapshot.observedAt,
      USAGE_TIBO_MATCH_WINDOW_MS,
    );
    if (matchingTibo.error) {
      console.warn("[Codex usage] Tibo match lookup failed", { reason: "database_error" });
      return NextResponse.json({ error: "Usage monitor corroboration unavailable" }, { status: 503 });
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
            tiboPrimaryTweetId: cluster.primaryTweetId,
            tiboSourceTweetIds: cluster.sourceTweetIds,
            usageObservation: observationResult.observation,
          });
          if (estimateResult.error) {
            console.warn("[Codex usage] reset execution estimate write failed", { reason: "database_error" });
          }
        }
      } catch {
        console.warn("[Codex usage] reset execution estimate skipped", { reason: "request_failed" });
      }
    } else if (notice.noticeSignal && decision.confidence === "strong" && decision.cycleHint !== "regular" && observationResult.observation) {
      try {
        const estimateResult = await upsertResetExecutionEstimate(client, {
          resetEventKey: `tibo-reset-${notice.noticeSignal.id}`,
          tiboAnnouncedAt: notice.noticeSignal.observedAt,
          tiboPrimaryTweetId: notice.noticeSignal.id,
          tiboSourceTweetIds: [notice.noticeSignal.id].filter(Boolean),
          usageObservation: observationResult.observation,
          officialNoticeTweetId: notice.noticeSignal.id,
          officialNoticeAt: notice.noticeSignal.observedAt,
        });
        if (estimateResult.error) {
          console.warn("[Codex usage] notice-backed reset execution estimate write failed", { reason: "database_error" });
        }
      } catch {
        console.warn("[Codex usage] notice-backed reset execution estimate skipped", { reason: "request_failed" });
      }
    }

    const stateError = await upsertCodexUsageMonitorState(client, snapshot, now.toISOString());
    if (stateError) {
      console.warn("[Codex usage] state update failed", { reason: "database_error" });
      return NextResponse.json({ error: "Usage monitor state unavailable" }, { status: 503 });
    }

    console.info("[Codex usage] recovery observation accepted", {
      cycleHint: decision.cycleHint,
      confidence: decision.confidence,
      matchedTibo: Boolean(matchingTibo.tweetId),
    });
    try {
      revalidateTag("radar-data");
    } catch {
      console.warn("[Codex usage] cache revalidation skipped", { reason: "runtime_context" });
    }
    return recoveryResponse(matchingTibo.tweetId ? "confirmed" : "observed_unconfirmed");
  } catch {
    console.warn("[Codex usage] request failed", { reason: "request_failed" });
    return NextResponse.json({ error: "Usage monitor unavailable" }, { status: 503 });
  }
}
