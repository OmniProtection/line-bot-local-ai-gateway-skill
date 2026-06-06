const assert = require("node:assert/strict");
const { createBotRuntime } = require("../src/server");

const BASE_CONFIG = {
  lineChannelSecret: "test-secret",
  lineChannelAccessToken: "test-token",
  localModelProvider: "lmstudio",
  localModelBaseUrl: "http://127.0.0.1:1234/v1",
  localModelRestBaseUrl: "http://127.0.0.1:1234/api/v1",
  localModelApiToken: "",
  localModelName: "google/gemma-4-e4b",
  localModelTimeoutMs: 1000,
  chatTemperature: 0.4,
  chatTopP: 0.9,
  chatMaxTokens: 256,
  chatContextLength: 8192,
  maxReplyChars: 800,
  webSearchMaxReplyChars: 1600,
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

function createFakeMemoryStore() {
  const seenWebhookIds = new Set();
  let nextLineEventId = 1;
  const calls = {
    autoMemoryBatches: [],
    conversationSummarySaves: [],
    lineEvents: [],
    longTermSaves: [],
    memoryContextLoads: [],
    shortTermSaves: []
  };

  return {
    calls,
    deleteLongTermMemories: () => ({ deletedCount: 0 }),
    getActiveLineEventIdsForMemory: (_scope, ids) => ids,
    getConversationSummary: () => null,
    getPendingAutoMemoryBatch: (scope) => {
      calls.autoMemoryBatches.push(scope);
      return [];
    },
    getPendingRollingSummaryBatch: () => [],
    listLongTermMemories: () => [],
    loadRelevantMemoryContext: (scope, query, options = {}) => {
      calls.memoryContextLoads.push({ scope, query, options });
      return {
        evidence: [],
        groupMentionContext: [],
        recentConversation: [],
        rollingSummary: null
      };
    },
    markLineEventsProcessedForMemory: () => {},
    markLineMessageUnsent: () => {},
    saveConversationSummary: (scope, summary, metadata) => {
      calls.conversationSummarySaves.push({ scope, summary, metadata });
      return { saved: true };
    },
    saveLineEventLog: (event) => {
      if (seenWebhookIds.has(event.webhookEventId)) {
        return { duplicate: true, inserted: false };
      }
      seenWebhookIds.add(event.webhookEventId);
      calls.lineEvents.push(event);
      return { duplicate: false, id: nextLineEventId++, inserted: true };
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
    generalModelInputs: [],
    generalModelOptions: [],
    groupSummaries: [],
    push: [],
    replies: [],
    rollingSummaries: [],
    searchDecisions: [],
    searchEvidenceQueries: [],
    searchQueries: [],
    webSearchToolsQueries: []
  };
  const memoryStore = overrides.memoryStore || createFakeMemoryStore();
  const config = { ...BASE_CONFIG, ...(overrides.config || {}) };
  let currentNow = overrides.nowMs || 1000;

  const runtime = createBotRuntime({
    config,
    validateConfig: false,
    createLineMiddleware: () => (_req, _res, next) => next(),
    lineClient: {},
    logEvent: () => {},
    memoryStore,
    now: () => currentNow,
    askLocalModel:
      overrides.askLocalModel ||
      (async (input, _config, _memoryContext, options) => {
        calls.generalModelInputs.push(input);
        calls.generalModelOptions.push(options);
        return { fallbackUsed: false, reason: "success", text: `一般回覆: ${input}` };
      }),
    askLocalModelWithSearchEvidence:
      overrides.askLocalModelWithSearchEvidence ||
      (async (query, evidence, _config, options) => {
        calls.searchEvidenceQueries.push({ query, evidence, options });
        return { fallbackUsed: false, reason: "success", text: `搜尋整理: ${query}` };
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
        return { durationMs: 0, ok: false, reason: "disabled" };
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
        return {
          durationMs: 1,
          evidence: [
            {
              fetchedAt: "2026-06-01T00:00:00.000Z",
              snippet: "Evidence",
              title: "Source",
              url: "https://example.com"
            }
          ],
          ok: true,
          options
        };
      }),
    summarizeGroupMemoryBatch: async (batch, configArg) => {
      calls.groupSummaries.push({ batch, config: configArg });
      return { ok: true, summary: "group summary" };
    },
    summarizeRollingConversationBatch: async (batch, summary, configArg) => {
      calls.rollingSummaries.push({ batch, summary, config: configArg });
      return { ok: true, summary: "rolling summary" };
    }
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

function textEvent(text, overrides = {}) {
  const event = {
    type: "message",
    timestamp: 1710000000000,
    source: overrides.source || { type: "user", userId: "U123" },
    message: {
      id: overrides.messageId || `msg-${Math.random()}`,
      text,
      type: "text",
      ...(overrides.message || {})
    },
    webhookEventId: overrides.webhookEventId || `event-${Math.random()}`
  };

  if (overrides.replyToken !== false) {
    event.replyToken = overrides.replyToken || `reply-${Math.random()}`;
  }
  if (overrides.deliveryContext) {
    event.deliveryContext = overrides.deliveryContext;
  }

  return event;
}

function nonTextEvent(overrides = {}) {
  return {
    type: "message",
    replyToken: overrides.replyToken || `reply-${Math.random()}`,
    timestamp: 1710000000000,
    source: overrides.source || { type: "user", userId: "U123" },
    message: {
      id: overrides.messageId || `msg-${Math.random()}`,
      type: "image"
    },
    webhookEventId: overrides.webhookEventId || `event-${Math.random()}`
  };
}

function groupSource() {
  return { groupId: "G123", type: "group", userId: "U123" };
}

function roomSource() {
  return { roomId: "R123", type: "room", userId: "U123" };
}

function mentionMessage(textAfterMention) {
  const mentionText = "@冥王星";
  return {
    mention: {
      mentionees: [{ index: 0, isSelf: true, length: mentionText.length, type: "user" }]
    },
    text: `${mentionText}${textAfterMention ? ` ${textAfterMention}` : ""}`
  };
}

async function drain(runtime) {
  await runtime.drainWebhookEventQueue();
  await runtime.drainGeneralReplyQueue();
  await runtime.drainWebSearchQueue();
  await runtime.drainMemoryOrganizationQueue();
}

function assertNoOutbound(calls, label) {
  assert.equal(calls.replies.length, 0, `${label}: should not reply`);
  assert.equal(calls.push.length, 0, `${label}: should not push`);
  assert.equal(calls.generalModelInputs.length, 0, `${label}: should not call general model`);
  assert.equal(calls.searchQueries.length, 0, `${label}: should not search`);
  assert.equal(calls.searchEvidenceQueries.length, 0, `${label}: should not call search answer model`);
  assert.equal(calls.webSearchToolsQueries.length, 0, `${label}: should not call LM Studio tools`);
  assert.equal(calls.groupSummaries.length, 0, `${label}: should not summarize group memory`);
}

async function testPrivateMemoryCommandKeepsPriority() {
  const { calls, memoryStore, runtime } = createRuntime();
  await runtime.handleEvent(textEvent("記住: 查: 測試內容"), "req", 0);
  await drain(runtime);

  assert.deepEqual(calls.replies.map((item) => item.text), ["已記住。"]);
  assert.equal(memoryStore.calls.longTermSaves.length, 1);
  assert.equal(calls.searchQueries.length, 0);
  assert.equal(calls.generalModelInputs.length, 0);
}

async function testPrivateSearchFlowDoesNotSaveMemory() {
  const { calls, memoryStore, runtime } = createRuntime();
  await runtime.handleEvent(textEvent("查: 台積電"), "req", 0);
  await drain(runtime);

  assert.deepEqual(calls.replies.map((item) => item.text), ["搜尋整理: 台積電"]);
  assert.deepEqual(calls.searchQueries, ["台積電"]);
  assert.deepEqual(calls.push, []);
  assert.equal(memoryStore.calls.shortTermSaves.length, 0);
}

async function testPrivateEmptySearch() {
  const { calls, runtime } = createRuntime();
  await runtime.handleEvent(textEvent("搜:"), "req", 0);
  await drain(runtime);

  assert.deepEqual(calls.replies.map((item) => item.text), ["請在 搜: 後面加上要搜尋的內容。"]);
  assert.equal(calls.searchQueries.length, 0);
  assert.equal(calls.push.length, 0);
}

async function testPrivateNaturalSearchPhraseIsNormalChat() {
  const { calls, runtime } = createRuntime();
  await runtime.handleEvent(textEvent("幫我查台積電"), "req", 0);
  await drain(runtime);

  assert.deepEqual(calls.generalModelInputs, ["幫我查台積電"]);
  assert.equal(calls.searchQueries.length, 0);
  assert.equal(calls.replies.length, 1);
}

async function testPrivateLongGeneralChatUsesPendingReplyAndPush() {
  const { calls, memoryStore, runtime } = createRuntime({
    config: { generalDirectReplyEnabled: false }
  });
  await runtime.handleEvent(textEvent("請詳細說明 LINE Bot 搜尋流程的一致規則"), "req", 0);
  await drain(runtime);

  assert.deepEqual(calls.replies.map((item) => item.text), ["思考中"]);
  assert.deepEqual(calls.push, [
    { text: "一般回覆: 請詳細說明 LINE Bot 搜尋流程的一致規則", to: "U123" }
  ]);
  assert.equal(memoryStore.calls.shortTermSaves.length, 1);
}

async function testNonTextAndMissingReplyTokenAreIgnoredAfterEventLog() {
  const first = createRuntime();
  await first.runtime.handleEvent(nonTextEvent(), "req", 0);
  await drain(first.runtime);
  assert.equal(first.memoryStore.calls.lineEvents.length, 1);
  assertNoOutbound(first.calls, "non-text event");

  const second = createRuntime();
  await second.runtime.handleEvent(textEvent("你好", { replyToken: false }), "req", 0);
  await drain(second.runtime);
  assert.equal(second.memoryStore.calls.lineEvents.length, 1);
  assertNoOutbound(second.calls, "missing reply token");
}

async function testRedeliveryDuplicateIsIgnored() {
  const { calls, memoryStore, runtime } = createRuntime();
  const first = textEvent("你好", { webhookEventId: "event-duplicate" });
  const second = textEvent("你好", {
    deliveryContext: { isRedelivery: true },
    webhookEventId: "event-duplicate"
  });

  await runtime.handleEvent(first, "req", 0);
  await runtime.handleEvent(second, "req", 1);
  await drain(runtime);

  assert.equal(memoryStore.calls.lineEvents.length, 1);
  assert.equal(calls.generalModelInputs.length, 1);
  assert.equal(calls.replies.length, 1);
}

async function testGroupAndRoomNoMentionNeverStartOutboundWork() {
  for (const [label, source] of [
    ["group no mention general", groupSource()],
    ["group no mention search", groupSource()],
    ["room no mention search", roomSource()]
  ]) {
    const { calls, memoryStore, runtime } = createRuntime();
    const text = label.includes("search") ? "查: 台積電" : "你好";
    await runtime.handleEvent(textEvent(text, { source }), "req", 0);
    await drain(runtime);

    assert.equal(memoryStore.calls.lineEvents.length, 1, `${label}: raw event should be saved`);
    assert.equal(
      memoryStore.calls.autoMemoryBatches.length,
      0,
      `${label}: should not start background memory organization`
    );
    assertNoOutbound(calls, label);
  }
}

async function testGroupMentionEmptyText() {
  const { calls, runtime } = createRuntime();
  await runtime.handleEvent(
    textEvent("@冥王星", { message: mentionMessage(""), source: groupSource() }),
    "req",
    0
  );
  await drain(runtime);

  assert.deepEqual(calls.replies.map((item) => item.text), [
    "請在 @冥王星 後面加上你要問的內容。"
  ]);
  assert.equal(calls.generalModelInputs.length, 0);
}

async function testGroupMentionFollowUpKeepsInputAndLoadsSameGroupContext() {
  const { calls, memoryStore, runtime } = createRuntime();
  await runtime.handleEvent(
    textEvent("@冥王星 明天早上吃什麼？", {
      message: mentionMessage("明天早上吃什麼？"),
      source: groupSource()
    }),
    "req",
    0
  );
  await drain(runtime);

  assert.deepEqual(calls.generalModelInputs, ["明天早上吃什麼？"]);
  assert.equal(memoryStore.calls.memoryContextLoads.length, 1);
  assert.equal(memoryStore.calls.memoryContextLoads[0].query, "明天早上吃什麼？");
  assert.equal(
    memoryStore.calls.memoryContextLoads[0].options.includeGroupMentionContext,
    true,
    "group mentions should load same-group context without special-casing the input text"
  );
  assert.equal(
    memoryStore.calls.memoryContextLoads[0].scope.key,
    "group:G123",
    "group mention context should stay scoped to the current group"
  );
}

async function testGroupMentionMemorySearchAndGeneralOrdering() {
  const memory = createRuntime();
  await memory.runtime.handleEvent(
    textEvent("@冥王星 記住: 查: 測試", {
      message: mentionMessage("記住: 查: 測試"),
      source: groupSource()
    }),
    "req",
    0
  );
  await drain(memory.runtime);
  assert.deepEqual(memory.calls.replies.map((item) => item.text), ["已記住。"]);
  assert.equal(memory.memoryStore.calls.longTermSaves.length, 1);
  assert.equal(memory.calls.searchQueries.length, 0);

  const search = createRuntime();
  await search.runtime.handleEvent(
    textEvent("@冥王星 查: 台積電", {
      message: mentionMessage("查: 台積電"),
      source: groupSource()
    }),
    "req",
    0
  );
  await drain(search.runtime);
  assert.deepEqual(search.calls.replies.map((item) => item.text), ["搜尋整理: 台積電"]);
  assert.deepEqual(search.calls.searchQueries, ["台積電"]);
  assert.deepEqual(search.calls.push, []);
  assert.equal(search.memoryStore.calls.shortTermSaves.length, 0);

  const general = createRuntime({
    config: { generalDirectReplyEnabled: false }
  });
  await general.runtime.handleEvent(
    textEvent("@冥王星 請詳細說明 LINE Bot 搜尋流程的一致規則", {
      message: mentionMessage("請詳細說明 LINE Bot 搜尋流程的一致規則"),
      source: groupSource()
    }),
    "req",
    0
  );
  await drain(general.runtime);
  assert.deepEqual(general.calls.replies.map((item) => item.text), ["思考中"]);
  assert.deepEqual(general.calls.push, [
    { text: "一般回覆: 請詳細說明 LINE Bot 搜尋流程的一致規則", to: "G123" }
  ]);
}

async function testRoomMentionGeneralUsesRoomPushTarget() {
  const { calls, runtime } = createRuntime({
    config: { generalDirectReplyEnabled: false }
  });
  await runtime.handleEvent(
    textEvent("@冥王星 請詳細說明 room 搜尋與一般對話的一致規則", {
      message: mentionMessage("請詳細說明 room 搜尋與一般對話的一致規則"),
      source: roomSource()
    }),
    "req",
    0
  );
  await drain(runtime);

  assert.deepEqual(calls.replies.map((item) => item.text), ["思考中"]);
  assert.deepEqual(calls.push, [
    { text: "一般回覆: 請詳細說明 room 搜尋與一般對話的一致規則", to: "R123" }
  ]);
}

async function testSearchFlagFailuresAndToolFallbackRouting() {
  const disabled = createRuntime({
    config: { webSearchBackgroundPushEnabled: false, webSearchEnabled: false }
  });
  await disabled.runtime.handleEvent(textEvent("查: 台積電"), "req", 0);
  await drain(disabled.runtime);
  assert.deepEqual(disabled.calls.replies.map((item) => item.text), ["網路搜尋功能目前未啟用。"]);

  const pushDisabled = createRuntime({
    config: { webSearchBackgroundPushEnabled: false, webSearchEnabled: true }
  });
  await pushDisabled.runtime.handleEvent(textEvent("查: 台積電"), "req", 0);
  await drain(pushDisabled.runtime);
  assert.deepEqual(pushDisabled.calls.replies.map((item) => item.text), ["搜尋整理: 台積電"]);
  assert.deepEqual(pushDisabled.calls.push, []);

  const toolsTimeout = createRuntime({
    askLocalModelWithWebSearchTools: async (query, _config, options) => {
      toolsTimeout.calls.webSearchToolsQueries.push({ query, options });
      return { durationMs: 1000, ok: false, reason: "timeout" };
    },
    config: { webSearchDuckDuckGoFallbackEnabled: false, webSearchLmstudioToolsEnabled: true }
  });
  await toolsTimeout.runtime.handleEvent(textEvent("搜: 台積電今天股價"), "req", 0);
  await drain(toolsTimeout.runtime);
  assert.deepEqual(toolsTimeout.calls.webSearchToolsQueries, []);
  assert.deepEqual(toolsTimeout.calls.searchQueries, ["台積電今天股價"]);
  assert.deepEqual(toolsTimeout.calls.replies.map((item) => item.text), [
    "搜尋整理: 台積電今天股價"
  ]);
  assert.deepEqual(toolsTimeout.calls.push, []);

  const toolsFallback = createRuntime({
    askLocalModelWithWebSearchTools: async (query, _config, options) => {
      toolsFallback.calls.webSearchToolsQueries.push({ query, options });
      return { durationMs: 1000, ok: false, reason: "timeout" };
    },
    config: { webSearchDuckDuckGoFallbackEnabled: true, webSearchLmstudioToolsEnabled: true }
  });
  await toolsFallback.runtime.handleEvent(textEvent("搜: 台積電今天股價"), "req", 0);
  await drain(toolsFallback.runtime);
  assert.deepEqual(toolsFallback.calls.webSearchToolsQueries, []);
  assert.deepEqual(toolsFallback.calls.searchQueries, ["台積電今天股價"]);
  assert.deepEqual(toolsFallback.calls.replies.map((item) => item.text), [
    "搜尋整理: 台積電今天股價"
  ]);
  assert.deepEqual(toolsFallback.calls.push, []);
}

async function testSearchNoEvidenceAndGroundingFallbacks() {
  const noEvidence = createRuntime({
    searchWeb: async () => ({ durationMs: 1, evidence: [], ok: false, reason: "no_results" })
  });
  await noEvidence.runtime.handleEvent(textEvent("查: 不存在的資料"), "req", 0);
  await drain(noEvidence.runtime);
  assert.deepEqual(noEvidence.calls.replies.map((item) => item.text), ["搜尋失敗"]);
  assert.deepEqual(noEvidence.calls.push, []);

  const grounding = createRuntime({
    askLocalModelWithSearchEvidence: async (query, evidence, _config, options) => {
      grounding.calls.searchEvidenceQueries.push({ query, evidence, options });
      return {
        fallbackUsed: true,
        reason: "policy_security_or_grounding",
        text: "我找到以下來源，但無法逐項驗證更多細節。\n1. Source\nhttps://example.com"
      };
    }
  });
  await grounding.runtime.handleEvent(textEvent("查: grounding 測試"), "req", 0);
  await drain(grounding.runtime);
  assert.equal(grounding.calls.replies.length, 1);
  assert.ok(grounding.calls.replies[0].text.includes("無法逐項驗證"));
  assert.equal(grounding.memoryStore.calls.shortTermSaves.length, 0);
}

async function run() {
  await testPrivateMemoryCommandKeepsPriority();
  await testPrivateSearchFlowDoesNotSaveMemory();
  await testPrivateEmptySearch();
  await testPrivateNaturalSearchPhraseIsNormalChat();
  await testPrivateLongGeneralChatUsesPendingReplyAndPush();
  await testNonTextAndMissingReplyTokenAreIgnoredAfterEventLog();
  await testRedeliveryDuplicateIsIgnored();
  await testGroupAndRoomNoMentionNeverStartOutboundWork();
  await testGroupMentionEmptyText();
  await testGroupMentionFollowUpKeepsInputAndLoadsSameGroupContext();
  await testGroupMentionMemorySearchAndGeneralOrdering();
  await testRoomMentionGeneralUsesRoomPushTarget();
  await testSearchFlagFailuresAndToolFallbackRouting();
  await testSearchNoEvidenceAndGroundingFallbacks();

  console.log(
    JSON.stringify({
      status: "PASS",
      matrix: "line-routing",
      scenarios: 23,
      rule: "private-direct-group-room-require-self-mention"
    })
  );
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
