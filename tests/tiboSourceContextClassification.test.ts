import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import https from "node:https";
import test from "node:test";

import { NextRequest } from "next/server";

import { buildGeminiPrompt, TIBO_GEMINI_SYSTEM_PROMPT } from "../lib/radar/geminiClassification";
import { POST } from "../app/api/webhook/tibo/route";

const ENV_KEYS = [
  "TIBO_WEBHOOK_SECRET",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "GEMINI_CLASSIFICATION_MODE",
  "GEMINI_API_KEY",
  "GEMINI_MODEL",
  "GEMINI_TRANSLATION_MODE",
  "RESET_DISPLAY_NAME_CANDIDATE_MODE",
  "RESET_DISPLAY_NAME_CANDIDATE_ADOPTION_AT",
] as const;

function saveEnvironment() {
  return Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]])) as
    Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>;
}

function restoreEnvironment(previous: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>) {
  for (const key of ENV_KEYS) {
    const value = previous[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

const TARGET_ID = "2115000000000000001";
const PARENT_ID = "2115000000000000002";
const TARGET_TEXT = "We will reset usage limits tomorrow.";
const PARENT_TEXT = "Reset usage limits for all users tomorrow.";
const TARGET_CREATED_AT = "2026-10-18T08:00:00.000Z";
const PARENT_CREATED_AT = "2026-10-17T08:00:00.000Z";
const TARGET_URL = `https://x.com/thsottiaux/status/${TARGET_ID}`;
const PARENT_URL = `https://x.com/thsottiaux/status/${PARENT_ID}`;

function sourceMetadata() {
  return {
    isReply: true,
    replyToHandles: ["@thsottiaux"],
    replyParentTweetId: PARENT_ID,
    replyParentTweetUrl: PARENT_URL,
    replyContextText: PARENT_TEXT,
    sourceTimeline: "with_replies" as const,
  };
}

function buildRequest(overrides: Record<string, unknown> = {}) {
  return new NextRequest("http://localhost/api/webhook/tibo", {
    method: "POST",
    headers: {
      authorization: "Bearer test-webhook-secret",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      tweetId: TARGET_ID,
      text: TARGET_TEXT,
      tweetUrl: TARGET_URL,
      tweetCreatedAt: TARGET_CREATED_AT,
      ...overrides,
    }),
  });
}

function installGeminiPromptCapture(
  result: Record<string, unknown> | Record<string, unknown>[] = {
  signalType: "official_notice",
  confidence: 0.94,
  temporalDirection: "future",
  evidenceQuote: TARGET_TEXT,
  reasonJa: "親投稿とつながる告知です。",
  resetTypeJa: null,
  teaserStrength: "none",
  teaserStrengthConfidence: 0.9,
  teaserStrengthEvidenceQuote: null,
  teaserStrengthReasonJa: null,
  contextualResetAssessment: "not_applicable",
  contextualResetTweetId: null,
}, responseStatuses: number[] = [], options: { preserveMissingContextualResetAssessment?: boolean } = {}) {
  const original = https.request;
  const prompts: string[] = [];
  https.request = ((...args: any[]) => {
    const callback = args[2] as (response: EventEmitter & { statusCode?: number }) => void;
    const request = new EventEmitter() as EventEmitter & {
      write: (body: string) => boolean;
      end: () => void;
    };
    let payload = "";
    request.write = (body) => {
      payload += body;
      return true;
    };
    request.end = () => {
      const requestBody = JSON.parse(payload) as {
        contents: Array<{ parts: Array<{ text: string }> }>;
      };
      prompts.push(requestBody.contents[0]!.parts[1]!.text);
      const responseIndex = prompts.length - 1;
      const responseStatus = responseStatuses[responseIndex] ?? 200;
      const rawResponseResult = Array.isArray(result)
        ? result[Math.min(responseIndex, result.length - 1)]
        : result;
      const responseResult = options.preserveMissingContextualResetAssessment ||
        Object.prototype.hasOwnProperty.call(rawResponseResult, "contextualResetAssessment")
        ? rawResponseResult
        : { ...rawResponseResult, contextualResetAssessment: "not_applicable", contextualResetTweetId: null };
      const response = new EventEmitter() as EventEmitter & { statusCode?: number };
      response.statusCode = responseStatus;
      callback(response);
      queueMicrotask(() => {
        response.emit("data", responseStatus === 200 ? JSON.stringify({
          candidates: [{ content: { parts: [{ text: JSON.stringify(responseResult) }] } }],
        }) : "{}");
        response.emit("end");
      });
    };
    return request;
  }) as typeof https.request;
  return {
    prompts,
    restore() { https.request = original; },
  };
}

type WebhookRow = Record<string, any>;

function installSourceContextDatabase(
  initialRows: WebhookRow[] = [],
  options: {
    failContextClassificationUpdateOnce?: boolean;
    failFormalAdoptionReadOnce?: boolean;
    addRevisionBeforeNextContextClassificationUpdate?: string;
  } = {},
) {
  const original = globalThis.fetch;
  const rows = new Map(initialRows.map((row) => [row.tweet_id, structuredClone(row)]));
  const appliedRevisions = new Map<string, Set<string>>();
  const upserts: WebhookRow[] = [];
  const urls: string[] = [];
  let contextMergeCalls = 0;
  let failContextClassificationUpdateOnce = options.failContextClassificationUpdateOnce === true;
  let failFormalAdoptionReadOnce = options.failFormalAdoptionReadOnce === true;
  let addRevisionBeforeNextContextClassificationUpdate = options.addRevisionBeforeNextContextClassificationUpdate;
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    const body = init?.body ? JSON.parse(String(init.body)) as WebhookRow : {};
    urls.push(url.toString());

    if (url.pathname.endsWith("/rpc/merge_tibo_source_context_enrichment")) {
      contextMergeCalls += 1;
      const root = rows.get(body.p_tweet_id);
      if (!root) {
        return new Response(JSON.stringify({ status: "root_missing" }), { status: 200 });
      }
      if (root.tweet_url !== body.p_tweet_url || root.tweet_created_at !== body.p_tweet_created_at
        || root.text.trim() !== body.p_text.trim()) {
        return new Response(JSON.stringify({ status: "root_mismatch" }), { status: 200 });
      }
      const revisions = appliedRevisions.get(body.p_tweet_id) ?? new Set<string>();
      if (revisions.has(body.p_revision_hash)) {
        return new Response(JSON.stringify({ status: "duplicate" }), { status: 200 });
      }
      const merged = { ...(root.source_context_snapshot ?? {}) };
      for (const [key, value] of Object.entries(body.p_snapshot as WebhookRow)) {
        if (merged[key] && JSON.stringify(merged[key]) !== JSON.stringify(value)) {
          return new Response(JSON.stringify({ status: "conflict" }), { status: 200 });
        }
        merged[key] = value;
      }
      root.source_context_snapshot = merged;
      revisions.add(body.p_revision_hash);
      appliedRevisions.set(body.p_tweet_id, revisions);
      root.source_context_revision_hashes = Array.from(revisions);
      root.source_context_classified_revision_hashes ??= [];
      return new Response(JSON.stringify({ status: "applied" }), { status: 200 });
    }

    if (url.pathname.endsWith("/rest/v1/tibo_signals") && method === "GET") {
      const filter = url.searchParams.get("tweet_id");
      const tweetId = filter?.startsWith("eq.") ? filter.slice(3) : null;
      const row = tweetId ? rows.get(tweetId) : null;
      return new Response(JSON.stringify(row ? [row] : []), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    if (url.pathname.endsWith("/rest/v1/tibo_formal_adoptions") && method === "GET"
      && failFormalAdoptionReadOnce) {
      failFormalAdoptionReadOnce = false;
      return new Response(JSON.stringify({ message: "injected formal adoption read failure" }), { status: 500 });
    }

    if (url.pathname.endsWith("/rest/v1/tibo_signals") && (method === "POST" || method === "PATCH")) {
      const payloads = Array.isArray(body) ? body : [body];
      let patchRoot: WebhookRow | undefined;
      if (method === "PATCH") {
        const tweetId = url.searchParams.get("tweet_id")?.replace(/^eq\./, "");
        const root = tweetId ? rows.get(tweetId) : null;
        patchRoot = root ?? undefined;
        if (failContextClassificationUpdateOnce
          && url.searchParams.get("source_context_revision_hashes") !== "eq.{}") {
          failContextClassificationUpdateOnce = false;
          return new Response(JSON.stringify({ message: "injected context classification save failure" }), { status: 500 });
        }
        if (root && addRevisionBeforeNextContextClassificationUpdate) {
          const revisions = root.source_context_revision_hashes ?? [];
          root.source_context_revision_hashes = [...revisions, addRevisionBeforeNextContextClassificationUpdate];
          addRevisionBeforeNextContextClassificationUpdate = undefined;
        }
        const revisionFilter = url.searchParams.get("source_context_revision_hashes") ?? "";
        const expected = revisionFilter.startsWith("eq.{") && revisionFilter.endsWith("}")
          ? revisionFilter.slice(4, -1).split(",").filter(Boolean)
          : [];
        if (!root || JSON.stringify(root.source_context_revision_hashes ?? []) !== JSON.stringify(expected)) {
          return new Response(JSON.stringify([]), { status: 200, headers: { "content-type": "application/json" } });
        }
      }
      for (const payload of payloads) {
        if (method !== "PATCH" || "signal_type" in payload) upserts.push(payload);
        if (method === "PATCH" && patchRoot) {
          Object.assign(patchRoot, payload);
        } else if (payload.tweet_id) {
          rows.set(payload.tweet_id, { ...(rows.get(payload.tweet_id) ?? {}), ...payload });
        }
      }
      return new Response(JSON.stringify(payloads), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    }

    return new Response(JSON.stringify([]), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  return {
    rows,
    upserts,
    urls,
    get contextMergeCalls() { return contextMergeCalls; },
    restore() { globalThis.fetch = original; },
  };
}

function contextTargetRow() {
  return {
    tweet_id: TARGET_ID,
    text: TARGET_TEXT,
    tweet_url: TARGET_URL,
    tweet_created_at: TARGET_CREATED_AT,
    verification_status: "auto_unverified",
    is_reply: true,
    reply_to_handles: ["@thsottiaux"],
    reply_context_text: PARENT_TEXT,
    source_timeline: "with_replies",
    source_context_snapshot: null,
    source_context_revision_hashes: [],
    source_context_classified_revision_hashes: [],
  };
}

function parentRow() {
  return {
    tweet_id: PARENT_ID,
    text: PARENT_TEXT,
    tweet_url: PARENT_URL,
    tweet_created_at: PARENT_CREATED_AT,
    verification_status: "confirmed",
    is_reply: false,
    is_quote: false,
  };
}

function enrichmentRequest() {
  return buildRequest({
    kind: "source_context_enrichment",
    ...sourceMetadata(),
  });
}

test("Gemini prompt includes bounded source evidence only when supplied", () => {
  const evidence = JSON.stringify({
    formatVersion: "tibo-classification-evidence-input-v1",
    contextStatus: "complete",
    target: { tweetId: "2110000000000000001" },
    relatedPosts: [{ tweetId: "2110000000000000002", text: "The reset is coming tomorrow." }],
    relations: [{ fromTweetId: "2110000000000000001", toTweetId: "2110000000000000002", relation: "reply" }],
    omissions: [],
    lookupCount: 1,
  });
  const prompt = buildGeminiPrompt({
    text: "Maybe",
    tiboEvidenceInput: evidence,
  } as never);

  assert.match(prompt, /VALIDATED CONNECTED SOURCE CONTEXT/);
  assert.match(prompt, /separately assess whether it semantically refers to the same reset event/i);
  assert.match(TIBO_GEMINI_SYSTEM_PROMPT, /contextualResetAssessment/);
  assert.match(prompt, /A graph edge alone does not establish same event, scope, or mechanism/i);
  assert.ok(prompt.includes(evidence));
  assert.doesNotMatch(buildGeminiPrompt({ text: "Maybe" }), /VALIDATED CONNECTED SOURCE CONTEXT/);
});

test("late context is reclassified once and a response-loss replay sees the durable marker", async () => {
  const previous = saveEnvironment();
  process.env.TIBO_WEBHOOK_SECRET = "test-webhook-secret";
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  process.env.GEMINI_CLASSIFICATION_MODE = "primary";
  process.env.GEMINI_API_KEY = "test-gemini-key";
  process.env.GEMINI_MODEL = "test-model";
  process.env.GEMINI_TRANSLATION_MODE = "off";
  process.env.RESET_DISPLAY_NAME_CANDIDATE_MODE = "off";
  const database = installSourceContextDatabase([parentRow()]);
  const gemini = installGeminiPromptCapture();

  try {
    const initialResponse = await POST(buildRequest(sourceMetadata()));
    assert.equal(initialResponse.status, 200);
    assert.equal(gemini.prompts.length, 1);
    assert.doesNotMatch(gemini.prompts[0]!, /VALIDATED CONNECTED SOURCE CONTEXT/);

    const enrichmentResponse = await POST(enrichmentRequest());
    assert.equal(enrichmentResponse.status, 200);
    assert.deepEqual(await enrichmentResponse.json(), { success: true, status: "applied" });
    assert.equal(gemini.prompts.length, 2);
    assert.match(gemini.prompts[1]!, /VALIDATED CONNECTED SOURCE CONTEXT/);
    assert.match(gemini.prompts[1]!, new RegExp(PARENT_ID));
    assert.match(gemini.prompts[1]!, new RegExp(PARENT_TEXT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(gemini.prompts[1]!, /"relation":"reply"/);

    const duplicateResponse = await POST(enrichmentRequest());
    assert.equal(duplicateResponse.status, 200);
    assert.deepEqual(await duplicateResponse.json(), { success: true, status: "duplicate" });
    assert.equal(gemini.prompts.length, 2);

    const targetUpserts = database.upserts.filter((row) => row.tweet_id === TARGET_ID);
    assert.equal(targetUpserts.length, 2);
    assert.deepEqual(new Set(targetUpserts.map((row) => row.tweet_id)), new Set([TARGET_ID]));
    assert.equal(database.rows.get(TARGET_ID)?.signal_type, "official_notice");
    assert.deepEqual(
      database.rows.get(TARGET_ID)?.source_context_classified_revision_hashes,
      database.rows.get(TARGET_ID)?.source_context_revision_hashes,
    );
    assert.equal(database.contextMergeCalls, 2);
  } finally {
    gemini.restore();
    database.restore();
    restoreEnvironment(previous);
  }
});

test("a formal-flow failure leaves the source-context revision pending for retry", async () => {
  const previous = saveEnvironment();
  const formalText = "I reset usage limits for all paid users.";
  process.env.TIBO_WEBHOOK_SECRET = "test-webhook-secret";
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  process.env.GEMINI_CLASSIFICATION_MODE = "primary";
  process.env.GEMINI_API_KEY = "test-gemini-key";
  process.env.GEMINI_MODEL = "test-model";
  process.env.GEMINI_TRANSLATION_MODE = "off";
  process.env.RESET_DISPLAY_NAME_CANDIDATE_MODE = "off";
  const target = {
    ...contextTargetRow(),
    text: formalText,
    signal_type: "reset_executed",
    confidence: 0.99,
    classification_reason: "The reset completed.",
    classification_source: "gemini",
  };
  const database = installSourceContextDatabase([parentRow(), target], {
    failFormalAdoptionReadOnce: true,
  });
  const gemini = installGeminiPromptCapture({
    signalType: "reset_executed",
    confidence: 0.99,
    temporalDirection: "completed_now",
    evidenceQuote: formalText,
    reasonJa: "利用上限をリセットしました。",
    teaserStrength: "none",
    teaserStrengthConfidence: 0.99,
    teaserStrengthEvidenceQuote: null,
  });
  const request = () => buildRequest({
    text: formalText,
    kind: "source_context_enrichment",
    ...sourceMetadata(),
  });

  try {
    const failedResponse = await POST(request());

    assert.equal(failedResponse.status, 503);
    assert.deepEqual(database.rows.get(TARGET_ID)?.source_context_classified_revision_hashes, []);

    await POST(request());
    assert.equal(gemini.prompts.length, 2);
  } finally {
    gemini.restore();
    database.restore();
    restoreEnvironment(previous);
  }
});

test("retryable Gemini failure leaves the revision pending and a duplicate replay completes it", async () => {
  const previous = saveEnvironment();
  process.env.TIBO_WEBHOOK_SECRET = "test-webhook-secret";
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  process.env.GEMINI_CLASSIFICATION_MODE = "primary";
  process.env.GEMINI_API_KEY = "test-gemini-key";
  process.env.GEMINI_MODEL = "test-model";
  process.env.GEMINI_TRANSLATION_MODE = "off";
  process.env.RESET_DISPLAY_NAME_CANDIDATE_MODE = "off";
  const database = installSourceContextDatabase([parentRow()]);
  const gemini = installGeminiPromptCapture(undefined, [200, 429, 429, 200]);

  try {
    assert.equal((await POST(buildRequest(sourceMetadata()))).status, 200);

    const failedResponse = await POST(enrichmentRequest());
    assert.equal(failedResponse.status, 503);
    assert.deepEqual(database.rows.get(TARGET_ID)?.source_context_classified_revision_hashes, []);
    assert.equal(database.rows.get(TARGET_ID)?.signal_type, "official_notice");

    const retryResponse = await POST(enrichmentRequest());
    assert.equal(retryResponse.status, 200);
    assert.deepEqual(await retryResponse.json(), { success: true, status: "duplicate" });
    assert.deepEqual(
      database.rows.get(TARGET_ID)?.source_context_classified_revision_hashes,
      database.rows.get(TARGET_ID)?.source_context_revision_hashes,
    );
    assert.equal(database.rows.get(TARGET_ID)?.signal_type, "official_notice");
    assert.equal(gemini.prompts.length, 4);
  } finally {
    gemini.restore();
    database.restore();
    restoreEnvironment(previous);
  }
});

test("rule fallback does not mark a source-context revision as classified", async () => {
  const previous = saveEnvironment();
  const tweetId = "2103911959544610829";
  const text = "I reset usage limits for all paid users.";
  const tweetUrl = `https://x.com/thsottiaux/status/${tweetId}`;
  const createdAt = "2026-10-18T08:00:00.000Z";
  process.env.TIBO_WEBHOOK_SECRET = "test-webhook-secret";
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  process.env.GEMINI_CLASSIFICATION_MODE = "primary";
  process.env.GEMINI_API_KEY = "test-gemini-key";
  process.env.GEMINI_MODEL = "test-model";
  process.env.GEMINI_TRANSLATION_MODE = "off";
  process.env.RESET_DISPLAY_NAME_CANDIDATE_MODE = "off";
  const database = installSourceContextDatabase([parentRow()]);
  const gemini = installGeminiPromptCapture({
    signalType: "official_notice",
    confidence: 0.99,
    temporalDirection: "completed_now",
    evidenceQuote: text,
    reasonJa: "完了済みのリセットについて述べています。",
    teaserStrength: "none",
    teaserStrengthConfidence: 0.99,
    teaserStrengthEvidenceQuote: null,
  });
  const targetRequest = () => buildRequest({
    tweetId,
    text,
    tweetUrl,
    tweetCreatedAt: createdAt,
    ...sourceMetadata(),
  });
  const contextRequest = () => buildRequest({
    tweetId,
    text,
    tweetUrl,
    tweetCreatedAt: createdAt,
    kind: "source_context_enrichment",
    ...sourceMetadata(),
  });

  try {
    assert.equal((await POST(targetRequest())).status, 200);
    const response = await POST(contextRequest());

    assert.equal(response.status, 503);
    assert.deepEqual(
      database.rows.get(tweetId)?.source_context_classified_revision_hashes,
      [],
    );
    assert.equal(database.upserts.filter((row) => row.tweet_id === tweetId).length, 1);
  } finally {
    gemini.restore();
    database.restore();
    restoreEnvironment(previous);
  }
});

test("a newer context revision arriving during Gemini keeps the old result from marking it complete", async () => {
  const previous = saveEnvironment();
  process.env.TIBO_WEBHOOK_SECRET = "test-webhook-secret";
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  process.env.GEMINI_CLASSIFICATION_MODE = "primary";
  process.env.GEMINI_API_KEY = "test-gemini-key";
  process.env.GEMINI_MODEL = "test-model";
  process.env.GEMINI_TRANSLATION_MODE = "off";
  process.env.RESET_DISPLAY_NAME_CANDIDATE_MODE = "off";
  const database = installSourceContextDatabase([parentRow()], {
    addRevisionBeforeNextContextClassificationUpdate: "b".repeat(64),
  });
  const gemini = installGeminiPromptCapture();

  try {
    assert.equal((await POST(buildRequest(sourceMetadata()))).status, 200);
    const response = await POST(enrichmentRequest());

    assert.equal(response.status, 503);
    assert.equal(database.rows.get(TARGET_ID)?.source_context_revision_hashes.length, 2);
    assert.deepEqual(database.rows.get(TARGET_ID)?.source_context_classified_revision_hashes, []);
    assert.equal(database.upserts.filter((row) => row.tweet_id === TARGET_ID).length, 1);
    assert.equal(gemini.prompts.length, 2);
  } finally {
    gemini.restore();
    database.restore();
    restoreEnvironment(previous);
  }
});

test("context-first delivery retries root_missing after the normal target webhook arrives", async () => {
  const previous = saveEnvironment();
  process.env.TIBO_WEBHOOK_SECRET = "test-webhook-secret";
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  process.env.GEMINI_CLASSIFICATION_MODE = "primary";
  process.env.GEMINI_API_KEY = "test-gemini-key";
  process.env.GEMINI_MODEL = "test-model";
  process.env.GEMINI_TRANSLATION_MODE = "off";
  process.env.RESET_DISPLAY_NAME_CANDIDATE_MODE = "off";
  const database = installSourceContextDatabase([parentRow()]);
  const gemini = installGeminiPromptCapture();

  try {
    const enrichmentResponse = await POST(enrichmentRequest());
    assert.equal(enrichmentResponse.status, 503);
    assert.equal(gemini.prompts.length, 0);

    const targetResponse = await POST(buildRequest(sourceMetadata()));
    assert.equal(targetResponse.status, 200);
    assert.equal(gemini.prompts.length, 1);
    assert.doesNotMatch(gemini.prompts[0]!, /VALIDATED CONNECTED SOURCE CONTEXT/);

    const retryResponse = await POST(enrichmentRequest());
    assert.equal(retryResponse.status, 200);
    assert.deepEqual(await retryResponse.json(), { success: true, status: "applied" });
    assert.equal(gemini.prompts.length, 2);
    assert.match(gemini.prompts[1]!, /VALIDATED CONNECTED SOURCE CONTEXT/);
    assert.match(gemini.prompts[1]!, new RegExp(PARENT_ID));
    assert.equal(database.rows.get(TARGET_ID)?.source_context_snapshot?.parent?.tweetId, PARENT_ID);
    assert.equal(database.rows.get(TARGET_ID)?.source_context_classified_revision_hashes?.length, 1);
    assert.equal(database.upserts.filter((row) => row.tweet_id === TARGET_ID).length, 2);

    const duplicateResponse = await POST(enrichmentRequest());
    assert.equal(duplicateResponse.status, 200);
    assert.deepEqual(await duplicateResponse.json(), { success: true, status: "duplicate" });
    assert.equal(gemini.prompts.length, 2);
    assert.equal(database.upserts.filter((row) => row.tweet_id === TARGET_ID).length, 2);
  } finally {
    gemini.restore();
    database.restore();
    restoreEnvironment(previous);
  }
});

test("source-context reclassification keeps BANKED completion and reviewed manual state out of forced-reset history", async () => {
  const previous = saveEnvironment();
  const bankedId = "2115000000000000011";
  const bankedText = "BANKED reset credits have now been distributed to all paid users.";
  const bankedParentText = "We are loading a banked reset into eligible accounts.";
  const bankedUrl = `https://x.com/thsottiaux/status/${bankedId}`;
  const bankedCreatedAt = "2026-10-18T08:00:00.000Z";
  const metadata = {
    isReply: true,
    replyToHandles: ["@thsottiaux"],
    replyParentTweetId: PARENT_ID,
    replyParentTweetUrl: PARENT_URL,
    replyContextText: bankedParentText,
    sourceTimeline: "with_replies" as const,
  };
  const existingBankedRow = {
    tweet_id: bankedId,
    text: bankedText,
    tweet_url: bankedUrl,
    tweet_created_at: bankedCreatedAt,
    verification_status: "confirmed",
    signal_type: "irrelevant",
    confidence: 1,
    classification_reason: "Manual review: BANKED delivery completion is not a forced reset.",
    classification_source: "manual",
    is_reply: true,
    reply_to_handles: ["@thsottiaux"],
    reply_context_text: bankedParentText,
    source_timeline: "with_replies",
    source_context_snapshot: null,
  };
  process.env.TIBO_WEBHOOK_SECRET = "test-webhook-secret";
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  process.env.GEMINI_CLASSIFICATION_MODE = "primary";
  process.env.GEMINI_API_KEY = "test-gemini-key";
  process.env.GEMINI_MODEL = "test-model";
  process.env.GEMINI_TRANSLATION_MODE = "off";
  process.env.RESET_DISPLAY_NAME_CANDIDATE_MODE = "off";
  const database = installSourceContextDatabase([parentRow(), existingBankedRow], {
    failContextClassificationUpdateOnce: true,
  });
  const gemini = installGeminiPromptCapture({
    signalType: "reset_executed",
    confidence: 0.99,
    temporalDirection: "completed_now",
    evidenceQuote: bankedText,
    reasonJa: "BANKEDリセット権の配布完了です。",
    teaserStrength: "none",
    teaserStrengthConfidence: 0.99,
    teaserStrengthEvidenceQuote: null,
  });

  try {
    const initialResponse = await POST(buildRequest({
      tweetId: bankedId,
      text: bankedText,
      tweetUrl: bankedUrl,
      tweetCreatedAt: bankedCreatedAt,
      ...metadata,
    }));
    assert.equal(initialResponse.status, 200);

    const enrichmentResponse = await POST(buildRequest({
      tweetId: bankedId,
      text: bankedText,
      tweetUrl: bankedUrl,
      tweetCreatedAt: bankedCreatedAt,
      kind: "source_context_enrichment",
      ...metadata,
    }));
    assert.equal(enrichmentResponse.status, 503);
    assert.deepEqual(database.rows.get(bankedId)?.source_context_classified_revision_hashes ?? [], []);

    const retryResponse = await POST(buildRequest({
      tweetId: bankedId,
      text: bankedText,
      tweetUrl: bankedUrl,
      tweetCreatedAt: bankedCreatedAt,
      kind: "source_context_enrichment",
      ...metadata,
    }));
    assert.equal(retryResponse.status, 200);
    assert.deepEqual(await retryResponse.json(), { success: true, status: "duplicate" });
    assert.equal(gemini.prompts.length, 3);
    assert.match(gemini.prompts[2]!, /VALIDATED CONNECTED SOURCE CONTEXT/);

    const finalRow = database.rows.get(bankedId)!;
    assert.equal(finalRow.signal_type, "irrelevant");
    assert.equal(finalRow.classification_source, "manual");
    assert.equal(finalRow.ai_signal_type, "reset_executed");
    assert.equal(database.urls.some((url) => url.includes("/rpc/claim_tibo_formal_adoption")), false);
    assert.equal(database.urls.some((url) => url.includes("reset_execution_estimates")), false);
    assert.equal(database.upserts.filter((row) => row.tweet_id === bankedId).length, 2);
  } finally {
    gemini.restore();
    database.restore();
    restoreEnvironment(previous);
  }
});

test("an exact Landing notice is saved when a validated one-hop or two-hop Tibo path supplies reset context", async () => {
  const previous = saveEnvironment();
  process.env.TIBO_WEBHOOK_SECRET = "test-webhook-secret";
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  process.env.GEMINI_CLASSIFICATION_MODE = "primary";
  process.env.GEMINI_API_KEY = "test-gemini-key";
  process.env.GEMINI_MODEL = "test-model";
  process.env.GEMINI_TRANSLATION_MODE = "off";
  process.env.RESET_DISPLAY_NAME_CANDIDATE_MODE = "off";
  const tweetId = "2115000000000000121";
  const tweetUrl = `https://x.com/thsottiaux/status/${tweetId}`;
  const text = "Landing within the next 2 hours.";
  const createdAt = "2026-10-18T08:00:00.000Z";
  const intermediateText = "A rollout is on the way tomorrow.";
  const grandparentId = "2115000000000000123";
  const grandparentText = "Reset usage limits for all users tomorrow.";
  const noticeResult = {
    signalType: "official_notice",
    confidence: 0.94,
    temporalDirection: "future",
    evidenceQuote: text,
    reasonJa: "検証済みの返信経路につながる利用上限リセットの告知です。",
    resetTypeJa: null,
    teaserStrength: "none",
    teaserStrengthConfidence: 0.9,
    teaserStrengthEvidenceQuote: null,
    teaserStrengthReasonJa: null,
    contextualResetAssessment: "same_global_reset",
  };
  const targetRow = {
    tweet_id: tweetId,
    text,
    tweet_url: tweetUrl,
    tweet_created_at: createdAt,
    verification_status: "auto_unverified",
    is_reply: true,
    reply_context_text: PARENT_TEXT,
    source_context_snapshot: null,
    source_context_revision_hashes: [],
    source_context_classified_revision_hashes: [],
  };
  const rootReply = (replyText: string) => ({
    isReply: true,
    replyToHandles: ["@thsottiaux"],
    replyParentTweetId: PARENT_ID,
    replyParentTweetUrl: PARENT_URL,
    replyContextText: replyText,
    sourceTimeline: "with_replies" as const,
  });
  const buildLandingRequest = (replyText: string, kind?: string) => buildRequest({
    tweetId,
    text,
    tweetUrl,
    tweetCreatedAt: createdAt,
    ...(kind ? { kind } : {}),
    ...rootReply(replyText),
  });

  try {
    for (const pathLength of [1, 2] as const) {
      const parentText = pathLength === 1 ? PARENT_TEXT : intermediateText;
      const rows: WebhookRow[] = [
        targetRow,
        {
          ...parentRow(),
          text: parentText,
          ...(pathLength === 2 ? {
            is_reply: true,
            reply_context_text: grandparentText,
            source_context_snapshot: {
              parent: {
                tweetId: grandparentId,
                tweetUrl: `https://x.com/thsottiaux/status/${grandparentId}`,
                authorHandle: "@thsottiaux",
                text: grandparentText,
              },
            },
          } : {}),
        },
        ...(pathLength === 2 ? [{
          tweet_id: grandparentId,
          text: grandparentText,
          tweet_url: `https://x.com/thsottiaux/status/${grandparentId}`,
          tweet_created_at: PARENT_CREATED_AT,
          verification_status: "confirmed",
          is_reply: false,
          is_quote: false,
        }] : []),
      ];
      const database = installSourceContextDatabase(rows);
      const scenarioNoticeResult = {
        ...noticeResult,
        contextualResetTweetId: pathLength === 1 ? PARENT_ID : grandparentId,
      };
      const gemini = installGeminiPromptCapture([scenarioNoticeResult, scenarioNoticeResult]);
      try {
        const requestMetadata = rootReply(parentText);
        const initialResponse = await POST(buildRequest({
          tweetId,
          text,
          tweetUrl,
          tweetCreatedAt: createdAt,
          ...requestMetadata,
        }));
        assert.equal(initialResponse.status, 200);

        const enrichmentResponse = await POST(buildLandingRequest(parentText, "source_context_enrichment"));

        assert.equal(enrichmentResponse.status, 200, `${pathLength}-hop source context should classify`);
        assert.equal(database.rows.get(tweetId)?.signal_type, "official_notice");
        assert.equal(database.rows.get(tweetId)?.ai_signal_type, "official_notice");
        assert.deepEqual(
          database.rows.get(tweetId)?.source_context_classified_revision_hashes,
          database.rows.get(tweetId)?.source_context_revision_hashes,
        );
        assert.match(gemini.prompts[1]!, /VALIDATED CONNECTED SOURCE CONTEXT/);
        assert.match(gemini.prompts[1]!, new RegExp(pathLength === 1 ? PARENT_ID : grandparentId));
        assert.equal((gemini.prompts[1]!.match(/"relation":"reply"/g) ?? []).length, pathLength);
      } finally {
        gemini.restore();
        database.restore();
      }
    }
  } finally {
    restoreEnvironment(previous);
  }
});

test("AI same-event judgments classify the real reset-button root and elliptical completions through validated paths", async () => {
  const previous = saveEnvironment();
  process.env.TIBO_WEBHOOK_SECRET = "test-webhook-secret";
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  process.env.GEMINI_CLASSIFICATION_MODE = "primary";
  process.env.GEMINI_API_KEY = "test-gemini-key";
  process.env.GEMINI_MODEL = "test-model";
  process.env.GEMINI_TRANSLATION_MODE = "off";
  process.env.RESET_DISPLAY_NAME_CANDIDATE_MODE = "off";

  const rootId = "2115000000000000131";
  const rootText = "The reports of my reset button being lost are greatly exaggerated\n\nDay 10/ Reset";
  const rootUrl = `https://x.com/thsottiaux/status/${rootId}`;
  const scenarios = [
    {
      name: "the real-root Landing notice",
      targetId: "2115000000000000132",
      targetText: "Landing within the next 2 hours.",
      signalType: "official_notice",
      temporalDirection: "future",
      pathLength: 1,
    },
    {
      name: "one-hop Done and dusted completion",
      targetId: "2115000000000000133",
      targetText: "Done and dusted.",
      signalType: "reset_executed",
      temporalDirection: "completed_now",
      pathLength: 1,
    },
    {
      name: "two-hop All taken care of completion",
      targetId: "2115000000000000134",
      targetText: "All taken care of.",
      signalType: "reset_executed",
      temporalDirection: "completed_now",
      pathLength: 2,
    },
  ] as const;

  try {
    for (const scenario of scenarios) {
      const intermediateId = "2115000000000000135";
      const intermediateText = "A difficult day, but we are still here.";
      const parentId = scenario.pathLength === 1 ? rootId : intermediateId;
      const parentText = scenario.pathLength === 1 ? rootText : intermediateText;
      const parentUrl = `https://x.com/thsottiaux/status/${parentId}`;
      const targetUrl = `https://x.com/thsottiaux/status/${scenario.targetId}`;
      const createdAt = TARGET_CREATED_AT;
      const sourceMetadata = {
        isReply: true,
        replyToHandles: ["@thsottiaux"],
        replyParentTweetId: parentId,
        replyParentTweetUrl: parentUrl,
        replyContextText: parentText,
        sourceTimeline: "with_replies" as const,
      };
      const targetRow = {
        tweet_id: scenario.targetId,
        text: scenario.targetText,
        tweet_url: targetUrl,
        tweet_created_at: createdAt,
        verification_status: "auto_unverified",
        is_reply: true,
        reply_to_handles: ["@thsottiaux"],
        reply_context_text: parentText,
        source_timeline: "with_replies",
        source_context_snapshot: null,
        source_context_revision_hashes: [],
        source_context_classified_revision_hashes: [],
      };
      const rootRow = {
        tweet_id: rootId,
        text: rootText,
        tweet_url: rootUrl,
        tweet_created_at: PARENT_CREATED_AT,
        verification_status: "confirmed",
        is_reply: false,
        is_quote: false,
      };
      const parentRowForScenario = scenario.pathLength === 1
        ? rootRow
        : {
            tweet_id: intermediateId,
            text: intermediateText,
            tweet_url: parentUrl,
            tweet_created_at: PARENT_CREATED_AT,
            verification_status: "confirmed",
            is_reply: true,
            reply_context_text: rootText,
            source_context_snapshot: {
              parent: {
                tweetId: rootId,
                tweetUrl: rootUrl,
                authorHandle: "@thsottiaux",
                text: rootText,
              },
            },
          };
      const scenarioResult = {
        signalType: scenario.signalType,
        confidence: 0.96,
        temporalDirection: scenario.temporalDirection,
        evidenceQuote: scenario.targetText,
        reasonJa: "著者本文の発話が、検証済みの同一resetイベントを指しています。",
        resetTypeJa: null,
        teaserStrength: "none",
        teaserStrengthConfidence: 0.95,
        teaserStrengthEvidenceQuote: null,
        teaserStrengthReasonJa: null,
        contextualResetAssessment: "same_global_reset",
        contextualResetTweetId: rootId,
      };
      const database = installSourceContextDatabase([
        targetRow,
        parentRowForScenario,
        ...(scenario.pathLength === 2 ? [rootRow] : []),
      ]);
      const gemini = installGeminiPromptCapture([scenarioResult, scenarioResult]);

      try {
        const initialResponse = await POST(buildRequest({
          tweetId: scenario.targetId,
          text: scenario.targetText,
          tweetUrl: targetUrl,
          tweetCreatedAt: createdAt,
          ...sourceMetadata,
        }));
        assert.equal(initialResponse.status, 200, `${scenario.name} initial delivery`);
        assert.equal(database.rows.get(scenario.targetId)?.signal_type, "irrelevant");

        const enrichmentResponse = await POST(buildRequest({
          tweetId: scenario.targetId,
          text: scenario.targetText,
          tweetUrl: targetUrl,
          tweetCreatedAt: createdAt,
          kind: "source_context_enrichment",
          ...sourceMetadata,
        }));

        assert.equal(enrichmentResponse.status, 200, `${scenario.name} enrichment`);
        const finalRow = database.rows.get(scenario.targetId)!;
        assert.equal(finalRow.signal_type, scenario.signalType, scenario.name);
        assert.equal(finalRow.ai_signal_type, scenario.signalType, `${scenario.name} preserves AI audit`);
        assert.deepEqual(
          finalRow.source_context_classified_revision_hashes,
          finalRow.source_context_revision_hashes,
          `${scenario.name} records the classified revision`,
        );
        assert.match(gemini.prompts[1]!, new RegExp(rootId));
        assert.equal(database.urls.some((url) => url.includes("/rpc/claim_tibo_formal_adoption")), false);
        assert.equal(database.urls.some((url) => url.includes("reset_execution_estimates")), false);
      } finally {
        gemini.restore();
        database.restore();
      }
    }
  } finally {
    restoreEnvironment(previous);
  }
});

test("provider semantic contrasts stay irrelevant when source identity or event meaning is unsafe or unknown", async () => {
  const previous = saveEnvironment();
  process.env.TIBO_WEBHOOK_SECRET = "test-webhook-secret";
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  process.env.GEMINI_CLASSIFICATION_MODE = "primary";
  process.env.GEMINI_API_KEY = "test-gemini-key";
  process.env.GEMINI_MODEL = "test-model";
  process.env.GEMINI_TRANSLATION_MODE = "off";
  process.env.RESET_DISPLAY_NAME_CANDIDATE_MODE = "off";

  const parentText = "Reset usage limits for all users tomorrow.";
  const cases: Array<{
    name: string;
    targetId: string;
    assessment?: string;
    sourceAuthor?: string;
    sourceText?: string;
    targetText?: string;
    preserveMissingFacet?: boolean;
    missingParent?: boolean;
  }> = [
    { name: "foreign source author", targetId: "2115000000000000141", assessment: "same_global_reset", sourceAuthor: "@external_user" },
    { name: "different event", targetId: "2115000000000000142", assessment: "different_event", sourceText: "The product rollout is on the way tomorrow." },
    { name: "BANKED distribution", targetId: "2115000000000000143", assessment: "same_banked_distribution", sourceText: "BANKED reset credits are being distributed to affected users." },
    { name: "personal reset", targetId: "2115000000000000144", assessment: "same_personal_reset", sourceText: "I will reset usage limits for my account tomorrow." },
    { name: "negated target speech act", targetId: "2115000000000000145", assessment: "negated", targetText: "The reset is not landing within the next 2 hours." },
    { name: "missing semantic assessment", targetId: "2115000000000000146", assessment: undefined, preserveMissingFacet: true },
    { name: "missing source graph", targetId: "2115000000000000147", assessment: "same_global_reset", missingParent: true },
  ];

  try {
    for (const scenario of cases) {
      const targetText = scenario.targetText ?? "Landing within the next 2 hours.";
      const sourceAuthor = scenario.sourceAuthor ?? "@thsottiaux";
      const sourceText = scenario.sourceText ?? parentText;
      const parentUrl = `https://x.com/${sourceAuthor.slice(1)}/status/${PARENT_ID}`;
      const targetUrl = `https://x.com/thsottiaux/status/${scenario.targetId}`;
      const responseResult: Record<string, unknown> = {
        signalType: "official_notice",
        confidence: 0.96,
        temporalDirection: "future",
        evidenceQuote: targetText,
        reasonJa: "対象本文と接続先を意味的に評価しました。",
        resetTypeJa: null,
        teaserStrength: "none",
        contextualResetTweetId: PARENT_ID,
      };
      if (scenario.assessment !== undefined) responseResult.contextualResetAssessment = scenario.assessment;

      const targetRow = {
        tweet_id: scenario.targetId,
        text: targetText,
        tweet_url: targetUrl,
        tweet_created_at: TARGET_CREATED_AT,
        verification_status: "auto_unverified",
        is_reply: true,
        reply_to_handles: [sourceAuthor],
        reply_context_text: sourceText,
        source_timeline: "with_replies",
        source_context_snapshot: null,
        source_context_revision_hashes: [],
        source_context_classified_revision_hashes: [],
      };
      const parentRow = {
        tweet_id: PARENT_ID,
        text: sourceText,
        tweet_url: parentUrl,
        tweet_created_at: PARENT_CREATED_AT,
        verification_status: "confirmed",
        is_reply: false,
        is_quote: false,
      };
      const database = installSourceContextDatabase(scenario.missingParent ? [targetRow] : [targetRow, parentRow]);
      const gemini = installGeminiPromptCapture(
        [responseResult, responseResult],
        [],
        { preserveMissingContextualResetAssessment: scenario.preserveMissingFacet === true },
      );

      try {
        const metadata = {
          isReply: true,
          replyToHandles: [sourceAuthor],
          replyParentTweetId: PARENT_ID,
          replyParentTweetUrl: parentUrl,
          replyContextText: sourceText,
          sourceTimeline: "with_replies" as const,
        };
        const initialResponse = await POST(buildRequest({
          tweetId: scenario.targetId,
          text: targetText,
          tweetUrl: targetUrl,
          tweetCreatedAt: TARGET_CREATED_AT,
          ...metadata,
        }));
        assert.equal(initialResponse.status, 200, `${scenario.name} initial delivery`);

        if (!scenario.missingParent) {
          const enrichmentResponse = await POST(buildRequest({
            tweetId: scenario.targetId,
            text: targetText,
            tweetUrl: targetUrl,
            tweetCreatedAt: TARGET_CREATED_AT,
            kind: "source_context_enrichment",
            ...metadata,
          }));
          assert.equal(enrichmentResponse.status, 200, `${scenario.name} enrichment`);
        }

        assert.equal(database.rows.get(scenario.targetId)?.signal_type, "irrelevant", scenario.name);
      } finally {
        gemini.restore();
        database.restore();
      }
    }
  } finally {
    restoreEnvironment(previous);
  }
});

test("missing and temporarily unreadable source parents stay retryable until the exact parent row is available", async () => {
  const previous = saveEnvironment();
  process.env.TIBO_WEBHOOK_SECRET = "test-webhook-secret";
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  process.env.GEMINI_CLASSIFICATION_MODE = "primary";
  process.env.GEMINI_API_KEY = "test-gemini-key";
  process.env.GEMINI_MODEL = "test-model";
  process.env.GEMINI_TRANSLATION_MODE = "off";
  process.env.RESET_DISPLAY_NAME_CANDIDATE_MODE = "off";

  try {
    for (const failureMode of ["not_found", "lookup_failed"] as const) {
      const database = installSourceContextDatabase(failureMode === "not_found" ? [] : [parentRow()]);
      const gemini = installGeminiPromptCapture();
      const originalFetch = globalThis.fetch;
      let failParentLookup = failureMode === "lookup_failed";
      if (failureMode === "lookup_failed") {
        globalThis.fetch = async (input, init) => {
          const url = new URL(input instanceof Request ? input.url : String(input));
          if (failParentLookup && url.pathname.endsWith("/rest/v1/tibo_signals")
            && url.searchParams.get("tweet_id") === `eq.${PARENT_ID}`) {
            return new Response(JSON.stringify({ message: "temporary parent read failure" }), { status: 500 });
          }
          return originalFetch(input, init);
        };
      }
      try {
        assert.equal((await POST(buildRequest(sourceMetadata()))).status, 200);
        const failedResponse = await POST(enrichmentRequest());

        assert.equal(failedResponse.status, 503, `${failureMode} must remain retryable`);
        assert.deepEqual(database.rows.get(TARGET_ID)?.source_context_classified_revision_hashes, []);
        assert.equal(gemini.prompts.length, 1, `${failureMode} must be detected before the provider call`);

        if (failureMode === "not_found") {
          database.rows.set(PARENT_ID, parentRow());
        } else {
          failParentLookup = false;
        }
        const retryResponse = await POST(enrichmentRequest());

        assert.equal(retryResponse.status, 200);
        assert.deepEqual(
          database.rows.get(TARGET_ID)?.source_context_classified_revision_hashes,
          database.rows.get(TARGET_ID)?.source_context_revision_hashes,
        );
        assert.equal(database.rows.get(TARGET_ID)?.signal_type, "official_notice");
        assert.equal(gemini.prompts.length, 2);
        assert.match(gemini.prompts[1]!, /VALIDATED CONNECTED SOURCE CONTEXT/);
      } finally {
        globalThis.fetch = originalFetch;
        gemini.restore();
        database.restore();
      }
    }
  } finally {
    restoreEnvironment(previous);
  }
});

test("a permanent rejected-parent omission completes terminally and does not retry classification", async () => {
  const previous = saveEnvironment();
  process.env.TIBO_WEBHOOK_SECRET = "test-webhook-secret";
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  process.env.GEMINI_CLASSIFICATION_MODE = "primary";
  process.env.GEMINI_API_KEY = "test-gemini-key";
  process.env.GEMINI_MODEL = "test-model";
  process.env.GEMINI_TRANSLATION_MODE = "off";
  process.env.RESET_DISPLAY_NAME_CANDIDATE_MODE = "off";
  const database = installSourceContextDatabase([{ ...parentRow(), verification_status: "rejected" }]);
  const gemini = installGeminiPromptCapture();

  try {
    assert.equal((await POST(buildRequest(sourceMetadata()))).status, 200);
    const firstEnrichmentResponse = await POST(enrichmentRequest());
    assert.equal(firstEnrichmentResponse.status, 200);
    assert.deepEqual(
      database.rows.get(TARGET_ID)?.source_context_classified_revision_hashes,
      database.rows.get(TARGET_ID)?.source_context_revision_hashes,
    );

    const duplicateResponse = await POST(enrichmentRequest());
    assert.equal(duplicateResponse.status, 200);
    assert.deepEqual(await duplicateResponse.json(), { success: true, status: "duplicate" });
    assert.equal(gemini.prompts.length, 2);
  } finally {
    gemini.restore();
    database.restore();
    restoreEnvironment(previous);
  }
});

test("a delayed normal webhook cannot overwrite a newer source-context classification", async () => {
  const previous = saveEnvironment();
  process.env.TIBO_WEBHOOK_SECRET = "test-webhook-secret";
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  process.env.GEMINI_CLASSIFICATION_MODE = "primary";
  process.env.GEMINI_API_KEY = "test-gemini-key";
  process.env.GEMINI_MODEL = "test-model";
  process.env.GEMINI_TRANSLATION_MODE = "off";
  process.env.RESET_DISPLAY_NAME_CANDIDATE_MODE = "off";
  const database = installSourceContextDatabase([parentRow(), contextTargetRow()]);
  const validNotice = {
    signalType: "official_notice",
    confidence: 0.94,
    temporalDirection: "future",
    evidenceQuote: TARGET_TEXT,
    reasonJa: "test notice",
    teaserStrength: "none",
  };
  const gemini = installGeminiPromptCapture([validNotice, { ...validNotice, signalType: "irrelevant" }]);
  const originalRequest = https.request;
  let requestCount = 0;
  let releaseFirstRequest: (() => void) | undefined;
  let firstRequestStartedResolve: () => void = () => {};
  const firstRequestStarted = new Promise<void>((resolve) => {
    firstRequestStartedResolve = resolve;
  });
  https.request = ((...args: any[]) => {
    const request = (originalRequest as any)(...args);
    const originalEnd = request.end.bind(request);
    if (++requestCount === 1) {
      request.end = () => {
        releaseFirstRequest = originalEnd;
        firstRequestStartedResolve();
      };
    }
    return request;
  }) as typeof https.request;

  try {
    const delayedNormalResponsePromise = POST(buildRequest(sourceMetadata()));
    await firstRequestStarted;
    const enrichmentResponse = await POST(enrichmentRequest());
    assert.equal(enrichmentResponse.status, 200);
    assert.equal(database.rows.get(TARGET_ID)?.signal_type, "official_notice");

    releaseFirstRequest!();
    const delayedNormalResponse = await delayedNormalResponsePromise;

    assert.equal(delayedNormalResponse.status, 503, "stale classification must lose the revision compare-and-swap");
    assert.equal(database.rows.get(TARGET_ID)?.signal_type, "official_notice");
    assert.deepEqual(
      database.rows.get(TARGET_ID)?.source_context_classified_revision_hashes,
      database.rows.get(TARGET_ID)?.source_context_revision_hashes,
    );
  } finally {
    https.request = originalRequest;
    gemini.restore();
    database.restore();
    restoreEnvironment(previous);
  }
});
