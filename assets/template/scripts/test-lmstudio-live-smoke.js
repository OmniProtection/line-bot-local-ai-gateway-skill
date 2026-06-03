const fs = require("node:fs");
const path = require("node:path");
const { askLocalModel, askLocalModelWithWebSearchTools } = require("../src/lmStudioClient");
const { DEFAULTS, readConfig } = require("../src/config");

function normalizeBaseUrl(value) {
  return String(value || "").replace(/\/+$/u, "");
}

async function canReachLmStudio(config) {
  const url = `${normalizeBaseUrl(config.localModelBaseUrl)}/models`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1500);
  const headers = {};
  if (config.localModelApiToken) {
    headers.authorization = `Bearer ${config.localModelApiToken}`;
  }

  try {
    const response = await fetch(url, { headers, signal: controller.signal });
    return {
      ok: response.ok,
      status: response.status,
      url
    };
  } catch (error) {
    return {
      error: error?.name || "Error",
      ok: false,
      url
    };
  } finally {
    clearTimeout(timeout);
  }
}

function smokeConfig() {
  const config = {
    ...readConfig(),
    lineChannelAccessToken: "live-smoke-no-line-token",
    lineChannelSecret: "live-smoke-no-line-secret"
  };

  return {
    ...config,
    localModelProvider: "lmstudio",
    localModelBaseUrl: config.localModelBaseUrl || DEFAULTS.localModelBaseUrl,
    localModelRestBaseUrl: config.localModelRestBaseUrl || DEFAULTS.localModelRestBaseUrl,
    localModelName: config.localModelName || "google/gemma-4-e4b",
    localModelTimeoutMs: Number.isFinite(config.localModelTimeoutMs)
      ? config.localModelTimeoutMs
      : DEFAULTS.localModelTimeoutMs,
    maxReplyChars: Number.isFinite(config.maxReplyChars) ? config.maxReplyChars : 800,
    webSearchLmstudioToolsEnabled: true,
    webSearchLmstudioPluginId: config.webSearchLmstudioPluginId || "npacker/web-tools"
  };
}

function classifyText(text) {
  const value = String(text || "");
  return {
    chars: value.length,
    hasChinese: /[\u4e00-\u9fff]/u.test(value),
    hasMarkdownLink: /\[[^\]]+\]\(https?:\/\/[^)]+\)/u.test(value),
    hasUrl: /https?:\/\//u.test(value),
    nonEmpty: value.trim().length > 0
  };
}

async function runGeneralSmoke(config) {
  const prompts = ["你好", "請用一句話說明你能做什麼", "今天適合測試 LINE Bot 嗎？"];
  const results = [];

  for (const prompt of prompts) {
    const startedAt = Date.now();
    const result = await askLocalModel(prompt, config, null, {
      maxEmptyResponseRetries: 0,
      timeoutMs: 1300
    });
    results.push({
      duration_ms: Date.now() - startedAt,
      fallback_used: result.fallbackUsed,
      prompt,
      reason: result.reason,
      text: classifyText(result.text)
    });
  }

  return results;
}

async function runSearchToolSmoke(config) {
  const queries = ["OpenAI 最新消息", "台積電今天股價", "台北今天氣溫", "LINE Messaging API 文件"];
  const timeoutMs = Number.parseInt(process.env.LMSTUDIO_LIVE_SEARCH_TIMEOUT_MS || "20000", 10);
  const results = [];

  for (const query of queries) {
    const startedAt = Date.now();
    const result = await askLocalModelWithWebSearchTools(query, config, {
      timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 20000
    });
    results.push({
      duration_ms: Date.now() - startedAt,
      ok: result.ok,
      query,
      reason: result.reason,
      status_code: result.statusCode || null,
      text: classifyText(result.text)
    });
  }

  return results;
}

function inspectRuntimeSearchPath() {
  const server = fs.readFileSync(path.join(__dirname, "..", "src", "server.js"), "utf8");
  return {
    uses_stable_evidence_search: server.includes("services.searchWeb"),
    depends_on_lmstudio_web_tools: server.includes("askLocalModelWithWebSearchTools")
  };
}

async function run() {
  const config = smokeConfig();
  const reachability = await canReachLmStudio(config);
  if (!reachability.ok) {
    const reason = reachability.status === 401 ? "lmstudio_auth_required" : "lmstudio_unreachable";
    console.log(
      JSON.stringify(
        {
          status: "PASS",
          mode: "skipped",
          reason,
          reachability
        },
        null,
        2
      )
    );
    return;
  }

  const general = await runGeneralSmoke(config);
  const search_tools = await runSearchToolSmoke(config);
  const runtime_search_path = inspectRuntimeSearchPath();
  const directSuccesses = general.filter((item) => item.fallback_used === false).length;
  const searchSuccesses = search_tools.filter((item) => item.ok === true).length;
  const searchToolTimeouts = search_tools.filter((item) => item.reason === "timeout").length;

  console.log(
    JSON.stringify(
      {
        status: "PASS",
        model: config.localModelName,
        reachability,
        summary: {
          direct_reply_successes: directSuccesses,
          direct_reply_total: general.length,
          search_tool_successes: searchSuccesses,
          search_tool_total: search_tools.length,
          search_tool_timeouts: searchToolTimeouts,
          search_tool_status:
            searchToolTimeouts === search_tools.length ? "UNAVAILABLE_TIMEOUT" : "OBSERVED",
          line_runtime_depends_on_web_tools: runtime_search_path.depends_on_lmstudio_web_tools
        },
        general,
        runtime_search_path,
        search_tools
      },
      null,
      2
    )
  );
}

run().catch((error) => {
  console.error(
    JSON.stringify(
      {
        status: "FAIL",
        error: error?.stack || error?.message || String(error)
      },
      null,
      2
    )
  );
  process.exitCode = 1;
});
