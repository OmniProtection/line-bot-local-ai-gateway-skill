const assert = require("node:assert/strict");
const http = require("node:http");
const { shouldUseDirectModelReply } = require("../src/directReplyGate");
const {
  askLocalModelForSearchDecision,
  askLocalModelWithSearchEvidence,
  askLocalModelWithWebSearchTools
} = require("../src/lmStudioClient");
const { LINE_TEXT_SAFE_HARD_LIMIT, clampReply } = require("../src/replyPolicy");
const { createBotRuntime } = require("../src/server");
const { searchWeb } = require("../src/webSearchService");

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
  chatMaxTokens: 256,
  chatContextLength: 8192,
  maxReplyChars: 800,
  webSearchMaxReplyChars: 3500,
  port: 3000,
  webSearchEnabled: true,
  webSearchBackgroundPushEnabled: true,
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
  generalDirectModelTimeoutMs: 1300
};

function createTextEvent(text, overrides = {}) {
  return {
    type: "message",
    replyToken: overrides.replyToken || `reply-${Math.random()}`,
    timestamp: 1710000000000,
    source: overrides.source || { type: "user", userId: "U123" },
    message: {
      id: overrides.messageId || `msg-${Math.random()}`,
      type: "text",
      text,
      ...(overrides.message || {})
    },
    webhookEventId: overrides.webhookEventId || `event-${Math.random()}`
  };
}

function testReplyLengthHardLimit() {
  const longText = "字".repeat(LINE_TEXT_SAFE_HARD_LIMIT + 1000);
  const configuredTooHigh = LINE_TEXT_SAFE_HARD_LIMIT + 2000;
  const reply = clampReply(longText, configuredTooHigh);

  assert.equal(reply.length, LINE_TEXT_SAFE_HARD_LIMIT);
  assert.equal(reply.endsWith("…"), true);
}

function createFakeMemoryStore() {
  let lineEventIdSequence = 0;
  const lineEventsByWebhookId = new Map();
  const calls = {
    conversationSummarySaves: [],
    longTermSaves: [],
    shortTermSaves: [],
    lineEvents: []
  };

  function lineEventLogRow(normalizedEvent, id) {
    return {
      id,
      webhook_event_id: normalizedEvent.webhookEventId,
      event_type: normalizedEvent.eventType,
      event_timestamp_ms: normalizedEvent.timestamp,
      delivery_is_redelivery: normalizedEvent.deliveryIsRedelivery ? 1 : 0,
      source_type: normalizedEvent.sourceType,
      sender_user_id: normalizedEvent.senderUserId,
      group_id: normalizedEvent.groupId,
      room_id: normalizedEvent.roomId,
      message_id: normalizedEvent.messageId,
      message_type: normalizedEvent.messageType,
      text: normalizedEvent.text,
      mention_json: normalizedEvent.mentionJson,
      quoted_message_id: normalizedEvent.quotedMessageId
    };
  }

  return {
    calls,
    deleteLongTermMemories: () => ({ deletedCount: 0 }),
    getActiveLineEventIdsForMemory: (_scope, ids) => ids,
    getConversationSummary: () => null,
    getLineEventLogByWebhookId: (webhookEventId) => lineEventsByWebhookId.get(webhookEventId) || null,
    getPendingAutoMemoryBatch: () => [],
    getPendingRollingSummaryBatch: () => [],
    listLongTermMemories: () => [],
    loadRelevantMemoryContext: () => ({ recentConversation: [], rollingSummary: null, evidence: [] }),
    markLineEventsProcessedForMemory: () => {},
    markLineMessageUnsent: () => {},
    saveLineEventLog: (event) => {
      calls.lineEvents.push(event);
      const id = ++lineEventIdSequence;
      lineEventsByWebhookId.set(event.webhookEventId, lineEventLogRow(event, id));
      return { inserted: true, duplicate: false, id };
    },
    saveConversationSummary: (scope, summary, metadata) => {
      calls.conversationSummarySaves.push({ scope, summary, metadata });
      return { saved: true };
    },
    saveLongTermMemory: (scope, memory) => {
      calls.longTermSaves.push({ scope, memory });
    },
    saveOrganizedGroupMemory: () => {},
    saveShortTermExchange: (scope, input, reply) => {
      calls.shortTermSaves.push({ scope, input, reply });
    }
  };
}

function createRuntime(overrides = {}) {
  const calls = {
    modelInputs: [],
    modelMemoryContexts: [],
    modelOptions: [],
    push: [],
    replies: [],
    searchQueries: [],
    searchOptions: [],
    searchEvidenceQueries: [],
    searchDecisions: [],
    webSearchToolsQueries: []
  };
  const memoryStore = overrides.memoryStore || createFakeMemoryStore();
  const config = {
    ...BASE_CONFIG,
    ...(overrides.config || {})
  };
  let currentNow = overrides.nowMs || 1000;

  const runtime = createBotRuntime({
    config,
    validateConfig: false,
    createLineMiddleware: overrides.createLineMiddleware || (() => (_req, _res, next) => next()),
    lineClient: {},
    logEvent: () => {},
    memoryStore,
    now: () => currentNow,
    askLocalModel:
      overrides.askLocalModel ||
      (async (input, _config, _memoryContext, options) => {
        calls.modelInputs.push(input);
        calls.modelMemoryContexts.push(_memoryContext);
        calls.modelOptions.push(options);
        return { text: "一般回覆", fallbackUsed: false, reason: "success" };
      }),
    askLocalModelWithSearchEvidence:
      overrides.askLocalModelWithSearchEvidence ||
      (async (query, evidence, _config, options) => {
        calls.searchEvidenceQueries.push({ query, evidence, options });
        return { text: `搜尋整理: ${query}`, fallbackUsed: false, reason: "success" };
      }),
    askLocalModelForSearchDecision:
      overrides.askLocalModelForSearchDecision ||
      (async (input, _config, options) => {
        calls.searchDecisions.push({ input, options });
        return {
          ok: true,
          needsSearch: false,
          confidence: 0.9,
          searchQuery: "",
          sourcePreference: "general",
          reason: "normal_chat",
          answerWithoutSearchAllowed: true,
          durationMs: 1
        };
      }),
    askLocalModelWithWebSearchTools:
      overrides.askLocalModelWithWebSearchTools ||
      (async (query, _config, options) => {
        calls.webSearchToolsQueries.push({ query, options });
        return { ok: false, reason: "disabled", durationMs: 0 };
      }),
    pushText: async (_client, to, text) => {
      calls.push.push({ to, text });
    },
    replyText: async (_client, replyToken, text) => {
      calls.replies.push({ replyToken, text });
    },
    searchWeb:
      overrides.searchWeb ||
      (async (query, _config, options) => {
        calls.searchQueries.push(query);
        calls.searchOptions.push(options);
        return {
          ok: true,
          evidence: [
            {
              title: "Source",
              url: "https://example.com",
              snippet: "Evidence",
              fetchedAt: "2026-05-29T00:00:00.000Z"
            }
          ],
          durationMs: 1
        };
      }),
    summarizeGroupMemoryBatch: async () => ({ ok: true, summary: "" }),
    summarizeRollingConversationBatch:
      overrides.summarizeRollingConversationBatch || (async () => ({ ok: true, summary: "" }))
  });

  return {
    calls,
    config,
    memoryStore,
    runtime,
    setNow: (value) => {
      currentNow = value;
    }
  };
}

