import assert from "node:assert/strict";
import test from "node:test";

import {
  createInvalidateRadarCacheHandler,
  ALLOWED_RADAR_CACHE_INVALIDATION_SCOPES,
  isAllowedRadarCacheInvalidationScope,
} from "../lib/radar/invalidateRadarCacheRoute";
import { RADAR_CACHE_TAGS } from "../lib/radar/cacheGeneration";
import type { RadarCacheInvalidationScope } from "../lib/radar/cacheInvalidation";

const TEST_SECRET = "test-cron-secret-12345";

function createJsonPostRequest(body: unknown, authorization?: string | null): Request {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (authorization !== undefined && authorization !== null) {
    headers.authorization = authorization;
  }
  return new Request("https://localhost/api/internal/invalidate-radar-cache", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

test("returns 503 when CRON_SECRET is not configured", async () => {
  const handler = createInvalidateRadarCacheHandler(
    async () => {},
    () => undefined,
  );
  const request = createJsonPostRequest({ scope: "tibo" }, `Bearer ${TEST_SECRET}`);
  const response = await handler(request);

  assert.equal(response.status, 503);
  const json = await response.json();
  assert.deepEqual(json, { error: "configuration_unavailable" });
});

test("returns 401 when authorization header is missing", async () => {
  const handler = createInvalidateRadarCacheHandler(
    async () => {},
    () => TEST_SECRET,
  );
  const request = createJsonPostRequest({ scope: "tibo" }, null);
  const response = await handler(request);

  assert.equal(response.status, 401);
  const json = await response.json();
  assert.deepEqual(json, { error: "Unauthorized" });
});

test("returns 401 when bearer token is invalid", async () => {
  const handler = createInvalidateRadarCacheHandler(
    async () => {},
    () => TEST_SECRET,
  );
  const request = createJsonPostRequest({ scope: "tibo" }, "Bearer wrong-secret");
  const response = await handler(request);

  assert.equal(response.status, 401);
  const json = await response.json();
  assert.deepEqual(json, { error: "Unauthorized" });
});

test("returns 405 when request method is not POST", async () => {
  const handler = createInvalidateRadarCacheHandler(
    async () => {},
    () => TEST_SECRET,
  );
  const request = new Request("https://localhost/api/internal/invalidate-radar-cache", {
    method: "GET",
    headers: {
      authorization: `Bearer ${TEST_SECRET}`,
    },
  });
  const response = await handler(request);

  assert.equal(response.status, 405);
  const json = await response.json();
  assert.deepEqual(json, { error: "Method Not Allowed" });
});

test("returns 400 when payload is not valid JSON", async () => {
  const handler = createInvalidateRadarCacheHandler(
    async () => {},
    () => TEST_SECRET,
  );
  const request = new Request("https://localhost/api/internal/invalidate-radar-cache", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      authorization: `Bearer ${TEST_SECRET}`,
    },
    body: "not-json{",
  });
  const response = await handler(request);

  assert.equal(response.status, 400);
  const json = await response.json();
  assert.deepEqual(json, { error: "invalid_payload" });
});

test("returns 400 when scope is missing or not a string", async () => {
  const handler = createInvalidateRadarCacheHandler(
    async () => {},
    () => TEST_SECRET,
  );

  for (const invalidBody of [{}, { scope: 123 }, { scope: null }, { scope: true }, []]) {
    const request = createJsonPostRequest(invalidBody, `Bearer ${TEST_SECRET}`);
    const response = await handler(request);

    assert.equal(response.status, 400);
    const json = await response.json();
    assert.deepEqual(json, {
      error: Array.isArray(invalidBody) ? "invalid_payload" : "invalid_scope",
    });
  }
});

test("returns 400 and blocks arbitrary cache tag injection", async () => {
  let invalidated = false;
  const handler = createInvalidateRadarCacheHandler(
    async () => {
      invalidated = true;
    },
    () => TEST_SECRET,
  );

  const arbitraryScopes = [
    "radar-core",
    "radar-tibo-active",
    "../../etc/passwd",
    "DROP TABLE tweets",
    "custom-tag",
    "TIBO",
    "tibo ",
    " tibo",
    "__proto__",
  ];

  for (const scope of arbitraryScopes) {
    const request = createJsonPostRequest({ scope }, `Bearer ${TEST_SECRET}`);
    const response = await handler(request);

    assert.equal(response.status, 400);
    const json = await response.json();
    assert.deepEqual(json, { error: "invalid_scope" });
    assert.equal(invalidated, false);
  }
});

test("successfully invalidates tibo scope with correct authentication and returns 200", async () => {
  const calls: RadarCacheInvalidationScope[] = [];
  const handler = createInvalidateRadarCacheHandler(
    async (scope) => {
      calls.push(scope);
    },
    () => TEST_SECRET,
  );

  const request = createJsonPostRequest({ scope: "tibo" }, `Bearer ${TEST_SECRET}`);
  const response = await handler(request);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store, no-cache, must-revalidate");
  assert.equal(response.headers.get("Content-Type"), "application/json");

  const json = await response.json();
  assert.equal(json.status, "completed");
  assert.equal(json.scope, "tibo");
  assert.deepEqual(json.invalidatedTags, [
    RADAR_CACHE_TAGS.tiboActive,
    RADAR_CACHE_TAGS.tiboHistory,
    RADAR_CACHE_TAGS.tiboTimed,
    RADAR_CACHE_TAGS.core,
  ]);
  assert.deepEqual(calls, ["tibo"]);
});

test("supports all allowed scopes defined in RadarCacheInvalidationScope", async () => {
  for (const scope of ALLOWED_RADAR_CACHE_INVALIDATION_SCOPES) {
    assert.ok(isAllowedRadarCacheInvalidationScope(scope));

    const calls: RadarCacheInvalidationScope[] = [];
    const handler = createInvalidateRadarCacheHandler(
      async (s) => {
        calls.push(s);
      },
      () => TEST_SECRET,
    );

    const request = createJsonPostRequest({ scope }, `Bearer ${TEST_SECRET}`);
    const response = await handler(request);

    assert.equal(response.status, 200);
    const json = await response.json();
    assert.equal(json.status, "completed");
    assert.equal(json.scope, scope);
    assert.ok(Array.isArray(json.invalidatedTags));
    assert.ok(json.invalidatedTags.length > 0);
    assert.deepEqual(calls, [scope]);
  }
});

test("returns 500 when invalidate throws an error", async () => {
  const handler = createInvalidateRadarCacheHandler(
    async () => {
      throw new Error("Revalidation failed");
    },
    () => TEST_SECRET,
  );

  const request = createJsonPostRequest({ scope: "tibo" }, `Bearer ${TEST_SECRET}`);
  const response = await handler(request);

  assert.equal(response.status, 500);
  const json = await response.json();
  assert.deepEqual(json, { status: "error", error: "invalidation_failed" });
});
