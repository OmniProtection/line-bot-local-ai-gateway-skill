const assert = require("node:assert/strict");
const http = require("node:http");
const { createGatewayStore } = require("../src/gatewayStore");
const { createMemoryStore } = require("../src/memoryStore");
const { createBotRuntime } = require("../src/server");

const BASE_CONFIG = {
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
  botPersonaPrompt: "使用繁體中文，簡短回答。",
  maxReplyChars: 800,
  webSearchMaxReplyChars: 1600,
  port: 0,
  webSearchEnabled: true,
  webSearchBackgroundPushEnabled: false,
  webSearchMaxResults: 3,
  webSearchTotalTimeoutMs: 1000,
  webSearchJobTimeoutMs: 1000,
  webSearchPageTimeoutMs: 200,
  webSearchPendingReplyText: "資料搜尋中，完成後會補上結果。",
  webSearchReplyDeadlineMs: 59000,
  webSearchDecisionTimeoutMs: 20000,
  webSearchDecisionConfidenceThreshold: 0.65,
  webSearchAutoDecisionEnabled: true,
  webSearchLmstudioToolsEnabled: false,
  webSearchLmstudioPluginId: "npacker/web-tools",
  webSearchDuckDuckGoFallbackEnabled: false,
  generalPendingReplyText: "思考中",
  generalDirectReplyEnabled: true,
  generalDirectReplyMaxInputChars: 800,
  generalDirectModelTimeoutMs: 60000
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

function textEvent(text, overrides = {}) {
  return {
    type: "message",
    replyToken: overrides.replyToken || `reply-${Math.random()}`,
    timestamp: overrides.timestamp || Date.now(),
    source: overrides.source || { type: "user", userId: "U-op" },
    message: {
      id: overrides.messageId || `msg-${Math.random()}`,
      type: "text",
      text,
      ...(overrides.message || {})
    },
    webhookEventId: overrides.webhookEventId || `event-${Math.random()}`
  };
}

function groupSource() {
  return { type: "group", groupId: "G-op", userId: "U-op" };
}

function mentionMessage(textAfterMention) {
  const mentionText = "@冥王星";
  return {
    text: `${mentionText} ${textAfterMention}`,
    mention: {
      mentionees: [{ index: 0, length: mentionText.length, isSelf: true, type: "user" }]
    }
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
    const server = app.listen(0, "127.0.0.1", () => {
      resolve(server);
    });
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

function createHarness() {
  const memoryStore = createMemoryStore(":memory:", { enableTestHelpers: true });
  const gatewayStore = createGatewayStore(":memory:", { enableTestHelpers: true });
  const calls = {
    logs: [],
    modelInputs: [],
    modelMemoryContexts: [],
    replies: [],
    pushes: [],
    searchDecisions: [],
    searchQueries: [],
    searchEvidenceQueries: []
  };
  const runtime = createBotRuntime({
    config: BASE_CONFIG,
    validateConfig: false,
    createLineMiddleware: createJsonBodyMiddleware(),
    lineClient: {},
    memoryStore,
    gatewayStore,
    logEvent: (event, fields) => calls.logs.push({ event, fields }),
    askLocalModel: async (input, _config, memoryContext, options) => {
      calls.modelInputs.push(input);
      calls.modelMemoryContexts.push(memoryContext);
      if (input.includes("明天早上吃什麼")) {
        const groupContext = JSON.stringify(memoryContext?.groupMentionContext || []);
        return {
          text: groupContext.includes("漢堡") ? "明天早上吃漢堡。" : "沒有看到早餐前文。",
          fallbackUsed: false,
          reason: "success",
          durationMs: 1,
          retryCount: 0
        };
      }
      return {
        text: `一般回覆：${input}`,
        fallbackUsed: false,
        reason: "success",
        durationMs: 1,
        retryCount: 0
      };
    },
    askLocalModelForSearchDecision: async (input, _config, options) => {
      calls.searchDecisions.push({ input, options });
      if (input.includes("5060ti")) {
        return {
          ok: true,
          needsSearch: true,
          confidence: 0.92,
          searchQuery: "NVIDIA RTX 5060 Ti official specifications",
          sourcePreference: "product_specs",
          answerWithoutSearchAllowed: false,
          reason: "product_specs_need_source",
          durationMs: 1
        };
      }
      return {
        ok: true,
        needsSearch: false,
        confidence: 0.9,
        searchQuery: "",
        sourcePreference: "general",
        answerWithoutSearchAllowed: true,
        reason: "normal_chat",
        durationMs: 1
      };
    },
    searchWeb: async (query, _config, options) => {
      calls.searchQueries.push({ query, options });
      return {
        ok: true,
        durationMs: 1,
        evidence: [
          {
            title: "NVIDIA GeForce RTX 5060 Ti",
            url: "https://www.nvidia.com/",
            snippet: "Official product specifications",
            fetchedAt: "2026-06-06T00:00:00.000Z"
          }
        ]
      };
    },
    askLocalModelWithSearchEvidence: async (query, evidence, _config, options) => {
      calls.searchEvidenceQueries.push({ query, evidence, options });
      return {
        text: `搜尋整理：${query}`,
        fallbackUsed: false,
        reason: "success",
        durationMs: 1,
        retryCount: 0
      };
    },
    pushText: async (_client, to, text) => calls.pushes.push({ to, text }),
    replyText: async (_client, replyToken, text) => calls.replies.push({ replyToken, text }),
    summarizeGroupMemoryBatch: async () => ({ ok: true, summary: "" }),
    summarizeRollingConversationBatch: async () => ({ ok: true, summary: "" })
  });

  return { calls, gatewayStore, memoryStore, runtime };
}

async function run() {
  const harness = createHarness();
  const server = await listen(harness.runtime.app);
  const port = server.address().port;

  try {
    const privateResponse = await postWebhook(port, [
      textEvent("你是誰", { webhookEventId: "op-private-1", messageId: "op-msg-private-1" })
    ]);
    await flush(harness.runtime);
    assert.equal(privateResponse.statusCode, 200);
    assert.equal(harness.calls.replies.length, 1);
    assert.equal(harness.calls.replies[0].text.includes("一般回覆：你是誰"), true);
    assert.equal(harness.calls.pushes.length, 0, "direct private reply should not push");

    const noMention = await postWebhook(port, [
      textEvent("明天早上吃漢堡", {
        source: groupSource(),
        webhookEventId: "op-group-context-1",
        messageId: "op-msg-group-context-1"
      })
    ]);
    await flush(harness.runtime);
    assert.equal(noMention.statusCode, 200);
    assert.equal(harness.calls.replies.length, 1, "group no mention must not reply");

    const groupMention = await postWebhook(port, [
      textEvent("@冥王星 明天早上吃什麼？", {
        source: groupSource(),
        message: mentionMessage("明天早上吃什麼？"),
        webhookEventId: "op-group-mention-1",
        messageId: "op-msg-group-mention-1"
      })
    ]);
    await flush(harness.runtime);
    assert.equal(groupMention.statusCode, 200);
    assert.equal(harness.calls.replies.at(-1).text, "明天早上吃漢堡。");
    assert.equal(
      harness.calls.modelMemoryContexts.at(-1).groupMentionContext.some((item) =>
        String(item.content || "").includes("明天早上吃漢堡")
      ),
      true,
      "group @ mention should include same-group previous unmentioned context"
    );

    const searchResponse = await postWebhook(port, [
      textEvent("5060ti 16g cuda", {
        webhookEventId: "op-search-1",
        messageId: "op-msg-search-1"
      })
    ]);
    await flush(harness.runtime);
    assert.equal(searchResponse.statusCode, 200);
    assert.equal(harness.calls.searchQueries.length, 1);
    assert.equal(harness.calls.searchQueries[0].query, "NVIDIA RTX 5060 Ti official specifications");
    assert.equal(harness.calls.replies.at(-1).text.includes("搜尋整理："), true);
    assert.equal(harness.calls.pushes.length, 0, "web search must remain Reply API only");

    const logs = harness.calls.logs.filter((entry) => entry.event === "context_builder_completed");
    assert.ok(logs.length >= 2, "general replies should emit context builder metadata");
    assert.equal(JSON.stringify(logs).includes("明天早上吃漢堡"), false);

    console.log(
      JSON.stringify({
        status: "PASS",
        sprint3_operation_flow: true,
        webhook_http: true,
        private_reply_api: true,
        group_no_mention_no_reply: true,
        group_context_used: true,
        auto_web_search_reply_only: true,
        context_metadata_without_raw_text: true
      })
    );
  } finally {
    await closeServer(server);
    harness.runtime.close();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