function createJsonBodyMiddleware() {
  return (_config) => (req, _res, next) => {
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

function postWebhook(port, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const request = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: "/webhook",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data)
        }
      },
      (response) => {
        response.resume();
        response.on("end", () => {
          resolve({ statusCode: response.statusCode });
        });
      }
    );
    request.on("error", reject);
    request.end(data);
  });
}

async function testDisabledFlags() {
  const { calls, runtime } = createRuntime({
    config: { webSearchEnabled: false, webSearchBackgroundPushEnabled: false }
  });
  await runtime.handleEvent(createTextEvent("查:"), "req", 0);
  await runtime.drainWebSearchQueue();

  assert.equal(calls.replies.length, 1);
  assert.equal(calls.replies[0].text, "網路搜尋功能目前未啟用。");
  assert.equal(calls.push.length, 0);
  assert.equal(calls.searchQueries.length, 0);
}

async function testPushDisabledDoesNotBlockReplySearch() {
  const { calls, runtime } = createRuntime({
    config: { webSearchEnabled: true, webSearchBackgroundPushEnabled: false }
  });
  await runtime.handleEvent(createTextEvent("查: 台積電"), "req", 0);
  await runtime.drainWebSearchQueue();

  assert.equal(calls.replies.length, 1);
  assert.equal(calls.replies[0].text, "搜尋整理: 台積電");
  assert.equal(calls.push.length, 0);
  assert.deepEqual(calls.searchQueries, ["台積電"]);
}

async function testEmptyQuery() {
  const { calls, runtime } = createRuntime();
  await runtime.handleEvent(createTextEvent("查:"), "req", 0);
  await runtime.drainWebSearchQueue();

  assert.equal(calls.replies.length, 1);
  assert.equal(calls.replies[0].text, "請在 查: 後面加上要搜尋的內容。");
  assert.equal(calls.push.length, 0);
}

async function testNormalSearchFlow() {
  const { calls, memoryStore, runtime } = createRuntime();
  await runtime.handleEvent(createTextEvent("查: 台積電"), "req", 0);
  await runtime.drainWebSearchQueue();

  assert.deepEqual(
    calls.replies.map((item) => item.text),
    ["搜尋整理: 台積電"]
  );
  assert.deepEqual(calls.push, []);
  assert.deepEqual(calls.searchQueries, ["台積電"]);
  assert.equal(memoryStore.calls.shortTermSaves.length, 0);
  assert.equal(calls.searchEvidenceQueries[0].options.timeoutMs > 0, true);
}

async function testAutoSearchDecisionStartsReplyOnlySearch() {
  const { calls, runtime } = createRuntime({
    askLocalModelForSearchDecision: async (input, _config, options) => {
      calls.searchDecisions.push({ input, options });
      return {
          ok: true,
          needsSearch: true,
          confidence: 0.92,
          searchQuery: "台積電 今日 股價",
          sourcePreference: "current_info",
          reason: "requires_external_current_data",
          answerWithoutSearchAllowed: false,
          durationMs: 1
      };
    }
  });

  await runtime.handleEvent(createTextEvent("台積電今天股價是多少"), "req", 0);
  await runtime.drainWebSearchQueue();

  assert.deepEqual(calls.searchDecisions.map((item) => item.input), ["台積電今天股價是多少"]);
  assert.deepEqual(calls.searchQueries, ["台積電 今日 股價"]);
  assert.deepEqual(calls.searchOptions.map((item) => item.sourcePreference), ["current_info"]);
  assert.deepEqual(calls.searchEvidenceQueries.map((item) => item.query), ["台積電 今日 股價"]);
  assert.deepEqual(calls.searchEvidenceQueries.map((item) => item.options.originalQuestion), ["台積電今天股價是多少"]);
  assert.deepEqual(calls.searchEvidenceQueries.map((item) => item.options.sourcePreference), ["current_info"]);
  assert.deepEqual(calls.replies.map((item) => item.text), ["搜尋整理: 台積電 今日 股價"]);
  assert.deepEqual(calls.push, []);
  assert.deepEqual(calls.modelInputs, []);
}

async function testAutoSearchDecisionFalseUsesNormalChat() {
  const { calls, runtime } = createRuntime();

  await runtime.handleEvent(createTextEvent("你在幹嘛"), "req", 0);
  await runtime.drainGeneralReplyQueue();

  assert.deepEqual(calls.searchDecisions.map((item) => item.input), ["你在幹嘛"]);
  assert.deepEqual(calls.searchQueries, []);
  assert.deepEqual(calls.modelInputs, ["你在幹嘛"]);
  assert.equal(calls.modelMemoryContexts[0].searchStatus.webSearchPerformed, false);
  assert.deepEqual(calls.replies.map((item) => item.text), ["一般回覆"]);
}

