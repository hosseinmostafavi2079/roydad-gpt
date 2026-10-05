# READ-ONLY: no installations, Docker starts, networking or IIS mutations.
[CmdletBinding()]
param([string]$Distribution = 'Ubuntu', [Parameter(Mandatory)][string]$WslReleasePath, [Parameter(Mandatory)][string]$WindowsEnvFile)
. "$PSScriptRoot/common.ps1"
Initialize-Eventos $Distribution $WslReleasePath
$problems = [System.Collections.Generic.List[string]]::new()
function Check-ReadOnly { param([string]$Name, [scriptblock]$Check); try { & $Check; Write-Output "PASS: $Name" } catch { $problems.Add($Name); Write-Output "FAIL: $Name (read-only check failed)" } }
Check-ReadOnly 'Windows Server 2022' {
    $os = Get-CimInstance Win32_OperatingSystem
    Write-Output "$($os.Caption); version $($os.Version); free memory KB $($os.FreePhysicalMemory)"
    if ($os.Caption -notmatch 'Windows Server 2022' -or [int64]$os.FreePhysicalMemory -lt 2097152) { throw 'Unsupported OS or less than 2 GiB free RAM.' }
}
Check-ReadOnly 'C: capacity (10 GiB free minimum)' { $disk = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='C:'"; Write-Output "C: free bytes $($disk.FreeSpace)"; if ($disk.FreeSpace -lt 10GB) { throw 'Disk space' } }
Check-ReadOnly 'IIS, ARR, URL Rewrite and current bindings' {
    Import-Module WebAdministration
    $modules = @(Get-WebGlobalModule | Select-Object -ExpandProperty Name)
    if ('RewriteModule' -notin $modules -or 'ApplicationRequestRouting' -notin $modules) { throw 'Missing IIS modules' }
    Get-Website | Select-Object name,state
    Get-WebBinding | Select-Object protocol,bindingInformation
    $proxyEnabled = Get-WebConfigurationProperty -PSPath 'MACHINE/WEBROOT/APPHOST' -Filter 'system.webServer/proxy' -Name 'enabled'
    $preserveHost = Get-WebConfigurationProperty -PSPath 'MACHINE/WEBROOT/APPHOST' -Filter 'system.webServer/proxy' -Name 'preserveHostHeader'
    Write-Output "ARR enabled=$($proxyEnabled.Value); preserveHostHeader=$($preserveHost.Value)"
    if (!$proxyEnabled.Value -or !$preserveHost.Value) { throw 'ARR not ready; do not change global settings without reviewing live sites.' }
}
Check-ReadOnly 'Windows listeners; 18280 must be free' {
    $listeners = @(Get-NetTCPConnection -State Listen)
    $listeners | Where-Object LocalPort -in @(80,443,18080,18180,18280) | Select-Object LocalAddress,LocalPort,OwningProcess
    Write-Output 'PROTECTED LIVE: 18080 PricePilot; 18180 ServerOps. Never modify either.'
    foreach ($owner in @($listeners | Where-Object LocalPort -in @(80,443) | Select-Object -ExpandProperty OwningProcess -Unique)) { Get-Process -Id $owner | Select-Object Id,ProcessName }
    if ($listeners | Where-Object LocalPort -eq 18280) { throw 'Port 18280 occupied; no alternative selected.' }
}
Check-ReadOnly 'WSL2 distribution exists' {
    $list = ((& wsl.exe --list --verbose 2>$null) -join "`n").Replace([string][char]0,'')
    Write-Output $list
    if ($LASTEXITCODE -ne 0 -or $list -notmatch "(?m)\b$([regex]::Escape($Distribution))\s+\S+\s+2\s*$") { throw 'WSL2 distro required' }
}
Check-ReadOnly 'WSL disk (10 GiB free minimum), memory and port' {
    Invoke-EventosWsl @('df','-h',$script:EventosReleasePath)
    Invoke-EventosWsl @('free','-m')
    $diskLines = @(Invoke-EventosWsl @('df','-Pk',$script:EventosReleasePath))
    $available = (($diskLines[-1].Trim() -split '\s+')[3])
    if ([int64]$available -lt 10485760) { throw 'WSL disk space' }
    if (@(Invoke-EventosWsl @('ss','-H','-ltn','sport = :18280')).Count) { throw 'WSL port occupied' }
}
Check-ReadOnly 'Docker Engine and Compose (no container inspection/secrets)' {
    Invoke-EventosWsl @('docker','info','--format','{{.ServerVersion}}')
    Invoke-EventosWsl @('docker','compose','version','--short')
    Invoke-EventosWsl @('docker','ps','--format','{{.Names}} | {{.Status}} | {{.Ports}}')
}
Check-ReadOnly 'Production env (Node 22+ required on operator Windows)' {
    & node "$PSScriptRoot/../../../scripts/windows-iis-preflight.mjs" --env-file $WindowsEnvFile
    if ($LASTEXITCODE -ne 0) { throw 'Production prerequisites missing' }
    $wslPath = (Invoke-EventosWsl @('wslpath','-u',(Resolve-Path -LiteralPath $WindowsEnvFile).Path)) -join ''
    if ($wslPath -ne $script:EventosEnv) { throw 'Windows/WSL env file paths must identify the same file.' }
}
Check-ReadOnly 'Compose isolation' { Assert-EventosCompose }
if ($problems.Count) { throw "Preflight FAILED: $($problems -join ', '). Nothing modified." }
Write-Output 'Preflight passed. This does not start containers or prove Windows-to-WSL loopback forwarding.'
