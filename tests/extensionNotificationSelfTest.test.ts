import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

type FakeElement = {
  value: string;
  checked: boolean;
  disabled: boolean;
  innerText: string;
  className: string;
  addEventListener: (event: string, handler: () => void) => void;
  click: () => void;
};

function createFakeElement(): FakeElement {
  const handlers = new Map<string, () => void>();
  return {
    value: "",
    checked: false,
    disabled: false,
    innerText: "",
    className: "",
    addEventListener(event, handler) {
      handlers.set(event, handler);
    },
    click() {
      handlers.get("click")?.();
    },
  };
}

test("options page exposes a safe notification test and reports its result", async () => {
  const extensionRoot = path.join(__dirname, "../extension/tibo-monitor");
  const html = fs.readFileSync(path.join(extensionRoot, "options.html"), "utf8");
  const source = fs.readFileSync(path.join(extensionRoot, "options.js"), "utf8");

  assert.match(html, /id="notificationTestBtn"/);
  assert.match(html, /本番データを変更せず、Chrome通知だけを確認します。/);
  assert.match(source, /TEST_FORMAL_ADOPTION_NOTIFICATION/);
  assert.doesNotMatch(source, /fetch\(/);

  const ids = [
    "webhookSecret",
    "observatoryDomain",
    "saveBtn",
    "testBtn",
    "notificationTestBtn",
    "statusMessage",
    "diagnosticsEnabled",
    "diagnosticsMaskText",
    "diagnosticCount",
    "refreshDiagnosticsBtn",
    "exportDiagnosticsBtn",
    "clearDiagnosticsBtn",
  ];
  const elements = Object.fromEntries(ids.map((id) => [id, createFakeElement()]));
  let sentMessage: unknown = null;

  const diagnostics = {
    ENABLED_KEY: "diagnostics_enabled",
    MASK_TEXT_KEY: "diagnostics_mask_text",
    getDiagnosticLogs: async () => [],
    serializeDiagnosticLogs: () => "[]",
    clearDiagnosticLogs: async () => {},
  };
  const fakeDocument = {
    addEventListener: (_event: string, handler: () => void) => {
      void handler();
    },
    getElementById: (id: string) => elements[id as keyof typeof elements],
  };
  const fakeChrome = {
    storage: {
      local: {
        get: async () => ({}),
        set: async () => {},
      },
    },
    runtime: {
      lastError: undefined,
      sendMessage: (message: unknown, callback: (response: { ok: boolean }) => void) => {
        sentMessage = message;
        callback({ ok: true });
      },
    },
  };

  vm.runInNewContext(source, {
    chrome: fakeChrome,
    document: fakeDocument,
    TiboDiagnostics: diagnostics,
    console,
    setTimeout,
    window: { confirm: () => false },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  elements.notificationTestBtn.click();

  assert.deepEqual(sentMessage, {
    action: "TEST_FORMAL_ADOPTION_NOTIFICATION",
    type: "TEST_FORMAL_ADOPTION_NOTIFICATION",
  });
  assert.equal(
    elements.statusMessage.innerText,
    "通知を送信しました。Windowsの通知欄を確認してください。",
  );
});