async function testAutoSearchPlanNaturalQueriesUseWebSearch() {
  const plans = new Map([
    [
      "搜尋5060ti規格",
      {
        searchQuery: "NVIDIA GeForce RTX 5060 Ti specifications",
        sourcePreference: "product_specs"
      }
    ],
    [
      "5060ti 16g cuda",
      {
        searchQuery: "NVIDIA GeForce RTX 5060 Ti 16GB CUDA cores specifications",
        sourcePreference: "product_specs"
      }
    ],
    [
      "搜尋官網5060ti的規格",
      {
        searchQuery: "NVIDIA official GeForce RTX 5060 Ti specifications",
        sourcePreference: "official"
      }
    ],
    [
      "Nvidia官網",
      {
        searchQuery: "NVIDIA official website",
        sourcePreference: "official"
      }
    ],
    [
      "基隆有哪些燒烤店",
      {
        searchQuery: "基隆 燒烤店",
        sourcePreference: "local_places"
      }
    ]
  ]);
  const { calls, runtime } = createRuntime({
    askLocalModelForSearchDecision: async (input, _config, options) => {
      calls.searchDecisions.push({ input, options });
      const plan = plans.get(input);
      return {
        ok: true,
        needsSearch: true,
        confidence: 0.9,
        searchQuery: plan.searchQuery,
        sourcePreference: plan.sourcePreference,
        reason: "requires_source_grounded_answer",
        answerWithoutSearchAllowed: false,
        durationMs: 1
      };
    }
  });

  for (const input of plans.keys()) {
    await runtime.handleEvent(createTextEvent(input), "req", 0);
  }
  await runtime.drainWebSearchQueue();

  assert.deepEqual(calls.searchQueries, [...plans.values()].map((item) => item.searchQuery));
  assert.deepEqual(calls.searchOptions.map((item) => item.sourcePreference), [...plans.values()].map((item) => item.sourcePreference));
  assert.deepEqual(calls.modelInputs, []);
  assert.deepEqual(calls.push, []);
}

async function testForcedSearchUsesPlanQueryWhenAvailable() {
  const { calls, runtime } = createRuntime({
    askLocalModelForSearchDecision: async (input, _config, options) => {
      calls.searchDecisions.push({ input, options });
      return {
        ok: true,
        needsSearch: true,
        confidence: 0.9,
        searchQuery: "NVIDIA official GeForce RTX 5060 Ti specifications",
        sourcePreference: "official",
        reason: "normalize_for_official_source",
        answerWithoutSearchAllowed: false,
        durationMs: 1
      };
    }
  });

  await runtime.handleEvent(createTextEvent("查：5060ti 官網"), "req", 0);

  assert.deepEqual(calls.searchDecisions.map((item) => item.input), ["5060ti 官網"]);
  assert.deepEqual(calls.searchQueries, ["NVIDIA official GeForce RTX 5060 Ti specifications"]);
  assert.deepEqual(calls.searchOptions.map((item) => item.sourcePreference), ["official"]);
  assert.deepEqual(calls.searchEvidenceQueries.map((item) => item.options.originalQuestion), ["5060ti 官網"]);
}

async function testForcedSearchFallsBackToRawQueryWhenPlanFails() {
  const { calls, runtime } = createRuntime({
    askLocalModelForSearchDecision: async (input, _config, options) => {
      calls.searchDecisions.push({ input, options });
      return {
        ok: false,
        needsSearch: false,
        confidence: 0,
        searchQuery: "",
        sourcePreference: "general",
        reason: "timeout",
        answerWithoutSearchAllowed: true,
        durationMs: 20000
      };
    }
  });

  await runtime.handleEvent(createTextEvent("搜：Nvidia官網"), "req", 0);

  assert.deepEqual(calls.searchQueries, ["Nvidia官網"]);
  assert.deepEqual(calls.searchOptions.map((item) => item.sourcePreference), ["general"]);
}

async function testSearchPlanFailureUsesNormalChatWithNoFakeSearchGuard() {
  const { calls, runtime } = createRuntime({
    askLocalModelForSearchDecision: async (input, _config, options) => {
      calls.searchDecisions.push({ input, options });
      return {
        ok: false,
        needsSearch: false,
        confidence: 0,
        searchQuery: "",
        sourcePreference: "general",
        reason: "timeout",
        answerWithoutSearchAllowed: true,
        durationMs: 20000
      };
    }
  });

  await runtime.handleEvent(createTextEvent("搜尋官網5060ti的規格"), "req", 0);

  assert.deepEqual(calls.searchQueries, []);
  assert.deepEqual(calls.modelInputs, ["搜尋官網5060ti的規格"]);
  assert.equal(calls.modelMemoryContexts[0].searchStatus.webSearchPerformed, false);
  assert.equal(calls.modelMemoryContexts[0].searchStatus.reason, "timeout");
}

async function testSearchDecisionClientParsesJson() {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      choices: [
        {
          message: {
            content: JSON.stringify({
              needs_search: true,
              confidence: 0.91,
              search_query: "台積電 今日 股價",
              source_preference: "current_info",
              reason: "requires external source-grounded data",
              answer_without_search_allowed: false
            })
          },
          finish_reason: "stop"
        }
      ]
    })
  });

  try {
    const result = await askLocalModelForSearchDecision(
      "今天台積電股價是多少",
      BASE_CONFIG,
      { timeoutMs: 1000 }
    );
    assert.equal(result.ok, true);
    assert.equal(result.needsSearch, true);
    assert.equal(result.confidence, 0.91);
    assert.equal(result.searchQuery, "台積電 今日 股價");
    assert.equal(result.sourcePreference, "current_info");
    assert.equal(result.answerWithoutSearchAllowed, false);
  } finally {
    global.fetch = originalFetch;
  }
}

async function testSearchDecisionClientAcceptsJsonReasonText() {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      choices: [
        {
          message: {
            content: JSON.stringify({
              needs_search: true,
              confidence: 0.98,
              search_query: "RTX 5060 Ti 規格",
              source_preference: "product_specs",
              reason:
                "The user is asking for specific technical specifications of a product, which requires external product data.",
              answer_without_search_allowed: false
            })
          },
          finish_reason: "stop"
        }
      ]
    })
  });

  try {
    const result = await askLocalModelForSearchDecision("搜尋5060ti規格", BASE_CONFIG, {
      timeoutMs: 1000
    });
    assert.equal(result.ok, true);
    assert.equal(result.needsSearch, true);
    assert.equal(result.searchQuery, "RTX 5060 Ti 規格");
    assert.equal(result.sourcePreference, "product_specs");
  } finally {
    global.fetch = originalFetch;
  }
}

