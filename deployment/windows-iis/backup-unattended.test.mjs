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

const helper = readFileSync(
  new URL(
    "powershell/enable-backup-maintenance-unattended.ps1",
    import.meta.url,
  ),
  "utf8",
);
test("unattended helper has credential-only input, fixed task scope and bounded verification", () => {
  assert.match(
    helper,
    /\[System\.Management\.Automation\.PSCredential\]\$Credential/,
  );
  assert.doesNotMatch(
    helper,
    /\[string\]\s*\$Password|param\([^)]*TaskName|S4U|SYSTEM['"]|-Password\s+['"]|Set-Content|WriteAllText|Out-File|\$env:\w+\s*=|docker\.sock|wsl --shutdown/i,
  );
  assert.match(helper, /SecureStringToBSTR/);
  assert.match(helper, /ZeroFreeBSTR/);
  assert.match(helper, /AddSeconds\(120\)/);
  assert.match(helper, /Start-Sleep -Seconds 2/);
  assert.match(helper, /LastRunTime -gt \$previousRun/);
  assert.match(helper, /LastTaskResult -ne 0/);
  assert.doesNotMatch(
    helper,
    /Write-(Output|Host|Warning|Error).*\$(Credential|plainPassword|passwordBuffer)|throw.*\$_/,
  );
});
test("default installer remains Interactive and untouched by unattended helper", () => {
  const installer = readFileSync(
    new URL("powershell/install-backup-maintenance-task.ps1", import.meta.url),
    "utf8",
  );
  assert.match(installer, /-LogonType Interactive/);
  assert.match(installer, /Get-ScheduledTask -TaskName \$taskName/);
  assert.doesNotMatch(
    installer,
    /Get-Credential|-LogonType Password|-Password/,
  );
});

const scenarios = [
  "dry-run",
  "what-if",
  "success-prompt",
  "success-credential",
  "refresh-password",
  "sid-alias",
  "missing-task",
  "wrong-action",
  "extra-command",
  "wrong-release",
  "missing-script",
  "path-injection",
  "broad-acl",
  "wrong-wsl",
  "multiple-actions",
  "service-user",
  "wrong-user",
  "s4u",
  "wrong-credential",
  "disabled",
  "wrong-interval",
  "wrong-runlevel",
  "mutation-failure",
  "postcondition-action",
  "postcondition-trigger",
  "postcondition-settings",
  "runtime-error",
  "no-fresh-run",
  "timeout",
  "rollback-failure",
];
for (const scenario of scenarios)
  test(`PowerShell 5.1 unattended: ${scenario}`, {
    skip: process.platform !== "win32",
  }, () => {
    const cleaned = helper.replace('. "$PSScriptRoot/common.ps1"', "");
    const script = `
$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue'
if($PSVersionTable.PSVersion.Major -ne 5){throw 'PowerShell 5.1 required'}
$scenario='${scenario}'
$script:clock=[datetime]'2026-10-08T00:00:00Z';$script:started=$false;$script:setCount=0;$script:rollbackCount=0;$script:prompts=0;$script:reads=0
$script:current=[Security.Principal.WindowsIdentity]::GetCurrent()
$user=$script:current.Name;$sid=$script:current.User.Value
$release='C:\\EventOS\\releases\\approved'
$runScript="$release\\deployment\\windows-iis\\powershell\\run-backup-maintenance.ps1"
$expected='-NoProfile -NonInteractive -Command "& ''{0}'' -Distribution ''Ubuntu'' -WslReleasePath ''/mnt/c/EventOS/releases/approved'' -WindowsBackupDirectory ''C:\\EventOS\\backups'' -Apply -Confirm:$false"' -f $runScript
$script:task=[pscustomobject]@{
 TaskName='EventOS-Backup-Maintenance';TaskPath='\\';State='Ready'
 Actions=@([pscustomobject]@{Execute="$env:SystemRoot\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";Arguments=$expected;WorkingDirectory=''})
 Principal=[pscustomobject]@{UserId=$user;LogonType='Interactive';RunLevel='Highest'}
 Triggers=@([pscustomobject]@{Repetition=[pscustomobject]@{Interval='PT15M';Duration='P3650D'}})
 Settings=[pscustomobject]@{Enabled=$true;MultipleInstances='IgnoreNew';ExecutionTimeLimit='PT2H'}
}
$script:originalAction=$expected
if($scenario -eq 'refresh-password'){$script:task.Principal.LogonType='Password'}
if($scenario -eq 'sid-alias'){$script:task.Principal.UserId=$sid}
if($scenario -eq 'wrong-action'){$script:task.Actions[0].Execute='cmd.exe'}
if($scenario -eq 'extra-command'){$script:task.Actions[0].Arguments+='; evil-command'}
if($scenario -eq 'multiple-actions'){$script:task.Actions+= $script:task.Actions[0]}
if($scenario -eq 'service-user'){$script:task.Principal.UserId='S-1-5-18'}
if($scenario -eq 'wrong-user'){$script:task.Principal.UserId='S-1-5-19'}
if($scenario -eq 's4u'){$script:task.Principal.LogonType='S4U'}
if($scenario -eq 'disabled'){$script:task.Settings.Enabled=$false}
if($scenario -eq 'wrong-interval'){$script:task.Triggers[0].Repetition.Interval='PT1M'}
if($scenario -eq 'wrong-runlevel'){$script:task.Principal.RunLevel='Limited'}
function Initialize-Eventos {param($Distribution,$ReleasePath);if($Distribution -notmatch '^[A-Za-z0-9_.-]+$' -or $ReleasePath -notmatch '^/[A-Za-z0-9_./-]+$' -or $ReleasePath.Contains('/../')){throw 'Invalid WSL grammar'};$script:EventosReleasePath=$ReleasePath;$script:EventosEnv="$ReleasePath/deployment/windows-iis/.env.production"}
function Test-Path {param($LiteralPath,$PathType);return !($scenario -eq 'missing-script' -and $LiteralPath.EndsWith('run-backup-maintenance.ps1'))}
function Resolve-Path {param($LiteralPath);return [pscustomobject]@{Path=$LiteralPath}}
function Invoke-EventosWsl {param([string[]]$Arguments);if($Arguments[0] -eq 'wslpath'){if($Arguments[1] -ne '-w'){throw 'Unsafe Windows path invocation'};return 'C:\\EventOS\\releases\\approved'};if($Arguments[0] -ne 'test'){throw 'Unexpected WSL mutation'}}
function wsl.exe {$global:LASTEXITCODE=0;if($scenario -eq 'wrong-wsl'){return 'Other'};return 'Ubuntu'}
function Get-Acl {param($LiteralPath);if($scenario -eq 'broad-acl'){return [pscustomobject]@{Access=@([pscustomobject]@{AccessControlType='Allow';IdentityReference=([Security.Principal.SecurityIdentifier]'S-1-1-0')})}};return [pscustomobject]@{Access=@()}}
function Assert-FixedTask {param($Name,$Path);if($Name -ne 'EventOS-Backup-Maintenance' -or $Path -ne '\\'){throw 'Protected task touched'}}
function Get-ScheduledTask {param($TaskName,$TaskPath);Assert-FixedTask $TaskName $TaskPath;if($scenario -eq 'missing-task'){return $null};return $script:task}
function Export-ScheduledTask {param($InputObject);$a=[Security.SecurityElement]::Escape($InputObject.Actions[0].Arguments);$e=[Security.SecurityElement]::Escape($InputObject.Actions[0].Execute);$i=$InputObject.Triggers[0].Repetition.Interval;$m=$InputObject.Settings.MultipleInstances;return "<Task><Actions><Exec><Command>$e</Command><Arguments>$a</Arguments></Exec></Actions><Triggers><TimeTrigger><Repetition><Interval>$i</Interval></Repetition></TimeTrigger></Triggers><Settings><MultipleInstancesPolicy>$m</MultipleInstancesPolicy></Settings></Task>"}
function New-ScheduledTaskPrincipal {param($UserId,$LogonType,$RunLevel);if($UserId -ne $user -or $LogonType -ne 'Interactive' -or $RunLevel -ne 'Highest'){throw 'Unsafe rollback principal'};return [pscustomobject]@{UserId=$UserId;LogonType=$LogonType;RunLevel=$RunLevel}}
function New-TestCredential {param($Username);$secure=New-Object Security.SecureString;foreach($character in 'synthetic-only-credential'.ToCharArray()){$secure.AppendChar($character)};$secure.MakeReadOnly();return [Management.Automation.PSCredential]::new($Username,$secure)}
function Get-Credential {param($UserName,$Message);$script:prompts++;return (New-TestCredential $user)}
function Set-ScheduledTask {
 param($TaskName,$TaskPath,$User,$Password,$Principal)
 Assert-FixedTask $TaskName $TaskPath
 if($Principal){
   $script:rollbackCount++
   if($scenario -eq 'rollback-failure'){throw 'Synthetic rollback failure'}
   $script:task.Principal=$Principal;return
 }
 if($User -ne $user -or $Password -ne 'synthetic-only-credential'){throw 'Wrong run-as account or password flow'}
 if($script:task.Actions[0].Arguments.Contains($Password)){throw 'Password in action'}
 $script:setCount++;$script:task.Principal.LogonType='Password';$script:task.Principal.UserId=$user
 if($scenario -eq 'mutation-failure'){throw 'synthetic-only-credential'}
 if($scenario -eq 'postcondition-action'){$script:task.Actions[0].Arguments+=' unexpected'}
 if($scenario -eq 'postcondition-trigger'){$script:task.Triggers[0].Repetition.Interval='PT1M'}
 if($scenario -eq 'postcondition-settings'){$script:task.Settings.MultipleInstances='Parallel'}
}
function Start-ScheduledTask {param($TaskName,$TaskPath);Assert-FixedTask $TaskName $TaskPath;$script:started=$true}
function Get-ScheduledTaskInfo {param($TaskName,$TaskPath);Assert-FixedTask $TaskName $TaskPath;$script:reads++;$last=[datetime]'2026-10-07T00:00:00Z';$result=0
 if($script:started){
   if($scenario -ne 'no-fresh-run'){$last=$last.AddDays(1)}
   if($scenario -in @('timeout','rollback-failure')){$script:task.State='Running'}
   if($scenario -eq 'runtime-error'){$result=1}
 }
 return [pscustomobject]@{LastRunTime=$last;LastTaskResult=$result}
}
function Get-Date {return $script:clock}
function Start-Sleep {param($Seconds);if($Seconds -ne 2){throw 'Busy polling'};$script:clock=$script:clock.AddSeconds($Seconds)}
$parameters=@{ReleasePath=$release;WslReleasePath='/mnt/c/EventOS/releases/approved';WindowsBackupDirectory='C:\\EventOS\\backups'}
if($scenario -eq 'wrong-release'){$parameters.ReleasePath='C:\\Other\\release'}
if($scenario -eq 'path-injection'){$parameters.WindowsBackupDirectory='C:\\EventOS\\backups;evil'}
if($scenario -notin @('dry-run','what-if')){$parameters.Apply=$true;$parameters.Confirm=$false}
if($scenario -eq 'what-if'){$parameters.Apply=$true;$parameters.WhatIf=$true}
if($scenario -in @('success-credential','sid-alias','wrong-credential')){
 $credentialUser=$user;if($scenario -eq 'sid-alias'){$credentialUser=$user.Split('\\')[-1]};if($scenario -eq 'wrong-credential'){$credentialUser='S-1-5-18'}
 $parameters.Credential=(New-TestCredential $credentialUser)
}
$failed=$false;$message='';$output=''
try {$output=(& { ${cleaned} } @parameters | Out-String)} catch {$failed=$true;$message=$_.Exception.Message}
if(($output+$message) -match 'synthetic-only-credential'){throw 'Credential leaked in safe output'}
if($env:EVENTOS_UNATTENDED_PASSWORD){throw 'Unexpected credential environment'}
$success=$scenario -in @('success-prompt','success-credential','refresh-password','sid-alias')
$dry=$scenario -in @('dry-run','what-if')
$rollback=$scenario -in @('mutation-failure','postcondition-action','postcondition-trigger','postcondition-settings','runtime-error','no-fresh-run','timeout','rollback-failure')
if($success){
 if($failed -or $script:setCount -ne 1 -or !$script:started -or $script:task.Principal.LogonType -ne 'Password' -or $script:task.Principal.RunLevel -ne 'Highest' -or $script:task.Actions[0].Arguments -cne $expected -or $script:task.Triggers[0].Repetition.Interval -ne 'PT15M' -or $script:task.Settings.MultipleInstances -ne 'IgnoreNew'){throw "Success scenario failed: $message"}
 if($scenario -eq 'success-credential' -and $script:prompts -ne 0){throw 'Unnecessary credential prompt'}
 if($scenario -eq 'success-prompt' -and $script:prompts -ne 1){throw 'Missing credential prompt'}
}elseif($dry){if($failed -or $script:setCount -ne 0 -or $script:prompts -ne 0 -or $script:started){throw 'Dry run or WhatIf mutated/prompted'}}
elseif($rollback){
 if(!$failed -or $script:rollbackCount -ne 1){throw 'Failure did not attempt rollback'}
 if($scenario -in @('postcondition-action','postcondition-trigger','postcondition-settings','rollback-failure')){if($message -notmatch 'rollback FAILED'){throw 'Unverified rollback reported as success'}}
 else {if($message -notmatch 'rollback succeeded' -or $script:task.Principal.LogonType -ne 'Interactive' -or $script:task.Actions[0].Arguments -cne $expected -or $script:task.Triggers[0].Repetition.Interval -ne 'PT15M' -or $script:task.Settings.MultipleInstances -ne 'IgnoreNew'){throw 'Rollback changed definition or failed'}}
}else{if(!$failed -or $script:setCount -ne 0 -or $script:started){throw 'Invalid scenario changed task'}}
Write-Output 'PASS ${scenario}'
`;
    const directory = mkdtempSync(
      path.join(tmpdir(), "eventos-unattended-test-"),
    );
    const file = path.join(directory, "mocked.ps1");
    let output;
    try {
      writeFileSync(file, script, { mode: 0o600 });
      const entry = `& ([scriptblock]::Create([IO.File]::ReadAllText('${file.replaceAll("'", "''")}')))`;
      output = execFileSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-EncodedCommand",
          Buffer.from(entry, "utf16le").toString("base64"),
        ],
        { encoding: "utf8", windowsHide: true, timeout: 20_000 },
      );
    } finally {
      unlinkSync(file);
      rmdirSync(directory);
    }
    assert.ok(output.includes(`PASS ${scenario}`));
    assert.ok(!output.includes("synthetic-only-credential"));
  });
