# SAFE CHANGE with explicit schema compatibility acknowledgement. NO DB rollback.
[CmdletBinding(SupportsShouldProcess, ConfirmImpact='High')]
param([string]$Distribution='Ubuntu', [Parameter(Mandatory)][string]$WslReleasePath, [Parameter(Mandatory)][string]$Image, [switch]$SchemaCompatibilityConfirmed, [switch]$Apply)
. "$PSScriptRoot/common.ps1"
Initialize-Eventos $Distribution $WslReleasePath
Assert-EventosImage $Image
Assert-EventosCompose
if (!$SchemaCompatibilityConfirmed) { throw 'Confirm old application image supports the CURRENT forward-migrated schema. No automatic DB restore.' }
Write-Output 'Only EventOS app/worker will be recreated. PostgreSQL, networks, volumes and other projects are untouched.'
if ($Apply -and $PSCmdlet.ShouldProcess('eventos-production app/worker','Rollback application image only')) {
    Invoke-EventosWsl @('docker','image','inspect','--format','{{.Id}}',$Image)
    Invoke-EventosCompose @('up','-d','--no-deps','--no-build','--pull','never','app','worker') $Image
    Write-Output 'Persist the approved digest in the private env file before any later normal Compose invocation; run status and smoke.'
}
