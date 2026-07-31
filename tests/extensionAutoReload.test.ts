import test from "node:test";
import assert from "node:assert";
import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";

// Helper to load service-worker.js with custom mocked chrome API
function setupServiceWorkerContext(customTabs: Array<{ id: number; url: string }> = []) {
  const localStore: Record<string, any> = {};
  const alarmsCreated: Array<{ name: string; alarmInfo: any }> = [];
  const reloadedTabIds: number[] = [];
  let alarmListener: ((alarm: { name: string }) => void) | null = null;
  let messageListener: Function | null = null;

  const mockFetchCalls: Array<{ url: string; body: any }> = [];

  const mockChrome = {
    storage: {
      local: {
        get: async (keys: string[]) => {
          const result: Record<string, any> = {};
          keys.forEach((k) => {
            result[k] = localStore[k];
          });
          return result;
        },
        set: async (obj: Record<string, any>) => {
          Object.assign(localStore, obj);
        },
      },
    },
    alarms: {
      get: (name: string, cb: Function) => {
        cb(alarmsCreated.find((a) => a.name === name) || null);
      },
      create: (name: string, alarmInfo: any) => {
        alarmsCreated.push({ name, alarmInfo });
      },
      onAlarm: {
        addListener: (fn: any) => {
          alarmListener = fn;
        },
      },
    },
    tabs: {
      query: async (queryInfo: { url: string[] }) => {
        // Filter customTabs matching patterns in queryInfo.url
        return customTabs.filter((tab) =>
          queryInfo.url.some((pattern) => {
            const prefix = pattern.replace("*", "");
            return tab.url.startsWith(prefix);
          })
        );
      },
      reload: async (tabId: number) => {
        reloadedTabIds.push(tabId);
      },
    },
    runtime: {
      onInstalled: { addListener: () => {} },
      onStartup: { addListener: () => {} },
      onMessage: {
        addListener: (fn: Function) => {
          messageListener = fn;
        },
      },
    },
  };

  const mockFetch = async (url: string, opts: any) => {
    mockFetchCalls.push({ url, body: opts.body ? JSON.parse(opts.body) : null });
    return {
      ok: true,
      status: 200,
      text: async () => "OK",
      json: async () => ({ success: true }),
    };
  };

  const swPath = path.join(__dirname, "../extension/tibo-monitor/service-worker.js");
  const swCode = fs.readFileSync(swPath, "utf8");

  const sandbox = {
    chrome: mockChrome,
    fetch: mockFetch,
    console,
    Date,
    Promise,
    setTimeout,
    setInterval,
  };

  const context = vm.createContext(sandbox);
  vm.runInContext(swCode, context);

  return {
    context,
    localStore,
    alarmsCreated,
    reloadedTabIds,
    mockFetchCalls,
    fireAlarm: async (name: string) => {
      if (alarmListener) {
        await alarmListener({ name });
      }
    },
    sendMessage: (msg: any): Promise<any> => {
      return new Promise((resolve) => {
        if (messageListener) {
          messageListener(msg, {}, (res: any) => resolve(res));
        } else {
          resolve(null);
        }
      });
    },
  };
}

test("REQUIREMENT 3: Extension setup registers a 10-minute page reload alarm", () => {
  const { alarmsCreated } = setupServiceWorkerContext();

  assert.strictEqual(alarmsCreated.length, 1, "Exactly one alarm should be created at setup");
  assert.strictEqual(alarmsCreated[0].name, "tibo_page_reload_alarm");
  assert.strictEqual(alarmsCreated[0].alarmInfo.periodInMinutes, 10, "Alarm must run every 10 minutes");
});

test("REQUIREMENT 7: When no monitored tab is open, alarm logs status as monitored_tab_missing without error", async () => {
  const { fireAlarm, localStore, reloadedTabIds } = setupServiceWorkerContext([]);

  await fireAlarm("tibo_page_reload_alarm");

  assert.strictEqual(reloadedTabIds.length, 0, "No tab should be reloaded when zero tabs exist");
  assert.strictEqual(localStore["tibo_last_page_reload_status"], "monitored_tab_missing");
  assert.ok(localStore["tibo_last_page_reload_at"], "last_page_reload_at timestamp must be recorded");
});

