using System.Diagnostics;
using System.Globalization;
using System.Text.Json;

namespace CodexUsageMonitor;

internal sealed class MainForm : Form
{
    private readonly Label _statusValue = CreateValueLabel();
    private readonly Label _usedValue = CreateValueLabel();
    private readonly Label _remainingValue = CreateValueLabel();
    private readonly Label _resetValue = CreateValueLabel();
    private readonly Label _bankedResetValue = CreateValueLabel();
    private readonly Label _lastSuccessValue = CreateValueLabel();
    private readonly Label _webhookValue = CreateValueLabel();
    private readonly Button _toggleButton = new();
    private Process? _monitorProcess;
    private string? _repositoryRoot;
    private bool _stopping;
    private bool _errorState;

    public MainForm()
    {
        Text = "Codex Usage Monitor";
        StartPosition = FormStartPosition.CenterScreen;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = true;
        ClientSize = new Size(430, 350);
        AutoScaleMode = AutoScaleMode.Dpi;
        BackColor = Color.White;

        var title = new Label
        {
            Text = "Codex Usage Monitor",
            AutoSize = true,
            Font = new Font(Font, FontStyle.Bold),
            Margin = new Padding(0, 0, 0, 18),
        };

        var table = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            ColumnCount = 2,
            RowCount = 9,
            Padding = new Padding(24, 22, 24, 20),
        };
        table.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 42));
        table.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 58));
        for (var row = 0; row < table.RowCount; row++)
        {
            table.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        }

        table.Controls.Add(title, 0, 0);
        table.SetColumnSpan(title, 2);
        AddRow(table, 1, "状態", _statusValue);
        AddRow(table, 2, "週間使用率", _usedValue);
        AddRow(table, 3, "週間残量", _remainingValue);
        AddRow(table, 4, "次回通常リセット", _resetValue);
        AddRow(table, 5, "BANKEDリセット", _bankedResetValue);
        AddRow(table, 6, "最終確認", _lastSuccessValue);
        AddRow(table, 7, "送信", _webhookValue);

        _toggleButton.Text = "監視停止";
        _toggleButton.AutoSize = true;
        _toggleButton.Anchor = AnchorStyles.Right;
        _toggleButton.Click += (_, _) => ToggleMonitor();
        table.Controls.Add(_toggleButton, 1, 8);

        Controls.Add(table);
        _statusValue.Text = "○ 起動中";
        _usedValue.Text = "--";
        _remainingValue.Text = "--";
        _resetValue.Text = "--";
        _bankedResetValue.Text = "--";
        _lastSuccessValue.Text = "--";
        _webhookValue.Text = "未送信";

        Shown += (_, _) => StartMonitor();
        FormClosing += (_, _) => StopMonitor();
    }

    private static Label CreateValueLabel()
    {
        return new Label
        {
            AutoSize = true,
            Font = new Font(SystemFonts.MessageBoxFont ?? SystemFonts.DefaultFont, FontStyle.Bold),
            Margin = new Padding(0, 0, 0, 10),
        };
    }

    private static void AddRow(TableLayoutPanel table, int row, string label, Label value)
    {
        table.Controls.Add(new Label
        {
            Text = label,
            AutoSize = true,
            Margin = new Padding(0, 0, 0, 10),
        }, 0, row);
        table.Controls.Add(value, 1, row);
    }

    private void ToggleMonitor()
    {
        if (IsMonitorRunning())
        {
            StopMonitor();
        }
        else
        {
            StartMonitor();
        }
    }

    private bool IsMonitorRunning()
    {
        return _monitorProcess is { HasExited: false };
    }

    private void StartMonitor()
    {
        if (IsMonitorRunning()) return;

        _stopping = false;
        _errorState = false;
        _repositoryRoot = FindRepositoryRoot();
        if (_repositoryRoot is null)
        {
            SetError("監視用ファイルが見つかりません");
            return;
        }

        try
        {
            var startInfo = new ProcessStartInfo
            {
                FileName = Environment.GetEnvironmentVariable("ComSpec") ?? "cmd.exe",
                WorkingDirectory = _repositoryRoot,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardInput = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
            };
            startInfo.ArgumentList.Add("/d");
            startInfo.ArgumentList.Add("/s");
            startInfo.ArgumentList.Add("/c");
            startInfo.ArgumentList.Add("corepack pnpm run monitor:codex-usage:host");

            var process = new Process { StartInfo = startInfo, EnableRaisingEvents = true };
            process.OutputDataReceived += (_, args) => HandleOutput(args.Data);
            process.ErrorDataReceived += (_, _) => { };
            process.Exited += (_, _) => HandleProcessExited();
            if (!process.Start())
            {
                process.Dispose();
                SetError("監視を開始できません");
                return;
            }

            _monitorProcess = process;
            process.BeginOutputReadLine();
            process.BeginErrorReadLine();
            SetStatus("○ 起動中");
            _toggleButton.Text = "監視停止";
        }
        catch
        {
            SetError("監視を開始できません");
        }
    }

    private void StopMonitor()
    {
        var process = _monitorProcess;
        if (process is null) return;

        _stopping = true;
        try
        {
            if (!process.HasExited)
            {
                process.StandardInput.WriteLine("stop");
                process.StandardInput.Flush();
                if (!process.WaitForExit(5_000) && !process.HasExited)
                {
                    process.Kill(entireProcessTree: true);
                    process.WaitForExit(2_000);
                }
            }
        }
        catch
        {
            try
            {
                if (!process.HasExited) process.Kill(entireProcessTree: true);
            }
            catch { }
        }
        finally
        {
            process.Dispose();
            _monitorProcess = null;
            SetStatus("○ 停止中");
            _toggleButton.Text = "監視開始";
            _stopping = false;
        }
    }

    private void HandleOutput(string? line)
    {
        if (string.IsNullOrWhiteSpace(line)) return;
        try
        {
            using var document = JsonDocument.Parse(line);
            var root = document.RootElement.Clone();
            if (!root.TryGetProperty("event", out var eventValue)) return;
            var eventName = eventValue.GetString();
            var at = root.TryGetProperty("at", out var atValue) ? atValue.GetString() : null;
            RunOnUiThread(() => HandleMonitorEvent(eventName, root, at));
        }
        catch (JsonException)
        {
            // pnpm/node startup text is intentionally ignored; the host emits JSON events.
        }
    }

    private void HandleMonitorEvent(string? eventName, JsonElement root, string? at)
    {
        switch (eventName)
        {
            case "starting":
                SetStatus("○ 起動中");
                break;
            case "app_server_started":
                SetStatus("● 監視中");
                break;
            case "snapshot_sent":
                SetStatus("● 監視中");
                _webhookValue.Text = "正常";
                _lastSuccessValue.Text = FormatLocalClock(at);
                UpdateSnapshotValues(root);
                break;
            case "snapshot_observed":
                SetStatus("● 監視中");
                _lastSuccessValue.Text = FormatLocalClock(ReadString(root, "observedAt") ?? at);
                UpdateSnapshotValues(root);
                break;
            case "snapshot_failed":
                SetStatus("△ 一時取得不能");
                _webhookValue.Text = "再試行中";
                break;
            case "session_restart":
                var reason = ReadString(root, "reason");
                if (reason == "codex_cli_not_found")
                {
                    SetError("Codexが見つかりません");
                }
                else
                {
                    SetStatus("△ 再接続中");
                    _webhookValue.Text = "再試行中";
                }
                break;
            case "error":
                SetError(ReadSafeErrorText(ReadString(root, "reason")));
                break;
            case "stopped":
                SetStatus("○ 停止中");
                _toggleButton.Text = "監視開始";
                break;
        }
    }

    private void HandleProcessExited()
    {
        RunOnUiThread(() =>
        {
            if (_stopping) return;
            _monitorProcess = null;
            if (!_errorState) SetError("監視プロセスが終了しました");
            _toggleButton.Text = "監視開始";
        });
    }

    private void SetStatus(string text)
    {
        _statusValue.Text = text;
        _errorState = false;
    }

    private void SetError(string text)
    {
        _errorState = true;
        _statusValue.Text = $"× {text}";
        _webhookValue.Text = "未送信";
        _toggleButton.Text = "監視開始";
    }

    private static string ReadSafeErrorText(string? reason)
    {
        return reason switch
        {
            "monitor_secret_missing" => "監視用設定がありません",
            "codex_cli_not_found" => "Codexが見つかりません",
            "invalid_webhook_url" or "webhook_requires_https" => "監視用設定を確認してください",
            _ => "監視エラー",
        };
    }

    private static string? ReadString(JsonElement root, string name)
    {
        return root.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;
    }

    private void UpdateSnapshotValues(JsonElement root)
    {
        if (root.TryGetProperty("usedPercent", out var usedValue) && usedValue.TryGetDouble(out var used))
        {
            _usedValue.Text = FormatPercent(used);
            _remainingValue.Text = FormatPercent(Math.Max(0, 100 - used));
        }
        if (root.TryGetProperty("resetsAt", out var resetValue) && resetValue.TryGetInt64(out var resetsAt))
        {
            _resetValue.Text = FormatTokyoTime(resetsAt);
        }

        _bankedResetValue.Text = FormatBankedResetCount(root);
    }

    private static string FormatBankedResetCount(JsonElement root)
    {
        const long maxAvailableCount = 1_000;
        if (!root.TryGetProperty("bankedResetDisplayCount", out var countValue) ||
            countValue.ValueKind != JsonValueKind.Number ||
            !countValue.TryGetInt64(out var count) ||
            count < 0 ||
            count > maxAvailableCount)
        {
            return "--";
        }
        return $"{count}回";
    }

    private static string FormatPercent(double value)
    {
        return $"{value.ToString("0.##", CultureInfo.InvariantCulture)}%";
    }

    private static string FormatLocalClock(string? value)
    {
        if (!DateTimeOffset.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var date))
        {
            return "--";
        }
        return date.ToLocalTime().ToString("HH:mm:ss", CultureInfo.InvariantCulture);
    }

    private static string FormatTokyoTime(long unixSeconds)
    {
        try
        {
            var date = DateTimeOffset.FromUnixTimeSeconds(unixSeconds);
            var zone = TimeZoneInfo.FindSystemTimeZoneById("Tokyo Standard Time");
            return TimeZoneInfo.ConvertTime(date, zone).ToString("yyyy/MM/dd HH:mm", CultureInfo.InvariantCulture);
        }
        catch
        {
            return "--";
        }
    }

    private static string? FindRepositoryRoot()
    {
        var configured = Environment.GetEnvironmentVariable("CODEX_USAGE_MONITOR_REPO");
        if (IsRepositoryRoot(configured)) return Path.GetFullPath(configured!);

        var current = new DirectoryInfo(AppContext.BaseDirectory);
        for (var depth = 0; depth < 8 && current is not null; depth++)
        {
            if (IsRepositoryRoot(current.FullName)) return current.FullName;
            current = current.Parent;
        }
        return null;
    }

    private static bool IsRepositoryRoot(string? path)
    {
        return !string.IsNullOrWhiteSpace(path) && File.Exists(Path.Combine(path, "package.json"));
    }

    private void RunOnUiThread(Action action)
    {
        if (IsDisposed || !IsHandleCreated) return;
        try
        {
            BeginInvoke(action);
        }
        catch (InvalidOperationException) { }
    }
}
