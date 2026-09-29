$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)

for ($attempt = 1; $attempt -le 60; $attempt++) {
    docker info --format '{{.ServerVersion}}' *> $null
    if ($LASTEXITCODE -eq 0) {
        docker compose up -d --no-build
        if ($LASTEXITCODE -ne 0) { throw 'EventOS local containers did not start.' }
        exit 0
    }
    Start-Sleep -Seconds 5
}
throw 'Docker Desktop did not become ready within five minutes.'
