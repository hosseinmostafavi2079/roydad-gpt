import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
const runner = readFileSync(
  new URL("powershell/run-backup-jobs.ps1", import.meta.url),
  "utf8",
);
test("runner is one-shot, explicit project, no socket/mount or scheduling", () => {
  const shell = readFileSync(
    new URL("run-backup-job.sh", import.meta.url),
    "utf8",
  );
  assert.ok(
    runner.includes("Initialize-Eventos $Distribution $WslReleasePath"),
  );
  assert.ok(runner.includes("Assert-EventosCompose"));
  assert.ok(runner.includes("$Apply -and $PSCmdlet.ShouldProcess"));
  assert.ok(runner.includes("eventos-production"));
  assert.ok(shell.includes("--project-name eventos-production"));
  assert.equal((shell.match(/control claim/g) ?? []).length, 1);
  assert.doesNotMatch(
    runner + shell,
    /docker\.sock|New-ScheduledTask|Register-ScheduledTask|compose down|volume prune|system prune|wsl --shutdown/i,
  );
  for (const file of ["compose.production.yaml", "../../compose.yaml"])
    assert.doesNotMatch(
      readFileSync(new URL(file, import.meta.url), "utf8"),
      /docker\.sock/,
    );
});
test("runner parses and executes guarded path under Windows PowerShell 5.1 with all host calls mocked", {
  skip: process.platform !== "win32",
}, () => {
  const body = runner.replace('. "$PSScriptRoot/common.ps1"', "");
  const script = `
    $ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue'
    if($PSVersionTable.PSVersion.Major -ne 5){throw 'PowerShell 5 required'}
    function Initialize-Eventos { param($Distribution,$ReleasePath); if($Distribution -ne 'Ubuntu' -or $ReleasePath -ne '/mnt/c/EventOS/releases/approved'){throw 'Invalid context'}; $script:EventosReleasePath=$ReleasePath;$script:EventosEnv="$ReleasePath/deployment/windows-iis/.env.production" }
    function wsl.exe {$global:LASTEXITCODE=0;return 'Ubuntu'}
    function Assert-EventosCompose {$script:isolated=$true}
    function Test-Path {param($LiteralPath,$PathType);return $true}
    function Resolve-Path {param($LiteralPath);return [pscustomobject]@{Path=$LiteralPath}}
    $script:executions=0;$script:isolated=$false
    function Invoke-EventosWsl {
      param([string[]]$Arguments)
      if($Arguments[0] -eq 'wslpath'){if($Arguments[2] -ne 'C:/EventOS/backups'){throw 'Unsafe native argument'};return '/mnt/c/EventOS/backups'}
      if($Arguments[0] -eq 'bash'){if(!$script:isolated -or $Arguments[1] -ne '/mnt/c/EventOS/releases/approved/deployment/windows-iis/run-backup-job.sh'){throw 'Unscoped execution'};$script:executions++}
    }
    & { ${body} } -WslReleasePath '/mnt/c/EventOS/releases/approved' -WindowsBackupDirectory 'C:\\EventOS\\backups'
    if($script:executions -ne 0){throw 'Dry-run executed a job'}
    & { ${body} } -WslReleasePath '/mnt/c/EventOS/releases/approved' -WindowsBackupDirectory 'C:\\EventOS\\backups' -Apply -Confirm:$false
    if($script:executions -ne 1){throw 'Expected exactly one execution'}
    Write-Output 'PowerShell 5.1 runner guards passed; host calls mocked.'
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
    "PowerShell 5.1 runner guards passed; host calls mocked.",
  );
});
