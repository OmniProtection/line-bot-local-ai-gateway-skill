const assert = require("node:assert/strict");
const http = require("node:http");
const { createGatewayStore } = require("../src/gatewayStore");
const { createHandoffStore } = require("../src/handoffStore");
const { createMemoryStore } = require("../src/memoryStore");
const { createBotRuntime } = require("../src/server");

const CONFIG = {
  lineChannelSecret: "test-secret",
  lineChannelAccessToken: "test-token",
  localModelProvider: "lmstudio",
  localModelBaseUrl: "http://127.0.0.1:1234/v1",
  localModelRestBaseUrl: "http://127.0.0.1:1234/api/v1",
  localModelApiToken: "",
  localModelName: "test-model",
  localModelTimeoutMs: 1000,
  chatTemperature: 0.4,
  chatTopP: 0.9,
  chatMaxTokens: 128,
  chatContextLength: 2048,
  botPersonaPrompt: "使用繁體中文。",
  maxReplyChars: 800,
  webSearchMaxReplyChars: 1600,
  webSearchEnabled: true,
  webSearchAutoDecisionEnabled: true,
  webSearchDecisionTimeoutMs: 1000,
  webSearchDecisionConfidenceThreshold: 0.65,
  webSearchReplyDeadlineMs: 59000,
  webSearchTotalTimeoutMs: 1000,
  webSearchJobTimeoutMs: 1000,
  webSearchPageTimeoutMs: 200,
  webSearchBackgroundPushEnabled: false,
  generalPendingReplyText: "思考中",
  generalDirectReplyEnabled: true,
  generalDirectReplyMaxInputChars: 800,
  generalDirectModelTimeoutMs: 60000,
  knowledgeBaseEnabled: true,
  knowledgeBaseMaxResults: 4,
  knowledgeBaseInsufficientReply: "目前知識庫資料不足，我還不能確定答案。",
  adminApiEnabled: false,
  adminApiToken: "",
  adminApiLocalhostOnly: true,
  humanHandoffEnabled: true,
  humanHandoffReplyText: "這件事需要人工確認，我已先記錄下來。"
};

function createJsonBodyMiddleware() {
  return () => (req, _res, next) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      req.body = body ? JSON.parse(body) : {};
      next();
    });
  };
}

function textEvent(text, id) {
  return {
    type: "message",
    replyToken: `reply-${id}`,
    timestamp: Date.now(),
    source: { type: "user", userId: "U-handoff" },
    message: {
      id: `msg-${id}`,
      type: "text",
      text
    },
    webhookEventId: `event-${id}`
  };
}

function postWebhook(port, events) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ events });
    const request = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: "/webhook",
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(payload)
        }
      },
      (response) => {
        response.resume();
        response.on("end", () => resolve({ statusCode: response.statusCode }));
      }
    );
    request.on("error", reject);
    request.end(payload);
  });
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function flush(runtime) {
  await runtime.drainWebhookEventQueue();
  await runtime.drainGeneralReplyQueue();
  await runtime.drainWebSearchQueue();
  await runtime.drainMemoryOrganizationQueue();
  await runtime.drainDurableJobs();
}

async function run() {
  const replies = [];
  const unanswered = [];
  const runtime = createBotRuntime({
    config: CONFIG,
    validateConfig: false,
    createLineMiddleware: createJsonBodyMiddleware(),
    lineClient: {},
    memoryStore: createMemoryStore(":memory:", { enableTestHelpers: true }),
    gatewayStore: createGatewayStore(":memory:", { enableTestHelpers: true }),
    handoffStore: createHandoffStore(":memory:", { enableTestHelpers: true }),
    knowledgeBaseStore: {
      searchKnowledge() {
        return [];
      },
      recordUnansweredQuestion(entry) {
        unanswered.push(entry);
        return unanswered.length;
      },
      close() {}
    },
    logEvent: () => {},
    askLocalModelForSearchDecision: async (input) => ({
      ok: true,
      needsSearch: input.includes("5060ti"),
      confidence: input.includes("5060ti") ? 0.95 : 0.95,
      searchQuery: input.includes("5060ti") ? "RTX 5060 Ti specs" : "",
      sourcePreference: input.includes("5060ti") ? "product_specs" : "general",
      answerWithoutSearchAllowed: !input.includes("5060ti"),
      reason: input.includes("5060ti") ? "product_specs_need_search" : "normal_chat",
      durationMs: 1
    }),
    askLocalModel: async (input) => ({
      text: input.includes("Webhook") ? "Webhook 和 replyToken 是不同概念。" : "一般聊天回覆。",
      fallbackUsed: false,
      reason: "success",
      durationMs: 1,
      retryCount: 0
    }),
    searchWeb: async () => ({
      ok: false,
      reason: "service_unavailable",
      durationMs: 1,
      evidence: []
    }),
    replyText: async (_client, replyToken, text) => replies.push({ replyToken, text }),
    pushText: async () => {
      throw new Error("handoff_runtime_should_not_push");
    },
    summarizeGroupMemoryBatch: async () => ({ ok: true, summary: "" }),
    summarizeRollingConversationBatch: async () => ({ ok: true, summary: "" })
  });
  const server = await listen(runtime.app);

  try {
    const port = server.address().port;

    await postWebhook(port, [textEvent("請幫我部署並 git push", "high-risk")]);
    await flush(runtime);
    assert.equal(replies.at(-1).text, CONFIG.humanHandoffReplyText);
    assert.equal(runtime.handoffStore.listTickets({}).at(0).triggerType, "policy_high_risk");

    await postWebhook(port, [textEvent("Webhook 是 replyToken 嗎？", "kb")]);
    await flush(runtime);
    assert.equal(replies.at(-1).text, CONFIG.knowledgeBaseInsufficientReply);
    assert.equal(unanswered.length, 1);
    assert.equal(runtime.handoffStore.listTickets({}).some((ticket) => ticket.triggerType === "kb_insufficient"), true);

    const beforeCasual = runtime.handoffStore.countTickets();
    await postWebhook(port, [textEvent("你在幹嘛", "casual")]);
    await flush(runtime);
    assert.equal(replies.at(-1).text, "一般聊天回覆。");
    assert.equal(runtime.handoffStore.countTickets(), beforeCasual);

    await postWebhook(port, [textEvent("5060ti 規格", "search")]);
    await flush(runtime);
    assert.equal(replies.at(-1).text, "搜尋失敗");
    assert.equal(
      runtime.handoffStore.listTickets({}).some((ticket) => ticket.triggerType === "web_search_failure"),
      true
    );

    console.log(
      JSON.stringify({
        status: "PASS",
        handoff_runtime_flow: true,
        high_risk_ticket: true,
        kb_ticket: true,
        search_failure_ticket: true,
        casual_no_ticket: true
      })
    );
  } finally {
    await closeServer(server);
    runtime.close();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
