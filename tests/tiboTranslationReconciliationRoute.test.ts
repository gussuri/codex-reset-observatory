import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import { NextRequest } from "next/server";

import {
  createTiboTranslationReconciliationHandler,
} from "../lib/radar/tiboTranslationReconciliationRoute";
import type {
  MissingTiboTranslationRow,
  TiboTranslationRepairResult,
} from "../lib/radar/tiboTranslationReconciliation";

const ORIGINAL_CRON_SECRET = process.env.CRON_SECRET;

function restoreCronSecret() {
  if (ORIGINAL_CRON_SECRET === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = ORIGINAL_CRON_SECRET;
}

function request(method: "GET" | "POST", authorization?: string, suffix = "") {
  return new NextRequest(`https://example.test/api/internal/reconcile-tibo-translations${suffix}`, {
    method,
    headers: authorization ? { authorization } : undefined,
  });
}

function row(tweetId: string): MissingTiboTranslationRow {
  return {
    tweetId,
    signalType: "official_notice",
    text: "A reset is coming.",
    tweetCreatedAt: "2026-09-20T00:00:00.000Z",
    translatedTextJa: null,
    translatedTextZh: "已有中文",
  };
}

function result(overrides: Partial<TiboTranslationRepairResult> = {}): TiboTranslationRepairResult {
  return {
    scanned: 2,
    candidates: 1,
    attempted: 1,
    geminiRequests: 1,
    writes: 1,
    rateLimited: false,
    invalidated: true,
    outcomes: [{
      tweetId: "private-id",
      signalType: "official_notice",
      missingLocales: ["ja"],
      writtenLocales: ["ja"],
      status: "translated",
    }],
    ...overrides,
  };
}

test("translation reconciliation route rejects unauthorized audit and repair requests", async () => {
  process.env.CRON_SECRET = "expected-secret";
  let auditCalls = 0;
  let repairCalls = 0;
  const handler = createTiboTranslationReconciliationHandler(
    () => ({ from: () => ({}) }) as any,
    async () => {
      auditCalls += 1;
      return [];
    },
    async () => {
      repairCalls += 1;
      return result();
    },
  );

  try {
    const audit = await handler(request("GET", "Bearer wrong-secret"));
    const repair = await handler(request("POST", "Bearer wrong-secret"));
    assert.equal(audit.status, 401);
    assert.equal(repair.status, 401);
    assert.equal(auditCalls, 0);
    assert.equal(repairCalls, 0);
  } finally {
    restoreCronSecret();
  }
});

test("authorized GET is a read-only audit and reports candidate IDs/locales", async () => {
  process.env.CRON_SECRET = "expected-secret";
  let repairCalls = 0;
  const handler = createTiboTranslationReconciliationHandler(
    () => ({ from: () => ({}) }) as any,
    async (_store, limit) => {
      assert.equal(limit, 10);
      return [row("audit-id")];
    },
    async () => {
      repairCalls += 1;
      return result();
    },
  );

  try {
    const response = await handler(request("GET", "Bearer expected-secret", "?limit=10"));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      status: "dry_run",
      scanned: 1,
      candidates: [{
        tweetId: "audit-id",
        signalType: "official_notice",
        missingLocales: ["ja"],
      }],
    });
    assert.equal(repairCalls, 0);
  } finally {
    restoreCronSecret();
  }
});

test("authorized POST runs one bounded repair and returns only aggregate status", async () => {
  process.env.CRON_SECRET = "expected-secret";
  let receivedMaxRows: number | undefined;
  const handler = createTiboTranslationReconciliationHandler(
    () => ({ from: () => ({}) }) as any,
    async () => [],
    async (options) => {
      receivedMaxRows = options.maxRows;
      return result();
    },
  );

  try {
    const response = await handler(request("POST", "Bearer expected-secret"));
    assert.equal(response.status, 200);
  assert.equal(receivedMaxRows, 4);
    assert.deepEqual(await response.json(), {
      status: "completed",
      scanned: 2,
      candidates: 1,
      attempted: 1,
      geminiRequests: 1,
      writes: 1,
      rateLimited: false,
      invalidated: true,
      statusSummary: { translated: 1 },
    });
  } finally {
    restoreCronSecret();
  }
});

test("translation reconciliation workflow uses only the protected production route", () => {
  const workflow = readFileSync(
    resolve(".github/workflows/reconcile-tibo-translations.yml"),
    "utf8",
  );
  assert.match(workflow, /cron:\s*["']?\*\/30 \* \* \* \*["']?/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /group:\s*tibo-translation-reconciliation/);
  assert.match(workflow, /secrets\.CRON_SECRET/);
  assert.match(workflow, /--request POST/);
  assert.match(workflow, /api\/internal\/reconcile-tibo-translations/);
  assert.doesNotMatch(workflow, /actions\/checkout|setup-node|pnpm install|SUPABASE_SERVICE_ROLE_KEY|GEMINI_API_KEY/);
  assert.match(workflow, /rateLimited/);
});
