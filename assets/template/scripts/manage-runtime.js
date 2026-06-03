const { execFile } = require("child_process");
const path = require("path");
const { readConfig } = require("../src/config");

const PROJECT_ROOT = path.resolve(__dirname, "..");

function argValue(name, fallback = "") {
  const prefix = `${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function exec(command, args, options = {}) {
  return new Promise((resolve) => {
    execFile(command, args, { cwd: PROJECT_ROOT, windowsHide: true, ...options }, (error, stdout, stderr) => {
      resolve({
        ok: !error,
        code: error?.code || 0,
        stdout: String(stdout || ""),
        stderr: String(stderr || "")
      });
    });
  });
}

async function fetchHealth(config) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(`http://127.0.0.1:${config.port}/health`, {
      signal: controller.signal
    });
    const body = await response.json().catch(() => ({}));
    return {
      ok: response.ok && body?.ok === true,
      http_status: response.status,
      body
    };
  } catch (error) {
    return {
      ok: false,
      http_status: null,
      error_class: error?.name || "Error",
      error_message: error?.message || String(error)
    };
  } finally {
    clearTimeout(timer);
  }
}

async function findPortPid(port) {
  const result = await exec("netstat.exe", ["-ano"]);
  if (!result.ok) {
    return {
      ok: false,
      error: result.stderr || result.stdout || "netstat failed"
    };
  }

  const pattern = new RegExp(`(?:0\\.0\\.0\\.0|\\[::\\]|127\\.0\\.0\\.1):${port}\\s+\\S+\\s+LISTENING\\s+(\\d+)`, "i");
  for (const line of result.stdout.split(/\r?\n/)) {
    const match = line.match(pattern);
    if (match) {
      return {
        ok: true,
        pid: Number.parseInt(match[1], 10),
        line: line.trim()
      };
    }
  }

  return {
    ok: true,
    pid: null,
    line: null
  };
}

async function status() {
  const config = readConfig();
  const port = config.port;
  const [portResult, health] = await Promise.all([findPortPid(port), fetchHealth(config)]);
  const isLineBot = Boolean(
    health.ok &&
      health.body?.modelProvider === "lmstudio" &&
      typeof health.body?.modelName === "string" &&
      health.body.modelName.length > 0
  );

  return {
    status: health.ok && portResult.pid ? "PASS" : "FAIL",
    port,
    listener_pid: portResult.pid,
    listener_line: portResult.line,
    health,
    identified_as_line_bot: isLineBot
  };
}

async function main() {
  const action = argValue("--action", "status");
  const executeMutation = hasFlag("--execute");
  const currentStatus = await status();

  if (action === "status") {
    console.log(JSON.stringify(currentStatus, null, 2));
    process.exitCode = currentStatus.status === "PASS" ? 0 : 2;
    return;
  }

  if (!["start", "stop", "restart"].includes(action)) {
    throw new Error(`Unsupported --action=${action}`);
  }

  if (!executeMutation) {
    console.log(
      JSON.stringify(
        {
          status: "PASS",
          mode: "dry_run",
          action,
          current_status: currentStatus,
          execute_required: true,
          note:
            "Runtime start/stop/restart mutates local service state and must be run only after approval with --execute."
        },
        null,
        2
      )
    );
    return;
  }

  if (action === "stop" || action === "restart") {
    if (!currentStatus.identified_as_line_bot || !currentStatus.listener_pid) {
      throw new Error("Refusing to stop process because port 3000 is not identified as this LINE Bot.");
    }
    await exec("taskkill.exe", ["/PID", String(currentStatus.listener_pid), "/T", "/F"]);
  }

  if (action === "start" || action === "restart") {
    await exec("cmd.exe", ["/d", "/c", "start", '""', "/min", "cmd.exe", "/d", "/c", "npm start"], {
      cwd: PROJECT_ROOT
    });
  }

  const after = await status();
  console.log(
    JSON.stringify(
      {
        status: after.status,
        action,
        before: currentStatus,
        after
      },
      null,
      2
    )
  );
  process.exitCode = after.status === "PASS" ? 0 : 2;
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
