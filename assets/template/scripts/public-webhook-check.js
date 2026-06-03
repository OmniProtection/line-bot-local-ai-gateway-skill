const DEFAULT_PUBLIC_BASE_URL = "https://linebot.sidekick.idv.tw";
const DEFAULT_TIMEOUT_MS = 8000;

function hasFlag(name) {
  return process.argv.includes(name);
}

function argValue(name, fallback = "") {
  const prefix = `${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function normalizeBaseUrl(url) {
  return String(url || "").replace(/\/+$/, "");
}

function parseTimeoutMs() {
  const parsed = Number.parseInt(argValue("--timeout-ms", String(DEFAULT_TIMEOUT_MS)), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
}

async function fetchWithTimeout(url, options = {}) {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || DEFAULT_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: options.method || "GET",
      headers: options.headers || {},
      body: options.body,
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
      http_status: response.status,
      duration_ms: Date.now() - startedAt,
      body
    };
  } catch (error) {
    return {
      ok: false,
      http_status: null,
      duration_ms: Date.now() - startedAt,
      error_class: error?.name || "Error",
      error_message: error?.message || String(error)
    };
  } finally {
    clearTimeout(timer);
  }
}

async function checkPublicHealth(url, timeoutMs) {
  const result = await fetchWithTimeout(`${url}/health`, { timeoutMs });
  return {
    status: result.ok && result.body?.ok === true ? "PASS" : "FAIL",
    url: `${url}/health`,
    ...result
  };
}

async function checkUnsignedWebhook(url, timeoutMs) {
  const result = await fetchWithTimeout(`${url}/webhook`, {
    timeoutMs,
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ events: [] })
  });
  const invalidSignature = result.body?.error === "invalid_signature";
  return {
    status: invalidSignature ? "PASS" : "FAIL",
    url: `${url}/webhook`,
    expected_error: "invalid_signature",
    ...result
  };
}

async function main() {
  const baseUrl = normalizeBaseUrl(
    argValue("--public-base-url", process.env.PUBLIC_BASE_URL || DEFAULT_PUBLIC_BASE_URL)
  );
  const timeoutMs = parseTimeoutMs();
  const execute = hasFlag("--execute");
  const planned = {
    public_health_url: `${baseUrl}/health`,
    unsigned_webhook_url: `${baseUrl}/webhook`,
    unsigned_webhook_method: "POST",
    unsigned_webhook_body_shape: { events: [] },
    expected_unsigned_webhook_error: "invalid_signature"
  };

  if (!execute) {
    console.log(
      JSON.stringify(
        {
          status: "PASS",
          mode: "dry_run",
          execute_required: true,
          note:
            "Public endpoint checks contact the approved public route and must be run only after Gate B approval with --execute.",
          planned
        },
        null,
        2
      )
    );
    return;
  }

  const checks = {
    public_health: await checkPublicHealth(baseUrl, timeoutMs),
    unsigned_webhook_rejection: await checkUnsignedWebhook(baseUrl, timeoutMs)
  };
  const failed = Object.values(checks).filter((check) => check.status !== "PASS");
  const summary = {
    status: failed.length === 0 ? "PASS" : "FAIL",
    checked_at: new Date().toISOString(),
    base_url: baseUrl,
    checks
  };
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
