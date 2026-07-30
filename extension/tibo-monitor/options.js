document.addEventListener("DOMContentLoaded", async () => {
  const secretInput = document.getElementById("webhookSecret");
  const domainInput = document.getElementById("observatoryDomain");
  const saveBtn = document.getElementById("saveBtn");
  const testBtn = document.getElementById("testBtn");
  const statusMsg = document.getElementById("statusMessage");

  // Load existing values from chrome.storage.local
  const data = await chrome.storage.local.get(["webhook_secret", "observatory_domain"]);
  if (data.webhook_secret) {
    secretInput.value = data.webhook_secret;
  }
  if (data.observatory_domain) {
    domainInput.value = data.observatory_domain;
  }

  function showStatus(message, isError = false) {
    statusMsg.innerText = message;
    statusMsg.className = isError ? "error" : "success";
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
    });

    showStatus("設定を正常に保存しました！");
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
});
