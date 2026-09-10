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
snapshot, a confirmed recovery candidate, a positive BANKED reset-count change, a
monitoring-structure change, or an eight-minute heartbeat after the last
successful send. Ordinary unchanged usage snapshots stay local, so the server
still receives a heartbeat before its ten-minute comparison gap.

A positive BANKED reset-count change is sent immediately as an explicit count
change. Weekly quota recoveries, by contrast, follow a two-step confirmation state
machine to prevent false positives from transient app-server glitches.

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

## Recovery interpretation & Two-Step Confirmation State Machine

To prevent false alarms caused by temporary fluctuations in `usedPercent` or
`resetsAt` (such as the false-positive reset event `usage-reset-512a8b31-e43e-4f91-b5e6-7023b87e80ec`
on 2026-09-09), the local monitor does not post a recovery upon the first
anomalous observation. Instead, it employs a local confirmation state machine.

> **Incident Data Notice**:
> The raw app-server snapshot sequence for the 2026-09-09 incident (`512a8b31...`)
> was not recovered and remains unavailable:
> - **actual 9/9 sequence**: unavailable
> - **current regression**: synthetic analogue
>
> The synthetic regression represents the class of transient recovery-like observations
> that could produce a false reset. The exact 2026-09-09 snapshot sequence was not recovered.

### Refresh Trigger Distinction

Observations arrive via three distinct triggers:
- `poll`: Periodic client-side poll timer tick (default 120s, minimum 60s). Represents an independent, unprompted client observation.
- `notification`: Triggered by `account/rateLimits/updated` push notifications from the Codex app-server. Notifications may burst or arrive repeatedly during server glitches, internal syncs, or cluster failovers.
- `initial`: The initial handshake observation on session start.

### State Transitions

1. **Candidate Start (`recovery_candidate_started`)**:
   When an observation shows both a decrease of at least 1 percentage point
   (`baseline.usedPercent - snapshot.usedPercent >= 1`) and a schedule advance of
   at least 1 hour (`snapshot.resetsAt - baseline.resetsAt >= 3600s`), the monitor
   enters the candidate phase.
   - Candidates can be started by any trigger (`poll` or `notification`). This captures the earliest possible detection timestamp.
   - The pre-recovery baseline snapshot is **frozen** (`preRecoveryBaseline`).
   - The initial detection snapshot is recorded as `firstEvidenceSnapshot`.
   - The candidate start time is recorded.
   - **No webhook is sent yet** (`postReason: null`).
   - Audit log `recovery_candidate_started` is emitted.

2. **Temporal Independence & Trigger Guard (`MIN_RECOVERY_CONFIRMATION_DELAY_MS = 60s`)**:
   - Notifications arriving while a candidate is pending can update candidate progress or cancel it immediately upon reversion, but **cannot confirm** the candidate (`trigger === "notification"` always yields `postReason: null`).
   - Observations arriving within 60 seconds (`elapsedMs < MIN_RECOVERY_CONFIRMATION_DELAY_MS = 60_000ms`) cannot confirm the candidate prematurely.
   - This prevents false confirmations during multi-stage transient anomalies (e.g. drop at 0s, second notification at 50s or 90s, reversion at 90s or 110s).

3. **Confirmation (`recovery_candidate_confirmed`)**:
   A recovery candidate is confirmed **only** when an observation satisfies all of:
   - **Scheduled poll trigger**: `trigger === "poll"`, ensuring client-side independent verification rather than a server-pushed notification burst.
   - **Hold duration**: At least one minimum poll interval has elapsed (`elapsedMs >= MIN_RECOVERY_CONFIRMATION_DELAY_MS = 60s`, typically the scheduled poll at 120s).
   - **Usage drop maintained**: Usage remains recovered relative to the frozen `preRecoveryBaseline` (`preRecoveryBaseline.usedPercent - snapshot.usedPercent >= 1%`).
   - **Schedule forward maintained**: `resetsAt` remains forward relative to `preRecoveryBaseline.resetsAt` and consistent with `firstEvidenceSnapshot.resetsAt` (within 30-second clock jitter tolerance `RESET_AT_JITTER_TOLERANCE_SEC = 30s`).
   - **First Evidence Timestamp Preservation**: Upon confirmation, the snapshot enqueued and posted to the webhook is `firstEvidenceSnapshot`. This ensures that the public observatory reflects the exact original time of recovery (t=0s) rather than the confirmation-delay time (t=120s), keeping regular proximity and probability windows accurate.
   - Audit log `recovery_candidate_confirmed` is emitted.
   - The candidate is cleared and the baseline advances to the current snapshot.

| Scenario | Candidate Start | Intermediate Events | Confirmation Check | Result |
| :--- | :--- | :--- | :--- | :--- |
| **Transient Glitch (45s)** | Notification @ 0s | None | Reverts @ 45s (< 60s) | Cancelled (`usage_reverted`), 0 webhooks |
| **Notification Glitch (50s)** | Notification @ 0s | Notification @ 50s | Reverts @ 90s | Cancelled (`usage_reverted`), 0 webhooks |
| **Extended Glitch (90s)** | Notification @ 0s | Notification @ 90s | Reverts @ 110s | Cancelled (`usage_reverted`), 0 webhooks |
| **Genuine Recovery** | Notification or Poll @ 0s | Normal user activity | Poll @ 120s (>= 60s) | Confirmed, 1 webhook with t=0s snapshot |

4. **Cancellation (`recovery_candidate_cancelled`)**:
   A pending candidate is cancelled and cleared if:
   - **Usage reverted (`usage_reverted`)**: The current usage bounces back towards the
     baseline (`preRecoveryBaseline.usedPercent - snapshot.usedPercent < 1%`).
   - **Reset time reverted (`reset_at_reverted`)**: `resetsAt` reverts to the old
     schedule or deviates unexpectedly from `firstEvidenceSnapshot`.
   - **Structure change (`structure_change`)**: `planType`, `limitId`, or
     `windowDurationMins` changes. Candidate is cancelled and `structure_change` is posted.
   - **Comparison gap (`comparison_gap`)**: More than 10 minutes pass without observation.
   - **Stale observation (`stale_observation`)**: An out-of-order snapshot arrives.
   - When cancelled, `recovery_candidate_cancelled` is logged with the specific reason,
     the candidate is cleared, and baseline rebases to the latest snapshot. Zero webhooks
     are sent for the false alarm.

### Post-Recovery Usage Protection

If a user immediately begins heavy work following a reset (e.g. `80% -> 5% -> 8%`),
the confirmation check compares against the frozen `preRecoveryBaseline` (80%),
yielding `80% - 8% = 72% >= 1%`. The post-recovery consumption is correctly recognized
as valid quota usage rather than a cancellation.

### Noise Absorption & Regular Schedule Updates

- **Sub-1% fluctuations**: Tiny usage changes (< 1%) update the baseline smoothly without
  accumulating across polls into a false reset candidate.
- **Schedule-only updates**: When `resetsAt` advances without quota recovery (e.g. standard
  rolling weekly window updates), the baseline advances its schedule without triggering a candidate.

### Observatory Server Processing

The server compares incoming weekly snapshots against the DB baseline.
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
