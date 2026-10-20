import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import {
  attachTiboFormalReplyAdmissionProof,
  createTiboFormalReplyAdmissionProof,
} from "../../lib/radar/tiboFormalReplyAdmission";
import { isFormalTiboResetSignal, type FormalTiboResetSignal } from "../../lib/radar/tiboHistory";
import type { TiboContextSafetyInput } from "../../lib/radar/tiboContextSafety";
import type { TiboEvidenceContext } from "../../lib/radar/tiboEvidenceContext";

const localUrl = process.env.SUPABASE_LOCAL_URL;
const localServiceRoleKey = process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY;
const localIntegrationMarker = process.env.SUPABASE_LOCAL_INTEGRATION === "1";
const localUrlHost = (() => {
  if (!localUrl) return null;
  try {
    return new URL(localUrl).hostname.toLowerCase();
  } catch {
    return null;
  }
})();
const loopbackHosts = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);
const hasAnyLocalConfiguration = Boolean(localUrl || localServiceRoleKey || localIntegrationMarker);
if (hasAnyLocalConfiguration && (
  !localIntegrationMarker ||
  !localUrl ||
  !localServiceRoleKey ||
  !localUrlHost ||
  !loopbackHosts.has(localUrlHost)
)) {
  throw new Error("Tibo proof database tests require an explicit local integration marker and loopback Supabase URL");
}
const isConfigured = localIntegrationMarker && Boolean(localUrl && localServiceRoleKey);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const TARGET_BODY = "Done and dusted.";
const RESET_MEANING = "I pressed the forced reset button for all paid users.";
const METHOD_QUOTE = "I pressed the forced reset button";
const SCOPE_QUOTE = "for all paid users";
const REVISION = "a".repeat(64);
const CREATED_AT = "2026-10-20T08:00:00.000Z";
const PARENT_CREATED_AT = "2026-10-20T07:55:00.000Z";

type CaseIds = { targetId: string; parentId: string };
const CASES: Record<string, CaseIds> = {
  stable: { targetId: "2119999000000000001", parentId: "2119999000000000002" },
  parentBody: { targetId: "2119999000000000011", parentId: "2119999000000000012" },
  parentVerification: { targetId: "2119999000000000021", parentId: "2119999000000000022" },
  targetVerification: { targetId: "2119999000000000031", parentId: "2119999000000000032" },
  confidenceThreshold: { targetId: "2119999000000000041", parentId: "2119999000000000042" },
};

function sourceContext(ids: CaseIds): TiboEvidenceContext {
  return {
    version: "tibo-evidence-context-v1",
    status: "complete",
    target: {
      tweetId: ids.targetId,
      tweetUrl: `https://x.com/thsottiaux/status/${ids.targetId}`,
      authorHandle: "@thsottiaux",
      text: TARGET_BODY,
      createdAt: CREATED_AT,
      sourceContextRevisionHashes: [REVISION],
    },
    relatedPosts: [{
      tweetId: ids.parentId,
      tweetUrl: `https://x.com/thsottiaux/status/${ids.parentId}`,
      authorHandle: "@thsottiaux",
      text: RESET_MEANING,
      createdAt: PARENT_CREATED_AT,
    }],
    edges: [{ fromTweetId: ids.targetId, toTweetId: ids.parentId, relation: "reply" }],
    omissions: [],
    lookupCount: 1,
  };
}

function proofInput(ids: CaseIds): TiboContextSafetyInput {
  return {
    authorText: TARGET_BODY,
    isReply: true,
    isQuote: false,
    replyContextText: RESET_MEANING,
    replyParentTweetId: ids.parentId,
    replyParentTweetUrl: `https://x.com/thsottiaux/status/${ids.parentId}`,
    selectedSignalType: "reset_executed",
    temporalDirection: "completed_now",
    evidenceQuote: TARGET_BODY,
    contextualResetAssessment: "same_global_reset",
    contextualResetTweetId: ids.parentId,
    resetMeaning: {
      method: "forced",
      methodEvidence: { tweetId: ids.parentId, quote: METHOD_QUOTE },
      scope: "all_paid_users",
      scopeEvidence: { tweetId: ids.parentId, quote: SCOPE_QUOTE },
    },
    targetTweetId: ids.targetId,
    targetTweetUrl: `https://x.com/thsottiaux/status/${ids.targetId}`,
    targetTweetCreatedAt: CREATED_AT,
    validatedSourceContext: sourceContext(ids),
  };
}

function proofFor(ids: CaseIds) {
  const value = createTiboFormalReplyAdmissionProof(proofInput(ids), [REVISION], 0);
  assert.ok(value, "fixture must produce a current formal reply proof");
  return value;
}

function parentRow(parentId: string) {
  return {
    tweet_id: parentId,
    signal_type: "official_notice",
    text: RESET_MEANING,
    tweet_url: `https://x.com/thsottiaux/status/${parentId}`,
    tweet_created_at: PARENT_CREATED_AT,
    expires_at: "2026-10-21T08:00:00.000Z",
    verification_status: "confirmed",
    confidence: 0.97,
    classification_source: "gemini",
    is_reply: false,
    is_quote: false,
  };
}

