# Host-only, one invocation processes zero or one job. No scheduling/cleanup.
[CmdletBinding(SupportsShouldProcess, ConfirmImpact='High')]
param([string]$Distribution='Ubuntu', [Parameter(Mandatory)][string]$WslReleasePath, [Parameter(Mandatory)][string]$WindowsBackupDirectory, [switch]$Apply)
. "$PSScriptRoot/common.ps1"
Initialize-Eventos $Distribution $WslReleasePath
$distributions = ((& wsl.exe --list --quiet 2>$null) -join "`n").Replace([string][char]0,'')
if ($LASTEXITCODE -ne 0 -or $distributions -notmatch "(?m)^$([regex]::Escape($Distribution))\s*$") { throw 'WSL distribution unavailable.' }
Invoke-EventosWsl @('test','-f',"$script:EventosReleasePath/deployment/windows-iis/run-backup-job.sh")
Invoke-EventosWsl @('test','-f',$script:EventosEnv)
Assert-EventosCompose
if (![IO.Path]::IsPathRooted($WindowsBackupDirectory) -or !(Test-Path -LiteralPath $WindowsBackupDirectory -PathType Container)) { throw 'Existing absolute private backup directory required.' }
$nativeBackupDirectory = [IO.Path]::GetFullPath((Resolve-Path -LiteralPath $WindowsBackupDirectory).Path).Replace('\','/')
if ($nativeBackupDirectory -notmatch '^[A-Za-z]:/[A-Za-z0-9_./-]*$') { throw 'Unsafe backup directory.' }
$backupPath = (Invoke-EventosWsl @('wslpath','-u',$nativeBackupDirectory)) -join ''
if ($backupPath -notmatch '^/[A-Za-z0-9_./-]+$') { throw 'Unsafe WSL backup directory.' }
Invoke-EventosWsl @('test','-d',$backupPath)
if ($Apply -and $PSCmdlet.ShouldProcess('eventos-production','Process at most one manual backup job')) {
    Invoke-EventosWsl @('bash',"$script:EventosReleasePath/deployment/windows-iis/run-backup-job.sh",$script:EventosReleasePath,$backupPath)
}
