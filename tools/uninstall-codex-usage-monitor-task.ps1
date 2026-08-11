[CmdletBinding()]
param(
  [string]$TaskName = "Codex Reset Observatory Usage Monitor"
)

$ErrorActionPreference = "Stop"

$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($null -ne $task) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Output "Removed the current-user Codex usage monitor task: $TaskName"
} else {
  Write-Output "The Codex usage monitor task was not installed."
}
