# SAFE CHANGE: creates a new backup directory; never overwrites or restores.
[CmdletBinding(SupportsShouldProcess, ConfirmImpact='High')]
param([string]$Distribution='Ubuntu', [Parameter(Mandatory)][string]$WslReleasePath, [Parameter(Mandatory)][string]$WindowsBackupDirectory, [switch]$Apply)
. "$PSScriptRoot/common.ps1"
Initialize-Eventos $Distribution $WslReleasePath
Assert-EventosCompose
if (![IO.Path]::IsPathRooted($WindowsBackupDirectory) -or !(Test-Path -LiteralPath $WindowsBackupDirectory -PathType Container)) { throw 'Supply an existing absolute private Windows backup directory with restricted ACL.' }
$backupPath = (Invoke-EventosWsl @('wslpath','-u',(Resolve-Path -LiteralPath $WindowsBackupDirectory).Path)) -join ''
if ($backupPath -notmatch '^/[A-Za-z0-9_./-]+$') { throw 'Use a backup path without spaces/shell metacharacters.' }
Write-Output 'Backups contain sensitive personal data. Protect the destination ACL, encrypt offline copies and test restoration separately.'
if ($Apply -and $PSCmdlet.ShouldProcess($WindowsBackupDirectory,'Create new EventOS database and local media backup')) {
    Invoke-EventosWsl @('bash', "$script:EventosReleasePath/deployment/windows-iis/backup.sh", $script:EventosReleasePath, $backupPath)
}
