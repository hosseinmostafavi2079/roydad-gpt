import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

const source = (file) => readFileSync(new URL(file, import.meta.url), "utf8");
const maintenance = source("powershell/run-backup-maintenance.ps1"),
  installer = source("powershell/install-backup-maintenance-task.ps1");
test("maintenance is bounded, scoped and protects Windows ACLs", () => {
  assert.ok(maintenance.includes("Assert-EventosCompose"));
  assert.ok(maintenance.includes("Get-Acl -LiteralPath"));
  assert.ok(maintenance.includes("$Apply -and $PSCmdlet.ShouldProcess"));
  const shell = source("run-backup-maintenance.sh");
  assert.ok(shell.includes("--project-name eventos-production"));
  assert.ok(shell.includes("count<=10"));
  assert.ok(shell.includes("check-prune"));
  assert.ok(shell.includes("flock -n 9"));
  assert.doesNotMatch(
    shell + maintenance,
    /docker\.sock|compose down|volume prune|system prune|wsl --shutdown/,
  );
});
test("installer is explicit interactive principal, dry-run, fixed isolated task and conflict rejection", () => {
  assert.ok(installer.includes("SupportsShouldProcess"));
  assert.ok(installer.includes("$Apply -and $PSCmdlet.ShouldProcess"));
  assert.ok(installer.includes("$taskName = 'EventOS-Backup-Maintenance'"));
  assert.ok(installer.includes("Get-ScheduledTask -TaskName $taskName"));
  assert.ok(installer.includes("-LogonType Interactive"));
  assert.ok(installer.includes("-Minutes 15"));
  assert.ok(installer.includes("WindowsIdentity]::GetCurrent"));
  assert.doesNotMatch(
    installer,
    /WSL-Ubuntu-KeepAlive|PricePilot|ServerOps|-Password|LogonType Password|UserId ['"]SYSTEM/i,
  );
});
test("PowerShell 5.1 maintenance and installer run only mocked host calls", {
  skip: process.platform !== "win32",
}, () => {
  const clean = (body) => body.replace('. "$PSScriptRoot/common.ps1"', "");
  const script = `
    $ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue'
    if($PSVersionTable.PSVersion.Major -ne 5){throw 'PowerShell 5 required'}
    function Initialize-Eventos {param($Distribution,$ReleasePath);$script:EventosReleasePath=$ReleasePath;$script:EventosEnv="$ReleasePath/deployment/windows-iis/.env.production"}
    function wsl.exe {$global:LASTEXITCODE=0;return 'Ubuntu'}
    function Assert-EventosCompose {$script:isolated=$true}
    function Test-Path {param($LiteralPath,$PathType);return $true}
    function Resolve-Path {param($LiteralPath);if($LiteralPath -like '*run-backup-maintenance.ps1'){return [pscustomobject]@{Path='C:\\EventOS\\run-backup-maintenance.ps1'}};return [pscustomobject]@{Path=$LiteralPath}}
    function Get-Acl {param($LiteralPath);return [pscustomobject]@{Access=@()}}
    $script:executions=0;$script:registered=0;$script:conflict=$false
    function Invoke-EventosWsl {
      param([string[]]$Arguments)
      if($Arguments[0] -eq 'wslpath'){if($Arguments[2] -ne 'C:/EventOS/backups'){throw 'Unsafe path'};return '/mnt/c/EventOS/backups'}
      if($Arguments[0] -eq 'env'){if(!$script:isolated -or $Arguments[1] -ne 'EVENTOS_WINDOWS_BACKUP_ACL_VERIFIED=1' -or $Arguments[2] -ne 'bash'){throw 'Missing host guard'};$script:executions++}
    }
    & { ${clean(maintenance)} } -WslReleasePath '/mnt/c/EventOS/releases/approved' -WindowsBackupDirectory 'C:\\EventOS\\backups'
    if($script:executions -ne 0){throw 'Dry run mutated'}
    & { ${clean(maintenance)} } -WslReleasePath '/mnt/c/EventOS/releases/approved' -WindowsBackupDirectory 'C:\\EventOS\\backups' -Apply -Confirm:$false
    if($script:executions -ne 1){throw 'Expected one invocation'}
    function Get-ScheduledTask {param($TaskName);if($TaskName -ne 'EventOS-Backup-Maintenance'){throw 'Protected task touched'};if($script:conflict){return [pscustomobject]@{TaskName=$TaskName}}}
    function New-ScheduledTaskAction {param($Execute,$Argument);return @{}}
    function New-ScheduledTaskTrigger {param([switch]$Once,$At,$RepetitionInterval,$RepetitionDuration);return @{}}
    function New-ScheduledTaskPrincipal {param($UserId,$LogonType,$RunLevel);if($LogonType -ne 'Interactive'){throw 'Unsafe principal'};return @{}}
    function New-ScheduledTaskSettingsSet {param($MultipleInstances,[switch]$StartWhenAvailable,$ExecutionTimeLimit);return @{}}
    function Register-ScheduledTask {param($TaskName,$Action,$Trigger,$Principal,$Settings);$script:registered++}
    $user=[Security.Principal.WindowsIdentity]::GetCurrent().Name
    & { ${clean(installer)} } -TaskUser $user -WslReleasePath '/mnt/c/EventOS/releases/approved' -WindowsBackupDirectory 'C:\\EventOS\\backups' | Out-Null
    if($script:registered -ne 0){throw 'Installer dry run mutated'}
    & { ${clean(installer)} } -TaskUser $user -WslReleasePath '/mnt/c/EventOS/releases/approved' -WindowsBackupDirectory 'C:\\EventOS\\backups' -Apply -Confirm:$false | Out-Null
    if($script:registered -ne 1){throw 'Mock registration missing'}
    $script:conflict=$true;$rejected=$false
    try { & { ${clean(installer)} } -TaskUser $user -WslReleasePath '/mnt/c/EventOS/releases/approved' -WindowsBackupDirectory 'C:\\EventOS\\backups' -Apply -Confirm:$false | Out-Null } catch {$rejected=$true}
    if(!$rejected -or $script:registered -ne 1){throw 'Unexpected task overwritten'}
    $rejected=$false
    try { & { ${clean(installer)} } -TaskUser 'SYSTEM' -WslReleasePath '/mnt/c/EventOS/releases/approved' -WindowsBackupDirectory 'C:\\EventOS\\backups' | Out-Null } catch {$rejected=$true}
    if(!$rejected){throw 'SYSTEM accepted'}
    Write-Output 'PowerShell 5.1 maintenance/installer guards passed; all mutations mocked.'
  `;
  const directory = mkdtempSync(
    path.join(tmpdir(), "eventos-maintenance-ps-test-"),
  );
  const file = path.join(directory, "mocked.ps1");
  let output;
  try {
    writeFileSync(file, script, { mode: 0o600 });
    output = execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-EncodedCommand",
        Buffer.from(
          `& ([scriptblock]::Create([IO.File]::ReadAllText('${file.replaceAll("'", "''")}')))`,
          "utf16le",
        ).toString("base64"),
      ],
      { encoding: "utf8", windowsHide: true },
    );
  } finally {
    unlinkSync(file);
    rmdirSync(directory);
  }
  assert.equal(
    output.trim(),
    "PowerShell 5.1 maintenance/installer guards passed; all mutations mocked.",
  );
});
