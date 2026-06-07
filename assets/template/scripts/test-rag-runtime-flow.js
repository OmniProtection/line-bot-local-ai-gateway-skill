const assert = require("node:assert/strict");
const http = require("node:http");
const { createGatewayStore } = require("../src/gatewayStore");
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
  webSearchEnabled: true,
  webSearchAutoDecisionEnabled: true,
  webSearchDecisionTimeoutMs: 1000,
  webSearchDecisionConfidenceThreshold: 0.65,
  generalPendingReplyText: "思考中",
  generalDirectReplyEnabled: true,
  generalDirectReplyMaxInputChars: 800,
  generalDirectModelTimeoutMs: 60000,
  knowledgeBaseEnabled: true,
  knowledgeBaseMaxResults: 4,
  knowledgeBaseInsufficientReply: "目前知識庫資料不足，我還不能確定答案。"
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

function textEvent(text) {
  return {
    type: "message",
    replyToken: "reply-rag-runtime",
    timestamp: Date.now(),
    source: { type: "user", userId: "U-rag" },
    message: {
      id: "msg-rag-runtime",
      type: "text",
      text
    },
    webhookEventId: "event-rag-runtime"
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
  const unanswered = [];
  const calls = {
    replies: [],
    memoryContexts: []
  };
  const runtime = createBotRuntime({
    config: CONFIG,
    validateConfig: false,
    createLineMiddleware: createJsonBodyMiddleware(),
    lineClient: {},
    memoryStore: createMemoryStore(":memory:", { enableTestHelpers: true }),
    gatewayStore: createGatewayStore(":memory:", { enableTestHelpers: true }),
    knowledgeBaseStore: {
      searchKnowledge() {
        return [];
      },
      recordUnansweredQuestion(entry) {
        unanswered.push(entry);
        return unanswered.length;
      }
    },
    logEvent: () => {},
    askLocalModelForSearchDecision: async () => ({
      ok: true,
      needsSearch: false,
      confidence: 0.95,
      reason: "technical_question_no_current_search",
      durationMs: 1
    }),
    askLocalModel: async (_input, _config, memoryContext) => {
      calls.memoryContexts.push(memoryContext);
      return {
        text: "Webhook 和 replyToken 是相關但不同的概念。",
        fallbackUsed: false,
        reason: "success",
        durationMs: 1,
        retryCount: 0
      };
    },
    replyText: async (_client, replyToken, text) => calls.replies.push({ replyToken, text }),
    pushText: async () => {
      throw new Error("rag_runtime_should_not_push");
    },
    searchWeb: async () => {
      throw new Error("rag_runtime_should_not_search");
    },
    summarizeGroupMemoryBatch: async () => ({ ok: true, summary: "" }),
    summarizeRollingConversationBatch: async () => ({ ok: true, summary: "" })
  });
  const server = await listen(runtime.app);

  try {
    const response = await postWebhook(server.address().port, [textEvent("Webhook 是 replyToken 嗎？")]);
    await flush(runtime);
    assert.equal(response.statusCode, 200);
    assert.equal(calls.replies.length, 1);
    assert.equal(calls.replies[0].text, CONFIG.knowledgeBaseInsufficientReply);
    assert.equal(unanswered.length, 1);
    assert.equal(unanswered[0].routeIntent, "general_chat");
    assert.equal(unanswered[0].knowledgeHit, false);
    assert.equal(JSON.stringify(calls.memoryContexts).includes("reply-rag-runtime"), false);

    console.log(
      JSON.stringify({
        status: "PASS",
        rag_runtime_flow: true,
        unanswered_logged: true,
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
