using System.Diagnostics;
using System.Reflection;
using System.Windows.Forms;

namespace CodexUsageMonitorLayoutSmoke;

internal static class Program
{
    [STAThread]
    private static int Main()
    {
        Application.SetHighDpiMode(HighDpiMode.DpiUnaware);

        foreach (var scale in new[] { 1.4f, 1.5f })
        {
            if (!CheckStatusLayout(scale)) return 1;
        }

        if (!CheckMonitorExitPresentation()) return 1;

        Console.WriteLine("PASS monitor controls remain visible and lock diagnostics are presented safely");
        return 0;
    }

    private static bool CheckMonitorExitPresentation()
    {
        var formType = Assembly.Load("CodexUsageMonitor").GetType("CodexUsageMonitor.MainForm")
            ?? throw new InvalidOperationException("MainForm was not found.");
        using var form = (Form)Activator.CreateInstance(formType)!;
        _ = form.Handle;

        using var exitedProcess = Process.Start(new ProcessStartInfo("cmd.exe", "/d /c exit 0")
        {
            CreateNoWindow = true,
            UseShellExecute = false,
        }) ?? throw new InvalidOperationException("Could not start the clean-exit fixture process.");
        if (!exitedProcess.WaitForExit(5_000) || exitedProcess.ExitCode != 0)
        {
            Console.Error.WriteLine("clean-exit fixture process did not exit successfully");
            return false;
        }

        formType.GetField("_monitorProcess", BindingFlags.Instance | BindingFlags.NonPublic)!
            .SetValue(form, exitedProcess);
        formType.GetMethod("HandleProcessExited", BindingFlags.Instance | BindingFlags.NonPublic)!
            .Invoke(form, null);
        Application.DoEvents();

        var status = GetField<Label>(form, "_statusValue");
        var toggle = GetField<Button>(form, "_toggleButton");
        if (status.Text != "○ 停止中" || toggle.Text != "監視開始")
        {
            Console.Error.WriteLine($"clean exit was not presented as stopped: status={status.Text}, toggle={toggle.Text}");
            return false;
        }

        var readSafeErrorText = formType.GetMethod("ReadSafeErrorText", BindingFlags.Static | BindingFlags.NonPublic)
            ?? throw new InvalidOperationException("ReadSafeErrorText was not found.");
        foreach (var reason in new[]
        {
            "pending_posts_lock_recovery_orphaned",
            "pending_posts_lock_recovery_corrupt",
        })
        {
            var message = (string?)readSafeErrorText.Invoke(null, new object?[] { reason });
            if (message is null || !message.Contains("手動確認", StringComparison.Ordinal))
            {
                Console.Error.WriteLine($"{reason} was not presented as requiring manual review");
                return false;
            }
        }

        return true;
    }

    private static bool CheckStatusLayout(float scale)
    {
        var formType = Assembly.Load("CodexUsageMonitor").GetType("CodexUsageMonitor.MainForm")
            ?? throw new InvalidOperationException("MainForm was not found.");
        using var form = (Form)Activator.CreateInstance(formType)!;

        if (form.FormBorderStyle != FormBorderStyle.Sizable ||
            form.AutoSizeMode != AutoSizeMode.GrowOnly ||
            form.MinimumSize.Height < 400)
        {
            Console.Error.WriteLine($"form sizing policy is not resizable/grow-only at {scale:P0}");
            return false;
        }

        var status = GetField<Label>(form, "_statusValue");
        var toggle = GetField<Button>(form, "_toggleButton");
        var table = (TableLayoutPanel)form.Controls[0];
        table.Scale(new SizeF(scale, scale));
        status.MaximumSize = new Size(120, 0);
        var statuses = new[]
        {
            "○ 起動中",
            "△ 一時取得不能",
            "× 監視プロセスが終了しました",
            "× 監視用ファイルが見つかりません",
        };
        foreach (var statusText in statuses)
        {
            status.Text = statusText;
            form.PerformLayout();
            table.PerformLayout();

            var buttonVisible = toggle.Enabled &&
                toggle.Left >= 0 &&
                toggle.Top >= 0 &&
                toggle.Right <= form.ClientSize.Width &&
                toggle.Bottom <= form.ClientSize.Height;
            if (!buttonVisible)
            {
                Console.Error.WriteLine($"{statusText}: button={toggle.Bounds}, client={form.ClientSize}, table={table.Bounds} at {scale:P0}");
                return false;
            }

            if (statusText.StartsWith("×", StringComparison.Ordinal) && status.Height <= 21)
            {
                Console.Error.WriteLine($"{statusText}: wrapped status was not measured at {scale:P0}");
                return false;
            }
        }

        return true;
    }

    private static T GetField<T>(Form form, string name)
    {
        return (T)(form.GetType().GetField(name, BindingFlags.Instance | BindingFlags.NonPublic)?.GetValue(form)
            ?? throw new InvalidOperationException($"Field {name} was not found."));
    }
}
