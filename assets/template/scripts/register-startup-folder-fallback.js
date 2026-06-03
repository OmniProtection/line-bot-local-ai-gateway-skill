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
const STARTUP_FILE = path.join(STARTUP_DIR, "Local Free LINE Bot.cmd");

function hasFlag(name) {
  return process.argv.includes(name);
}

function startupCommand() {
  return [
    "@echo off",
    "setlocal",
    `cd /d "${PROJECT_ROOT}"`,
    "npm start",
    "endlocal",
    ""
  ].join("\r\n");
}

function inspect() {
  const exists = fs.existsSync(STARTUP_FILE);
  const content = exists ? fs.readFileSync(STARTUP_FILE, "utf8") : "";
  return {
    startup_dir: STARTUP_DIR,
    startup_file: STARTUP_FILE,
    exists,
    command_points_to_project: content.includes(PROJECT_ROOT),
    command_uses_npm_start: /\bnpm start\b/.test(content),
    size_bytes: exists ? fs.statSync(STARTUP_FILE).size : 0
  };
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
          existing_file_found: before.exists,
          planned_command_points_to_project: true,
          planned_command_uses_npm_start: true,
          execute_required: true,
          note: "Startup folder fallback mutates user login startup and must be executed only after explicit approval with --execute."
        },
        null,
        2
      )
    );
    return;
  }

  fs.mkdirSync(STARTUP_DIR, { recursive: true });
  fs.writeFileSync(STARTUP_FILE, startupCommand(), "utf8");
  const after = inspect();
  const pass = after.exists && after.command_points_to_project && after.command_uses_npm_start;

  console.log(
    JSON.stringify(
      {
        status: pass ? "PASS" : "FAIL",
        mode: "execute",
        startup_dir: STARTUP_DIR,
        startup_file: STARTUP_FILE,
        file_created_or_updated: after.exists,
        command_points_to_project: after.command_points_to_project,
        command_uses_npm_start: after.command_uses_npm_start,
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