async function testLmStudioToolsEnabledDoesNotBypassStableEvidenceSearch() {
  const { calls, memoryStore, runtime } = createRuntime({
    config: { webSearchLmstudioToolsEnabled: true },
    askLocalModelWithWebSearchTools: async (query, _config, options) => {
      calls.webSearchToolsQueries.push({ query, options });
      return {
        ok: true,
        text: "工具搜尋不應該進入 LINE runtime 主路徑",
        fallbackUsed: false,
        reason: "success"
      };
    }
  });

  await runtime.handleEvent(createTextEvent("搜: OpenAI 最新消息"), "req", 0);
  await runtime.drainWebSearchQueue();

  assert.deepEqual(calls.replies.map((item) => item.text), ["搜尋整理: OpenAI 最新消息"]);
  assert.deepEqual(calls.push, []);
  assert.deepEqual(calls.webSearchToolsQueries, []);
  assert.deepEqual(calls.searchQueries, ["OpenAI 最新消息"]);
  assert.deepEqual(calls.searchEvidenceQueries.map((item) => item.query), ["OpenAI 最新消息"]);
  assert.equal(memoryStore.calls.shortTermSaves.length, 0);
}

async function testLmStudioToolsFailureDoesNotBlockStableEvidenceSearch() {
  const { calls, runtime } = createRuntime({
    config: {
      webSearchLmstudioToolsEnabled: true,
      webSearchDuckDuckGoFallbackEnabled: true
    },
    askLocalModelWithWebSearchTools: async (query, _config, options) => {
      calls.webSearchToolsQueries.push({ query, options });
      return {
        ok: false,
        reason: "timeout",
        durationMs: 1000
      };
    }
  });

  await runtime.handleEvent(createTextEvent("搜: 美元兌台幣匯率"), "req", 0);
  await runtime.drainWebSearchQueue();

  assert.deepEqual(calls.webSearchToolsQueries, []);
  assert.deepEqual(calls.searchQueries, ["美元兌台幣匯率"]);
  assert.deepEqual(calls.replies.map((item) => item.text), ["搜尋整理: 美元兌台幣匯率"]);
  assert.deepEqual(calls.push, []);
}

async function testNoResults() {
  const { calls, runtime } = createRuntime({
    searchWeb: async () => ({ ok: false, reason: "no_results", evidence: [], durationMs: 1 })
  });
  await runtime.handleEvent(createTextEvent("查: 沒資料"), "req", 0);
  await runtime.drainWebSearchQueue();

  assert.equal(calls.replies[0].text, "搜尋失敗");
  assert.deepEqual(calls.push, []);
}

async function testTotalTimeoutAfterSearch() {
  const ctx = createRuntime({
    config: { webSearchReplyDeadlineMs: 50 },
    searchWeb: async () => {
      ctx.setNow(2000);
      return {
        ok: true,
        evidence: [{ title: "Late", url: "https://example.com", snippet: "", fetchedAt: "" }],
        durationMs: 1
      };
    }
  });

  await ctx.runtime.handleEvent(createTextEvent("查: 太慢"), "req", 0);
  await ctx.runtime.drainWebSearchQueue();

  assert.equal(ctx.calls.searchEvidenceQueries.length, 0);
  assert.deepEqual(ctx.calls.replies.map((item) => item.text), ["搜尋失敗"]);
  assert.deepEqual(ctx.calls.push, []);
}

async function testReplyDeadlineIsSeparateFromSearchTimeout() {
  const ctx = createRuntime({
    config: { webSearchTotalTimeoutMs: 50, webSearchReplyDeadlineMs: 59000 },
    searchWeb: async (_query, _config, options) => {
      assert.equal(options.deadlineMs, 1050);
      ctx.setNow(2000);
      return {
        ok: true,
        evidence: [{ title: "Source", url: "https://example.com", snippet: "", fetchedAt: "" }],
        durationMs: 1,
        deadlineMs: options.deadlineMs
      };
    }
  });

  await ctx.runtime.handleEvent(createTextEvent("查: 長時間整理"), "req", 0);
  await ctx.runtime.drainWebSearchQueue();

  assert.equal(ctx.calls.searchEvidenceQueries.length, 1);
  assert.equal(ctx.calls.searchEvidenceQueries[0].options.timeoutMs > 50000, true);
  assert.deepEqual(ctx.calls.replies.map((item) => item.text), ["搜尋整理: 長時間整理"]);
  assert.deepEqual(ctx.calls.push, []);
}

async function testModelTimeoutRepliesSearchFailure() {
  const { calls, runtime } = createRuntime({
    askLocalModelWithSearchEvidence: async (_query, evidence, config) => ({
      text: [
        "資料已搜尋，但本機模型整理逾時。可先參考來源：",
        `1. ${evidence[0].title}`,
        evidence[0].url
      ].join("\n").slice(0, config.maxReplyChars),
      fallbackUsed: true,
      reason: "timeout",
      durationMs: 100,
      retryCount: 0
    })
  });

  await runtime.handleEvent(createTextEvent("查: 模型逾時"), "req", 0);
  await runtime.drainWebSearchQueue();

  assert.deepEqual(calls.replies.map((item) => item.text), ["搜尋失敗"]);
  assert.deepEqual(calls.push, []);
}

async function testQueuedSearchEvidenceSkipsExpiredDeadline() {
  const originalFetch = global.fetch;
  let fetchCalled = false;
  global.fetch = async () => {
    fetchCalled = true;
    throw new Error("fetch should not be called after deadline");
  };

  try {
    const result = await askLocalModelWithSearchEvidence(
      "expired",
      [
        {
          title: "Expired Source",
          url: "https://example.com/expired",
          snippet: "Expired evidence",
          fetchedAt: "2026-05-29T00:00:00.000Z"
        }
      ],
      BASE_CONFIG,
      {
        deadlineMs: 1000,
        now: () => 1001
      }
    );

    assert.equal(fetchCalled, false);
    assert.equal(result.reason, "timeout");
    assert.ok(result.text.includes("資料已搜尋，但本機模型整理逾時。"));
    assert.ok(result.text.includes("https://example.com/expired"));
  } finally {
    global.fetch = originalFetch;
  }
}

