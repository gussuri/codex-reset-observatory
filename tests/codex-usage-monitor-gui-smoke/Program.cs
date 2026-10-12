using System.Reflection;
using System.Text.Json;
using System.Windows.Forms;

const BindingFlags PrivateInstance = BindingFlags.Instance | BindingFlags.NonPublic;
var monitorAssembly = Assembly.Load("CodexUsageMonitor");
var formType = monitorAssembly.GetType("CodexUsageMonitor.MainForm", throwOnError: true)!;
var handler = formType.GetMethod("HandleMonitorEvent", PrivateInstance)!;
var statusField = formType.GetField("_statusValue", PrivateInstance)!;

RunScenario("pending_posts_lock_owned", "別の監視", expectError: false);
RunScenario("pending_posts_lock_recovery_corrupt", "手動確認", expectError: true);
Console.WriteLine("GUI lock-conflict status smoke passed (2 scenarios).");

void RunScenario(string reason, string expectedText, bool expectError)
{
    using var form = (Form)Activator.CreateInstance(formType, nonPublic: true)!;
    using var conflict = JsonDocument.Parse(JsonSerializer.Serialize(new
    {
        reason,
        action = expectError ? "manual_review_required_queue_untouched" : "monitor_exited_without_reading_or_writing_queue",
    }));
    handler.Invoke(form, ["pending_queue_lock_conflict", conflict.RootElement.Clone(), null]);
    var status = (Label)statusField.GetValue(form)!;
    AssertContains(status.Text, expectedText, $"{reason} should explain why monitoring stopped");
    handler.Invoke(form, ["stopped", default(JsonElement), null]);
    AssertContains(status.Text, expectedText, $"{reason} should remain visible after the host's stopped event");
}

static void AssertContains(string actual, string expected, string message)
{
    if (!actual.Contains(expected, StringComparison.Ordinal))
    {
        throw new InvalidOperationException($"{message}. Actual status: {actual}");
    }
}
