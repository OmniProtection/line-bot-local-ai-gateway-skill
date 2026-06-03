const path = require("node:path");
const dotenv = require("dotenv");

dotenv.config({ path: path.join(__dirname, "..", ".env") });

const DEFAULT_QUERIES = [
  "OpenAI 最新消息",
  "台積電今天股價",
  "美元兌台幣匯率",
  "台北明天天氣",
  "5060TI",
  "忠孝東路大安路口附近韓式烤肉",
  "2026 台灣最低工資",
  "高鐵台北到左營今日時刻表",
  "Gemma 4 E4B LM Studio",
  "OpenClaw"
];

function normalizeBaseUrl(value) {
  return String(value || "").replace(/\/+$/, "");
}

function headers(token) {
  const result = { "content-type": "application/json" };
  if (token) {
    result.authorization = `Bearer ${token}`;
  }
  return result;
}

function hasUrl(text) {
  return /https?:\/\/[^\s)）\]}>"']+/i.test(String(text || ""));
}

function hasBadUrl(text) {
  return /duckduckgo\.com\/y\.js|bing\.com\/aclick|googleadservices|doubleclick|\/url\?/i.test(
    String(text || "")
  );
}

function extractRestChatText(payload) {
  const output = Array.isArray(payload?.output) ? payload.output : [];
  for (let index = output.length - 1; index >= 0; index -= 1) {
    const item = output[index];
    if (item?.type !== "message") {
      continue;
    }
    if (typeof item.content === "string" && item.content.trim()) {
      return item.content.trim();
    }
    if (Array.isArray(item.content)) {
      const text = item.content
        .map((part) => {
          if (typeof part === "string") {
            return part;
          }
          if (typeof part?.text === "string") {
            return part.text;
          }
          return "";
        })
        .join("")
        .trim();
      if (text) {
        return text;
      }
    }
  }
  return "";
}

async function checkSearxng(searxngUrl) {
  const url = new URL(`${normalizeBaseUrl(searxngUrl)}/search`);
  url.searchParams.set("q", "OpenAI");
  url.searchParams.set("format", "json");
  const response = await fetch(url.href, {
    headers: { accept: "application/json" }
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = JSON.parse(text);
  } catch {
    // Keep the report bounded.
  }
  return {
    ok: response.ok && Array.isArray(payload?.results),
    status: response.status,
    result_count: Array.isArray(payload?.results) ? payload.results.length : 0,
    reason: response.status === 403 ? "json_format_forbidden" : response.ok ? "success" : "http_non_200"
  };
}

async function callLmStudio(query, config) {
  const response = await fetch(`${normalizeBaseUrl(config.restBaseUrl)}/chat`, {
    method: "POST",
    headers: headers(config.apiToken),
    body: JSON.stringify({
      model: config.model,
      input: [
        "請使用 web_search 工具搜尋網路，根據工具結果用繁體中文回答，並附來源 URL。",
        "不要只用模型記憶回答。不要輸出思考過程或 <think>。",
        `搜尋需求：${query}`
      ].join("\n"),
      integrations: [
        {
          type: "plugin",
          id: config.pluginId,
          allowed_tools: ["web_search"]
        }
      ],
      context_length: Number.parseInt(config.contextLength, 10) || 8192,
      max_output_tokens: 900,
      temperature: 0.2
    })
  });

  const raw = await response.text();
  let payload = null;
  try {
    payload = JSON.parse(raw);
  } catch {
    // Keep the report bounded.
  }

  const text = payload ? extractRestChatText(payload) : "";
  return {
    query,
    ok: response.ok && !!text && hasUrl(text) && !hasBadUrl(text),
    status: response.status,
    has_url: hasUrl(text),
    has_bad_url: hasBadUrl(text),
    text_preview: text.slice(0, 350),
    error: response.ok ? null : payload?.error?.message || raw.slice(0, 350)
  };
}

async function run() {
  const config = {
    restBaseUrl: process.env.LOCAL_MODEL_REST_BASE_URL || "http://127.0.0.1:1234/api/v1",
    apiToken: process.env.LOCAL_MODEL_API_TOKEN || "",
    model: process.env.LOCAL_MODEL_NAME || "google/gemma-4-e4b",
    pluginId: process.env.WEB_SEARCH_LMSTUDIO_PLUGIN_ID || "mcp/searxng-local",
    contextLength: process.env.CHAT_CONTEXT_LENGTH || "8192"
  };
  const searxngUrl = process.env.SEARXNG_URL || "http://127.0.0.1:8080";
  const queries = process.argv.includes("--quick") ? DEFAULT_QUERIES.slice(0, 1) : DEFAULT_QUERIES;

  const report = {
    status: "FAIL",
    model: config.model,
    plugin_id: config.pluginId,
    token_set: !!config.apiToken,
    searxng: null,
    results: []
  };

  try {
    report.searxng = await checkSearxng(searxngUrl);
  } catch (error) {
    report.searxng = {
      ok: false,
      reason: error?.message || "searxng_check_failed"
    };
  }

  if (report.searxng.ok) {
    for (const query of queries) {
      try {
        report.results.push(await callLmStudio(query, config));
      } catch (error) {
        report.results.push({
          query,
          ok: false,
          error: error?.message || "lmstudio_call_failed"
        });
      }
    }
  }

  const passed = report.results.filter((item) => item.ok).length;
  report.pass_count = passed;
  report.total_count = report.results.length;
  report.status = report.searxng.ok && passed === report.results.length ? "PASS" : "FAIL";

  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.status === "PASS" ? 0 : 1;
}

run();
