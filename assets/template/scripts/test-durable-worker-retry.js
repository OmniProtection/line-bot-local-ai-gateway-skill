const assert = require("node:assert/strict");
const { createGatewayStore } = require("../src/gatewayStore");
const { createBotRuntime } = require("../src/server");

const BASE_CONFIG = {
  lineChannelSecret: "test-secret",
  lineChannelAccessToken: "test-token",
  localModelProvider: "lmstudio",
  localModelBaseUrl: "http://127.0.0.1:1234/v1",
  localModelName: "test-model",
  localModelTimeoutMs: 1000,
  chatTemperature: 0.4,
  chatTopP: 0.9,
  chatMaxTokens: 256,
  chatContextLength: 8192,
  maxReplyChars: 800,
  webSearchMaxReplyChars: 3500,
  webSearchEnabled: true,
  webSearchBackgroundPushEnabled: true,
  webSearchMaxResults: 3,
  webSearchTotalTimeoutMs: 1000,
  webSearchJobTimeoutMs: 1000,
  webSearchPageTimeoutMs: 200,
  webSearchPendingReplyText: "searching",
  webSearchReplyDeadlineMs: 59000,
  webSearchDecisionTimeoutMs: 20000,
  webSearchDecisionConfidenceThreshold: 0.65,
  webSearchAutoDecisionEnabled: true,
  generalPendingReplyText: "thinking",
  generalDirectReplyEnabled: false,
  generalDirectReplyMaxInputChars: 20,
  generalDirectModelTimeoutMs: 1300,
  port: 0
};

function createTextEvent(text, id) {
  return {
    type: "message",
    replyToken: `reply-${id}`,
    timestamp: 1710000000000,
    source: { type: "user", userId: "U123" },
    message: {
      id: `msg-${id}`,
      type: "text",
      text
    },
    webhookEventId: `event-${id}`
  };
}

function createFakeMemoryStore() {
  let nextLineEventLogId = 1;
  return {
    deleteLongTermMemories: () => ({ deletedCount: 0 }),
    getActiveLineEventIdsForMemory: (_scope, ids) => ids,
    getConversationSummary: () => null,
    getPendingAutoMemoryBatch: () => [],
    getPendingRollingSummaryBatch: () => [],
    listLongTermMemories: () => [],
    loadRelevantMemoryContext: () => ({ recentConversation: [], rollingSummary: null, evidence: [] }),
    markLineEventsProcessedForMemory: () => {},
    markLineMessageUnsent: () => {},
    saveConversationSummary: () => ({ saved: true }),
    saveLineEventLog: () => ({
      inserted: true,
      duplicate: false,
      id: nextLineEventLogId++
    }),
    saveLongTermMemory: () => {},
    saveOrganizedGroupMemory: () => {},
    saveShortTermExchange: () => {}
  };
}

function createTimerHarness() {
  const timers = [];
  return {
    timers,
    setTimeout: (fn, delayMs) => {
      const timer = {
        cleared: false,
        delayMs,
        fn,
        unref: () => {}
      };
      timers.push(timer);
      return timer;
    },
    clearTimeout: (timer) => {
      timer.cleared = true;
    }
  };
}

function createRuntimeHarness({
  alwaysFail = false,
  failFirstModel = true,
  failFirstPush = true,
  gatewayStore = null
} = {}) {
  const store = gatewayStore || createGatewayStore(":memory:", { enableTestHelpers: true });
  const timers = createTimerHarness();
  let nowMs = 0;
  let modelCalls = 0;
  let pushCalls = 0;
  const calls = {
    replies: [],
    pushes: [],
    searchQueries: []
  };
  const runtime = createBotRuntime({
    config: BASE_CONFIG,
    validateConfig: false,
    gatewayStore: store,
    memoryStore: createFakeMemoryStore(),
    lineClient: {},
    logEvent: () => {},
    now: () => nowMs,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    askLocalModel: async () => {
      modelCalls += 1;
      if (alwaysFail || (failFirstModel && modelCalls === 1)) {
        throw new Error("model_down");
      }
      return { text: "retry ok", fallbackUsed: false, reason: "success" };
    },
    askLocalModelWithSearchEvidence: async (query, evidence) => ({
      text: `search ok: ${query} (${evidence.length})`,
      fallbackUsed: false,
      reason: "success"
    }),
    askLocalModelForSearchDecision: async () => ({
      ok: true,
      needsSearch: false,
      confidence: 0.9,
      searchQuery: "",
      sourcePreference: "general",
      reason: "normal_chat",
      answerWithoutSearchAllowed: true,
      durationMs: 1
    }),
    pushText: async (_client, to, text) => {
      pushCalls += 1;
      if (alwaysFail || (failFirstPush && pushCalls === 1)) {
        throw new Error("push_down");
      }
      calls.pushes.push({ to, text });
    },
    replyText: async (_client, replyToken, text) => {
      calls.replies.push({ replyToken, text });
    },
    searchWeb: async (query) => {
      calls.searchQueries.push(query);
      return {
        ok: true,
        evidence: [
          {
            title: "Source",
            url: "https://example.com",
            snippet: "Evidence",
            fetchedAt: "2026-06-05T00:00:00.000Z"
          }
        ],
        durationMs: 1
      };
    }
  });

  return {
    calls,
    gatewayStore: store,
    get modelCalls() {
      return modelCalls;
    },
    runtime,
    setNow: (value) => {
      nowMs = value;
    },
    timers: timers.timers
  };
}

