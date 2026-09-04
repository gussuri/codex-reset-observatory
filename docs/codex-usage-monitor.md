# Codex usage monitor runbook

The local monitor observes the weekly usage window exposed by the official
Codex app-server. An unexpected weekly quota recovery is immediately confirmed
as a formal random reset on the public observatory, while Tibo posts provide
retrospective context and corroboration.

## 日常運用

> **通常運用ではWindows GUIアプリを起動している間だけ監視します。黒いターミナルを開きっぱなしにする必要はありません。**

### 普段の状態

`Codex Usage Monitor`を起動すると監視が始まり、アプリを閉じると監視が止まります。

- GUI source: `apps/codex-usage-monitor/`
- GUI executable: `apps/codex-usage-monitor/dist/CodexUsageMonitor.exe`
- 通常のpolling: 120秒
- 最低polling: 60秒

monitorはCodex公式app-serverから週次利用枠を定期取得し、Vercel webhookへ安全なスナップショットを送信します。GUIには監視状態、週間使用率、残量、次回通常リセット、最終成功取得時刻、送信状態を表示します。

### 自動監視が動いているか確認する

GUIの状態表示で`監視中`または`再接続中`になっていることと、最終確認時刻が更新されていることを確認します。

必要に応じて、Supabaseのlatest monitor stateが更新され続けていることでも確認できます。ただし、個人のusage raw値がpublic APIに表示されるとは限りません。

### 手動で監視画面を表示する

通常はデスクトップまたはStart Menuから`CodexUsageMonitor.exe`を起動します。アプリ起動時に監視が自動開始され、ウィンドウを閉じるとapp-server、polling、監視プロセスが終了します。

開発・デバッグで黒いコンソールのログを確認したい場合だけ、Windows Terminalまたはcmdで次を実行します。

```powershell
cd /d C:\Users\Yura\Documents\codex-reset-observatory
corepack pnpm run monitor:codex-usage
```

CLIは開発・デバッグ用です。`[Codex usage monitor] app_server_started {}`や`[Codex usage monitor] snapshot_sent ...`などのログを確認できます。終了するには`Ctrl+C`を押します。

### 二重起動に注意

GUIを起動している状態でCLIを起動すると、二重監視になる可能性があります。デバッグ時はGUIを閉じてからCLIを起動してください。

### PC再起動後

PC再起動やWindowsログオンだけではmonitorは自動起動しません。通常運用へ戻る場合はGUIアプリを起動してください。

Task Scheduler、Startup folder、registry Run key、Windows serviceは現在の運用では使用しません。

## Data source and safety

The monitor starts the official local executable with `codex.exe app-server` and
uses JSONL over stdio. It completes the `initialize` handshake before calling
`account/rateLimits/read`. It does not read `auth.json`, tokens, cookies, or a
private ChatGPT API. The app-server owns authentication.

Only these fields leave the machine:

- `limitId`
- `planType`
- `usedPercent`
- `windowDurationMins`
- `resetsAt`
- `observedAt`
- `bankedResetAvailableCount` only for an explicit count-change event

When the read-only app-server response reports the explicit
`rateLimitResetCredits.availableCount` field, that value is the only source for
the local BANKED reset count. The monitor sends only the new count and the
boolean `bankedResetCountChange` marker for a positive count transition. The
ordinary `credits` object is a separate product and is never used as a BANKED
count or distribution signal. Missing or unsupported reset-credit metadata
never creates a distribution event. If the monitor has a previously explicit
count, the GUI keeps it with the `（前回確認）` marker until a new explicit
count is available; otherwise it shows `--`.

The monitor selects the weekly window by `windowDurationMins = 10080`, preferring
the `codex` limit id. It does not assume that the weekly window is `primary` or
`secondary`. Ambiguous or invalid responses are rejected without creating a
recovery event. Raw stdout, stderr, account identifiers, and credentials are
never logged or sent to the site.

## Polling and notifications