test("REQUIREMENT 5 & 6: When multiple monitored tabs exist, exactly 1 tab is selected and reloaded", async () => {
  const tabs = [
    { id: 201, url: "https://x.com/thsottiaux" },
    { id: 202, url: "https://x.com/thsottiaux/status/12345" },
    { id: 203, url: "https://twitter.com/thsottiaux" },
  ];

  const { fireAlarm, localStore, reloadedTabIds } = setupServiceWorkerContext(tabs);

  await fireAlarm("tibo_page_reload_alarm");

  assert.strictEqual(reloadedTabIds.length, 1, "Exactly 1 tab must be reloaded when multiple match");
  assert.strictEqual(reloadedTabIds[0], 201, "First matching tab (tabs[0]) must be selected");
  assert.strictEqual(localStore["tibo_last_page_reload_status"], "success");
  assert.strictEqual(localStore["tibo_reloaded_tab_id"], 201);
  assert.ok(localStore["tibo_last_page_reload_at"], "tibo_last_page_reload_at must be populated");
});

test("REQUIREMENT 8: POST_HEARTBEAT includes last_page_reload_at in its payload", async () => {
  const { sendMessage, localStore, mockFetchCalls } = setupServiceWorkerContext();

  // Set preset last page reload timestamp in storage
  const sampleReloadTime = "2026-07-31T21:00:00.000Z";
  localStore["tibo_last_page_reload_at"] = sampleReloadTime;
  localStore["webhook_secret"] = "test-secret";

  const heartbeatResponse = await sendMessage({
    action: "POST_HEARTBEAT",
    payload: {
      sessionId: "session_test_123",
      lastSuccessfulParseAt: "2026-07-31T21:05:00.000Z",
      lastSeenTweetId: "tweet_111",
      lastScanError: null,
      selectorVersion: "v1.4-extension",
    },
  });

  assert.strictEqual(heartbeatResponse.success, true);
  assert.strictEqual(mockFetchCalls.length, 1);

  const sentBody = mockFetchCalls[0].body;
  assert.strictEqual(
    sentBody.last_page_reload_at,
    sampleReloadTime,
    "Heartbeat payload must include last_page_reload_at from storage"
  );
});

test("REQUIREMENT 9: Deduplication in storage prevents duplicate webhooks even after tab reload re-initialization", async () => {
  const tabs = [{ id: 301, url: "https://x.com/thsottiaux" }];
  const { sendMessage, fireAlarm, localStore, mockFetchCalls } = setupServiceWorkerContext(tabs);

  localStore["webhook_secret"] = "test-secret";

  const tweetPayload = {
    tweetId: "tweet_after_reload_999",
    text: "Testing tweet deduplication after page reload",
    tweetUrl: "https://x.com/thsottiaux/status/tweet_after_reload_999",
    tweetCreatedAt: new Date().toISOString(),
  };

  // 1. Initial scan sends tweet to webhook
  const res1 = await sendMessage({ action: "POST_TWEET", payload: tweetPayload });
  assert.strictEqual(res1.success, true);
  assert.strictEqual(res1.skipped, undefined);
  assert.strictEqual(mockFetchCalls.length, 1);

  // 2. Tab is reloaded via alarm (simulating page reload & content.js re-initialization)
  await fireAlarm("tibo_page_reload_alarm");

  // 3. Re-initialized content.js scans the same tweetId again after page reload
  const res2 = await sendMessage({ action: "POST_TWEET", payload: tweetPayload });
  assert.strictEqual(res2.success, true);
  assert.strictEqual(res2.skipped, true, "Re-scanned tweet must be skipped due to SW storage deduplication");
  assert.strictEqual(mockFetchCalls.length, 1, "Webhook fetch must NOT be called a second time");
});
