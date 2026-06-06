const fs = require("fs");
const os = require("os");
const path = require("path");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const STARTUP_DIR = path.join(
  os.homedir(),
  "AppData",
  "Roaming",
  "Microsoft",
  "Windows",
  "Start Menu",
  "Programs",
  "Startup"
);
const STARTUP_FILE = path.join(STARTUP_DIR, "LINE Bot Local AI Gateway Skill.vbs");
const LEGACY_STARTUP_FILE = path.join(STARTUP_DIR, "JARVIS Local Free LINE Bot.cmd");

function hasFlag(name) {
  return process.argv.includes(name);
}

function vbString(value) {
  return String(value).replace(/"/g, '""');
}

function startupCommand() {
  return [
    'Set shell = CreateObject("WScript.Shell")',
    `shell.CurrentDirectory = "${vbString(PROJECT_ROOT)}"`,
    `shell.Run "${vbString(`"${process.execPath}" "src\\server.js"`)}", 0, False`,
    ""
  ].join("\r\n");
}

function inspect() {
  const exists = fs.existsSync(STARTUP_FILE);
  const content = exists ? fs.readFileSync(STARTUP_FILE, "utf8") : "";
  return {
    startup_dir: STARTUP_DIR,
    startup_file: STARTUP_FILE,
    legacy_startup_file: LEGACY_STARTUP_FILE,
    exists,
    legacy_cmd_exists: fs.existsSync(LEGACY_STARTUP_FILE),
    command_points_to_project: content.includes(PROJECT_ROOT),
    command_uses_node_server: content.includes(process.execPath) && /src\\server\.js/.test(content),
    hidden_window_style: /shell\.Run[\s\S]*,\s*0\s*,\s*False/i.test(content),
    size_bytes: exists ? fs.statSync(STARTUP_FILE).size : 0
  };
}

function disableLegacyCmd() {
  if (!fs.existsSync(LEGACY_STARTUP_FILE)) {
    return null;
  }
  let disabledPath = `${LEGACY_STARTUP_FILE}.disabled`;
  if (fs.existsSync(disabledPath)) {
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
    disabledPath = `${LEGACY_STARTUP_FILE}.${stamp}.disabled`;
  }
  fs.renameSync(LEGACY_STARTUP_FILE, disabledPath);
  return disabledPath;
}

function main() {
  const execute = hasFlag("--execute");
  const before = inspect();

  if (!execute) {
    console.log(
      JSON.stringify(
        {
          status: "PASS",
          mode: "dry_run",
          startup_dir: STARTUP_DIR,
          startup_file: STARTUP_FILE,
          legacy_startup_file: LEGACY_STARTUP_FILE,
          existing_file_found: before.exists,
          legacy_cmd_exists: before.legacy_cmd_exists,
          planned_command_points_to_project: true,
          planned_command_uses_node_server: true,
          planned_hidden_window_style: true,
          execute_required: true,
          note: "Startup folder fallback mutates user login startup and must be executed only after explicit approval with --execute. It uses a hidden VBS launcher and disables the legacy visible CMD launcher if present."
        },
        null,
        2
      )
    );
    return;
  }

  fs.mkdirSync(STARTUP_DIR, { recursive: true });
  fs.writeFileSync(STARTUP_FILE, startupCommand(), "utf8");
  const disabled_legacy_cmd = disableLegacyCmd();
  const after = inspect();
  const pass =
    after.exists &&
    after.command_points_to_project &&
    after.command_uses_node_server &&
    after.hidden_window_style &&
    !after.legacy_cmd_exists;

  console.log(
    JSON.stringify(
      {
        status: pass ? "PASS" : "FAIL",
        mode: "execute",
        startup_dir: STARTUP_DIR,
        startup_file: STARTUP_FILE,
        file_created_or_updated: after.exists,
        command_points_to_project: after.command_points_to_project,
        command_uses_node_server: after.command_uses_node_server,
        hidden_window_style: after.hidden_window_style,
        disabled_legacy_cmd,
        legacy_cmd_exists_after: after.legacy_cmd_exists,
        size_bytes: after.size_bytes,
        scheduled_task_required: false,
        fallback_kind: "startup_folder"
      },
      null,
      2
    )
  );
  process.exitCode = pass ? 0 : 2;
}

main();
