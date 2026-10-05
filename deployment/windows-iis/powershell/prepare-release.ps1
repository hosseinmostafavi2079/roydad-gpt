# SAFE CHANGE only with -Apply: pull an immutable EventOS image; never start it.
[CmdletBinding(SupportsShouldProcess, ConfirmImpact='High')]
param([string]$Distribution='Ubuntu', [Parameter(Mandatory)][string]$WslReleasePath, [Parameter(Mandatory)][string]$Image, [switch]$Apply)
. "$PSScriptRoot/common.ps1"
Initialize-Eventos $Distribution $WslReleasePath
Assert-EventosImage $Image
Assert-EventosCompose
Write-Output "Stage only: $Image. No live image/env switch or migration."
if ($Apply -and $PSCmdlet.ShouldProcess('EventOS immutable image cache','Pull release image')) { Invoke-EventosWsl @('docker','pull',$Image) }
