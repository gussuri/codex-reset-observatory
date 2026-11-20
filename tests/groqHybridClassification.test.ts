import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import https from "node:https";
import test from "node:test";
import {
  classifyWithGemini,
  shouldEscalateTiboClassification,
  TIBO_OPENAI_COMPAT_SYSTEM_PROMPT,
} from "../lib/radar/geminiClassification";

function makeJsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function mockHttpsRequest(handler: (url: string) => { statusCode: number; body: string }) {
  const original = https.request;
  const calledUrls: string[] = [];

  (https as unknown as { request: typeof https.request }).request = ((
    url: string | URL,
    _options: unknown,
    callback?: (res: EventEmitter & { statusCode?: number }) => void,
  ) => {
    const resolvedUrl = typeof url === "string" ? url : url.toString();
    calledUrls.push(resolvedUrl);
    const req = new EventEmitter() as EventEmitter & {
      write: () => void;
      end: () => void;
      destroy: () => void;
    };
    req.write = () => {};
    req.destroy = () => {};
    req.end = () => {
      const { statusCode, body } = handler(resolvedUrl);
      const res = new EventEmitter() as EventEmitter & { statusCode?: number };
      res.statusCode = statusCode;
      callback?.(res);
      queueMicrotask(() => {
        res.emit("data", body);
        res.emit("end");
      });
    };
    return req as unknown as ReturnType<typeof https.request>;
  }) as unknown as typeof https.request;

  return {
    calledUrls,
    restore() {
      (https as unknown as { request: typeof https.request }).request = original;
    },
  };
}

test("TIBO_OPENAI_COMPAT_SYSTEM_PROMPT stays compact enough for Groq ITPM limits and preserves core rules", () => {
  assert.ok(
    TIBO_OPENAI_COMPAT_SYSTEM_PROMPT.length < 12_000,
    `Expected compact prompt under 12,000 chars, got ${TIBO_OPENAI_COMPAT_SYSTEM_PROMPT.length}`,
  );
  assert.match(TIBO_OPENAI_COMPAT_SYSTEM_PROMPT, /"reset_executed"/);
  assert.match(TIBO_OPENAI_COMPAT_SYSTEM_PROMPT, /"official_notice"/);
  assert.match(TIBO_OPENAI_COMPAT_SYSTEM_PROMPT, /"teaser"/);
  assert.match(TIBO_OPENAI_COMPAT_SYSTEM_PROMPT, /"irrelevant"/);
  assert.match(TIBO_OPENAI_COMPAT_SYSTEM_PROMPT, /BANKED/i);
  assert.match(TIBO_OPENAI_COMPAT_SYSTEM_PROMPT, /historical/i);
  assert.match(TIBO_OPENAI_COMPAT_SYSTEM_PROMPT, /exact contiguous substrings of AUTHOR TEXT/i);
});

test("shouldEscalateTiboClassification matches reset keywords and second-opinion context", () => {
  const prevDisable = process.env.GEMINI_DISABLE_KEYWORD_MODEL_ESCALATION;
  delete process.env.GEMINI_DISABLE_KEYWORD_MODEL_ESCALATION;
  try {
    assert.equal(shouldEscalateTiboClassification({ text: "Day 13/ Le limit reset" }), true);
    assert.equal(shouldEscalateTiboClassification({ text: "The banked reset has been activated." }), true);
    assert.equal(
      shouldEscalateTiboClassification({ text: "Big update!", secondOpinionMonitorContext: "Usage Monitor observed a grant" }),
      true,
    );
    assert.equal(shouldEscalateTiboClassification({ text: "Had a great coffee today." }), false);

    process.env.GEMINI_DISABLE_KEYWORD_MODEL_ESCALATION = "true";
    assert.equal(shouldEscalateTiboClassification({ text: "Day 13/ Le limit reset" }), false);
  } finally {
    if (prevDisable === undefined) delete process.env.GEMINI_DISABLE_KEYWORD_MODEL_ESCALATION;
    else process.env.GEMINI_DISABLE_KEYWORD_MODEL_ESCALATION = prevDisable;
  }
});

