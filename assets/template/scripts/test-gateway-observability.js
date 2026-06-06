const assert = require("node:assert/strict");
const { createGatewayStore } = require("../src/gatewayStore");

const store = createGatewayStore(":memory:", { enableTestHelpers: true });

store.recordPipelineLog({
  requestId: "req-obs",
  jobType: "general_reply",
  stage: "general_chat",
  sourceType: "user",
  intent: "general_chat",
  riskLevel: "unknown",
  status: "completed",
  inputChars: 12,
  outputChars: 8
});

store.recordLlmCall({
  requestId: "req-obs",
  callType: "general_reply",
  conversationKey: "user:U123",
  intent: "general_chat",
  riskLevel: "unknown",
  provider: "lmstudio",
  modelName: "qwen/qwen3.5-9b",
  promptChars: 12,
  completionChars: 8,
  latencyMs: 100,
  retryCount: 0,
  timeout: false,
  fallbackUsed: false,
  fallbackReason: null,
  status: "success"
});

store.recordLlmCall({
  requestId: "req-timeout",
  callType: "general_reply",
  conversationKey: "user:U123",
  intent: "general_chat",
  riskLevel: "unknown",
  provider: "lmstudio",
  modelName: "qwen/qwen3.5-9b",
  promptChars: 24,
  completionChars: 0,
  latencyMs: 200,
  retryCount: 1,
  timeout: true,
  fallbackUsed: true,
  fallbackReason: "timeout",
  status: "timeout"
});

const pipelineLogs = store.readPipelineLogs();
const llmLogs = store.readLlmCallLogs();
assert.equal(pipelineLogs.length, 1);
assert.equal(llmLogs.length, 2);
assert.equal(Object.hasOwn(pipelineLogs[0], "payload_json"), false);
assert.equal(Object.hasOwn(llmLogs[0], "payload_json"), false);
assert.equal(JSON.stringify(pipelineLogs).includes("replyToken"), false);
assert.equal(JSON.stringify(pipelineLogs).includes("private message"), false);
assert.equal(JSON.stringify(llmLogs).includes("replyToken"), false);
assert.equal(JSON.stringify(llmLogs).includes("private message"), false);

const failures = store.listRecentLlmFailures(100);
assert.equal(failures.length, 1);
assert.equal(failures[0].fallback_reason, "timeout");

const latency = store.getLlmLatencyStats({
  provider: "lmstudio",
  modelName: "qwen/qwen3.5-9b",
  intent: "general_chat"
});
assert.equal(latency.count, 2);
assert.equal(latency.averageLatencyMs, 150);

const fallback = store.getFallbackRate({
  provider: "lmstudio",
  modelName: "qwen/qwen3.5-9b",
  intent: "general_chat"
});
assert.equal(fallback.count, 2);
assert.equal(fallback.fallbackCount, 1);
assert.equal(fallback.fallbackRate, 0.5);

console.log(
  JSON.stringify({
    status: "PASS",
    observability: true,
    payload_json_excluded_from_observability: true,
    recent_failures: failures.length,
    fallback_rate: fallback.fallbackRate
  })
);

store.close();
