require("dotenv").config();

const DEFAULTS = {
  localModelProvider: "lmstudio",
  localModelBaseUrl: "http://localhost:1234/v1",
  localModelRestBaseUrl: "http://127.0.0.1:1234/api/v1",
  localModelApiToken: "",
  localModelName: "google/gemma-4-e4b",
  localModelTimeoutMs: 60000,
  chatTemperature: 0.4,
  chatTopP: 0.9,
  chatMaxTokens: 256,
  chatContextLength: 8192,
  maxReplyChars: 800,
  webSearchMaxReplyChars: 1600,
  port: 3000,
  webSearchEnabled: false,
  webSearchBackgroundPushEnabled: false,
  webSearchMaxResults: 3,
  webSearchTotalTimeoutMs: 12000,
  webSearchJobTimeoutMs: 120000,
  webSearchPageTimeoutMs: 5000,
  webSearchPendingReplyText: "資料搜尋中，完成後會補上結果。",
  webSearchLmstudioToolsEnabled: false,
  webSearchLmstudioPluginId: "npacker/web-tools",
  webSearchDuckDuckGoFallbackEnabled: false,
  generalPendingReplyText: "思考中",
  generalDirectReplyEnabled: true,
  generalDirectReplyMaxInputChars: 20,
  generalDirectModelTimeoutMs: 1300
};

function readIntEnv(name, fallback) {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readFloatEnv(name, fallback) {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }

  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function readBooleanEnv(name, fallback) {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }

  const normalized = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return fallback;
}

function readTextEnv(name, fallback) {
  const raw = process.env[name];
  return raw && raw.trim() ? raw : fallback;
}

function readConfig() {
  return {
    lineChannelSecret: process.env.LINE_CHANNEL_SECRET || "",
    lineChannelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || "",
    localModelProvider: process.env.LOCAL_MODEL_PROVIDER || DEFAULTS.localModelProvider,
    localModelBaseUrl: process.env.LOCAL_MODEL_BASE_URL || DEFAULTS.localModelBaseUrl,
    localModelRestBaseUrl:
      process.env.LOCAL_MODEL_REST_BASE_URL || DEFAULTS.localModelRestBaseUrl,
    localModelApiToken: process.env.LOCAL_MODEL_API_TOKEN || DEFAULTS.localModelApiToken,
    localModelName: process.env.LOCAL_MODEL_NAME || DEFAULTS.localModelName,
    localModelTimeoutMs: readIntEnv("LOCAL_MODEL_TIMEOUT_MS", DEFAULTS.localModelTimeoutMs),
    chatTemperature: readFloatEnv("CHAT_TEMPERATURE", DEFAULTS.chatTemperature),
    chatTopP: readFloatEnv("CHAT_TOP_P", DEFAULTS.chatTopP),
    chatMaxTokens: readIntEnv("CHAT_MAX_TOKENS", DEFAULTS.chatMaxTokens),
    chatContextLength: readIntEnv("CHAT_CONTEXT_LENGTH", DEFAULTS.chatContextLength),
    maxReplyChars: readIntEnv("MAX_REPLY_CHARS", DEFAULTS.maxReplyChars),
    webSearchMaxReplyChars: readIntEnv(
      "WEB_SEARCH_MAX_REPLY_CHARS",
      DEFAULTS.webSearchMaxReplyChars
    ),
    port: readIntEnv("PORT", DEFAULTS.port),
    webSearchEnabled: readBooleanEnv("WEB_SEARCH_ENABLED", DEFAULTS.webSearchEnabled),
    webSearchBackgroundPushEnabled: readBooleanEnv(
      "WEB_SEARCH_BACKGROUND_PUSH_ENABLED",
      DEFAULTS.webSearchBackgroundPushEnabled
    ),
    webSearchMaxResults: readIntEnv("WEB_SEARCH_MAX_RESULTS", DEFAULTS.webSearchMaxResults),
    webSearchTotalTimeoutMs: readIntEnv(
      "WEB_SEARCH_TOTAL_TIMEOUT_MS",
      DEFAULTS.webSearchTotalTimeoutMs
    ),
    webSearchJobTimeoutMs: readIntEnv(
      "WEB_SEARCH_JOB_TIMEOUT_MS",
      DEFAULTS.webSearchJobTimeoutMs
    ),
    webSearchPageTimeoutMs: readIntEnv("WEB_SEARCH_PAGE_TIMEOUT_MS", DEFAULTS.webSearchPageTimeoutMs),
    webSearchPendingReplyText: readTextEnv(
      "WEB_SEARCH_PENDING_REPLY_TEXT",
      DEFAULTS.webSearchPendingReplyText
    ),
    webSearchLmstudioToolsEnabled: readBooleanEnv(
      "WEB_SEARCH_LMSTUDIO_TOOLS_ENABLED",
      DEFAULTS.webSearchLmstudioToolsEnabled
    ),
    webSearchLmstudioPluginId: readTextEnv(
      "WEB_SEARCH_LMSTUDIO_PLUGIN_ID",
      DEFAULTS.webSearchLmstudioPluginId
    ),
    webSearchDuckDuckGoFallbackEnabled: readBooleanEnv(
      "WEB_SEARCH_DUCKDUCKGO_FALLBACK_ENABLED",
      DEFAULTS.webSearchDuckDuckGoFallbackEnabled
    ),
    generalPendingReplyText: readTextEnv(
      "GENERAL_PENDING_REPLY_TEXT",
      DEFAULTS.generalPendingReplyText
    ),
    generalDirectReplyEnabled: readBooleanEnv(
      "GENERAL_DIRECT_REPLY_ENABLED",
      DEFAULTS.generalDirectReplyEnabled
    ),
    generalDirectReplyMaxInputChars: readIntEnv(
      "GENERAL_DIRECT_REPLY_MAX_INPUT_CHARS",
      DEFAULTS.generalDirectReplyMaxInputChars
    ),
    generalDirectModelTimeoutMs: readIntEnv(
      "GENERAL_DIRECT_MODEL_TIMEOUT_MS",
      DEFAULTS.generalDirectModelTimeoutMs
    )
  };
}

function validateConfig(config) {
  const missing = [];

  if (!config.lineChannelSecret) {
    missing.push("LINE_CHANNEL_SECRET");
  }

  if (!config.lineChannelAccessToken) {
    missing.push("LINE_CHANNEL_ACCESS_TOKEN");
  }

  if (config.localModelProvider !== "lmstudio") {
    throw new Error("LOCAL_MODEL_PROVIDER must be lmstudio for this MVP.");
  }

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }
}

module.exports = {
  DEFAULTS,
  readConfig,
  validateConfig
};
