import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(
  new URL("powershell/backup.ps1", import.meta.url),
  "utf8",
);
const block = source.slice(
  source.indexOf("if (![IO.Path]::IsPathRooted"),
  source.indexOf("Write-Output 'Backups"),
);
test("backup wrapper preserves CLI, ShouldProcess and safe WSL arguments", () => {
  assert.ok(source.includes("SupportsShouldProcess"));
  assert.ok(source.includes("$Apply -and $PSCmdlet.ShouldProcess"));
  assert.ok(block.includes(".Replace('\\','/')"));
  assert.ok(block.includes("wslpath','-u',$nativeBackupDirectory"));
  assert.doesNotMatch(block, /bash|Write-Output|Get-Content|Invoke-Expression/);
});
test("PowerShell 5.1 reproduces lost-backslash boundary and safely converts backup paths", {
  skip: process.platform !== "win32",
}, () => {
  const script = `
    $ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'
    if ($PSVersionTable.PSVersion.Major -ne 5) { throw 'PowerShell 5 required' }
    function Test-Path { param($LiteralPath,$PathType); return $true }
    function Resolve-Path { param($LiteralPath); return [pscustomobject]@{Path=$LiteralPath} }
    function Invoke-EventosWsl {
      param([string[]]$Arguments)
      # Reproduce the observed native boundary: backslashes disappear.
      $received=$Arguments[2].Replace('\\','')
      if ($received -notmatch '^([A-Za-z]):/(.*)$') { throw 'Malformed native path' }
      return '/mnt/'+$Matches[1].ToLower()+'/'+$Matches[2]
    }
    foreach ($case in @(@('C:\\EventOS\\backups','/mnt/c/EventOS/backups'),@('D:\\Private\\archive-01','/mnt/d/Private/archive-01'))) {
      $WindowsBackupDirectory=$case[0]; & { ${block}; if ($backupPath -cne $case[1]) { throw 'Incorrect conversion' } }
    }
    foreach ($unsafe in @('relative','C:\\EventOS\\bad;command','C:\\EventOS\\with space','C:\\EventOS\\bad&command','C:\\EventOS\\bad$command')) {
      $WindowsBackupDirectory=$unsafe; $rejected=$false
      try { & { ${block} } } catch { $rejected=$true }
      if (!$rejected) { throw 'Unsafe path accepted' }
    }
    Write-Output 'Backup path regression passed (WSL mocked; no backup executed).'
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
    "Backup path regression passed (WSL mocked; no backup executed).",
  );
});
