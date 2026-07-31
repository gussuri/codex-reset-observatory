import test from "node:test";
import assert from "node:assert";
import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";

// Helper to load service-worker.js with custom mocked chrome API
function setupServiceWorkerContext(
  customTabs: Array<{ id: number; url: string }> = [],
  opts: { failReloadTabId?: number } = {}
) {
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
        // Simple prefix matcher simulating chrome.tabs.query with host permissions
        return customTabs.filter((tab) =>
          queryInfo.url.some((pattern) => {
            const prefix = pattern.replace("*", "");
            return tab.url.startsWith(prefix);
          })
        );
      },
      reload: async (tabId: number) => {
        if (opts.failReloadTabId === tabId) {
          throw new Error("Simulated tab reload failure");
        }
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

  const mockFetch = async (url: string, fetchOpts: any) => {
    mockFetchCalls.push({ url, body: fetchOpts.body ? JSON.parse(fetchOpts.body) : null });
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
    URL,
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

test("REQUIREMENT 4: When no monitored tab is open, preserves last_page_reload_at and updates status to monitored_tab_missing", async () => {
  const { fireAlarm, localStore, reloadedTabIds } = setupServiceWorkerContext([]);

  const previousSuccessTime = "2026-07-31T20:00:00.000Z";
  localStore["tibo_last_page_reload_at"] = previousSuccessTime;

  await fireAlarm("tibo_page_reload_alarm");

  assert.strictEqual(reloadedTabIds.length, 0, "No tab should be reloaded when zero profile tabs exist");
  assert.strictEqual(
    localStore["tibo_last_page_reload_at"],
    previousSuccessTime,
    "last_page_reload_at MUST NOT be overwritten when tab is missing"
  );
  assert.strictEqual(localStore["tibo_last_page_reload_status"], "monitored_tab_missing");
});

test("REQUIREMENT 4: When tab reload fails with an error, preserves last_page_reload_at and updates status to error", async () => {
  const profileTab = [{ id: 501, url: "https://x.com/thsottiaux" }];
  const { fireAlarm, localStore, reloadedTabIds } = setupServiceWorkerContext(profileTab, {
    failReloadTabId: 501,
  });

  const previousSuccessTime = "2026-07-31T20:00:00.000Z";
  localStore["tibo_last_page_reload_at"] = previousSuccessTime;

  await fireAlarm("tibo_page_reload_alarm");

  assert.strictEqual(reloadedTabIds.length, 0, "Reload failed, so tabId must not be added to reloaded list");
  assert.strictEqual(
    localStore["tibo_last_page_reload_at"],
    previousSuccessTime,
    "last_page_reload_at MUST NOT be overwritten on error"
  );
  assert.strictEqual(localStore["tibo_last_page_reload_status"], "error");
  assert.strictEqual(localStore["tibo_last_page_reload_error"], "Simulated tab reload failure");
});

test("REQUIREMENT 5: Ignores tweet status detail tabs (/thsottiaux/status/...) and only reloads profile tabs (/thsottiaux or /thsottiaux/)", async () => {
  const tabs = [
    { id: 101, url: "https://x.com/thsottiaux/status/9876543210" },
    { id: 102, url: "https://twitter.com/thsottiaux/status/11223344" },
  ];

  const { fireAlarm, localStore, reloadedTabIds } = setupServiceWorkerContext(tabs);

  await fireAlarm("tibo_page_reload_alarm");

  assert.strictEqual(reloadedTabIds.length, 0, "Individual status detail tabs must NOT be reloaded");
  assert.strictEqual(localStore["tibo_last_page_reload_status"], "monitored_tab_missing");
});

test("REQUIREMENT 5 & 6: Strictly matches profile tabs and reloads exactly 1 profile tab when multiple exist", async () => {
  const tabs = [
    { id: 201, url: "https://x.com/thsottiaux/status/12345" }, // Detail page (ignore)
    { id: 202, url: "https://x.com/thsottiaux" },              // Profile tab (target 1)
    { id: 203, url: "https://twitter.com/thsottiaux/" },       // Profile tab (target 2)
  ];

  const { fireAlarm, localStore, reloadedTabIds } = setupServiceWorkerContext(tabs);

  await fireAlarm("tibo_page_reload_alarm");

  assert.strictEqual(reloadedTabIds.length, 1, "Exactly 1 profile tab must be reloaded");
  assert.strictEqual(reloadedTabIds[0], 202, "First profile tab (id: 202) must be selected");
  assert.strictEqual(localStore["tibo_last_page_reload_status"], "success");
  assert.ok(localStore["tibo_last_page_reload_at"], "tibo_last_page_reload_at must be updated on success");
});

test("REQUIREMENT 2 & 3: Heartbeat API & Service Worker include 3 page reload fields (at, status, error)", async () => {
  const { sendMessage, localStore, mockFetchCalls } = setupServiceWorkerContext();

  const sampleTime = "2026-07-31T22:00:00.000Z";
  localStore["tibo_last_page_reload_at"] = sampleTime;
  localStore["tibo_last_page_reload_status"] = "success";
  localStore["tibo_last_page_reload_error"] = null;
  localStore["webhook_secret"] = "test-secret";

  const heartbeatResponse = await sendMessage({
    action: "POST_HEARTBEAT",
    payload: {
      sessionId: "session_test_456",
      lastSuccessfulParseAt: "2026-07-31T22:05:00.000Z",
      lastSeenTweetId: "tweet_222",
      lastScanError: null,
      selectorVersion: "v1.4-extension",
    },
  });

  assert.strictEqual(heartbeatResponse.success, true);
  assert.strictEqual(mockFetchCalls.length, 1);

  const sentBody = mockFetchCalls[0].body;
  assert.strictEqual(sentBody.last_page_reload_at, sampleTime);
  assert.strictEqual(sentBody.last_page_reload_status, "success");
  assert.strictEqual(sentBody.last_page_reload_error, null);
});
