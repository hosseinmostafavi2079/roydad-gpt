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
  assert.ok(installer.includes('-NonInteractive -Command "&'));
  assert.doesNotMatch(installer, /-File .*?-Confirm:\$false/);
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
    function New-ScheduledTaskAction {param($Execute,$Argument);$script:actionArguments=$Argument;return @{}}
    function New-ScheduledTaskTrigger {param([switch]$Once,$At,$RepetitionInterval,$RepetitionDuration);return @{}}
    function New-ScheduledTaskPrincipal {param($UserId,$LogonType,$RunLevel);if($LogonType -ne 'Interactive'){throw 'Unsafe principal'};return @{}}
    function New-ScheduledTaskSettingsSet {param($MultipleInstances,[switch]$StartWhenAvailable,$ExecutionTimeLimit);return @{}}
    function Register-ScheduledTask {param($TaskName,$Action,$Trigger,$Principal,$Settings);$script:registered++}
    $user=[Security.Principal.WindowsIdentity]::GetCurrent().Name
    & { ${clean(installer)} } -TaskUser $user -WslReleasePath '/mnt/c/EventOS/releases/approved' -WindowsBackupDirectory 'C:\\EventOS\\backups' | Out-Null
    if($script:registered -ne 0){throw 'Installer dry run mutated'}
    & { ${clean(installer)} } -TaskUser $user -WslReleasePath '/mnt/c/EventOS/releases/approved' -WindowsBackupDirectory 'C:\\EventOS\\backups' -Apply -Confirm:$false | Out-Null
    if($script:registered -ne 1){throw 'Mock registration missing'}
    if($script:actionArguments -notlike '-NoProfile -NonInteractive -Command *' -or $script:actionArguments -match '-File '){throw 'Broken task action'}
    $fixture=[IO.Path]::Combine([IO.Path]::GetTempPath(),[Guid]::NewGuid().ToString()+'.ps1')
    try {
      [IO.File]::WriteAllText($fixture,@'
[CmdletBinding(SupportsShouldProcess)]
param([string]$Distribution,[string]$WslReleasePath,[string]$WindowsBackupDirectory,[switch]$Apply)
if($PSVersionTable.PSVersion.Major -ne 5){throw 'Expected PowerShell 5.1'}
if(!$PSBoundParameters.ContainsKey('Confirm') -or $PSBoundParameters['Confirm'].IsPresent){throw 'Confirm must be boolean false'}
if(!$Apply -or $Distribution -ne 'Ubuntu' -or $WslReleasePath -ne '/mnt/c/EventOS/releases/approved' -or $WindowsBackupDirectory -ne 'C:\\EventOS\\backups'){throw 'Task arguments changed'}
Write-Output 'generated-action-pass'
'@)
      $nativeArguments=$script:actionArguments.Replace("'C:\\EventOS\\run-backup-maintenance.ps1'", "'"+$fixture.Replace("'","''")+"'")
      $start=New-Object System.Diagnostics.ProcessStartInfo
      $start.FileName="$env:SystemRoot\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"
      # Only this disposable mocked test process may execute its unsigned fixture.
      # The installer action and machine/operator execution policy stay unchanged.
      $start.Arguments='-ExecutionPolicy Bypass '+$nativeArguments;$start.UseShellExecute=$false;$start.CreateNoWindow=$true
      $start.RedirectStandardOutput=$true;$start.RedirectStandardError=$true
      $child=[Diagnostics.Process]::Start($start)
      $result=$child.StandardOutput.ReadToEnd();$failure=$child.StandardError.ReadToEnd();$child.WaitForExit()
      if($child.ExitCode -ne 0 -or $result.Trim() -ne 'generated-action-pass'){throw "Generated native action failed: $failure"}
    } finally {if([IO.File]::Exists($fixture)){[IO.File]::Delete($fixture)}}
    $script:conflict=$true;$rejected=$false
    try { & { ${clean(installer)} } -TaskUser $user -WslReleasePath '/mnt/c/EventOS/releases/approved' -WindowsBackupDirectory 'C:\\EventOS\\backups' -Apply -Confirm:$false | Out-Null } catch {$rejected=$true}
    if(!$rejected -or $script:registered -ne 1){throw 'Unexpected task overwritten'}
    $rejected=$false
    try { & { ${clean(installer)} } -TaskUser 'SYSTEM' -WslReleasePath '/mnt/c/EventOS/releases/approved' -WindowsBackupDirectory 'C:\\EventOS\\backups' | Out-Null } catch {$rejected=$true}
    if(!$rejected){throw 'SYSTEM accepted'}
    $rejected=$false
    try { & { ${clean(installer)} } -TaskUser 'OTHER\\unexpected-user' -WslReleasePath '/mnt/c/EventOS/releases/approved' -WindowsBackupDirectory 'C:\\EventOS\\backups' | Out-Null } catch {$rejected=$true}
    if(!$rejected -or $script:registered -ne 1){throw 'Non-current user accepted or protected task changed'}
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
