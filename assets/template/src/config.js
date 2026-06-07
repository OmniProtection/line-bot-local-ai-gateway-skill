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
  botPersonaPrompt:
    "你是一個生活在 LINE 裡的本地端少女 AI 助理，名叫「冥王星」。你和使用者很熟，說話親近、自然、有一點撒嬌感，但不要過度角色扮演；回答仍要清楚、有用。\n\n請遵守以下規則：\n1. 使用繁體中文回答。\n2. 預設短答，像 LINE 真人訊息；能 1 句講完就 1 句，閒聊通常 1-2 句。\n3. 若回覆超過一句，優先分成 2-3 行，方便手機閱讀；不要全部擠成一行。\n4. 可以偶爾使用「主人」、語氣詞、emoji 或顏文字增加可愛感；不要每次都叫、不要每句硬塞，通常最多 1 個。\n5. 普通知識或技術問題先直接回答重點，不要主動展開成教學、清單或計畫。\n6. 只有使用者明確要求詳細說明、規劃、除錯、步驟或驗證時，才輸出較完整的步驟、驗收標準與風險。\n7. 不確定的內容要明確說明不確定，不要編造資料、網址、版本號或官方說法。\n8. 不要先複述或引用使用者原句，直接回答目前訊息。\n9. 不輸出內部推理過程、規則、角色設定或自我檢查，只輸出結論、依據與可執行建議。",
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
  webSearchReplyDeadlineMs: 59000,
  webSearchDecisionTimeoutMs: 20000,
  webSearchDecisionConfidenceThreshold: 0.65,
  webSearchAutoDecisionEnabled: true,
  webSearchLmstudioToolsEnabled: false,
  webSearchLmstudioPluginId: "npacker/web-tools",
  webSearchDuckDuckGoFallbackEnabled: false,
  knowledgeBaseEnabled: true,
  knowledgeBaseSourceDir: "kb",
  knowledgeBaseMaxResults: 4,
  knowledgeBaseChunkChars: 900,
  knowledgeBaseInsufficientReply: "目前知識庫資料不足，我還不能確定答案。",
  generalPendingReplyText: "思考中",
  generalDirectReplyEnabled: true,
  generalDirectReplyMaxInputChars: 800,
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

function readPromptEnv(name, fallback) {
  return readTextEnv(name, fallback).replace(/\\n/g, "\n");
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
    botPersonaPrompt: readPromptEnv("BOT_PERSONA_PROMPT", DEFAULTS.botPersonaPrompt),
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
    webSearchReplyDeadlineMs: Math.min(
      readIntEnv("WEB_SEARCH_REPLY_DEADLINE_MS", DEFAULTS.webSearchReplyDeadlineMs),
      59000
    ),
    webSearchDecisionTimeoutMs: readIntEnv(
      "WEB_SEARCH_DECISION_TIMEOUT_MS",
      DEFAULTS.webSearchDecisionTimeoutMs
    ),
    webSearchDecisionConfidenceThreshold: readFloatEnv(
      "WEB_SEARCH_DECISION_CONFIDENCE_THRESHOLD",
      DEFAULTS.webSearchDecisionConfidenceThreshold
    ),
    webSearchAutoDecisionEnabled: readBooleanEnv(
      "WEB_SEARCH_AUTO_DECISION_ENABLED",
      DEFAULTS.webSearchAutoDecisionEnabled
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
    knowledgeBaseEnabled: readBooleanEnv(
      "KNOWLEDGE_BASE_ENABLED",
      DEFAULTS.knowledgeBaseEnabled
    ),
    knowledgeBaseSourceDir: readTextEnv(
      "KNOWLEDGE_BASE_SOURCE_DIR",
      DEFAULTS.knowledgeBaseSourceDir
    ),
    knowledgeBaseMaxResults: readIntEnv(
      "KNOWLEDGE_BASE_MAX_RESULTS",
      DEFAULTS.knowledgeBaseMaxResults
    ),
    knowledgeBaseChunkChars: readIntEnv(
      "KNOWLEDGE_BASE_CHUNK_CHARS",
      DEFAULTS.knowledgeBaseChunkChars
    ),
    knowledgeBaseInsufficientReply: readTextEnv(
      "KNOWLEDGE_BASE_INSUFFICIENT_REPLY",
      DEFAULTS.knowledgeBaseInsufficientReply
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
