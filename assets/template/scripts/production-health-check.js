const { readConfig } = require("../src/config");
const fs = require("fs");
const path = require("path");

const DEFAULT_PUBLIC_HEALTH_URL = "https://linebot.sidekick.idv.tw/health";
const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_MAX_LOG_BYTES = 1024 * 1024;
const PROJECT_ROOT = path.resolve(__dirname, "..");
const DEFAULT_LOG_DIR = path.join(PROJECT_ROOT, "logs", "production-health");

function hasFlag(name) {
  return process.argv.includes(name);
}

function readArgValue(name, fallback) {
  const prefix = `${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function parseTimeoutMs() {
  const raw = readArgValue("--timeout-ms", String(DEFAULT_TIMEOUT_MS));
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
}

function shouldWriteLog() {
  return hasFlag("--write-log");
}

function logDir() {
  return path.resolve(readArgValue("--log-dir", process.env.PROD_HEALTH_LOG_DIR || DEFAULT_LOG_DIR));
}

function maxLogBytes() {
  const raw = readArgValue("--max-log-bytes", process.env.PROD_HEALTH_MAX_LOG_BYTES || String(DEFAULT_MAX_LOG_BYTES));
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_LOG_BYTES;
}

function assertInsideProject(filePath) {
  const resolved = path.resolve(filePath);
  if (!resolved.toLowerCase().startsWith(PROJECT_ROOT.toLowerCase() + path.sep.toLowerCase())) {
    throw new Error(`Refusing to write health log outside project root: ${resolved}`);
  }
}

function writeHealthLog(summary) {
  const dir = logDir();
  assertInsideProject(dir);
  fs.mkdirSync(dir, { recursive: true });
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const filePath = path.join(dir, `health-${day}.jsonl`);
  fs.appendFileSync(filePath, `${JSON.stringify(summary)}\n`, "utf8");
  const maxBytes = maxLogBytes();
  let truncated = false;
  const stat = fs.statSync(filePath);
  if (stat.size > maxBytes) {
    const fd = fs.openSync(filePath, "r");
    try {
      const buffer = Buffer.alloc(maxBytes);
      fs.readSync(fd, buffer, 0, maxBytes, stat.size - maxBytes);
      const text = buffer.toString("utf8");
      const firstNewline = text.indexOf("\n");
      fs.writeFileSync(filePath, firstNewline >= 0 ? text.slice(firstNewline + 1) : text, "utf8");
      truncated = true;
    } finally {
      fs.closeSync(fd);
    }
  }
  const after = fs.statSync(filePath);
  return {
    file_path: filePath,
    max_log_bytes: maxBytes,
    size_bytes: after.size,
    truncated
  };
}

async function fetchJson(url, options = {}) {
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      headers: options.headers || {},
      method: options.method || "GET",
      signal: controller.signal
    });
    const text = await response.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = { raw_text_present: Boolean(text) };
    }

    return {
      ok: response.ok,
      status: response.status,
      duration_ms: Date.now() - startedAt,
      body
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      duration_ms: Date.now() - startedAt,
      error_class: error?.name || "Error",
      error_message: error?.message || String(error)
    };
  } finally {
    clearTimeout(timer);
  }
}

function passCheck(details) {
  return {
    status: "PASS",
    ...details
  };
}

function failCheck(details) {
  return {
    status: "FAIL",
    ...details
  };
}

function skippedCheck(reason) {
  return {
    status: "PASS",
    mode: "skipped",
    reason
  };
}

async function checkLocalHealth(config, timeoutMs) {
  const url = `http://127.0.0.1:${config.port}/health`;
  const result = await fetchJson(url, { timeoutMs });
  if (result.ok && result.body?.ok === true) {
    return passCheck({
      url,
      http_status: result.status,
      duration_ms: result.duration_ms,
      model_provider: result.body.modelProvider || null,
      model_name: result.body.modelName || null
    });
  }

  return failCheck({
    url,
    http_status: result.status,
    duration_ms: result.duration_ms,
    error_class: result.error_class || null,
    error_message: result.error_message || null
  });
}

async function checkLmStudio(config, timeoutMs) {
  const url = `${config.localModelBaseUrl.replace(/\/+$/, "")}/models`;
  const headers = {};
  if (config.localModelApiToken) {
    headers.authorization = `Bearer ${config.localModelApiToken}`;
  }

  const result = await fetchJson(url, { headers, timeoutMs });
  if (result.ok) {
    return passCheck({
      url,
      http_status: result.status,
      duration_ms: result.duration_ms,
      token_present: Boolean(config.localModelApiToken),
      model_name_configured: config.localModelName
    });
  }

  return failCheck({
    url,
    http_status: result.status,
    duration_ms: result.duration_ms,
    token_present: Boolean(config.localModelApiToken),
    error_class: result.error_class || null,
    error_message: result.error_message || null
  });
}

async function checkPublicHealth(timeoutMs) {
  if (hasFlag("--skip-public")) {
    return skippedCheck("public health skipped by --skip-public");
  }

  const url = readArgValue(
    "--public-health-url",
    process.env.PUBLIC_HEALTH_URL || DEFAULT_PUBLIC_HEALTH_URL
  );
  const result = await fetchJson(url, { timeoutMs });
  if (result.ok && result.body?.ok === true) {
    return passCheck({
      url,
      http_status: result.status,
      duration_ms: result.duration_ms
    });
  }

  return failCheck({
    url,
    http_status: result.status,
    duration_ms: result.duration_ms,
    error_class: result.error_class || null,
    error_message: result.error_message || null
  });
}

async function main() {
  const config = readConfig();
  const timeoutMs = parseTimeoutMs();
  const checks = {
    local_health: await checkLocalHealth(config, timeoutMs),
    lmstudio_models: await checkLmStudio(config, timeoutMs),
    public_health: await checkPublicHealth(timeoutMs)
  };

  const failed = Object.values(checks).filter((check) => check.status === "FAIL");
  const summary = {
    status: failed.length === 0 ? "PASS" : "FAIL",
    checked_at: new Date().toISOString(),
    checks
  };

  if (shouldWriteLog()) {
    summary.log = writeHealthLog(summary);
  }

  console.log(JSON.stringify(summary, null, 2));
  process.exitCode = failed.length === 0 ? 0 : 2;
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
