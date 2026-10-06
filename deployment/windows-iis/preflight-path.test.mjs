import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(
  new URL("powershell/preflight.ps1", import.meta.url),
  "utf8",
);
const block = source.match(
  /Check-ReadOnly 'Production env Windows\/WSL path identity' \{([\s\S]*?)\n\}/,
)?.[1];

test("env identity converts only the authoritative POSIX path and stays read-only", () => {
  assert.ok(block);
  assert.ok(block.includes("@('wslpath','-w',$script:EventosEnv)"));
  assert.ok(block.includes("Resolve-Path -LiteralPath $WindowsEnvFile"));
  assert.ok(block.includes("[StringComparison]::OrdinalIgnoreCase"));
  assert.equal((block.match(/GetFullPath/g) ?? []).length, 2);
  assert.doesNotMatch(
    block,
    /Write-|Get-Content|Set-Content|docker|wslpath','-u'/i,
  );
  assert.ok(source.includes("Production env Node validation"));
  assert.ok(
    source.includes("PROTECTED LIVE: 18080 PricePilot; 18180 ServerOps"),
  );
});

test("Windows PowerShell 5.1 accepts backslashes/mixed case and rejects mismatches without secret output", {
  skip: process.platform !== "win32",
}, () => {
  const script = `
    $ErrorActionPreference = 'Stop'
    if ($PSVersionTable.PSVersion.Major -ne 5) { throw 'Windows PowerShell 5 required' }
    $script:EventosEnv = '/mnt/c/EventOS/releases/approved/deployment/windows-iis/.env.production'
    $WindowsEnvFile = 'C:\\EventOS\\releases\\approved\\deployment\\windows-iis\\.env.production'
    function Resolve-Path { param([string]$LiteralPath); if ($LiteralPath -ne $WindowsEnvFile) { throw 'Literal path changed' }; [pscustomobject]@{Path=$LiteralPath} }
    function Invoke-EventosWsl {
      param([string[]]$Arguments)
      if (($Arguments -join '|') -cne ('wslpath|-w|' + $script:EventosEnv)) { throw 'Unsafe WSL arguments' }
      return $script:MappedPath
    }
    $script:MappedPath = 'c:\\eventos\\releases\\approved\\deployment\\windows-iis\\.env.production'
    & { ${block} }
    $script:MappedPath = 'C:\\EventOS\\releases\\other\\deployment\\windows-iis\\.env.production'
    $rejected = $false
    try { & { ${block} } } catch {
      if ($_.Exception.Message -ne 'Windows/WSL env file paths must identify the same file.') { throw }
      $rejected = $true
    }
    if (!$rejected) { throw 'Mismatched path accepted' }
    Write-Output 'Path identity cases passed; no env contents read or printed.'
  `;
  const output = execFileSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      Buffer.from(script, "utf16le").toString("base64"),
    ],
    { encoding: "utf8", windowsHide: true },
  );
  assert.equal(
    output.trim(),
    "Path identity cases passed; no env contents read or printed.",
  );
});
