import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import https from "node:https";
import test from "node:test";

import {
  buildTeaserStrengthGeminiPrompt,
  classifyTeaserStrengthWithGemini,
  shouldRunTeaserStrengthClassification,
  TIBO_TEASER_STRENGTH_SYSTEM_PROMPT,
  type GeminiTeaserStrengthInput,
} from "../lib/radar/geminiClassification";

function installGeminiResponse(result: Record<string, unknown>, requestBodies: unknown[]) {
  const originalHttpsRequest = https.request;
  https.request = ((...args: any[]) => {
    const callback = args[2] as (response: EventEmitter & { statusCode?: number }) => void;
    const request = new EventEmitter() as EventEmitter & {
      write: (body: string) => boolean;
      end: () => void;
    };
    request.write = (body) => {
      requestBodies.push(JSON.parse(body));
      return true;
    };
    request.end = () => {
      const response = new EventEmitter() as EventEmitter & { statusCode?: number };
      response.statusCode = 200;
      callback(response);
      queueMicrotask(() => {
        response.emit("data", JSON.stringify({
          candidates: [{
            content: {
              parts: [{ text: JSON.stringify(result) }],
            },
          }],
        }));
        response.emit("end");
      });
    };
    return request;
  }) as typeof https.request;

  return () => {
    https.request = originalHttpsRequest;
  };
}

const occasionalResetInput: GeminiTeaserStrengthInput = {
  text: "When I say excellent service for existing users, that includes the occasional reset",
  formalSignalType: "irrelevant",
  isReply: true,
  replyToHandles: ["@fable"],
  replyContextText: "I don't think Tibo is giving us anymore resets this week.",
  isQuote: false,
  quoteContextText: null,
};

test("strength candidate gate is independent from formal signal selection", () => {
  assert.equal(shouldRunTeaserStrengthClassification(occasionalResetInput), true);
  assert.equal(
    shouldRunTeaserStrengthClassification({
      ...occasionalResetInput,
      formalSignalType: "teaser",
    }),
    false,
  );
  assert.equal(
    shouldRunTeaserStrengthClassification({
      ...occasionalResetInput,
      text: "Thanks",
      replyContextText: "Are we getting a usage reset?",
    }),
    true,
  );
  assert.equal(
    shouldRunTeaserStrengthClassification({
      text: "Next week we'll be retiring GPT-5.3-Codex-Spark.",
      formalSignalType: "irrelevant",
    }),
    false,
  );
});

