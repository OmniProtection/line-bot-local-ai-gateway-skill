const assert = require("node:assert/strict");
const { askLocalModel } = require("../src/lmStudioClient");
const { readConfig } = require("../src/config");

async function captureChatRequest(config, userText = "測試", modelAnswer = "測試回覆唷 ✨") {
  const originalFetch = global.fetch;
  let capturedBody = null;

  global.fetch = async (url, options = {}) => {
    capturedBody = JSON.parse(options.body);
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          choices: [
            {
              finish_reason: "stop",
              message: {
                content: JSON.stringify({ answer: modelAnswer })
              }
            }
          ]
        };
      }
    };
  };

  try {
    const result = await askLocalModel(userText, config, null, {
      maxEmptyResponseRetries: 0,
      timeoutMs: 1000
    });
    assert.equal(result.fallbackUsed, false);
    return { body: capturedBody, result };
  } finally {
    global.fetch = originalFetch;
  }
}

async function run() {
  const originalPersona = process.env.BOT_PERSONA_PROMPT;

  try {
    delete process.env.BOT_PERSONA_PROMPT;
    const defaultConfig = readConfig();
    assert.equal(defaultConfig.botPersonaPrompt.includes("生活在 LINE 裡"), true);
    assert.equal(defaultConfig.botPersonaPrompt.includes("本地端少女 AI 助理"), true);
    assert.equal(defaultConfig.botPersonaPrompt.includes("撒嬌"), true);
    assert.equal(defaultConfig.botPersonaPrompt.includes("主人"), true);
    assert.equal(defaultConfig.botPersonaPrompt.includes("emoji"), true);
    assert.equal(defaultConfig.botPersonaPrompt.includes("不要每句硬塞"), true);
    assert.equal(defaultConfig.botPersonaPrompt.includes("不要編造資料"), true);
    assert.equal(defaultConfig.botPersonaPrompt.includes("預設短答"), true);
    assert.equal(defaultConfig.botPersonaPrompt.includes("2-3 行"), true);
    assert.equal(defaultConfig.botPersonaPrompt.includes("不要全部擠成一行"), true);
    assert.equal(defaultConfig.botPersonaPrompt.includes("不要主動展開成教學、清單或計畫"), true);
    assert.equal(defaultConfig.botPersonaPrompt.includes("只有使用者明確要求詳細說明"), true);
    assert.equal(defaultConfig.botPersonaPrompt.includes("技術或專案問題請提供"), false);
    assert.equal(defaultConfig.botPersonaPrompt.includes("不要先複述或引用使用者原句"), true);
    assert.equal(defaultConfig.botPersonaPrompt.includes("主人問我"), false);
    assert.equal(defaultConfig.botPersonaPrompt.includes("主人問人家"), false);

    process.env.BOT_PERSONA_PROMPT = "你是冥王星\\n每句都要可愛唷";
    const config = {
      ...readConfig(),
      lineChannelAccessToken: "test-token",
      lineChannelSecret: "test-secret",
      localModelBaseUrl: "http://127.0.0.1:1234/v1",
      localModelName: "test-model",
      maxReplyChars: 800
    };

    assert.equal(config.botPersonaPrompt.includes("\n"), true);
    assert.equal(config.botPersonaPrompt.includes("冥王星"), true);

    const { body } = await captureChatRequest(config);
    const systemMessage = body.messages.find((message) => message.role === "system");

    assert.equal(Boolean(systemMessage), true);
    assert.equal(systemMessage.content.includes("只輸出 JSON"), true);
    assert.equal(systemMessage.content.includes("冥王星"), true);
    assert.equal(systemMessage.content.includes("每句都要可愛唷"), true);
    assert.equal(systemMessage.content.includes("回答最後一則使用者訊息"), true);
    assert.equal(body.max_tokens, 256);

    const { body: detailedBody } = await captureChatRequest(config, "請詳細說明 Webhook 是 replyToken 嗎？");
    assert.equal(detailedBody.max_tokens, 768);

    const longSingleLineAnswer =
      "不是喔～Webhook 是 LINE 把事件通知你的伺服器；replyToken 是你收到事件後用來回覆同一則訊息的代碼；兩個東西用途不同啦！";
    const { result: formattedResult } = await captureChatRequest(
      config,
      "Webhook 是 replyToken 嗎？",
      longSingleLineAnswer
    );
    assert.equal(formattedResult.text.split("\n").length, 3);
    assert.equal(formattedResult.text.includes("Webhook 是 LINE"), true);
  } finally {
    if (typeof originalPersona === "undefined") {
      delete process.env.BOT_PERSONA_PROMPT;
    } else {
      process.env.BOT_PERSONA_PROMPT = originalPersona;
    }
  }
}

run()
  .then(() => {
    console.log(
      JSON.stringify({
        status: "PASS",
        bot_persona_prompt_default: true,
        bot_persona_prompt_env: true,
        chat_json_protocol_preserved: true,
        chat_max_tokens_default_respected: true,
        detailed_chat_token_budget_preserved: true,
        mobile_line_breaks_preserved: true
      })
    );
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
