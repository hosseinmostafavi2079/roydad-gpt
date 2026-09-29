$ErrorActionPreference = 'Stop'
$taskName = 'EventOS Local'
if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    Write-Host 'EventOS Local autostart was removed. Docker data was preserved.'
} else {
    Write-Host 'EventOS Local autostart is not installed.'
}