function targetRow(ids: CaseIds) {
  return {
    tweet_id: ids.targetId,
    signal_type: "reset_executed",
    text: TARGET_BODY,
    tweet_url: `https://x.com/thsottiaux/status/${ids.targetId}`,
    tweet_created_at: CREATED_AT,
    expires_at: "2026-10-21T08:00:00.000Z",
    verification_status: "auto_unverified",
    confidence: 0.96,
    classification_reason: "The contextual completion confirms a global reset.",
    classification_source: "gemini",
    ai_signal_type: "reset_executed",
    ai_confidence: 0.96,
    ai_classification_status: "success",
    ai_temporal_direction: "completed_now",
    ai_evidence_quote: TARGET_BODY,
    is_reply: true,
    is_quote: false,
    reply_to_handles: ["@thsottiaux"],
    reply_context_text: RESET_MEANING,
    source_context_snapshot: {
      parent: {
        tweetId: ids.parentId,
        tweetUrl: `https://x.com/thsottiaux/status/${ids.parentId}`,
        authorHandle: "@thsottiaux",
        text: RESET_MEANING,
      },
    },
    source_context_revision_hashes: [REVISION],
    source_context_classified_revision_hashes: [REVISION],
    source_context_generation: 0,
    formal_reply_admission_proof: proofFor(ids),
  };
}

function clearLocalRows() {
  const cleanupFile = "tests/integration/tiboFormalReplyAdmission.cleanup.sql";
  try {
    if (process.platform === "win32") {
      const command = `pnpm exec supabase db query --local --file "${cleanupFile}"`;
      execFileSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", command], {
        cwd: repositoryRoot,
        stdio: "ignore",
      });
    } else {
      execFileSync("pnpm", ["exec", "supabase", "db", "query", "--local", "--file", cleanupFile], {
        cwd: repositoryRoot,
        stdio: "ignore",
      });
    }
  } catch (error) {
    const failure = error as { code?: string | number; status?: number; stderr?: Buffer | string; message?: string };
    const diagnostic = [failure.stderr?.toString(), failure.message].filter(Boolean).join(" ").toLowerCase();
    const reason = /connection refused|not running|could not connect/.test(diagnostic)
      ? "local_database_unavailable"
      : /no such file|enoent|failed to read.*file/.test(diagnostic)
        ? "cleanup_file_unavailable"
        : `local_supabase_cli_failed_${failure.status ?? failure.code ?? "unknown"}`;
    throw new Error(`Failed to clear local Tibo formal reply integration rows (${reason})`);
  }
}

function clientOrThrow(): SupabaseClient {
  if (!localUrl || !localServiceRoleKey) throw new Error("Local Supabase credentials are not configured");
  return createClient(localUrl, localServiceRoleKey, { auth: { persistSession: false } });
}

async function loadSignal(client: SupabaseClient, tweetId: string): Promise<Record<string, any>> {
  const { data, error } = await client
    .from("tibo_signals")
    .select("tweet_id,text,tweet_url,tweet_created_at,signal_type,confidence,verification_status,classification_source,ai_signal_type,ai_confidence,ai_classification_status,ai_temporal_direction,ai_evidence_quote,is_reply,is_quote,source_context_revision_hashes,source_context_classified_revision_hashes,source_context_generation,formal_reply_admission_proof")
    .eq("tweet_id", tweetId)
    .single();
  if (error) throw error;
  const attached = attachTiboFormalReplyAdmissionProof(data as Record<string, unknown>);
  return {
    ...attached,
    rawFormalReplyAdmissionProof: data.formal_reply_admission_proof,
  };
}

async function assertFormalAfterReload(client: SupabaseClient, ids: CaseIds, expected: boolean) {
  const signal = await loadSignal(client, ids.targetId);
  assert.equal(isFormalTiboResetSignal(signal as unknown as FormalTiboResetSignal), expected);
  return signal;
}

async function insertPair(client: SupabaseClient, ids: CaseIds) {
  const { error: parentError } = await client.from("tibo_signals").insert(parentRow(ids.parentId));
  if (parentError) throw parentError;
  const { error: targetError } = await client.from("tibo_signals").insert(targetRow(ids));
  if (targetError) throw targetError;
  await assertFormalAfterReload(client, ids, true);
}

