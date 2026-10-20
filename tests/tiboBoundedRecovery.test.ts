import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

function loadScanUtils() {
  const context = vm.createContext({ URL, Date });
  vm.runInContext(
    fs.readFileSync(path.join(process.cwd(), "extension/tibo-monitor/scan-utils.js"), "utf8"),
    context,
  );
  return (context as typeof context & { TiboMonitorScan: Record<string, any> }).TiboMonitorScan;
}

test("bounded reply recovery moves at most four times and reports a missing target", () => {
  const recovery = loadScanUtils().createBoundedReplyRecoveryController();
  const page = {
    sourceTimeline: "with_replies",
    currentUrl: "https://x.com/thsottiaux/with_replies",
    eligible: true,
    targetFound: false,
    userIntervened: false,
    viewportHeight: 800,
  };

  let result = recovery.consider({ ...page, now: 0 });
  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    action: "scroll",
    status: "attempting",
    move: 1,
    moveCount: 1,
    scrollPixels: 600,
  });
  assert.equal(recovery.consider({ ...page, now: 10 }).status, "in_progress", "mutation-triggered scans must not re-enter a pending move");

  for (let now = 1000; now <= 3000; now += 1000) {
    recovery.finishMove();
    result = recovery.consider({ ...page, now });
    assert.equal(result.action, "scroll");
  }

  recovery.finishMove();
  result = recovery.consider({ ...page, now: 4000 });
  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    action: "none",
    status: "target_not_visible",
    moveCount: 4,
  });
  assert.equal(recovery.consider({ ...page, now: 63_999 }).status, "cooldown");
  assert.equal(recovery.consider({ ...page, now: 64_000 }).action, "scroll");
});

test("recovery stops at the ten-second deadline even when fewer than four moves ran", () => {
  const recovery = loadScanUtils().createBoundedReplyRecoveryController();
  const page = {
    sourceTimeline: "with_replies",
    currentUrl: "https://x.com/thsottiaux/with_replies",
    eligible: true,
    targetFound: false,
    userIntervened: false,
    viewportHeight: 900,
  };

  assert.equal(recovery.consider({ ...page, now: 1 }).action, "scroll");
  recovery.finishMove();
  assert.deepEqual(JSON.parse(JSON.stringify(recovery.consider({ ...page, now: 10_001 }))), {
    action: "none",
    status: "target_not_visible",
    moveCount: 1,
  });
});

test("recovery does not start for profile pages or without a qualifying long-parent condition", () => {
  const recovery = loadScanUtils().createBoundedReplyRecoveryController();
  const base = {
    currentUrl: "https://x.com/thsottiaux/with_replies",
    eligible: false,
    targetFound: false,
    userIntervened: false,
    viewportHeight: 900,
    now: 0,
  };

  assert.deepEqual(JSON.parse(JSON.stringify(recovery.consider({ ...base, sourceTimeline: "with_replies" }))), {
    action: "none",
    status: "not_attempted",
    moveCount: 0,
  });
  assert.equal(recovery.consider({ ...base, sourceTimeline: "profile", eligible: true }).action, "none");
});

test("recovery stops permanently for the current page after user scroll intervention or navigation", () => {
  const recovery = loadScanUtils().createBoundedReplyRecoveryController();
  const base = {
    sourceTimeline: "with_replies",
    currentUrl: "https://x.com/thsottiaux/with_replies",
    eligible: true,
    targetFound: false,
    userIntervened: false,
    viewportHeight: 900,
  };
  assert.equal(recovery.consider({ ...base, now: 0 }).action, "scroll");
  recovery.finishMove();
  assert.equal(recovery.consider({ ...base, now: 10, userIntervened: true }).status, "user_interrupted");
  assert.equal(recovery.consider({ ...base, now: 70_000 }).status, "user_interrupted");

  const navigation = loadScanUtils().createBoundedReplyRecoveryController();
  assert.equal(navigation.consider({ ...base, now: 0 }).action, "scroll");
  navigation.finishMove();
  assert.equal(navigation.consider({ ...base, now: 100, currentUrl: "https://x.com/thsottiaux" }).status, "navigation_interrupted");
  assert.equal(navigation.consider({ ...base, now: 70_000 }).status, "navigation_interrupted");
});

test("a newly materialized Tibo article stops further recovery moves", () => {
  const recovery = loadScanUtils().createBoundedReplyRecoveryController();
  const base = {
    sourceTimeline: "with_replies",
    currentUrl: "https://x.com/thsottiaux/with_replies",
    eligible: true,
    userIntervened: false,
    viewportHeight: 900,
  };
  assert.equal(recovery.consider({ ...base, now: 0, targetFound: false }).action, "scroll");
  recovery.finishMove();
  assert.deepEqual(JSON.parse(JSON.stringify(recovery.consider({ ...base, now: 500, targetFound: true }))), {
    action: "none",
    status: "target_found",
    moveCount: 1,
  });
});

test("a failed scroll stops the attempt and observes the cooldown", () => {
  const recovery = loadScanUtils().createBoundedReplyRecoveryController();
  const base = {
    sourceTimeline: "with_replies",
    currentUrl: "https://x.com/thsottiaux/with_replies",
    eligible: true,
    targetFound: false,
    userIntervened: false,
    viewportHeight: 900,
  };

  assert.equal(recovery.consider({ ...base, now: 0 }).action, "scroll");
  assert.deepEqual(JSON.parse(JSON.stringify(recovery.failMove(10))), {
    action: "none",
    status: "scroll_failed",
    moveCount: 1,
  });
  assert.deepEqual(JSON.parse(JSON.stringify(recovery.consider({ ...base, now: 11 }))), {
    action: "none",
    status: "cooldown",
    moveCount: 1,
  });
});
