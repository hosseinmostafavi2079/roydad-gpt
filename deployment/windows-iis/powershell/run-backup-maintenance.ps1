# Host-only scheduling/retention. No task installation or deployment here.
[CmdletBinding(SupportsShouldProcess, ConfirmImpact='High')]
param([string]$Distribution='Ubuntu', [Parameter(Mandatory)][string]$WslReleasePath, [Parameter(Mandatory)][string]$WindowsBackupDirectory, [switch]$Apply)
. "$PSScriptRoot/common.ps1"
Initialize-Eventos $Distribution $WslReleasePath
$distributions = ((& wsl.exe --list --quiet 2>$null) -join "`n").Replace([string][char]0,'')
if ($LASTEXITCODE -ne 0 -or $distributions -notmatch "(?m)^$([regex]::Escape($Distribution))\s*$") { throw 'WSL distribution unavailable.' }
foreach ($file in @($script:EventosEnv,"$script:EventosReleasePath/deployment/windows-iis/run-backup-maintenance.sh","$script:EventosReleasePath/deployment/windows-iis/prune-backup.sh")) { Invoke-EventosWsl @('test','-f',$file) }
Assert-EventosCompose
if (![IO.Path]::IsPathRooted($WindowsBackupDirectory) -or !(Test-Path -LiteralPath $WindowsBackupDirectory -PathType Container)) { throw 'Existing private Windows backup directory required.' }
# Reject broad access: NTFS ACLs are authoritative on Windows-mounted WSL roots.
$acl = Get-Acl -LiteralPath $WindowsBackupDirectory
foreach ($entry in $acl.Access) {
    $sid = $entry.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
    if ($entry.AccessControlType -eq 'Allow' -and $sid -in @('S-1-1-0','S-1-5-11','S-1-5-32-545')) { throw 'Backup directory ACL must exclude broad user groups.' }
}
$native = [IO.Path]::GetFullPath((Resolve-Path -LiteralPath $WindowsBackupDirectory).Path).Replace('\','/')
if ($native -notmatch '^[A-Za-z]:/[A-Za-z0-9_./-]*$') { throw 'Unsafe backup directory.' }
$backupPath = (Invoke-EventosWsl @('wslpath','-u',$native)) -join ''
if ($backupPath -notmatch '^/[A-Za-z0-9_./-]+$') { throw 'Unsafe WSL directory.' }
Invoke-EventosWsl @('test','-d',$backupPath)
if ($Apply -and $PSCmdlet.ShouldProcess('eventos-production','Evaluate schedule, execute one job and prune at most ten selected backups')) {
    Invoke-EventosWsl @('env','EVENTOS_WINDOWS_BACKUP_ACL_VERIFIED=1','bash',"$script:EventosReleasePath/deployment/windows-iis/run-backup-maintenance.sh",$script:EventosReleasePath,$backupPath)
}
