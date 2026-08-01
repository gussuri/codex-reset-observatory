import assert from "node:assert/strict";
import test from "node:test";

import { LOCAL_OPENAI_STATUS_HISTORY } from "../data/statusHistory";
import { fetchOpenAIStatusSignals } from "../lib/openaiStatus";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

test("retains stored history when both status requests fail", async () => {
  const result = await fetchOpenAIStatusSignals({}, async () => {
    throw new Error("raw network failure details");
  });

  assert.deepStrictEqual(result.data.history, LOCAL_OPENAI_STATUS_HISTORY);
  assert.deepStrictEqual(result.health, {
    state: "degraded",
    detail: "request_failed",
  });
  assert.doesNotMatch(JSON.stringify(result), /raw network failure details/);
});

test("classifies two non-JSON status responses as invalid", async () => {
  const result = await fetchOpenAIStatusSignals({}, async () =>
    new Response("not json", {
      status: 200,
      headers: { "content-type": "text/html" },
    }),
  );

  assert.deepStrictEqual(result.health, {
    state: "degraded",
    detail: "invalid_response",
  });
});

test("classifies malformed JSON status responses as invalid", async () => {
  const result = await fetchOpenAIStatusSignals({}, async () =>
    new Response("{ malformed", {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );

  assert.deepStrictEqual(result.health, {
    state: "degraded",
    detail: "invalid_response",
  });
});

test("marks one usable status response as partial", async () => {
  let request = 0;
  const result = await fetchOpenAIStatusSignals({}, async () => {
    request += 1;
    if (request === 1) {
      return jsonResponse({
        page: { updated_at: "2026-08-01T00:00:00.000Z" },
        components: [{ name: "Codex", status: "operational" }],
      });
    }

    throw new Error("network failure");
  });

  assert.deepStrictEqual(result.health, {
    state: "degraded",
    detail: "partial_response",
  });
  assert.equal(result.data.suppressCodexIncidents, true);
});

test("marks two usable status responses as ok", async () => {
  let request = 0;
  const result = await fetchOpenAIStatusSignals({}, async () => {
    request += 1;
    return request === 1
      ? jsonResponse({
          page: { updated_at: "2026-08-01T00:00:00.000Z" },
          components: [{ name: "Codex", status: "operational" }],
        })
      : jsonResponse({
          page: { updated_at: "2026-08-01T00:00:00.000Z" },
          incidents: [],
        });
  });

  assert.deepStrictEqual(result.health, { state: "ok" });
  assert.deepStrictEqual(result.data.history, LOCAL_OPENAI_STATUS_HISTORY);
});