async function testSearchEvidenceAnswerWithoutUrlsFallsBackToSourceSummary() {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      choices: [
        {
          message: {
            content: "根據資料，這是一個需要來源支撐的回答。"
          },
          finish_reason: "stop"
        }
      ]
    })
  });

  try {
    const result = await askLocalModelWithSearchEvidence(
      "通用搜尋問題",
      [
        {
          title: "來源一",
          url: "https://example.com/source-1",
          snippet: "Evidence one",
          fetchedAt: "2026-05-29T00:00:00.000Z"
        },
        {
          title: "來源二",
          url: "https://example.com/source-2",
          snippet: "Evidence two",
          fetchedAt: "2026-05-29T00:00:00.000Z"
        }
      ],
      BASE_CONFIG,
      {
        deadlineMs: Date.now() + 1000,
        timeoutMs: 1000
      }
    );

    assert.equal(result.reason, "policy_security_or_grounding");
    assert.equal(result.fallbackUsed, true);
    assert.ok(result.text.includes("無法逐項驗證更多細節"));
    assert.ok(result.text.includes("https://example.com/source-1"));
    assert.ok(result.text.includes("https://example.com/source-2"));
  } finally {
    global.fetch = originalFetch;
  }
}

async function testSearchEvidenceEnglishAnswerFallsBackToChineseSourceSummary() {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      choices: [
        {
          message: {
            content:
              "The evidence provided does not contain sufficient details to support a reliable conclusion. Please review the listed sources."
          },
          finish_reason: "stop"
        }
      ]
    })
  });

  try {
    const result = await askLocalModelWithSearchEvidence(
      "OPENCLAW",
      [
        {
          title: "OpenClaw",
          url: "https://openclaw.com.tw/",
          snippet: "OpenClaw evidence",
          fetchedAt: "2026-05-31T00:00:00.000Z"
        }
      ],
      BASE_CONFIG,
      {
        deadlineMs: Date.now() + 1000,
        timeoutMs: 1000
      }
    );

    assert.equal(result.reason, "policy_security_or_grounding");
    assert.equal(result.fallbackUsed, true);
    assert.ok(result.text.includes("我找到以下來源"));
    assert.ok(result.text.includes("https://openclaw.com.tw/"));
    assert.equal(result.text.includes("The evidence provided"), false);
  } finally {
    global.fetch = originalFetch;
  }
}

async function testSearchEvidenceAnswerFallsBackWhenListExceedsEvidence() {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      choices: [
        {
          message: {
            content: [
              "1. 未逐項驗證項目一",
              "2. 未逐項驗證項目二",
              "3. 未逐項驗證項目三"
            ].join("\n")
          },
          finish_reason: "stop"
        }
      ]
    })
  });

  try {
    const result = await askLocalModelWithSearchEvidence(
      "通用清單問題",
      [
        {
          title: "來源一",
          url: "https://example.com/source-1",
          snippet: "Evidence one",
          fetchedAt: "2026-05-29T00:00:00.000Z"
        },
        {
          title: "來源二",
          url: "https://example.com/source-2",
          snippet: "Evidence two",
          fetchedAt: "2026-05-29T00:00:00.000Z"
        }
      ],
      BASE_CONFIG,
      {
        deadlineMs: Date.now() + 1000,
        timeoutMs: 1000
      }
    );

    assert.equal(result.reason, "policy_security_or_grounding");
    assert.equal(result.fallbackUsed, true);
    assert.ok(result.text.includes("無法逐項驗證更多細節"));
    assert.ok(result.text.includes("https://example.com/source-1"));
    assert.ok(result.text.includes("https://example.com/source-2"));
    assert.equal(result.text.includes("3. 未逐項驗證項目三"), false);
  } finally {
    global.fetch = originalFetch;
  }
}

async function testWeakEvidenceListFallsBackToSourceSummary() {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      choices: [
        {
          message: {
            content: "1. 這是一個看似明確的推薦項目\nhttps://example-blog.com/list"
          },
          finish_reason: "stop"
        }
      ]
    })
  });

  try {
    const result = await askLocalModelWithSearchEvidence(
      "通用推薦問題",
      [
        {
          title: "10 間店家懶人包推薦",
          url: "https://example-blog.com/list",
          snippet: "部落格整理多個項目",
          sourceType: "weak_secondary",
          qualityScore: 40,
          qualityReasons: ["blog_or_listicle_signal"],
          fetchedAt: "2026-05-29T00:00:00.000Z"
        }
      ],
      BASE_CONFIG,
      {
        deadlineMs: Date.now() + 1000,
        timeoutMs: 1000
      }
    );

    assert.equal(result.reason, "policy_security_or_grounding");
    assert.equal(result.fallbackUsed, true);
    assert.ok(result.text.includes("無法逐項驗證更多細節"));
    assert.ok(result.text.includes("來源類型：weak_secondary"));
    assert.ok(result.text.includes("https://example-blog.com/list"));
  } finally {
    global.fetch = originalFetch;
  }
}

async function testWeakEvidenceNarrativeFallsBackToSourceSummary() {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      choices: [
        {
          message: {
            content:
              "這個產品很值得買，價格大約在 12000 到 19000 元之間，適合 2K 遊戲。https://example-blog.com/product"
          },
          finish_reason: "stop"
        }
      ]
    })
  });

  try {
    const result = await askLocalModelWithSearchEvidence(
      "商品資訊",
      [
        {
          title: "產品懶人包",
          url: "https://example-blog.com/product",
          snippet: "部落格整理產品資訊",
          sourceType: "weak_secondary",
          qualityScore: 40,
          qualityReasons: ["blog_or_listicle_signal"],
          fetchedAt: "2026-05-29T00:00:00.000Z"
        }
      ],
      BASE_CONFIG,
      {
        deadlineMs: Date.now() + 1000,
        timeoutMs: 1000
      }
    );

    assert.equal(result.reason, "policy_security_or_grounding");
    assert.equal(result.fallbackUsed, true);
    assert.ok(result.text.includes("無法逐項驗證更多細節"));
    assert.ok(result.text.includes("來源類型：weak_secondary"));
    assert.ok(result.text.includes("https://example-blog.com/product"));
    assert.equal(result.text.includes("很值得買"), false);
    assert.equal(result.text.includes("12000 到 19000"), false);
  } finally {
    global.fetch = originalFetch;
  }
}

