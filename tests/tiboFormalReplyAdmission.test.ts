import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  attachTiboFormalReplyAdmissionProof,
  createTiboFormalReplyAdmissionProof,
  type TiboFormalReplyAdmissionProof,
} from "../lib/radar/tiboFormalReplyAdmission";
import {
  areFormalTiboResetSignalsSameCluster,
  convertTiboResetSignalToHistoryEvent,
  isFormalTiboResetSignal,
  type FormalTiboResetSignal,
} from "../lib/radar/tiboHistory";
import type { TiboContextSafetyInput } from "../lib/radar/tiboContextSafety";
import type { TiboEvidenceContext } from "../lib/radar/tiboEvidenceContext";

const TARGET_ID = "2115000000000000101";
const PARENT_ID = "2115000000000000102";
const ROOT_ID = "2115000000000000103";
const TARGET_URL = `https://x.com/thsottiaux/status/${TARGET_ID}`;
const PARENT_URL = `https://x.com/thsottiaux/status/${PARENT_ID}`;
const ROOT_URL = `https://x.com/thsottiaux/status/${ROOT_ID}`;
const TARGET_AT = "2026-10-20T08:00:00.000Z";
const PARENT_AT = "2026-10-20T07:55:00.000Z";
const ROOT_AT = "2026-10-20T07:30:00.000Z";
const REVISION = "a".repeat(64);
const COMPLETION_TEXT = "Done and dusted.";

function context(depth: 1 | 2, targetTweetId = TARGET_ID, targetCreatedAt = TARGET_AT): TiboEvidenceContext {
  const target = {
    tweetId: targetTweetId,
    tweetUrl: `https://x.com/thsottiaux/status/${targetTweetId}`,
    authorHandle: "@thsottiaux",
    text: COMPLETION_TEXT,
    createdAt: targetCreatedAt,
    sourceContextRevisionHashes: [REVISION],
  };
  const parent = {
    tweetId: PARENT_ID,
    tweetUrl: PARENT_URL,
    authorHandle: "@thsottiaux",
    text: depth === 1 ? "Day 13/ Le limit reset" : "Landing within the next 2 hours.",
    createdAt: PARENT_AT,
  };
  const root = {
    tweetId: ROOT_ID,
    tweetUrl: ROOT_URL,
    authorHandle: "@thsottiaux",
    text: "Day 10/ Reset",
    createdAt: ROOT_AT,
  };
  return {
    version: "tibo-evidence-context-v1",
    status: "complete",
    target,
    relatedPosts: depth === 1 ? [parent] : [parent, root],
    edges: depth === 1
      ? [{ fromTweetId: targetTweetId, toTweetId: PARENT_ID, relation: "reply" }]
      : [
          { fromTweetId: targetTweetId, toTweetId: PARENT_ID, relation: "reply" },
          { fromTweetId: PARENT_ID, toTweetId: ROOT_ID, relation: "reply" },
        ],
    omissions: [],
    lookupCount: depth,
  };
}

function input(depth: 1 | 2, targetTweetId = TARGET_ID, targetCreatedAt = TARGET_AT): TiboContextSafetyInput {
  return {
    authorText: COMPLETION_TEXT,
    isReply: true,
    isQuote: false,
    replyContextText: depth === 1 ? "Day 13/ Le limit reset" : "Landing within the next 2 hours.",
    replyParentTweetId: PARENT_ID,
    replyParentTweetUrl: PARENT_URL,
    selectedSignalType: "reset_executed",
    temporalDirection: "completed_now",
    evidenceQuote: COMPLETION_TEXT,
    contextualResetAssessment: "same_global_reset",
    contextualResetTweetId: depth === 1 ? PARENT_ID : ROOT_ID,
    targetTweetId,
    targetTweetUrl: `https://x.com/thsottiaux/status/${targetTweetId}`,
    targetTweetCreatedAt: targetCreatedAt,
    validatedSourceContext: context(depth, targetTweetId, targetCreatedAt),
  };
}