test("escalateToOpenAiCompat routes reset-keyword posts directly to Groq gpt-oss-120b with compact prompt and low reasoning effort", async () => {
  const prevModel = process.env.GEMINI_MODEL;
  process.env.GEMINI_MODEL = "gemini-3.5-flash-lite";
  const httpsMock = mockHttpsRequest(() => {
    throw new Error("Gemini HTTPS should not be called when Groq succeeds");
  });
  const capturedBodies: Array<Record<string, unknown>> = [];
  const capturedUrls: string[] = [];

  try {
    const result = await classifyWithGemini(
      { text: "Day 13/ Le limit reset", tweetCreatedAt: "2026-10-15T17:00:00Z" },
      {
        mode: "primary",
        apiKey: "dummy-gemini-key",
        escalateToOpenAiCompat: true,
        openAiFallbackApiKey: "dummy-groq-key",
        openAiFallbackBaseUrl: "https://api.groq.com/openai/v1",
        openAiFallbackModel: "openai/gpt-oss-120b",
        openAiFetch: async (url, init) => {
          capturedUrls.push(String(url));
          capturedBodies.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
          return makeJsonResponse(200, {
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    signalType: "official_notice",
                    confidence: 0.92,
                    temporalDirection: "unclear",
                    evidenceQuote: "Le limit reset",
                    contextualResetAssessment: "not_applicable",
                    contextualResetTweetId: null,
                    noticeTimingStatus: "unknown",
                    resetMeaning: null,
                    reasonJa: "Codex利用枠リセットの公式告知見出し。",
                    resetTypeJa: null,
                    noticeToExecution: null,
                    teaserStrength: "none",
                    teaserStrengthConfidence: 0.9,
                    teaserStrengthEvidenceQuote: null,
                    teaserStrengthReasonJa: null,
                    futureSignal: null,
                    temporalExpression: null,
                    temporalKind: "none",
                    temporalPrecision: "unknown",
                    weekday: null,
                    relativeDayOffset: null,
                    relativeAmount: null,
                    relativeUnit: null,
                    explicitDateParts: null,
                    explicitTimeParts: null,
                    daypart: null,
                    rangeKind: null,
                    explicitTimezone: null,
                    temporalConfidence: 0.1,
                    codexOperationalStatus: "none",
                    codexOperationalConfidence: 0.9,
                    codexOperationalEvidenceQuote: null,
                    codexOperationalReasonJa: null,
                  }),
                },
              },
            ],
          });
        },
      },
    );

    assert.equal(result.status, "success");
    assert.equal(result.model, "openai/gpt-oss-120b");
    assert.equal(result.signalType, "official_notice");
    assert.equal(result.temporalDirection, "unclear");
    assert.equal(httpsMock.calledUrls.length, 0);
    assert.deepEqual(capturedUrls, ["https://api.groq.com/openai/v1/chat/completions"]);
    assert.equal(capturedBodies[0]?.reasoning_effort, "low");
    const messages = capturedBodies[0]?.messages as Array<{ role: string; content: string }>;
    assert.equal(messages[0]?.content, TIBO_OPENAI_COMPAT_SYSTEM_PROMPT);
  } finally {
    httpsMock.restore();
    if (prevModel === undefined) delete process.env.GEMINI_MODEL;
    else process.env.GEMINI_MODEL = prevModel;
  }
});