async function testUnsupportedHighRiskClaimFallsBackToSourceSummary() {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      choices: [
        {
          message: {
            content:
              "這家店距離很近，目前營業中，而且評分很高。\nhttps://trusted.example/place"
          },
          finish_reason: "stop"
        }
      ]
    })
  });

  try {
    const result = await askLocalModelWithSearchEvidence(
      "附近店家",
      [
        {
          title: "店家官方頁",
          url: "https://trusted.example/place",
          snippet: "店家介紹與菜單內容",
          sourceType: "structured_platform",
          qualityScore: 80,
          qualityReasons: ["structured_platform_domain"],
          fetchedAt: "2026-05-29T00:00:00.000Z"
        }
      ],
      BASE_CONFIG,
      {
        deadlineMs: Date.now() + 1000,
        timeoutMs: 1000
      }
    );

    assert.equal(result.reason, "policy_security_or_grounding");
    assert.equal(result.fallbackUsed, true);
    assert.ok(result.text.includes("無法逐項驗證更多細節"));
    assert.ok(result.text.includes("https://trusted.example/place"));
    assert.equal(result.text.includes("目前營業中"), false);
    assert.equal(result.text.includes("評分很高"), false);
  } finally {
    global.fetch = originalFetch;
  }
}

async function testPromptInjectionEvidenceSkipsModel() {
  const originalFetch = global.fetch;
  let fetchCalled = false;
  global.fetch = async () => {
    fetchCalled = true;
    throw new Error("model should not be called for injection-risk evidence");
  };

  try {
    const result = await askLocalModelWithSearchEvidence(
      "通用搜尋問題",
      [
        {
          title: "可疑來源",
          url: "https://example.com/injected",
          snippet: "正常內容。[已移除可疑網頁指令]",
          sourceType: "structured_platform",
          securityFlags: ["prompt_injection_signal"],
          securityAnswerMode: "conservative_summary",
          fetchedAt: "2026-05-29T00:00:00.000Z"
        }
      ],
      BASE_CONFIG,
      {
        deadlineMs: Date.now() + 1000,
        timeoutMs: 1000
      }
    );

    assert.equal(fetchCalled, false);
    assert.equal(result.reason, "policy_security_or_grounding");
    assert.equal(result.fallbackUsed, true);
    assert.ok(result.text.includes("無法逐項驗證更多細節"));
    assert.ok(result.text.includes("https://example.com/injected"));
  } finally {
    global.fetch = originalFetch;
  }
}

async function testLmStudioToolsClientSendsRestIntegrationAndToken() {
  const originalFetch = global.fetch;
  let captured;
  global.fetch = async (url, options) => {
    captured = {
      url,
      options,
      body: JSON.parse(options.body)
    };
    return {
      ok: true,
      status: 200,
      json: async () => ({
        output: [
          {
            type: "message",
            content: "OpenAI 最新消息可參考官方新聞頁。\nhttps://openai.com/news/"
          }
        ]
      })
    };
  };

  try {
    const result = await askLocalModelWithWebSearchTools(
      "OpenAI 最新消息",
      {
        ...BASE_CONFIG,
        webSearchLmstudioToolsEnabled: true,
        localModelApiToken: "test-token"
      },
      {
        deadlineMs: Date.now() + 1000,
        timeoutMs: 1000
      }
    );

    assert.equal(result.ok, true);
    assert.equal(result.text.includes("[來源](https://openai.com/news/)"), true);
    assert.equal(result.text.includes("OpenAI 最新消息"), true);
    assert.equal(captured.url, "http://127.0.0.1:1234/api/v1/chat");
    assert.equal(captured.options.headers.authorization, "Bearer test-token");
    assert.deepEqual(captured.body.integrations, ["npacker/web-tools"]);
    assert.equal(captured.body.model, "test-model");
    assert.equal(captured.body.input.includes("OpenAI 最新消息"), true);
  } finally {
    global.fetch = originalFetch;
  }
}

async function testLmStudioToolsClientClassifiesPluginPermissionDenied() {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: false,
    status: 403,
    json: async () => ({
      error: {
        message:
          "Permission denied to use plugin 'npacker/web-tools'. Ensure that the server configuration allows plugin usage."
      }
    })
  });

  try {
    const result = await askLocalModelWithWebSearchTools(
      "OpenAI 最新消息",
      {
        ...BASE_CONFIG,
        webSearchLmstudioToolsEnabled: true
      },
      {
        deadlineMs: Date.now() + 1000,
        timeoutMs: 1000
      }
    );

    assert.equal(result.ok, false);
    assert.equal(result.reason, "permission_denied");
    assert.equal(result.statusCode, 403);
  } finally {
    global.fetch = originalFetch;
  }
}

async function testLmStudioToolsClientKeepsClickableMarkdownSource() {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      output: [
        {
          type: "message",
          content: "OpenAI 有新消息，可參考官方新聞頁。來源：[OpenAI](https://openai.com/news/)。"
        }
      ]
    })
  });

  try {
    const result = await askLocalModelWithWebSearchTools(
      "OpenAI 最新消息",
      {
        ...BASE_CONFIG,
        webSearchLmstudioToolsEnabled: true
      },
      {
        deadlineMs: Date.now() + 1000,
        timeoutMs: 1000
      }
    );

    assert.equal(result.ok, true);
    assert.equal(result.text.includes("[OpenAI](https://openai.com/news/)"), true);
    assert.equal(result.text.includes("https://openai.com/news/"), true);
  } finally {
    global.fetch = originalFetch;
  }
}

async function testUnexpectedSearchErrorRepliesFailure() {
  const { calls, runtime } = createRuntime({
    searchWeb: async () => {
      throw new Error("boom");
    }
  });
  await runtime.handleEvent(createTextEvent("查: 例外"), "req", 0);
  await runtime.drainWebSearchQueue();

  assert.deepEqual(calls.replies.map((item) => item.text), ["搜尋失敗"]);
  assert.deepEqual(calls.push, []);
}

