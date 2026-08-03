document.addEventListener("DOMContentLoaded", async () => {
  const secretInput = document.getElementById("webhookSecret");
  const domainInput = document.getElementById("observatoryDomain");
  const saveBtn = document.getElementById("saveBtn");
  const testBtn = document.getElementById("testBtn");
  const notificationTestBtn = document.getElementById("notificationTestBtn");
  const statusMsg = document.getElementById("statusMessage");
  const diagnosticsEnabled = document.getElementById("diagnosticsEnabled");
  const diagnosticsMaskText = document.getElementById("diagnosticsMaskText");
  const diagnosticCount = document.getElementById("diagnosticCount");
  const refreshDiagnosticsBtn = document.getElementById("refreshDiagnosticsBtn");
  const exportDiagnosticsBtn = document.getElementById("exportDiagnosticsBtn");
  const clearDiagnosticsBtn = document.getElementById("clearDiagnosticsBtn");

  // Load existing values from chrome.storage.local
  const data = await chrome.storage.local.get([
    "webhook_secret",
    "observatory_domain",
    TiboDiagnostics.ENABLED_KEY,
    TiboDiagnostics.MASK_TEXT_KEY,
  ]);
  if (data.webhook_secret) {
    secretInput.value = data.webhook_secret;
  }
  if (data.observatory_domain) {
    domainInput.value = data.observatory_domain;
  }
  diagnosticsEnabled.checked = data[TiboDiagnostics.ENABLED_KEY] !== false;
  diagnosticsMaskText.checked = data[TiboDiagnostics.MASK_TEXT_KEY] !== false;

  function showStatus(message, isError = false) {
    statusMsg.innerText = message;
    statusMsg.className = isError ? "error" : "success";
  }

  function safeNotificationError(value) {
    const text = typeof value === "string" ? value : "notifications API is unavailable";
    return text
      .replace(/(authorization|bearer|api[_ -]?key|secret|token)\s*[:=]\s*\S+/gi, "$1=[REDACTED]")
      .replace(/[\r\n]+/g, " ")
      .slice(0, 300);
  }

  function formatNotificationDetails(details) {
    if (!details || typeof details !== "object") return "";
    const parts = [];
    if (details.permissionLevel && details.permissionLevel !== "unavailable") {
      parts.push(`通知権限: ${details.permissionLevel}`);
    }
    if (details.iconLoadStatus && details.iconLoadStatus !== "not_checked") {
      parts.push(
        `アイコン確認: ${details.iconLoadStatus === "ok" ? "成功" : details.iconLoadStatus}`,
      );
    }
    return parts.length > 0 ? ` (${parts.join(" / ")})` : "";
  }

  saveBtn.addEventListener("click", async () => {
    const secret = secretInput.value.trim();
    const domain = domainInput.value.trim().replace(/\/+$/, "");

    if (!secret) {
      showStatus("エラー: Webhook Secretを入力してください。", true);
      return;
    }

    await chrome.storage.local.set({
      webhook_secret: secret,
      observatory_domain: domain,
      [TiboDiagnostics.ENABLED_KEY]: diagnosticsEnabled.checked,
      [TiboDiagnostics.MASK_TEXT_KEY]: diagnosticsMaskText.checked,
    });

    showStatus("設定を正常に保存しました！");
  });

  async function refreshDiagnosticCount() {
    const logs = await TiboDiagnostics.getDiagnosticLogs(chrome.storage.local);
    const serialized = TiboDiagnostics.serializeDiagnosticLogs(logs);
    diagnosticCount.innerText = `${logs.length}件 / 約${serialized.length.toLocaleString()}文字（Chromeローカルのみ）`;
  }

  refreshDiagnosticsBtn.addEventListener("click", () => {
    refreshDiagnosticCount().catch(() => {
      diagnosticCount.innerText = "診断ログを読み込めませんでした。";
    });
  });

  exportDiagnosticsBtn.addEventListener("click", async () => {
    const logs = await TiboDiagnostics.getDiagnosticLogs(chrome.storage.local);
    const blob = new Blob([TiboDiagnostics.serializeDiagnosticLogs(logs)], {
      type: "application/json",
    });
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = `tibo-diagnostics-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    showStatus("診断ログをJSONとしてエクスポートしました。");
  });

  clearDiagnosticsBtn.addEventListener("click", async () => {
    if (!window.confirm("ローカル診断ログをすべて削除しますか？")) return;
    await TiboDiagnostics.clearDiagnosticLogs(chrome.storage.local);
    await refreshDiagnosticCount();
    showStatus("診断ログを削除しました。");
  });

  refreshDiagnosticCount().catch(() => {
    diagnosticCount.innerText = "診断ログを読み込めませんでした。";
  });

  testBtn.addEventListener("click", () => {
    showStatus("接続テストを実行中...");
    testBtn.disabled = true;

    chrome.runtime.sendMessage({ action: "TEST_CONNECTION" }, (response) => {
      testBtn.disabled = false;
      if (chrome.runtime.lastError) {
        showStatus("接続失敗: " + chrome.runtime.lastError.message, true);
        return;
      }

      if (response && response.success) {
        showStatus("✅ 接続テスト成功！ (Heartbeat Webhook 2xx 応答確認)");
      } else {
        showStatus("❌ 接続失敗: " + (response?.error || "不明なエラー"), true);
      }
    });
  });

  notificationTestBtn.addEventListener("click", () => {
    showStatus("通知テストを実行中...");
    notificationTestBtn.disabled = true;

    chrome.runtime.sendMessage(
      {
        action: "TEST_FORMAL_ADOPTION_NOTIFICATION",
        type: "TEST_FORMAL_ADOPTION_NOTIFICATION",
      },
      (response) => {
        notificationTestBtn.disabled = false;
        if (chrome.runtime.lastError) {
          showStatus(
            `通知の送信に失敗しました: ${safeNotificationError(
              chrome.runtime.lastError.message,
            )}`,
            true,
          );
          return;
        }

        if (response?.ok) {
          showStatus("通知を送信しました。Windowsの通知欄を確認してください。");
          return;
        }

        const error = safeNotificationError(response?.error);
        showStatus(
          `通知の送信に失敗しました: ${error}${formatNotificationDetails(
            response?.details,
          )}`,
          true,
        );
      },
    );
  });
});