The normal poll interval is 120 seconds and cannot be lower than 60 seconds.
`account/rateLimits/updated` is only a refresh hint; it is debounced and followed
by a fresh `account/rateLimits/read`. A notification by itself is never treated
as a reset.

The local monitor reads every two minutes but sends a webhook only for the initial
snapshot, a recovery candidate, a positive BANKED reset-count change, a
monitoring-structure change, or an eight-minute heartbeat after the last
successful send. Ordinary unchanged usage snapshots stay local, so the server
still receives a heartbeat before its ten-minute comparison gap.

A BANKED history event is created only when that explicit local reset-count
change matches an active broad Tibo BANKED notice within the existing
time-matching window. The notice is shown and affects the official probability
window before the distribution is observed; the random-reset history clock
changes only after the corroborated observation is stored.

The monitor sends the safe snapshot to:

`https://codex.gussuriworks.com/api/webhook/codex-usage`

with `Authorization: Bearer $env:CODEX_USAGE_MONITOR_SECRET`. The webhook rejects
unknown fields and stores the latest state in Supabase. It is fail-closed when
the secret or storage is unavailable.

## Recovery interpretation

The server compares the previous and current weekly snapshots. A recovery needs
both a decrease of at least one percentage point in `usedPercent` and a
`resetsAt` advance of at least one hour. The app-server timestamp may jitter by
a few seconds, so smaller changes are ignored. Raw `resetsAt` values are kept
unchanged for monitoring and later analysis. The first observation is a
baseline. An observation after a gap greater than 10 minutes or after a plan/limit
structure change is a rebase and does not create an event.

The previous scheduled reset is used only as context. An observation within 5
minutes of that schedule is marked `regular`. When a measured recovery is near
the regular schedule, the webhook stores a canonical `regular_completed`
history row.

An unexpected weekly recovery (`cycleHint === 'unexpected'`) observed by the
monitor is an immediate, confirmed random reset event. It does not wait for Tibo
posts. When observed:
1. A confirmed global reset history item is generated immediately.
2. `lastRandomResetAt` and the probability forecast clock are updated.
3. The Next.js data cache is revalidated so the public UI and API reflect the event immediately.

Subsequent Tibo posts (official notices, teasers, or completion confirmations)
serve as retrospective corroboration and enrichment (providing reasons, titles,
scopes, and source links) that merge into the canonical monitor event without
shifting execution time or creating duplicates.

### Personal Banked Reset vs Random Reset
If a weekly recovery occurs concurrently with an explicit decrease in banked
reset credits that is clearly within the active grant window (< 20 days since grant),
it is treated as personal banked reset consumption and suppressed from the public
random reset history. If indistinguishable from natural 30-day expiration or if
credit count is unavailable, the recovery fails open and publishes the random reset.

## Windows configuration and CLI debugging

Set the secret in the current user's environment without printing it:

```powershell
[Environment]::SetEnvironmentVariable('CODEX_USAGE_MONITOR_SECRET', '<value>', 'User')
```

Do not put the value in a task argument, GUI configuration file, or repository
file. The GUI inherits the current user's environment. The value is never
shown in the UI or logs.

For CLI debugging, run from the repository root:

```powershell
corepack pnpm run monitor:codex-usage
```

If the monitor is stopped, the server keeps the last state. After a gap over 10
minutes, the next snapshot rebases instead of inventing a reset. The GUI and CLI
both use the same monitor core.

## Troubleshooting

- `monitor_secret_missing`: set the User-scope `CODEX_USAGE_MONITOR_SECRET` and
  restart the GUI after the environment value is available.
- `app_server_spawn_failed`: verify the local Codex installation and
  `CODEX_CLI_PATH`.
- `snapshot_rejected`: the app-server response had no unambiguous weekly Codex
  window or failed validation; no reset was created.
- `webhook_http_*`: check the production URL and server configuration. The
  monitor retries by restarting the app-server session; it does not log the
  response body.

The database migration is
`20260811043509_add_codex_usage_recovery_observation.sql`. Both tables have RLS
enabled, no client-role grants or policies, and are intended for the service
role webhook only.
