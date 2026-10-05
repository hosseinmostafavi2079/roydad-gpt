Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Initialize-Eventos {
    param([string]$Distribution, [string]$ReleasePath)
    if ($Distribution -notmatch '^[A-Za-z0-9_.-]+$' -or $ReleasePath -notmatch '^/[A-Za-z0-9_./-]+$' -or $ReleasePath.Contains('/../')) { throw 'Invalid WSL distribution/release path.' }
    $script:EventosDistribution = $Distribution
    $script:EventosReleasePath = $ReleasePath.TrimEnd('/')
    $script:EventosEnv = "$script:EventosReleasePath/deployment/windows-iis/.env.production"
    $script:EventosCompose = "$script:EventosReleasePath/deployment/windows-iis/compose.production.yaml"
}

function Invoke-EventosWsl {
    param([string[]]$Arguments)
    $result = & wsl.exe -d $script:EventosDistribution -u root -- @Arguments 2>$null
    if ($LASTEXITCODE -ne 0) { throw 'EventOS WSL command failed; no environment/secrets dumped.' }
    return $result
}

function Assert-EventosImage {
    param([string]$Image)
    if ($Image -notmatch '^[a-z0-9][a-z0-9./:_-]*@sha256:[a-f0-9]{64}$') { throw 'An immutable image reference with sha256 digest is required.' }
}

function Invoke-EventosCompose {
    param([string[]]$Arguments, [string]$Image = '')
    $prefix = @()
    if ($Image) { Assert-EventosImage $Image; $prefix = @('env', "EVENTOS_IMAGE=$Image") }
    Invoke-EventosWsl ($prefix + @('docker', 'compose', '--project-name', 'eventos-production', '--env-file', $script:EventosEnv, '-f', $script:EventosCompose) + $Arguments)
}

function Assert-EventosCompose {
    $config = ((Invoke-EventosCompose @('config', '--format', 'json')) -join "`n") | ConvertFrom-Json
    $services = @($config.services.PSObject.Properties.Name | Sort-Object)
    if (($services -join ',') -ne 'app,postgres,worker') { throw 'Only EventOS app/worker/postgres services are allowed.' }
    if ($config.name -ne 'eventos-production') { throw 'Invalid Compose project.' }
    Assert-EventosImage $config.services.app.image
    if ($config.services.worker.image -ne $config.services.app.image) { throw 'App and worker images must match.' }
    foreach ($service in $config.services.PSObject.Properties) {
        if ($service.Value.PSObject.Properties.Name -contains 'container_name') { throw 'Manual container names forbidden.' }
        $ports = @()
        if ($service.Value.PSObject.Properties.Name -contains 'ports') { $ports = @($service.Value.ports) }
        if ($service.Name -ne 'app' -and $ports.Count) { throw 'Private services must not publish ports.' }
        if ($service.Name -eq 'app') {
            if ($ports.Count -ne 1 -or $ports[0].host_ip -ne '127.0.0.1' -or [string]$ports[0].published -ne '18280' -or $ports[0].target -ne 3000) { throw 'App must bind exclusively to 127.0.0.1:18280:3000.' }
        }
    }
    foreach ($resource in @($config.networks.PSObject.Properties) + @($config.volumes.PSObject.Properties)) {
        if (!$resource.Value.name.StartsWith('eventos-production_') -or (($resource.Value.PSObject.Properties.Name -contains 'external') -and $resource.Value.external)) { throw 'External or non-EventOS resources forbidden.' }
    }
    Write-Output 'EventOS Compose isolation valid; protected ports 18080/18180 are not used.'
}