function formalSignal(overrides: Partial<FormalTiboResetSignal> = {}): FormalTiboResetSignal {
  return {
    tweet_id: TARGET_ID,
    text: COMPLETION_TEXT,
    tweet_url: TARGET_URL,
    tweet_created_at: TARGET_AT,
    signal_type: "reset_executed",
    confidence: 0.97,
    verification_status: "auto_unverified",
    classification_source: "gemini",
    ai_signal_type: "reset_executed",
    ai_confidence: 0.97,
    ai_classification_status: "success",
    ai_temporal_direction: "completed_now",
    ai_evidence_quote: COMPLETION_TEXT,
    is_reply: true,
    is_quote: false,
    source_context_revision_hashes: [REVISION],
    source_context_classified_revision_hashes: [REVISION],
    ...overrides,
  } as FormalTiboResetSignal;
}

function proof(depth: 1 | 2, targetTweetId = TARGET_ID, targetCreatedAt = TARGET_AT): TiboFormalReplyAdmissionProof {
  const result = createTiboFormalReplyAdmissionProof(input(depth, targetTweetId, targetCreatedAt), [REVISION]);
  assert.ok(result, `${depth}-hop same-event reply should produce a proof`);
  return result;
}

test("same-global reset completion replies receive versioned proof over exact one- and two-hop Tibo paths", () => {
  for (const depth of [1, 2] as const) {
    const admissionProof = proof(depth);
    const signal = attachTiboFormalReplyAdmissionProof(formalSignal(), admissionProof);

    assert.equal(admissionProof.version, "tibo-formal-reply-admission-v1");
    assert.equal(admissionProof.admissionMethod, "validated_same_global_reset_reply");
    assert.equal(admissionProof.targetTextHash, createHash("sha256").update(COMPLETION_TEXT, "utf8").digest("hex"));
    assert.equal(admissionProof.targetTweetId, TARGET_ID);
    assert.equal(admissionProof.contextualResetTweetId, depth === 1 ? PARENT_ID : ROOT_ID);
    assert.equal(admissionProof.pathTweetIds.length, depth + 1);
    assert.equal(isFormalTiboResetSignal(signal), true);
    const serializedSignal = JSON.stringify(signal);
    assert.equal(serializedSignal.includes("formal_reply_admission_proof"), false);
    assert.equal(serializedSignal.includes("contextualResetTweetId"), false);
  }
});

test("reply proof fails closed for stale revisions, edits, manual/rejected state, and unsupported event meaning", () => {
  const admissionProof = proof(2);
  const valid = formalSignal();
  assert.equal(isFormalTiboResetSignal(valid), false, "a reply without proof remains excluded");

  assert.equal(isFormalTiboResetSignal(attachTiboFormalReplyAdmissionProof(
    formalSignal({ source_context_revision_hashes: ["b".repeat(64)] }),
    admissionProof,
  )), false, "source context revision must match the persisted proof");
  assert.equal(isFormalTiboResetSignal(attachTiboFormalReplyAdmissionProof(
    formalSignal({ source_context_classified_revision_hashes: [] }),
    admissionProof,
  )), false, "the proof revision must have completed classification");
  assert.equal(isFormalTiboResetSignal(attachTiboFormalReplyAdmissionProof(
    formalSignal({ text: "A different edited reply." }),
    admissionProof,
  )), false, "the exact target evidence quote must remain in the current post");
  assert.equal(isFormalTiboResetSignal(attachTiboFormalReplyAdmissionProof(
    formalSignal({ text: `Added context. ${COMPLETION_TEXT}` }),
    admissionProof,
  )), false, "an edited target must fail even if the previous quote remains in its body");
  assert.equal(isFormalTiboResetSignal(attachTiboFormalReplyAdmissionProof(
    formalSignal({ text: `${COMPLETION_TEXT} ` }),
    admissionProof,
  )), false, "the body hash binds the exact stored text, including boundary whitespace");
  assert.equal(isFormalTiboResetSignal(attachTiboFormalReplyAdmissionProof(
    formalSignal({ classification_source: "manual" }),
    admissionProof,
  )), false, "AI context proof cannot override a manual classification");
  assert.equal(isFormalTiboResetSignal(attachTiboFormalReplyAdmissionProof(
    formalSignal({ verification_status: "rejected" }),
    admissionProof,
  )), false, "rejected rows never enter formal history");
  assert.equal(isFormalTiboResetSignal(attachTiboFormalReplyAdmissionProof(
    formalSignal({ verification_status: "confirmed" }),
    admissionProof,
  )), false, "a manually confirmed row cannot retain automatic reply admission");
  assert.equal(isFormalTiboResetSignal(attachTiboFormalReplyAdmissionProof(
    formalSignal({ ai_confidence: 0.94 }),
    admissionProof,
  )), false, "the current Gemini confidence must still meet the formal threshold");
  assert.equal(isFormalTiboResetSignal(attachTiboFormalReplyAdmissionProof(
    formalSignal({ ai_temporal_direction: "historical" }),
    admissionProof,
  )), false, "the stored Gemini direction must still match the completion assessment");
  assert.equal(isFormalTiboResetSignal(attachTiboFormalReplyAdmissionProof(
    formalSignal({ ai_evidence_quote: "A different quote." }),
    admissionProof,
  )), false, "the stored Gemini evidence must still match the proof");
  assert.equal(isFormalTiboResetSignal(attachTiboFormalReplyAdmissionProof(
    formalSignal({ text: "Banked resets have now been loaded into all accounts." }),
    admissionProof,
  )), false, "BANKED completion remains outside broad forced-reset history");
});