test("loopback Supabase proof triggers preserve harmless updates and reject stale ancestor context", {
  skip: !isConfigured,
}, async () => {
  clearLocalRows();
  const client = clientOrThrow();
  try {
    const stable = CASES.stable!;
    await insertPair(client, stable);

    const reasonUpdate = await client.from("tibo_signals")
      .update({ classification_reason: "The parent explanation was revised." })
      .eq("tweet_id", stable.targetId)
      .select("tweet_id");
    assert.ifError(reasonUpdate.error);
    assert.equal(reasonUpdate.data?.length, 1);
    let reloaded = await assertFormalAfterReload(client, stable, true);
    assert.equal(reloaded.rawFormalReplyAdmissionProof?.sourceContextGeneration, 0);

    const confidenceUpdate = await client.from("tibo_signals")
      .update({ confidence: 0.97, ai_confidence: 0.97 })
      .eq("tweet_id", stable.targetId)
      .select("tweet_id");
    assert.ifError(confidenceUpdate.error);
    assert.equal(confidenceUpdate.data?.length, 1);
    await assertFormalAfterReload(client, stable, true);

    const parentExplanation = await client.from("tibo_signals")
      .update({
        classification_reason: "A parent explanation changed.",
        confidence: 0.98,
      })
      .eq("tweet_id", stable.parentId)
      .select("tweet_id");
    assert.ifError(parentExplanation.error);
    assert.equal(parentExplanation.data?.length, 1);
    reloaded = await assertFormalAfterReload(client, stable, true);
    assert.equal(reloaded.source_context_generation, 0);

    const targetBodyChange = await client.from("tibo_signals")
      .update({ text: "This target body has changed." })
      .eq("tweet_id", stable.targetId)
      .select("tweet_id");
    assert.ifError(targetBodyChange.error);
    assert.equal(targetBodyChange.data?.length, 1);
    reloaded = await assertFormalAfterReload(client, stable, false);
    assert.equal(reloaded.rawFormalReplyAdmissionProof, null);

    const threshold = CASES.confidenceThreshold!;
    await insertPair(client, threshold);
    const belowThreshold = await client.from("tibo_signals")
      .update({ confidence: 0.94, ai_confidence: 0.94 })
      .eq("tweet_id", threshold.targetId)
      .select("tweet_id");
    assert.ifError(belowThreshold.error);
    assert.equal(belowThreshold.data?.length, 1);
    const afterThresholdCrossing = await assertFormalAfterReload(client, threshold, false);
    assert.equal(afterThresholdCrossing.rawFormalReplyAdmissionProof, null);

    const parentBody = CASES.parentBody!;
    await insertPair(client, parentBody);
    const capturedGeneration = 0;
    const parentBodyUpdate = await client.from("tibo_signals")
      .update({ text: "The parent source body changed while classification was in flight." })
      .eq("tweet_id", parentBody.parentId)
      .select("tweet_id");
    assert.ifError(parentBodyUpdate.error);
    const afterParentBodyChange = await assertFormalAfterReload(client, parentBody, false);
    assert.equal(afterParentBodyChange.source_context_generation, capturedGeneration + 1);
    assert.deepEqual(afterParentBodyChange.source_context_classified_revision_hashes, []);
    assert.equal(afterParentBodyChange.rawFormalReplyAdmissionProof, null);

    const staleBodySave = await client.from("tibo_signals")
      .update({ formal_reply_admission_proof: proofFor(parentBody) })
      .eq("tweet_id", parentBody.targetId)
      .eq("source_context_generation", capturedGeneration)
      .select("tweet_id");
    assert.ifError(staleBodySave.error);
    assert.deepEqual(staleBodySave.data, [], "old-generation classification save must lose its CAS");
    await assertFormalAfterReload(client, parentBody, false);

    const parentVerification = CASES.parentVerification!;
    await insertPair(client, parentVerification);
    const parentVerificationUpdate = await client.from("tibo_signals")
      .update({ verification_status: "rejected" })
      .eq("tweet_id", parentVerification.parentId)
      .select("tweet_id");
    assert.ifError(parentVerificationUpdate.error);
    const afterParentVerificationChange = await assertFormalAfterReload(client, parentVerification, false);
    assert.equal(afterParentVerificationChange.source_context_generation, 1);
    assert.deepEqual(afterParentVerificationChange.source_context_classified_revision_hashes, []);

    const staleVerificationSave = await client.from("tibo_signals")
      .update({ formal_reply_admission_proof: proofFor(parentVerification) })
      .eq("tweet_id", parentVerification.targetId)
      .eq("source_context_generation", 0)
      .select("tweet_id");
    assert.ifError(staleVerificationSave.error);
    assert.deepEqual(staleVerificationSave.data, [], "old-generation verification context cannot be saved");
    await assertFormalAfterReload(client, parentVerification, false);

    const targetVerification = CASES.targetVerification!;
    await insertPair(client, targetVerification);
    const targetVerificationUpdate = await client.from("tibo_signals")
      .update({ verification_status: "rejected" })
      .eq("tweet_id", targetVerification.targetId)
      .select("tweet_id");
    assert.ifError(targetVerificationUpdate.error);
    const afterTargetVerificationChange = await assertFormalAfterReload(client, targetVerification, false);
    assert.equal(afterTargetVerificationChange.rawFormalReplyAdmissionProof, null);
  } finally {
    clearLocalRows();
    await client.auth.signOut().catch(() => undefined);
  }
});