test("escalateToOpenAiCompat falls back to stable baseModel (flash-lite) when Groq returns 429 and does not retry Groq twice", async () => {
  const prevModel = process.env.GEMINI_MODEL;
  process.env.GEMINI_MODEL = "gemini-3.5-flash-lite";
  let groqCalls = 0;
  const httpsMock = mockHttpsRequest(() => ({
    statusCode: 200,
    body: JSON.stringify({
      candidates: [
        {
          content: {
            parts: [
              {
                text: JSON.stringify({
                  signalType: "official_notice",
                  confidence: 0.95,
                  temporalDirection: "future",
                  evidenceQuote: "The banked reset has been activated",
                  contextualResetAssessment: "not_applicable",
                  contextualResetTweetId: null,
                  noticeTimingStatus: "unknown",
                  resetMeaning: null,
                  reasonJa: "BANKEDリセットの有効化告知。",
                  resetTypeJa: null,
                  noticeToExecution: null,
                  teaserStrength: "none",
                  teaserStrengthConfidence: 0.9,
                  teaserStrengthEvidenceQuote: null,
                  teaserStrengthReasonJa: null,
                  futureSignal: null,
                  temporalExpression: null,
                  temporalKind: "vague",
                  temporalPrecision: "unknown",
                  weekday: null,
                  relativeDayOffset: null,
                  relativeAmount: null,
                  relativeUnit: null,
                  explicitDateParts: null,
                  explicitTimeParts: null,
                  daypart: null,
                  rangeKind: null,
                  explicitTimezone: null,
                  temporalConfidence: 0.3,
                  codexOperationalStatus: "none",
                  codexOperationalConfidence: 0.9,
                  codexOperationalEvidenceQuote: null,
                  codexOperationalReasonJa: null,
                }),
              },
            ],
          },
        },
      ],
    }),
  }));

  try {
    const result = await classifyWithGemini(
      { text: "The banked reset has been activated and should land soon!", tweetCreatedAt: "2026-11-11T06:57:08Z" },
      {
        mode: "primary",
        apiKey: "dummy-gemini-key",
        escalateToOpenAiCompat: true,
        openAiFallbackApiKey: "dummy-groq-key",
        openAiFallbackBaseUrl: "https://api.groq.com/openai/v1",
        openAiFallbackModel: "openai/gpt-oss-120b",
        openAiFetch: async () => {
          groqCalls += 1;
          return makeJsonResponse(429, { error: { message: "TPM exceeded" } });
        },
      },
    );

    assert.equal(groqCalls, 1);
    assert.equal(result.status, "success");
    assert.equal(result.model, "gemini-3.5-flash-lite");
    assert.equal(httpsMock.calledUrls.length, 1);
    assert.match(httpsMock.calledUrls[0], /models\/gemini-3\.5-flash-lite:generateContent/);
  } finally {
    httpsMock.restore();
    if (prevModel === undefined) delete process.env.GEMINI_MODEL;
    else process.env.GEMINI_MODEL = prevModel;
  }
});

test("ordinary non-keyword posts use Gemini flash-lite first and fall back to Groq on Gemini 429", async () => {
  const prevModel = process.env.GEMINI_MODEL;
  process.env.GEMINI_MODEL = "gemini-3.5-flash-lite";
  let groqCalls = 0;
  const httpsMock = mockHttpsRequest(() => ({
    statusCode: 429,
    body: JSON.stringify({ error: { code: 429 } }),
  }));

  try {
    const result = await classifyWithGemini(
      { text: "Had a great coffee today.", tweetCreatedAt: "2026-11-20T03:00:00Z" },
      {
        mode: "primary",
        apiKey: "dummy-gemini-key",
        escalateToOpenAiCompat: true,
        openAiFallbackApiKey: "dummy-groq-key",
        openAiFallbackBaseUrl: "https://api.groq.com/openai/v1",
        openAiFallbackModel: "openai/gpt-oss-120b",
        openAiFetch: async () => {
          groqCalls += 1;
          return makeJsonResponse(200, {
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    signalType: "irrelevant",
                    confidence: 0.99,
                    temporalDirection: "unclear",
                    evidenceQuote: null,
                    contextualResetAssessment: "not_applicable",
                    contextualResetTweetId: null,
                    noticeTimingStatus: null,
                    resetMeaning: null,
                    reasonJa: "日常投稿。",
                    resetTypeJa: null,
                    noticeToExecution: null,
                    teaserStrength: "none",
                    teaserStrengthConfidence: 0.99,
                    teaserStrengthEvidenceQuote: null,
                    teaserStrengthReasonJa: null,
                    futureSignal: null,
                    temporalExpression: null,
                    temporalKind: "none",
                    temporalPrecision: "unknown",
                    weekday: null,
                    relativeDayOffset: null,
                    relativeAmount: null,
                    relativeUnit: null,
                    explicitDateParts: null,
                    explicitTimeParts: null,
                    daypart: null,
                    rangeKind: null,
                    explicitTimezone: null,
                    temporalConfidence: 0.0,
                    codexOperationalStatus: "none",
                    codexOperationalConfidence: 0.99,
                    codexOperationalEvidenceQuote: null,
                    codexOperationalReasonJa: null,
                  }),
                },
              },
            ],
          });
        },
      },
    );

    assert.equal(httpsMock.calledUrls.length, 1);
    assert.match(httpsMock.calledUrls[0], /models\/gemini-3\.5-flash-lite:generateContent/);
    assert.equal(groqCalls, 1);
    assert.equal(result.status, "success");
    assert.equal(result.model, "openai/gpt-oss-120b");
    assert.equal(result.signalType, "irrelevant");
  } finally {
    httpsMock.restore();
    if (prevModel === undefined) delete process.env.GEMINI_MODEL;
    else process.env.GEMINI_MODEL = prevModel;
  }
});
