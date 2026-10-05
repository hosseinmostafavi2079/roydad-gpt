# READ-ONLY; exclusively the EventOS Compose project.
[CmdletBinding()]
param([string]$Distribution = 'Ubuntu', [Parameter(Mandatory)][string]$WslReleasePath)
. "$PSScriptRoot/common.ps1"
Initialize-Eventos $Distribution $WslReleasePath
Assert-EventosCompose
Invoke-EventosCompose @('ps','--all','--format','json')
Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object LocalPort -eq 18280 | Select-Object LocalAddress,LocalPort,OwningProcess
