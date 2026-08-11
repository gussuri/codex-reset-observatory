[CmdletBinding()]
param(
  [string]$TaskName = "Codex Reset Observatory Usage Monitor"
)

$ErrorActionPreference = "Stop"

$repoPath = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
if (-not (Test-Path (Join-Path $repoPath "package.json"))) {
  throw "The repository root could not be verified."
}

# The scheduled task inherits the current user's environment. Do not put the
# secret in an action argument, task description, or log output.
$userSecret = [Environment]::GetEnvironmentVariable("CODEX_USAGE_MONITOR_SECRET", "User")
if ([string]::IsNullOrWhiteSpace($userSecret)) {
  throw "Set CODEX_USAGE_MONITOR_SECRET in the current user's environment before installing the task."
}

$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$commandShell = Join-Path $env:SystemRoot "System32\cmd.exe"
$action = New-ScheduledTaskAction `
  -Execute $commandShell `
  -Argument '/d /c "corepack pnpm run monitor:codex-usage"' `
  -WorkingDirectory $repoPath
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser
$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 2)
$principal = New-ScheduledTaskPrincipal `
  -UserId $currentUser `
  -LogonType Interactive `
  -RunLevel Limited

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Principal $principal `
  -Force | Out-Null

Write-Output "Installed the current-user Codex usage monitor task: $TaskName"