test("strength prompt separates author, reply, and quote context and forbids formal output", () => {
  const prompt = buildTeaserStrengthGeminiPrompt({
    ...occasionalResetInput,
    isQuote: true,
    quoteAuthorHandle: "@parent",
    quoteContextText: "Could we get a reset?",
    quoteTweetUrl: "https://x.com/parent/status/1",
  });

  assert.match(prompt, /independent teaserStrength classifier/i);
  assert.match(prompt, /must not output or change signalType/i);
  assert.match(prompt, /AUTHOR TEXT: When I say excellent service/);
  assert.match(prompt, /VISIBLE REPLY\/PARENT CONTEXT/);
  assert.match(prompt, /QUOTED CONTEXT \(not Tibo's own text\)/);
  assert.ok(prompt.indexOf("AUTHOR TEXT:") < prompt.indexOf("VISIBLE REPLY/PARENT CONTEXT"));
  assert.ok(prompt.indexOf("VISIBLE REPLY/PARENT CONTEXT") < prompt.indexOf("QUOTED CONTEXT"));
  assert.doesNotMatch(prompt, /24[-–]48\s*hours.*required.*weak/i);
  assert.doesNotMatch(prompt, /\bstrong\b/i);
  assert.match(TIBO_TEASER_STRENGTH_SYSTEM_PROMPT, /"teaserStrength": "weak" \| "none"/);
  assert.doesNotMatch(TIBO_TEASER_STRENGTH_SYSTEM_PROMPT, /\bstrong\b/i);
});

test("strength-only API output has no formal signalType and preserves weak result", async () => {
  const requestBodies: unknown[] = [];
  const restore = installGeminiResponse({
    teaserStrength: "weak",
    confidence: 0.87,
    evidenceQuote: "occasional reset",
    reasonJa: "時々リセットする方針を示しています。",
  }, requestBodies);

  try {
    const result = await classifyTeaserStrengthWithGemini(occasionalResetInput, {
      mode: "primary",
      apiKey: "test-key",
      model: "test-model",
    });

    assert.equal(result.status, "success");
    assert.equal(result.teaserStrength, "weak");
    assert.equal(result.confidence, 0.87);
    assert.equal(result.evidenceQuote, "occasional reset");
    assert.equal(result.reasonJa, "時々リセットする方針を示しています。");
    assert.equal("signalType" in result, false);
    assert.equal(requestBodies.length, 1);
    const payload = requestBodies[0] as {
      contents: Array<{ parts: Array<{ text: string }> }>;
    };
    assert.match(payload.contents[0].parts[1].text, /AUTHOR TEXT:/);
    assert.match(payload.contents[0].parts[1].text, /VISIBLE REPLY\/PARENT CONTEXT/);
  } finally {
    restore();
  }
});

test("strength classifier skips non-candidates without an API call", async () => {
  const requestBodies: unknown[] = [];
  const restore = installGeminiResponse({
    teaserStrength: "strong",
    confidence: 1,
    evidenceQuote: "unreachable",
    reasonJa: "unreachable",
  }, requestBodies);

  try {
    const skipInputs: GeminiTeaserStrengthInput[] = [
      { text: "Next week we'll be retiring GPT-5.3-Codex-Spark.", formalSignalType: "irrelevant" },
      { text: "The latest Codex update is rolling out today.", formalSignalType: "irrelevant" },
      { text: "Something was felt across the internet today.", formalSignalType: "irrelevant" },
      { text: "GPT-6 Astra rollout starts today.", formalSignalType: "irrelevant" },
    ];

    for (const input of skipInputs) {
      for (let run = 0; run < 3; run += 1) {
        const result = await classifyTeaserStrengthWithGemini(input, {
          mode: "primary",
          apiKey: "test-key",
          model: "test-model",
        });

        assert.equal(result.status, "skipped");
        assert.equal(result.teaserStrength, null);
      }
    }

    assert.equal(requestBodies.length, 0);
  } finally {
    restore();
  }
});

test("candidate-gated negative contexts remain eligible for the strength-only pass", () => {
  const candidates: GeminiTeaserStrengthInput[] = [
    { text: "I feel Theo is in need of a reset.", formalSignalType: "irrelevant" },
    { text: "No reset tonight.", formalSignalType: "irrelevant" },
    { text: "One day we created the reset button and the rest is history.", formalSignalType: "irrelevant" },
    { text: "I reset my laptop because it froze.", formalSignalType: "irrelevant" },
    { text: "Thanks", replyContextText: "Are we getting a usage reset?", isReply: true, formalSignalType: "irrelevant" },
    { text: "Nice", replyContextText: "Maybe Tibo will reset Codex limits.", isReply: true, formalSignalType: "irrelevant" },
  ];

  for (const input of candidates) {
    assert.equal(shouldRunTeaserStrengthClassification(input), true, input.text);
  }
});

test("strength-only schema rejects strong instead of coercing it to weak", async () => {
  const requestBodies: unknown[] = [];
  const restore = installGeminiResponse({
    teaserStrength: "strong",
    confidence: 0.99,
    evidenceQuote: "occasional reset",
    reasonJa: "強い示唆",
  }, requestBodies);

  try {
    const result = await classifyTeaserStrengthWithGemini(occasionalResetInput, {
      mode: "primary",
      apiKey: "test-key",
      model: "test-model",
    });

    assert.equal(result.status, "invalid_schema");
    assert.equal(result.teaserStrength, null);
    assert.equal(requestBodies.length, 1);
  } finally {
    restore();
  }
});

test("strength response containing formal signalType is rejected instead of changing it", async () => {
  const restore = installGeminiResponse({
    signalType: "teaser",
    teaserStrength: "weak",
    confidence: 0.9,
    evidenceQuote: "occasional reset",
    reasonJa: "weak",
  }, []);

  try {
    const result = await classifyTeaserStrengthWithGemini(occasionalResetInput, {
      mode: "primary",
      apiKey: "test-key",
      model: "test-model",
    });

    assert.equal(result.status, "invalid_schema");
    assert.equal(result.teaserStrength, null);
    assert.equal("signalType" in result, false);
  } finally {
    restore();
  }
});
