const { execFile } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const LAUNCHER_DIR = path.join(PROJECT_ROOT, "logs", "production-task-definitions");
const TASKS = {
  runtime: {
    name: "LINE Bot Local AI Gateway Skill",
    schedule: "ONLOGON",
    command: `"${process.execPath}" "src\\server.js"`,
    retry: {
      restart_count: 3,
      restart_interval_minutes: 1
    }
  },
  health: {
    name: "LINE Bot Local AI Gateway Skill Health Check",
    schedule: "MINUTE",
    modifier: "5",
    command: "wsh-local-health-check",
    launcher_kind: "wsh_health_check",
    retry: {
      restart_count: 2,
      restart_interval_minutes: 1
    }
  }
};

function argValue(name, fallback = "") {
  const prefix = `${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function exec(command, args) {
  return new Promise((resolve) => {
    execFile(command, args, { cwd: PROJECT_ROOT, windowsHide: true }, (error, stdout, stderr) => {
      resolve({
        ok: !error,
        code: error?.code || 0,
        stdout: String(stdout || ""),
        stderr: String(stderr || "")
      });
    });
  });
}

function execPowerShell(commands) {
  return exec("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    commands.join("; ")
  ]);
}

function launcherPath(kind) {
  return path.join(LAUNCHER_DIR, `${kind}-hidden-launcher.vbs`);
}

function vbString(value) {
  return String(value).replace(/"/g, '""');
}

function launcherCommand(task) {
  if (task.launcher_kind === "wsh_health_check") {
    const logDir = path.join(PROJECT_ROOT, "logs", "production-health");
    return [
      'Set fso = CreateObject("Scripting.FileSystemObject")',
      'Set shell = CreateObject("WScript.Shell")',
      `projectRoot = "${vbString(PROJECT_ROOT)}"`,
      `logDir = "${vbString(logDir)}"`,
      'If Not fso.FolderExists(logDir) Then fso.CreateFolder(logDir)',
      'logFile = logDir & "\\health-" & Year(Date) & Right("0" & Month(Date), 2) & Right("0" & Day(Date), 2) & ".jsonl"',
      'apiToken = shell.ExpandEnvironmentStrings("%LOCAL_MODEL_API_TOKEN%")',
      'If apiToken = "%LOCAL_MODEL_API_TOKEN%" Then apiToken = ""',
      'envPath = projectRoot & "\\.env"',
      'If Len(apiToken) = 0 And fso.FileExists(envPath) Then',
      '  Set envFile = fso.OpenTextFile(envPath, 1, False)',
      '  Do Until envFile.AtEndOfStream',
      '    envLine = Trim(envFile.ReadLine)',
      '    If LCase(Left(envLine, 22)) = "local_model_api_token=" Then',
      '      apiToken = Mid(envLine, 23)',
      '      If Left(apiToken, 1) = """" And Right(apiToken, 1) = """" Then apiToken = Mid(apiToken, 2, Len(apiToken) - 2)',
      '      If Left(apiToken, 1) = "\'" And Right(apiToken, 1) = "\'" Then apiToken = Mid(apiToken, 2, Len(apiToken) - 2)',
      '    End If',
      '  Loop',
      '  envFile.Close',
      'End If',
      'Function JsonEscape(value)',
      '  JsonEscape = Replace(Replace(Replace(CStr(value), "\\", "\\\\"), """", "\""") , vbCrLf, " ")',
      'End Function',
      'Function HttpCheck(url, expectedText)',
      '  On Error Resume Next',
      '  Set xhr = CreateObject("MSXML2.ServerXMLHTTP.6.0")',
      '  xhr.setTimeouts 2000, 2000, 5000, 5000',
      '  xhr.open "GET", url, False',
      '  If InStr(url, "localhost:1234") > 0 And Len(apiToken) > 0 Then',
      '    xhr.setRequestHeader "Authorization", "Bearer " & apiToken',
      '  End If',
      '  xhr.send',
      '  If Err.Number <> 0 Then',
      '    HttpCheck = """status"":""FAIL"",""url"":""" & JsonEscape(url) & """,""http_status"":null,""error"":""" & JsonEscape(Err.Description) & """"',
      '    Err.Clear',
      '  ElseIf xhr.Status >= 200 And xhr.Status < 300 And InStr(xhr.responseText, expectedText) > 0 Then',
      '    HttpCheck = """status"":""PASS"",""url"":""" & JsonEscape(url) & """,""http_status"":" & xhr.Status',
      '  Else',
      '    HttpCheck = """status"":""FAIL"",""url"":""" & JsonEscape(url) & """,""http_status"":" & xhr.Status',
      '  End If',
      '  On Error GoTo 0',
      'End Function',
      'checkedAt = Year(Now) & "-" & Right("0" & Month(Now), 2) & "-" & Right("0" & Day(Now), 2) & "T" & Right("0" & Hour(Now), 2) & ":" & Right("0" & Minute(Now), 2) & ":" & Right("0" & Second(Now), 2)',
      'localHealth = HttpCheck("http://127.0.0.1:3000/health", """ok"":true")',
      'lmStudio = HttpCheck("http://localhost:1234/v1/models", "data")',
      'overall = "PASS"',
      'If InStr(localHealth, """FAIL""") > 0 Or InStr(lmStudio, """FAIL""") > 0 Then overall = "FAIL"',
      'line = "{""checked_at"":""" & checkedAt & """,""status"":""" & overall & """,""runner"":""wscript"",""checks"":{""local_health"":{" & localHealth & "},""lmstudio_models"":{" & lmStudio & "}}}"',
      'Set stream = fso.OpenTextFile(logFile, 8, True)',
      'stream.WriteLine line',
      'stream.Close',
      ""
    ].join("\r\n");
  }

  return [
    'Set shell = CreateObject("WScript.Shell")',
    `shell.CurrentDirectory = "${vbString(PROJECT_ROOT)}"`,
    `shell.Run "${vbString(task.command)}", 0, False`,
    ""
  ].join("\r\n");
}

function writeLauncher(kind, task) {
  fs.mkdirSync(LAUNCHER_DIR, { recursive: true });
  const filePath = launcherPath(kind);
  fs.writeFileSync(filePath, launcherCommand(task), "utf8");
  return filePath;
}

function wscriptArguments(kind) {
  return `//B //Nologo "${launcherPath(kind)}"`;
}