function testDirectReplyGate() {
  assert.equal(shouldUseDirectModelReply("嗨", BASE_CONFIG), true);
  assert.equal(shouldUseDirectModelReply("你是誰", BASE_CONFIG), true);
  assert.equal(shouldUseDirectModelReply("測試一下", BASE_CONFIG), true);
  assert.equal(shouldUseDirectModelReply("幫我想三個晚餐選項", BASE_CONFIG), true);
  assert.equal(shouldUseDirectModelReply("整理房間步驟", BASE_CONFIG), true);
  assert.equal(shouldUseDirectModelReply("詳細說明 xxx", BASE_CONFIG), true);
  assert.equal(
    shouldUseDirectModelReply("字".repeat(801), BASE_CONFIG),
    false
  );
  assert.equal(
    shouldUseDirectModelReply("嗨", { ...BASE_CONFIG, generalDirectReplyEnabled: false }),
    false
  );
}

async function testNormalChatStillSavesMemory() {
  const { calls, memoryStore, runtime } = createRuntime();
  await runtime.handleEvent(createTextEvent("你好"), "req", 0);
  await runtime.drainGeneralReplyQueue();

  assert.deepEqual(calls.replies.map((item) => item.text), ["一般回覆"]);
  assert.deepEqual(calls.push, []);
  assert.deepEqual(calls.modelInputs, ["你好"]);
  assert.equal(calls.modelOptions.length, 1);
  assert.equal(calls.modelOptions[0].maxEmptyResponseRetries, 0);
  assert.equal(Number.isFinite(calls.modelOptions[0].deadlineMs), true);
  assert.equal(memoryStore.calls.shortTermSaves.length, 1);
}

async function testDirectChatFallbackUsesAsyncAndSavesOnPush() {
  let callCount = 0;
  const { calls, memoryStore, runtime } = createRuntime({
    askLocalModel: async (input, _config, _memoryContext, options) => {
      calls.modelInputs.push(input);
      calls.modelOptions.push(options);
      callCount += 1;
      if (callCount === 2) {
        return {
          text: "背景完成",
          fallbackUsed: false,
          reason: "success"
        };
      }

      return {
        text: "Sorry, I cannot answer right now. Please try again later.",
        fallbackUsed: true,
        reason: "timeout"
      };
    }
  });

  await runtime.handleEvent(createTextEvent("測試"), "req", 0);
  await runtime.drainGeneralReplyQueue();

  assert.deepEqual(calls.replies.map((item) => item.text), ["思考中"]);
  assert.equal(calls.push.length, 1);
  assert.equal(calls.push[0].to, "U123");
  assert.equal(calls.push[0].text, "背景完成");
  assert.deepEqual(calls.modelInputs, ["測試", "測試"]);
  assert.equal(calls.modelOptions[0].maxEmptyResponseRetries, 0);
  assert.equal(memoryStore.calls.shortTermSaves.length, 1);
}

async function testGeneralChatUpdatesRollingSummary() {
  const memoryStore = createFakeMemoryStore();
  const rollingBatch = Array.from({ length: 12 }, (_value, index) => ({
    id: index + 1,
    role: index % 2 === 0 ? "user" : "assistant",
    content: `舊對話 ${index + 1}`
  }));
  memoryStore.getPendingRollingSummaryBatch = () => rollingBatch;

  const { memoryStore: runtimeMemoryStore, runtime } = createRuntime({
    memoryStore,
    config: { generalDirectReplyEnabled: false },
    summarizeRollingConversationBatch: async (batch) => {
      assert.equal(batch.length, rollingBatch.length);
      return { ok: true, summary: "已壓縮的舊對話摘要" };
    }
  });

  await runtime.handleEvent(createTextEvent("這是一段超過二十字的一般聊天，會走背景回覆"), "req", 0);
  await runtime.drainGeneralReplyQueue();
  await runtime.drainMemoryOrganizationQueue();

  assert.equal(runtimeMemoryStore.calls.shortTermSaves.length, 1);
  assert.equal(runtimeMemoryStore.calls.conversationSummarySaves.length, 1);
  assert.equal(
    runtimeMemoryStore.calls.conversationSummarySaves[0].summary,
    "已壓縮的舊對話摘要"
  );
  assert.equal(runtimeMemoryStore.calls.conversationSummarySaves[0].metadata.firstShortTermId, 1);
  assert.equal(runtimeMemoryStore.calls.conversationSummarySaves[0].metadata.lastShortTermId, 12);
}

async function testGeneralChatPushTargetMissingDoesNotStartModel() {
  const { calls, runtime } = createRuntime();
  await runtime.handleEvent(
    createTextEvent("@bot 你好", {
      source: { type: "group", userId: "U123" },
      message: {
        mention: {
          mentionees: [{ index: 0, length: 4, isSelf: true }]
        }
      }
    }),
    "req",
    0
  );
  await runtime.drainGeneralReplyQueue();

  assert.deepEqual(calls.replies.map((item) => item.text), [
    "目前無法在這個對話補送回覆。"
  ]);
  assert.equal(calls.push.length, 0);
  assert.equal(calls.modelInputs.length, 0);
}

