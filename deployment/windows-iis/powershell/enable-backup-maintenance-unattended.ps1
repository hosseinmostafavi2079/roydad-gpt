# Explicit operator helper. No installation, deployment or unattended default.
[CmdletBinding(SupportsShouldProcess, ConfirmImpact='High')]
param(
    [Parameter(Mandatory)][string]$ReleasePath,
    [Parameter(Mandatory)][string]$WslReleasePath,
    [Parameter(Mandatory)][string]$WindowsBackupDirectory,
    [string]$Distribution='Ubuntu',
    [System.Management.Automation.PSCredential]$Credential,
    [switch]$Apply
)
. "$PSScriptRoot/common.ps1"

function Resolve-EventosAccountSid {
    param([string]$Account)
    if ($Account -match '^S-1-') { return ([Security.Principal.SecurityIdentifier]$Account).Value }
    return ([Security.Principal.NTAccount]$Account).Translate([Security.Principal.SecurityIdentifier]).Value
}
function Get-EventosTaskSnapshot {
    param($Task)
    # XML is kept in memory only. Compare complete action/trigger/settings definitions.
    [xml]$definition = Export-ScheduledTask -InputObject $Task -ErrorAction Stop
    return @($definition.Task.Actions.OuterXml,$definition.Task.Triggers.OuterXml,$definition.Task.Settings.OuterXml) -join "`n"
}
function Assert-EventosMaintenanceTask {
    param($Task,[string]$ExpectedLogon,[string]$Snapshot='')
    if (!$Task -or $Task.TaskName -cne $taskName -or $Task.TaskPath -cne '\' -or @($Task.Actions).Count -ne 1) { throw 'Expected isolated EventOS maintenance task required.' }
    $action = @($Task.Actions)[0]
    if (![string]::Equals([string]$action.Execute,$expectedExecutable,[StringComparison]::OrdinalIgnoreCase) -or [string]$action.Arguments -cne $expectedArguments -or [string]$action.WorkingDirectory -ne '') { throw 'Unexpected maintenance action; no conversion performed.' }
    $sid = Resolve-EventosAccountSid ([string]$Task.Principal.UserId)
    if ($sid -ne $currentSid -or $sid -in @('S-1-5-18','S-1-5-19','S-1-5-20')) { throw 'Task must retain the current WSL-owning Windows account.' }
    if ([string]$Task.Principal.LogonType -notin @('Interactive','Password') -or ($ExpectedLogon -and [string]$Task.Principal.LogonType -ne $ExpectedLogon)) { throw 'Unexpected task logon type.' }
    if ([string]$Task.Principal.RunLevel -ne 'Highest' -or !$Task.Settings.Enabled -or [string]$Task.State -in @('Running','Queued','Disabled')) { throw 'Enabled idle task with Highest run level required.' }
    $triggers = @($Task.Triggers)
    if ($triggers.Count -ne 1 -or [string]$triggers[0].Repetition.Interval -ne 'PT15M') { throw 'Existing 15-minute maintenance trigger required.' }
    if ($Snapshot -and (Get-EventosTaskSnapshot $Task) -cne $Snapshot) { throw 'Task action, trigger or settings changed unexpectedly.' }
}

Initialize-Eventos $Distribution $WslReleasePath
if ($ReleasePath -notmatch '^[A-Za-z]:\\[A-Za-z0-9_.\\-]+$' -or $WindowsBackupDirectory -notmatch '^[A-Za-z]:\\[A-Za-z0-9_.\\-]+$') { throw 'Safe absolute Windows paths required.' }
if (!(Test-Path -LiteralPath $ReleasePath -PathType Container) -or !(Test-Path -LiteralPath $WindowsBackupDirectory -PathType Container)) { throw 'Existing release and private backup directories required.' }
$resolvedRelease = [IO.Path]::GetFullPath((Resolve-Path -LiteralPath $ReleasePath).Path).TrimEnd('\')
$scriptPath = "$resolvedRelease\deployment\windows-iis\powershell\run-backup-maintenance.ps1"
foreach ($file in @($scriptPath,"$resolvedRelease\deployment\windows-iis\compose.production.yaml","$resolvedRelease\deployment\windows-iis\run-backup-maintenance.sh","$resolvedRelease\deployment\windows-iis\prune-backup.sh")) {
    if (!(Test-Path -LiteralPath $file -PathType Leaf)) { throw 'Expected EventOS release files required.' }
}
if (![string]::Equals((Resolve-Path -LiteralPath $scriptPath).Path,$scriptPath,[StringComparison]::OrdinalIgnoreCase)) { throw 'Unexpected release script path.' }
$mappedRelease = ((Invoke-EventosWsl @('wslpath','-w',$script:EventosReleasePath)) -join '').Trim()
if (![string]::Equals([IO.Path]::GetFullPath($mappedRelease).TrimEnd('\'),$resolvedRelease,[StringComparison]::OrdinalIgnoreCase)) { throw 'Windows and WSL release identity mismatch.' }
$acl = Get-Acl -LiteralPath $WindowsBackupDirectory
foreach ($entry in $acl.Access) {
    $sid = $entry.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
    if ($entry.AccessControlType -eq 'Allow' -and $sid -in @('S-1-1-0','S-1-5-11','S-1-5-32-545')) { throw 'Backup directory ACL must exclude broad user groups.' }
}
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$currentUser = $identity.Name
$currentSid = $identity.User.Value
if ($currentSid -in @('S-1-5-18','S-1-5-19','S-1-5-20')) { throw 'Service identities cannot own this task.' }
$distributions = ((& wsl.exe --list --quiet 2>$null) -join "`n").Replace([string][char]0,'')
if ($LASTEXITCODE -ne 0 -or $distributions -notmatch "(?m)^$([regex]::Escape($Distribution))\s*$") { throw 'Current user must own the selected WSL distribution.' }
foreach ($file in @($script:EventosEnv,"$script:EventosReleasePath/deployment/windows-iis/run-backup-maintenance.sh","$script:EventosReleasePath/deployment/windows-iis/prune-backup.sh")) { Invoke-EventosWsl @('test','-f',$file) | Out-Null }
$taskName = 'EventOS-Backup-Maintenance'
$expectedExecutable = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$expectedArguments = '-NoProfile -NonInteractive -Command "& ''{0}'' -Distribution ''{1}'' -WslReleasePath ''{2}'' -WindowsBackupDirectory ''{3}'' -Apply -Confirm:$false"' -f $scriptPath,$Distribution,$WslReleasePath,$WindowsBackupDirectory
$task = Get-ScheduledTask -TaskName $taskName -TaskPath '\' -ErrorAction Stop
Assert-EventosMaintenanceTask $task ''
$snapshot = Get-EventosTaskSnapshot $task
if (!$Apply) { Write-Output 'Validated only: would convert the existing EventOS maintenance task to Password logon for the same WSL-owning account. No credential prompt or task change.'; return }
if (!$PSCmdlet.ShouldProcess($taskName,'Convert to Password logon and verify a new maintenance run; roll back to Interactive on failure')) { return }
if (!$Credential) { $Credential = Get-Credential -UserName $currentUser -Message 'Run the existing EventOS backup task as the same WSL-owning account without interactive logon.' }
if (!$Credential -or (Resolve-EventosAccountSid $Credential.UserName) -ne $currentSid) { throw 'Credential must resolve to the same current Windows account SID.' }
# Pre-create rollback principal; never replace actions, triggers or settings.
$rollbackPrincipal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Highest
$previousRun = (Get-ScheduledTaskInfo -TaskName $taskName -TaskPath '\' -ErrorAction Stop).LastRunTime
# Recheck after a potentially long credential prompt before any mutation.
Assert-EventosMaintenanceTask (Get-ScheduledTask -TaskName $taskName -TaskPath '\' -ErrorAction Stop) '' $snapshot
$mutationAttempted = $false
$plainPassword = $null
$passwordBuffer = [IntPtr]::Zero
try {
    try {
        $passwordBuffer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Credential.Password)
        $plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordBuffer)
        $mutationAttempted = $true
        # Existing definition retained; only run-as credentials are updated.
        Set-ScheduledTask -TaskName $taskName -TaskPath '\' -User $currentUser -Password $plainPassword -ErrorAction Stop 2>$null | Out-Null
    } finally {
        $plainPassword = $null
        if ($passwordBuffer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordBuffer); $passwordBuffer = [IntPtr]::Zero }
        $Credential = $null
    }
    Assert-EventosMaintenanceTask (Get-ScheduledTask -TaskName $taskName -TaskPath '\' -ErrorAction Stop) 'Password' $snapshot
    Start-ScheduledTask -TaskName $taskName -TaskPath '\' -ErrorAction Stop
    $deadline = (Get-Date).AddSeconds(120)
    $verified = $false
    do {
        $info = Get-ScheduledTaskInfo -TaskName $taskName -TaskPath '\' -ErrorAction Stop
        $observed = Get-ScheduledTask -TaskName $taskName -TaskPath '\' -ErrorAction Stop
        if ($info.LastRunTime -gt $previousRun -and [string]$observed.State -notin @('Running','Queued')) {
            if ($info.LastTaskResult -ne 0) { throw 'Maintenance test run failed.' }
            Assert-EventosMaintenanceTask $observed 'Password' $snapshot
            $verified = $true
            break
        }
        if ((Get-Date) -ge $deadline) { break }
        Start-Sleep -Seconds 2
    } while ((Get-Date) -lt $deadline)
    if (!$verified) { throw 'Fresh maintenance run not verified within 120 seconds.' }
    Write-Output 'EventOS maintenance verified: same account, Password logon, Highest, unchanged definition, fresh run and LastTaskResult=0. Reboot/no-login execution requires separate operator testing.'
} catch {
    # Never expose exception details: ScheduledTasks failures may contain sensitive inputs.
    $rollbackSucceeded = $false
    if ($mutationAttempted) {
        try {
            Set-ScheduledTask -TaskName $taskName -TaskPath '\' -Principal $rollbackPrincipal -ErrorAction Stop 2>$null | Out-Null
            $restored = Get-ScheduledTask -TaskName $taskName -TaskPath '\' -ErrorAction Stop
            # A timed-out task can still be running: rollback changes future logon,
            # never stops a backup or alters its action/trigger/settings.
            if ([string]$restored.Principal.LogonType -ne 'Interactive' -or [string]$restored.Principal.RunLevel -ne 'Highest' -or (Resolve-EventosAccountSid $restored.Principal.UserId) -ne $currentSid -or (Get-EventosTaskSnapshot $restored) -cne $snapshot -or !$restored.Settings.Enabled) { throw 'Rollback verification failed.' }
            $rollbackSucceeded = $true
        } catch { $rollbackSucceeded = $false }
    }
    if ($rollbackSucceeded) { throw 'Unattended setup failed. Interactive rollback succeeded; operator review required.' }
    throw 'Unattended setup failed. Interactive rollback FAILED or could not be verified; immediate operator review required.'
} finally {
    $plainPassword = $null
    $Credential = $null
    if ($passwordBuffer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordBuffer) }
}
