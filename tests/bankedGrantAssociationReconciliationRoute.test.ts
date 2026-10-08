import assert from "node:assert/strict";
import test from "node:test";

import { createReconcileBankedGrantAssociationsHandler } from "../lib/radar/bankedGrantAssociationReconciliationRoute";

const result = {
  scanned: 3,
  accepted: 1,
  pending: 1,
  conflict: 0,
  stale: 1,
  failed: 0,
  invalidated: true,
  hasMore: false,
};

test("BANKED reconciliation endpoint requires CRON_SECRET bearer auth", async () => {
  const previous = process.env.CRON_SECRET;
  process.env.CRON_SECRET = "test-secret";
  try {
    let calls = 0;
    const handler = createReconcileBankedGrantAssociationsHandler(async () => {
      calls += 1;
      return result;
    });
    const response = await handler(new Request("https://example.test", { method: "POST" }));
    assert.equal(response.status, 401);
    assert.equal(calls, 0);
  } finally {
    if (previous === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previous;
  }
});

test("BANKED reconciliation endpoint returns only aggregate results", async () => {
  const previous = process.env.CRON_SECRET;
  process.env.CRON_SECRET = "test-secret";
  try {
    const handler = createReconcileBankedGrantAssociationsHandler(async () => result);
    const response = await handler(new Request("https://example.test", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
    }));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store, no-cache, must-revalidate");
    assert.deepEqual(await response.json(), { status: "completed", ...result });
  } finally {
    if (previous === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previous;
  }
});

test("BANKED reconciliation endpoint reports runner failures as retryable HTTP errors", async () => {
  const previous = process.env.CRON_SECRET;
  process.env.CRON_SECRET = "test-secret";
  try {
    const handler = createReconcileBankedGrantAssociationsHandler(async () => ({
      ...result,
      accepted: 0,
      pending: 1,
      failed: 2,
      invalidated: false,
    }));
    const response = await handler(new Request("https://example.test", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
    }));

    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      status: "failed",
      scanned: 3,
      accepted: 0,
      pending: 1,
      conflict: 0,
      stale: 1,
      failed: 2,
      invalidated: false,
      hasMore: false,
      error: "reconciliation_failed",
    });
  } finally {
    if (previous === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previous;
  }
});

test("BANKED reconciliation endpoint sanitizes runner failures", async () => {
  const previous = process.env.CRON_SECRET;
  process.env.CRON_SECRET = "test-secret";
  try {
    const handler = createReconcileBankedGrantAssociationsHandler(async () => {
      throw new Error("sensitive database detail");
    });
    const response = await handler(new Request("https://example.test", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
    }));
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: "reconciliation_failed" });
  } finally {
    if (previous === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previous;
  }
});
