$ErrorActionPreference = 'Stop'
$taskName = 'EventOS Local'
$startupScript = Join-Path $PSScriptRoot 'start-local.ps1'
if (-not (Test-Path -LiteralPath $startupScript)) { throw 'EventOS startup script is missing.' }
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'Docker CLI is not available.' }

$quotedScript = '"' + $startupScript + '"'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ("-NoProfile -NonInteractive -ExecutionPolicy Bypass -File $quotedScript")
$user = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $user
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 15)
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
Write-Host 'EventOS Local autostart is installed for this Windows user.'
Write-Host 'Enable "Start Docker Desktop when you sign in" in Docker Desktop settings.'
