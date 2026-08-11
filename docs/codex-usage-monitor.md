# Codex usage monitor runbook

The local monitor observes the weekly usage window exposed by the official
Codex app-server. It is an independent corroboration signal, not a replacement
for Tibo's reset confirmation.

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

The monitor sends the safe snapshot to:

`https://codex.gussuriworks.com/api/webhook/codex-usage`

with `Authorization: Bearer $env:CODEX_USAGE_MONITOR_SECRET`. The webhook rejects
unknown fields and stores the latest state in Supabase. It is fail-closed when
the secret or storage is unavailable.

## Recovery interpretation

The server compares the previous and current weekly snapshots. A recovery needs
both a decrease of at least one percentage point in `usedPercent` and a forward
move in `resetsAt`. The first observation is a baseline. An observation after a
gap greater than 10 minutes is a rebase and does not create an event.

The previous scheduled reset is used only as context. An observation within 60
minutes of that schedule is marked `regular` when there is no active official
notice, or `unknown` with strong confidence when an official notice is active.
An off-schedule recovery is `unexpected`; it is strong only when an active
official notice corroborates it. Medium observations are stored for audit but do
not change the public display.

Strong, non-regular observations are public only as a provisional derived state
for 90 minutes. The UI says that usage recovery was observed on the monitored
Codex account and that Tibo confirmation is pending. It never says that a global
reset is confirmed. The provisional state is excluded from reset history,
probability learning, and prospective targets.

When a formal Tibo `reset_executed` signal arrives, the nearest strong or medium
non-regular observation within 90 minutes is marked `confirmed`. The reverse
order is also reconciled when a usage observation arrives after Tibo. The
canonical global reset time remains the first trusted Tibo completion post;
the local observation timestamp is never used as the formal history timestamp.

## Windows Task Scheduler

Set the secret in the current user's environment without printing it:

```powershell
[Environment]::SetEnvironmentVariable('CODEX_USAGE_MONITOR_SECRET', '<value>', 'User')
```

Do not put the value in a task argument or repository file. Then install a
current-user, non-administrator logon task from the repository root:

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\install-codex-usage-monitor-task.ps1
```

The task runs `corepack pnpm run monitor:codex-usage`, starts at the user's logon,
and restarts up to three times with a two-minute interval. The installer refuses
to register the task until the User-scope secret exists. Verify only the task
state, never the task action's environment:

```powershell
Get-ScheduledTask -TaskName 'Codex Reset Observatory Usage Monitor'
Get-ScheduledTaskInfo -TaskName 'Codex Reset Observatory Usage Monitor'
```

To stop and remove it:

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\uninstall-codex-usage-monitor-task.ps1
```

If the monitor is stopped, the server keeps the last state. After a gap over 10
minutes, the next snapshot rebases instead of inventing a reset.

## Troubleshooting

- `monitor_secret_missing`: set the User-scope `CODEX_USAGE_MONITOR_SECRET` and
  start a new user session before running the task.
- `app_server_spawn_failed`: verify the local Codex installation and
  `CODEX_CLI_PATH`.
- `snapshot_rejected`: the app-server response had no unambiguous weekly Codex
  window or failed validation; no reset was created.
- `webhook_http_*`: check the production URL and server configuration. The
  monitor retries by restarting the app-server session; it does not log the
  response body.

The database migration is
`20260811060000_add_codex_usage_recovery_observation.sql`. Both tables have RLS
enabled, no client-role grants or policies, and are intended for the service
role webhook only.
