# Operator helper only: default dry-run. Never embeds unattended credentials.
[CmdletBinding(SupportsShouldProcess, ConfirmImpact='High')]
param([Parameter(Mandatory)][string]$TaskUser, [string]$Distribution='Ubuntu', [Parameter(Mandatory)][string]$WslReleasePath, [Parameter(Mandatory)][string]$WindowsBackupDirectory, [switch]$Apply)
. "$PSScriptRoot/common.ps1"
Initialize-Eventos $Distribution $WslReleasePath
$current = [Security.Principal.WindowsIdentity]::GetCurrent().Name
if (![string]::Equals($TaskUser,$current,[StringComparison]::OrdinalIgnoreCase) -or $TaskUser -match '(^|\\)(SYSTEM|LOCAL SERVICE|NETWORK SERVICE)$') { throw 'Explicit current WSL-owning interactive user required; unattended credentials need separate operator setup.' }
$distributions = ((& wsl.exe --list --quiet 2>$null) -join "`n").Replace([string][char]0,'')
if ($LASTEXITCODE -ne 0 -or $distributions -notmatch "(?m)^$([regex]::Escape($Distribution))\s*$") { throw 'Current user must own the selected WSL distribution.' }
$scriptPath = (Resolve-Path -LiteralPath "$PSScriptRoot/run-backup-maintenance.ps1").Path
if ($scriptPath -notmatch '^[A-Za-z]:\\[A-Za-z0-9_.\\-]+$' -or $WindowsBackupDirectory -notmatch '^[A-Za-z]:\\[A-Za-z0-9_.\\-]+$') { throw 'Explicit safe absolute Windows paths required.' }
$taskName = 'EventOS-Backup-Maintenance'
if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) { throw 'Task already exists; review explicitly rather than overwrite.' }
if ($Apply -and $PSCmdlet.ShouldProcess($taskName,'Register interactive EventOS maintenance task every 15 minutes')) {
    # Validated path/distribution grammars exclude quotes and command metacharacters.
    # -Command parses $false as a boolean; PowerShell 5.1 -File passes it as text.
    $arguments = '-NoProfile -NonInteractive -Command "& ''{0}'' -Distribution ''{1}'' -WslReleasePath ''{2}'' -WindowsBackupDirectory ''{3}'' -Apply -Confirm:$false"' -f $scriptPath,$Distribution,$WslReleasePath,$WindowsBackupDirectory
    $action = New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -Argument $arguments
    $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 15) -RepetitionDuration (New-TimeSpan -Days 3650)
    $principal = New-ScheduledTaskPrincipal -UserId $TaskUser -LogonType Interactive -RunLevel Highest
    $settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 2)
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings | Out-Null
}
Write-Output 'EventOS helper complete. Interactive WSL-owning user must stay logged on; no passwords embedded. Unattended credential setup requires separate operator action.'