async function testWebhookRespondsBeforeGeneralModelCompletion() {
  let releaseModel;
  const { calls, runtime } = createRuntime({
    createLineMiddleware: createJsonBodyMiddleware(),
    config: { generalDirectReplyEnabled: false },
    askLocalModel: async (input) => {
      calls.modelInputs.push(input);
      await new Promise((resolve) => {
        releaseModel = resolve;
      });
      return { text: "背景完成", fallbackUsed: false, reason: "success" };
    }
  });
  const server = await new Promise((resolve) => {
    const listener = runtime.app.listen(0, "127.0.0.1", () => resolve(listener));
  });

  try {
    const response = await postWebhook(server.address().port, {
      events: [createTextEvent("這是一段明確超過二十個字的一般聊天測試內容")]
    });

    assert.equal(response.statusCode, 200);
    await runtime.drainWebhookEventQueue();
    assert.deepEqual(calls.replies.map((item) => item.text), ["思考中"]);
    assert.equal(calls.push.length, 0);
    assert.equal(calls.modelInputs.length, 1);
    assert.equal(calls.modelInputs[0], "這是一段明確超過二十個字的一般聊天測試內容");

    releaseModel();
    await runtime.drainGeneralReplyQueue();
    assert.deepEqual(calls.push, [{ to: "U123", text: "背景完成" }]);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function testMemoryCommandKeepsPriority() {
  const { calls, memoryStore, runtime } = createRuntime();
  await runtime.handleEvent(createTextEvent("記住: 查: 測試"), "req", 0);
  await runtime.drainWebSearchQueue();

  assert.deepEqual(calls.replies.map((item) => item.text), ["已記住。"]);
  assert.equal(calls.searchQueries.length, 0);
  assert.equal(memoryStore.calls.longTermSaves.length, 1);
}

async function testGroupNoMentionDoesNotSearch() {
  const { calls, runtime } = createRuntime();
  await runtime.handleEvent(
    createTextEvent("查: 台積電", {
      source: { type: "group", groupId: "G123", userId: "U123" },
      message: {}
    }),
    "req",
    0
  );
  await runtime.drainMemoryOrganizationQueue();
  await runtime.drainWebSearchQueue();

  assert.equal(calls.replies.length, 0);
  assert.equal(calls.push.length, 0);
  assert.equal(calls.searchQueries.length, 0);
}

async function testSearchDoesNotRequirePushTarget() {
  const { calls, runtime } = createRuntime();
  await runtime.handleEvent(
    createTextEvent("@bot 查: 台積電", {
      source: { type: "group", userId: "U123" },
      message: {
        mention: {
          mentionees: [{ index: 0, length: 4, isSelf: true }]
        }
      }
    }),
    "req",
    0
  );
  await runtime.drainWebSearchQueue();

  assert.deepEqual(calls.replies.map((item) => item.text), ["搜尋整理: 台積電"]);
  assert.equal(calls.push.length, 0);
  assert.deepEqual(calls.searchQueries, ["台積電"]);
}

async function testBodyReadTimeout() {
  const originalFetch = global.fetch;
  global.fetch = async (_url, options) => {
    assert.ok(options.signal, "fetch should receive an AbortSignal");
    return {
      ok: true,
      headers: { get: () => "text/html" },
      text: () => new Promise(() => {})
    };
  };

  try {
    const startedAt = Date.now();
    const result = await searchWeb("timeout", {
      ...BASE_CONFIG,
      webSearchTotalTimeoutMs: 25,
      webSearchPageTimeoutMs: 25
    });
    const durationMs = Date.now() - startedAt;

    assert.equal(result.ok, false);
    assert.equal(result.reason, "timeout");
    assert.ok(durationMs < 500, `body read timeout should be bounded, got ${durationMs}ms`);
  } finally {
    global.fetch = originalFetch;
  }
}

async function testHugeSearchBodyIsBounded() {
  const originalFetch = global.fetch;
  global.fetch = async (_url, options) => {
    assert.ok(options.signal, "fetch should receive an AbortSignal");
    return {
      ok: true,
      headers: {
        get: (name) => (String(name).toLowerCase() === "content-length" ? "999999999" : "text/html")
      },
      text: async () => {
        throw new Error("oversized body should be rejected before text read");
      }
    };
  };

  try {
    const result = await searchWeb("huge", {
      ...BASE_CONFIG,
      webSearchTotalTimeoutMs: 100,
      webSearchPageTimeoutMs: 25
    });

    assert.equal(result.ok, false);
    assert.equal(result.reason, "error");
  } finally {
    global.fetch = originalFetch;
  }
}

async function run() {
  testReplyLengthHardLimit();
  await testDisabledFlags();
  await testPushDisabledDoesNotBlockReplySearch();
  await testEmptyQuery();
  await testNormalSearchFlow();
  await testAutoSearchDecisionStartsReplyOnlySearch();
  await testAutoSearchDecisionFalseUsesNormalChat();
  await testAutoSearchPlanNaturalQueriesUseWebSearch();
  await testForcedSearchUsesPlanQueryWhenAvailable();
  await testForcedSearchFallsBackToRawQueryWhenPlanFails();
  await testSearchPlanFailureUsesNormalChatWithNoFakeSearchGuard();
  await testSearchDecisionClientParsesJson();
  await testSearchDecisionClientAcceptsJsonReasonText();
  await testLmStudioToolsEnabledDoesNotBypassStableEvidenceSearch();
  await testLmStudioToolsFailureDoesNotBlockStableEvidenceSearch();
  await testNoResults();
  await testTotalTimeoutAfterSearch();
  await testReplyDeadlineIsSeparateFromSearchTimeout();
  await testModelTimeoutRepliesSearchFailure();
  await testQueuedSearchEvidenceSkipsExpiredDeadline();
  await testSearchEvidenceAnswerWithoutUrlsFallsBackToSourceSummary();
  await testSearchEvidenceEnglishAnswerFallsBackToChineseSourceSummary();
  await testSearchEvidenceAnswerFallsBackWhenListExceedsEvidence();
  await testWeakEvidenceListFallsBackToSourceSummary();
  await testWeakEvidenceNarrativeFallsBackToSourceSummary();
  await testUnsupportedHighRiskClaimFallsBackToSourceSummary();
  await testPromptInjectionEvidenceSkipsModel();
  await testLmStudioToolsClientSendsRestIntegrationAndToken();
  await testLmStudioToolsClientClassifiesPluginPermissionDenied();
  await testLmStudioToolsClientKeepsClickableMarkdownSource();
  await testUnexpectedSearchErrorRepliesFailure();
  testDirectReplyGate();
  await testNormalChatStillSavesMemory();
  await testDirectChatFallbackUsesAsyncAndSavesOnPush();
  await testGeneralChatUpdatesRollingSummary();
  await testGeneralChatPushTargetMissingDoesNotStartModel();
  await testWebhookRespondsBeforeGeneralModelCompletion();
  await testMemoryCommandKeepsPriority();
  await testGroupNoMentionDoesNotSearch();
  await testSearchDoesNotRequirePushTarget();
  await testBodyReadTimeout();
  await testHugeSearchBodyIsBounded();
}

run().then(() => {
  console.log(JSON.stringify({ status: "PASS", web_search_runtime: true }));
});
