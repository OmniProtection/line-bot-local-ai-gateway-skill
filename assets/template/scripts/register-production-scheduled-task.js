const { execFile } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const TASKS = {
  runtime: {
    name: "JARVIS Local Free LINE Bot",
    schedule: "ONLOGON",
    command: `cmd.exe /d /c "cd /d ${PROJECT_ROOT} && npm start"`,
    retry: {
      restart_count: 3,
      restart_interval_minutes: 1
    }
  },
  health: {
    name: "JARVIS Local Free LINE Bot Health Check",
    schedule: "MINUTE",
    modifier: "5",
    command: `cmd.exe /d /c "cd /d ${PROJECT_ROOT} && npm run prod:health:local -- --write-log"`,
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

function buildSchtasksArgs(task) {
  const args = ["/Create", "/TN", task.name, "/TR", task.command, "/SC", task.schedule, "/F"];
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

function taskArguments(task) {
  return task.command.replace(/^cmd\.exe \/d \/c /i, "");
}

function buildTaskXml(task) {
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
    <Description>JARVIS local-free-line-bot production ${xmlEscape(task.schedule)} task.</Description>
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
    <Hidden>false</Hidden>
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
      <Command>cmd.exe</Command>
      <Arguments>${xmlEscape(taskArguments(task))}</Arguments>
    </Exec>
  </Actions>
</Task>
`;
}

function writeTaskXml(kind, task) {
  const outDir = path.join(PROJECT_ROOT, "logs", "production-task-definitions");
  fs.mkdirSync(outDir, { recursive: true });
  const xmlPath = path.join(outDir, `${kind}-task.xml`);
  const content = Buffer.from(buildTaskXml(task), "utf16le");
  fs.writeFileSync(xmlPath, Buffer.concat([Buffer.from([0xff, 0xfe]), content]));
  return xmlPath;
}

function buildScheduledTasksPowerShell(task) {
  const escapedName = task.name.replace(/'/g, "''");
  const escapedCommand = task.command.replace(/'/g, "''");
  const trigger =
    task.schedule === "ONLOGON"
      ? "$trigger = New-ScheduledTaskTrigger -AtLogOn"
      : `$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).Date -RepetitionInterval (New-TimeSpan -Minutes ${task.modifier || 5}) -RepetitionDuration (New-TimeSpan -Days 3650)`;
  return [
    `$action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument '/d /c ${escapedCommand.replace(/^cmd\.exe \/d \/c /i, "")}'`,
    trigger,
    `$settings = New-ScheduledTaskSettingsSet -RestartCount ${task.retry.restart_count} -RestartInterval (New-TimeSpan -Minutes ${task.retry.restart_interval_minutes}) -ExecutionTimeLimit (New-TimeSpan -Hours 12)`,
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
  const createArgs = buildSchtasksArgs(task);

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
          compatibility_schtasks_executable: "schtasks.exe",
          compatibility_schtasks_args: createArgs,
          execute_executable: "powershell.exe",
          execute_args: [
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            buildScheduledTasksPowerShell(task).join("; ")
          ],
          scheduledtasks_powershell_plan: buildScheduledTasksPowerShell(task),
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

  const created = await execPowerShell(buildScheduledTasksPowerShell(task));
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
