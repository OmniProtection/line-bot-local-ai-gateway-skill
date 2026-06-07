const assert = require("node:assert/strict");
const http = require("node:http");
const { createConfirmationStore } = require("../src/confirmationStore");
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
    source: { type: "user", userId: "U-tool" },
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
  const runtime = createBotRuntime({
    config: CONFIG,
    validateConfig: false,
    createLineMiddleware: createJsonBodyMiddleware(),
    lineClient: {},
    memoryStore: createMemoryStore(":memory:", { enableTestHelpers: true }),
    gatewayStore: createGatewayStore(":memory:", { enableTestHelpers: true }),
    handoffStore: createHandoffStore(":memory:", { enableTestHelpers: true }),
    confirmationStore: createConfirmationStore(":memory:"),
    knowledgeBaseStore: {
      searchKnowledge() {
        return [];
      },
      recordUnansweredQuestion() {},
      close() {}
    },
    logEvent: () => {},
    askLocalModelForSearchDecision: async () => ({
      ok: true,
      needsSearch: false,
      confidence: 0.95,
      searchQuery: "",
      sourcePreference: "general",
      answerWithoutSearchAllowed: true,
      reason: "normal_chat",
      durationMs: 1
    }),
    askLocalModel: async () => ({
      text: "一般聊天回覆。",
      fallbackUsed: false,
      reason: "success",
      durationMs: 1,
      retryCount: 0
    }),
    replyText: async (_client, replyToken, text) => replies.push({ replyToken, text }),
    pushText: async () => {
      throw new Error("sprint6_runtime_should_not_push");
    },
    summarizeGroupMemoryBatch: async () => ({ ok: true, summary: "" }),
    summarizeRollingConversationBatch: async () => ({ ok: true, summary: "" })
  });
  const server = await listen(runtime.app);

  try {
    const port = server.address().port;

    await postWebhook(port, [textEvent("你在幹嘛", "casual")]);
    await flush(runtime);
    assert.equal(replies.at(-1).text, "一般聊天回覆。");
    assert.equal(runtime.confirmationStore.listConfirmations({}).length, 0);

    await postWebhook(port, [textEvent("建立工單: 請人工確認這個問題", "create")]);
    await flush(runtime);
    assert.match(replies.at(-1).text, /確認碼：/);
    assert.equal(runtime.handoffStore.countTickets(), 0);
    const confirmation = runtime.confirmationStore.listConfirmations({ status: "pending" }).at(0);
    assert.equal(confirmation.toolName, "handoff_ticket_create");

    await postWebhook(port, [textEvent(`確認 ${confirmation.code}`, "confirm")]);
    await flush(runtime);
    assert.match(replies.at(-1).text, /已建立本機工單：HT-/);
    assert.equal(runtime.handoffStore.countTickets(), 1);

    await postWebhook(port, [textEvent(`確認 ${confirmation.code}`, "confirm-again")]);
    await flush(runtime);
    assert.equal(replies.at(-1).text, "這個確認碼已經執行過。");
    assert.equal(runtime.handoffStore.countTickets(), 1);

    await postWebhook(port, [textEvent("建立工單: 取消測試", "cancel-create")]);
    await flush(runtime);
    const cancellable = runtime.confirmationStore.listConfirmations({ status: "pending" }).at(0);
    await postWebhook(port, [textEvent(`取消 ${cancellable.code}`, "cancel")]);
    await flush(runtime);
    assert.equal(replies.at(-1).text, "已取消。");
    assert.equal(runtime.handoffStore.countTickets(), 1);

    console.log(
      JSON.stringify({
        status: "PASS",
        sprint6_runtime_flow: true,
        casual_no_tool: true,
        confirmation_required: true,
        confirm_executes_once: true,
        cancel_supported: true,
        reply_only: true
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