async function fireNextTimer(harness) {
  const timer = harness.timers.find((item) => !item.cleared);
  assert.ok(timer, "retry timer should be scheduled");
  timer.cleared = true;
  await timer.fn();
}

async function testRetryWakeupCompletesWithoutNewWebhook() {
  const harness = createRuntimeHarness();
  try {
    await harness.runtime.handleEvent(
      createTextEvent("這是一段會走背景任務的一般聊天內容", "retry-success"),
      "req-retry-success",
      0
    );
    await harness.runtime.drainGeneralReplyQueue();

    let jobs = harness.gatewayStore.listJobs({ jobType: "general_reply", limit: 10 });
    assert.equal(jobs[0].status, "pending");
    assert.equal(jobs[0].attemptCount, 1);
    assert.equal(harness.timers.length, 1);

    harness.setNow(1000);
    await fireNextTimer(harness);

    jobs = harness.gatewayStore.listJobs({ jobType: "general_reply", limit: 10 });
    assert.equal(jobs[0].status, "completed");
    assert.equal(jobs[0].attemptCount, 2);
    assert.deepEqual(harness.calls.pushes, [{ to: "U123", text: "retry ok" }]);
  } finally {
    harness.runtime.close();
  }
}

async function testRetryWakeupDeadLettersAtMaxAttempts() {
  const harness = createRuntimeHarness({ alwaysFail: true });
  try {
    await harness.runtime.handleEvent(
      createTextEvent("這是一段會走背景任務且持續失敗的一般聊天內容", "retry-dead"),
      "req-retry-dead",
      0
    );
    await harness.runtime.drainGeneralReplyQueue();

    harness.setNow(1000);
    await fireNextTimer(harness);
    harness.setNow(2000);
    await fireNextTimer(harness);

    const jobs = harness.gatewayStore.listJobs({ jobType: "general_reply", limit: 10 });
    assert.equal(jobs[0].status, "failed");
    assert.equal(jobs[0].attemptCount, 3);
    assert.equal(harness.gatewayStore.listDeadLetterJobs({ jobType: "general_reply" }).length, 1);
  } finally {
    harness.runtime.close();
  }
}

async function testRestartRequestIdCollisionDoesNotDropGeneralReply() {
  const gatewayStore = createGatewayStore(":memory:", { enableTestHelpers: true });
  const first = createRuntimeHarness({
    failFirstModel: false,
    failFirstPush: false,
    gatewayStore
  });
  const second = createRuntimeHarness({
    failFirstModel: false,
    failFirstPush: false,
    gatewayStore
  });

  try {
    await first.runtime.handleEvent(
      createTextEvent("這是一段重啟前的一般背景聊天內容", "restart-general-a"),
      "req_1",
      0
    );
    await first.runtime.drainGeneralReplyQueue();

    await second.runtime.handleEvent(
      createTextEvent("這是一段重啟後的一般背景聊天內容", "restart-general-b"),
      "req_1",
      0
    );
    await second.runtime.drainGeneralReplyQueue();

    const jobs = gatewayStore.listJobs({ jobType: "general_reply", limit: 10 });
    assert.equal(jobs.length, 2);
    assert.equal(jobs.every((job) => job.status === "completed"), true);
    assert.equal(first.calls.pushes.length, 1);
    assert.equal(second.calls.pushes.length, 1);
  } finally {
    first.runtime.close();
    second.runtime.close();
  }
}

async function testRestartRequestIdCollisionDoesNotDropReplyOnlyWebSearch() {
  const gatewayStore = createGatewayStore(":memory:", { enableTestHelpers: true });
  const first = createRuntimeHarness({
    failFirstModel: false,
    failFirstPush: false,
    gatewayStore
  });
  const second = createRuntimeHarness({
    failFirstModel: false,
    failFirstPush: false,
    gatewayStore
  });

  try {
    await first.runtime.handleEvent(
      createTextEvent("查: 第一個搜尋任務", "restart-search-a"),
      "req_1",
      0
    );
    await first.runtime.drainWebSearchQueue();

    await second.runtime.handleEvent(
      createTextEvent("查: 第二個搜尋任務", "restart-search-b"),
      "req_1",
      0
    );
    await second.runtime.drainWebSearchQueue();

    const jobs = gatewayStore.listJobs({ jobType: "web_search", limit: 10 });
    assert.equal(jobs.length, 0);
    assert.deepEqual(first.calls.searchQueries, ["第一個搜尋任務"]);
    assert.deepEqual(second.calls.searchQueries, ["第二個搜尋任務"]);
    assert.deepEqual(first.calls.replies.map((item) => item.text), [
      "search ok: 第一個搜尋任務 (1)"
    ]);
    assert.deepEqual(second.calls.replies.map((item) => item.text), [
      "search ok: 第二個搜尋任務 (1)"
    ]);
    assert.equal(first.calls.pushes.length, 0);
    assert.equal(second.calls.pushes.length, 0);
  } finally {
    first.runtime.close();
    second.runtime.close();
  }
}

async function run() {
  await testRetryWakeupCompletesWithoutNewWebhook();
  await testRetryWakeupDeadLettersAtMaxAttempts();
  await testRestartRequestIdCollisionDoesNotDropGeneralReply();
  await testRestartRequestIdCollisionDoesNotDropReplyOnlyWebSearch();
}

run().then(() => {
  console.log(
    JSON.stringify({
      status: "PASS",
      durable_worker_retry_wakeup: true,
      durable_worker_dead_letter: true,
      restart_request_id_dedupe_regression: true
    })
  );
});