test("reply proof generation rejects partial, foreign-author, quote, and non-completion context", () => {
  const valid = input(2);
  const revisions = [REVISION];
  assert.equal(createTiboFormalReplyAdmissionProof({
    ...valid,
    validatedSourceContext: { ...valid.validatedSourceContext!, status: "partial" },
  }, revisions), null);
  assert.equal(createTiboFormalReplyAdmissionProof({
    ...valid,
    isQuote: true,
  }, revisions), null);
  assert.equal(createTiboFormalReplyAdmissionProof({
    ...valid,
    contextualResetAssessment: "same_banked_distribution",
  }, revisions), null);
  assert.equal(createTiboFormalReplyAdmissionProof({
    ...valid,
    temporalDirection: "historical",
  }, revisions), null);
  assert.equal(createTiboFormalReplyAdmissionProof({
    ...valid,
    contextualResetTweetId: "2115000000000000999",
  }, revisions), null);
  assert.equal(createTiboFormalReplyAdmissionProof({
    ...valid,
    validatedSourceContext: {
      ...valid.validatedSourceContext!,
      relatedPosts: valid.validatedSourceContext!.relatedPosts.map((node, index) =>
        index === 0 ? { ...node, authorHandle: "@external_user" } : node,
      ),
    },
  }, revisions), null);
  assert.equal(createTiboFormalReplyAdmissionProof(valid, []), null);
  assert.equal(createTiboFormalReplyAdmissionProof(valid, ["not-a-revision"]), null);
});

test("reply proof generation rejects a BANKED event anywhere in the cited context path", () => {
  const valid = input(2);
  const sourceContext = valid.validatedSourceContext!;
  const bankedRootText = "Banked resets have now been loaded into all accounts.";
  assert.equal(createTiboFormalReplyAdmissionProof({
    ...valid,
    validatedSourceContext: {
      ...sourceContext,
      relatedPosts: sourceContext.relatedPosts.map((node) =>
        node.tweetId === ROOT_ID ? { ...node, text: bankedRootText } : node,
      ),
    },
  }, [REVISION]), null);
});

test("reply completions that cite the same verified root share one exact event identity", () => {
  const secondTweetId = "2115000000000000104";
  const secondCreatedAt = "2026-10-20T08:01:00.000Z";
  const first = attachTiboFormalReplyAdmissionProof(formalSignal(), proof(2));
  const second = attachTiboFormalReplyAdmissionProof(formalSignal({
    tweet_id: secondTweetId,
    tweet_url: `https://x.com/thsottiaux/status/${secondTweetId}`,
    tweet_created_at: secondCreatedAt,
  }), proof(2, secondTweetId, secondCreatedAt));

  assert.equal(isFormalTiboResetSignal(first), true);
  assert.equal(isFormalTiboResetSignal(second), true);
  assert.equal(areFormalTiboResetSignalsSameCluster(first, second), true);
  assert.equal(convertTiboResetSignalToHistoryEvent(first).id, `tibo-reset-${ROOT_ID}`);
  assert.equal(convertTiboResetSignalToHistoryEvent(second).id, `tibo-reset-${ROOT_ID}`);
});
