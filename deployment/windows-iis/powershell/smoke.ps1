# READ-ONLY; Windows loopback only; no login, OTP or mutation requests.
[CmdletBinding()]
param([string]$HostName = 'event.mediasanat.ir')
if ($HostName -notmatch '^[a-z0-9-]+(?:\.[a-z0-9-]+)+$') { throw 'Exact ASCII hostname required.' }
foreach ($path in @('/api/health/live','/api/health/ready','/login')) {
    # Platform login is /sign-in. Custom tenant login is /login.
    if ($path -eq '/login' -and $HostName -eq 'event.mediasanat.ir') { $path = '/sign-in' }
    $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:18280$path" -Headers @{Host=$HostName; 'X-Forwarded-Proto'='https'} -MaximumRedirection 0 -TimeoutSec 15
    if ($response.StatusCode -ne 200) { throw "Smoke failed: $path" }
    Write-Output "PASS: $HostName $path"
}