function buildSchtasksArgs(kind, task) {
  const args = [
    "/Create",
    "/TN",
    task.name,
    "/TR",
    `wscript.exe ${wscriptArguments(kind)}`,
    "/SC",
    task.schedule,
    "/F"
  ];
  if (task.modifier) {
    args.push("/MO", task.modifier);
  }
  return args;
}

function xmlEscape(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function buildTaskXml(kind, task) {
  const userDomain = process.env.USERDOMAIN || ".";
  const userName = process.env.USERNAME || process.env.USER || "";
  const userId = userName ? `${userDomain}\\${userName}` : "";
  const trigger =
    task.schedule === "ONLOGON"
      ? "<LogonTrigger><Enabled>true</Enabled></LogonTrigger>"
      : `<CalendarTrigger><Repetition><Interval>PT${task.modifier || 5}M</Interval><StopAtDurationEnd>false</StopAtDurationEnd></Repetition><StartBoundary>2026-01-01T00:00:00</StartBoundary><Enabled>true</Enabled><ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay></CalendarTrigger>`;

  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>LINE Bot Local AI Gateway Skill production ${xmlEscape(task.schedule)} task.</Description>
  </RegistrationInfo>
  <Triggers>
    ${trigger}
  </Triggers>
  <Principals>
    <Principal id="Author">
      ${userId ? `<UserId>${xmlEscape(userId)}</UserId>` : ""}
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings>
      <StopOnIdleEnd>false</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>true</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT12H</ExecutionTimeLimit>
    <Priority>7</Priority>
    <RestartOnFailure>
      <Interval>PT${task.retry.restart_interval_minutes}M</Interval>
      <Count>${task.retry.restart_count}</Count>
    </RestartOnFailure>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>wscript.exe</Command>
      <Arguments>${xmlEscape(wscriptArguments(kind))}</Arguments>
    </Exec>
  </Actions>
</Task>
`;
}

function writeTaskXml(kind, task) {
  fs.mkdirSync(LAUNCHER_DIR, { recursive: true });
  const xmlPath = path.join(LAUNCHER_DIR, `${kind}-task.xml`);
  const content = Buffer.from(buildTaskXml(kind, task), "utf16le");
  fs.writeFileSync(xmlPath, Buffer.concat([Buffer.from([0xff, 0xfe]), content]));
  return xmlPath;
}

function buildScheduledTasksPowerShell(kind, task) {
  const escapedName = task.name.replace(/'/g, "''");
  const escapedArguments = wscriptArguments(kind).replace(/'/g, "''");
  const trigger =
    task.schedule === "ONLOGON"
      ? "$trigger = New-ScheduledTaskTrigger -AtLogOn"
      : `$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).Date -RepetitionInterval (New-TimeSpan -Minutes ${task.modifier || 5}) -RepetitionDuration (New-TimeSpan -Days 3650)`;
  return [
    `$action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument '${escapedArguments}'`,
    trigger,
    `$settings = New-ScheduledTaskSettingsSet -RestartCount ${task.retry.restart_count} -RestartInterval (New-TimeSpan -Minutes ${task.retry.restart_interval_minutes}) -ExecutionTimeLimit (New-TimeSpan -Hours 12)`,
    "$settings.Hidden = $true",
    `Register-ScheduledTask -TaskName '${escapedName}' -Action $action -Trigger $trigger -Settings $settings -Force`
  ];
}

async function queryTask(name) {
  return exec("schtasks.exe", ["/Query", "/TN", name, "/FO", "LIST", "/V"]);
}

async function main() {
  const kind = argValue("--task", "runtime");
  const task = TASKS[kind];
  if (!task) {
    throw new Error(`Unsupported --task=${kind}. Expected one of: ${Object.keys(TASKS).join(", ")}`);
  }

  const executeMutation = hasFlag("--execute");
  const query = await queryTask(task.name);
  const createArgs = buildSchtasksArgs(kind, task);

  if (!executeMutation) {
    console.log(
      JSON.stringify(
        {
          status: "PASS",
          mode: "dry_run",
          task_kind: kind,
          task_name: task.name,
          existing_task_found: query.ok,
          schedule: task.schedule,
          modifier: task.modifier || null,
          retry_policy: task.retry,
          command: task.command,
          hidden_launcher: {
            execute: "wscript.exe",
            arguments: wscriptArguments(kind),
            launcher_file: launcherPath(kind)
          },
          compatibility_schtasks_executable: "schtasks.exe",
          compatibility_schtasks_args: createArgs,
          execute_executable: "powershell.exe",
          execute_args: [
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            buildScheduledTasksPowerShell(kind, task).join("; ")
          ],
          scheduledtasks_powershell_plan: buildScheduledTasksPowerShell(kind, task),
          execute_required: true,
          note:
            "Scheduled task creation mutates Windows task state and must be run only after approval with --execute. schtasks args are shown for compatibility; ScheduledTasks PowerShell plan includes retry settings."
        },
        null,
        2
      )
    );
    return;
  }

  const launcherFile = writeLauncher(kind, task);
  const created = await execPowerShell(buildScheduledTasksPowerShell(kind, task));
  let creationMethod = "scheduledtasks_powershell";
  let fallback = null;
  let after = await queryTask(task.name);

  if (!created.ok || !after.ok) {
    const xmlPath = writeTaskXml(kind, task);
    fallback = await exec("schtasks.exe", ["/Create", "/TN", task.name, "/XML", xmlPath, "/F"]);
    creationMethod = fallback.ok ? "schtasks_xml_fallback" : creationMethod;
    after = await queryTask(task.name);
  }

  console.log(
    JSON.stringify(
      {
        status: (created.ok || fallback?.ok) && after.ok ? "PASS" : "FAIL",
        task_kind: kind,
        task_name: task.name,
        launcher_file: launcherFile,
        creation_method: creationMethod,
        create_code: created.code,
        create_stdout_present: Boolean(created.stdout),
        create_stderr_present: Boolean(created.stderr),
        fallback_code: fallback?.code ?? null,
        fallback_stdout_present: Boolean(fallback?.stdout),
        fallback_stderr_present: Boolean(fallback?.stderr),
        query_after_found: after.ok,
        create_stderr: created.ok ? null : created.stderr.trim(),
        fallback_stderr: fallback && !fallback.ok ? fallback.stderr.trim() : null,
        query_after_stderr: after.ok ? null : after.stderr.trim()
      },
      null,
      2
    )
  );
  process.exitCode = (created.ok || fallback?.ok) && after.ok ? 0 : 2;
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        status: "FAIL",
        error_class: error?.name || "Error",
        error_message: error?.message || String(error)
      },
      null,
      2
    )
  );
  process.exitCode = 2;
});
