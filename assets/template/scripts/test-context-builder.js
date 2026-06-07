const assert = require("node:assert/strict");
const { buildContextPackage } = require("../src/contextBuilder");

function createMemoryStore() {
  const calls = [];
  return {
    calls,
    loadRelevantMemoryContext(scope, query, options) {
      calls.push({ scope, query, options });
      return {
        groupMentionContext: options.includeGroupMentionContext
          ? [{ role: "user", content: "明天早上吃漢堡", source: "line_event_log" }]
          : [],
        manualMemories: [{ source: "manual", content: "使用者喜歡短回覆" }],
        recentConversation: [
          { role: "assistant", content: "主人問人家「測試」啦" },
          { role: "user", content: "前一輪問題" }
        ],
        retrievedEvidence: [],
        rollingSummary: null,
        summaries: [],
        evidence: [],
        stats: {
          context_chars: 20
        }
      };
    }
  };
}

function testSameScopeAndGroupContext() {
  const memoryStore = createMemoryStore();
  const scope = { type: "group", key: "group:G1" };
  const result = buildContextPackage({
    scope,
    modelInput: "明天早上吃什麼？",
    routeDecision: {
      intent: "general_chat",
      route_reason: "no_search",
      search_plan: { needs_search: false, reason: "stable_context_question" }
    },
    policyDecision: { allowed_tools: [], risk_level: "low" },
    lineEventLogId: 42,
    includeGroupMentionContext: true,
    memoryStore,
    config: { chatContextLength: 8192, chatMaxTokens: 256 }
  });

  assert.equal(memoryStore.calls.length, 1);
  assert.equal(memoryStore.calls[0].scope.key, "group:G1");
  assert.equal(memoryStore.calls[0].options.excludeLineEventLogId, 42);
  assert.equal(memoryStore.calls[0].options.includeGroupMentionContext, true);
  assert.equal(result.memory_context.groupMentionContext[0].content, "明天早上吃漢堡");
  assert.equal(result.prompt_sections.includes("GROUP_RECENT_CONTEXT"), true);
  assert.equal(result.prompt_sections.includes("WEB_SEARCH_STATUS"), true);
}

function testPrivateScopeDoesNotRequestGroupContext() {
  const memoryStore = createMemoryStore();
  buildContextPackage({
    scope: { type: "user", key: "user:U1" },
    modelInput: "你是誰",
    routeDecision: { intent: "general_chat", route_reason: "normal_chat" },
    policyDecision: { allowed_tools: [], risk_level: "low" },
    includeGroupMentionContext: false,
    memoryStore,
    config: { chatContextLength: 8192, chatMaxTokens: 256 }
  });

  assert.equal(memoryStore.calls[0].scope.key, "user:U1");
  assert.equal(memoryStore.calls[0].options.includeGroupMentionContext, false);
}

function testAssistantHistoryIsContextOnly() {
  const memoryStore = createMemoryStore();
  const result = buildContextPackage({
    scope: { type: "group", key: "group:G1" },
    modelInput: "回答",
    routeDecision: { intent: "general_chat", route_reason: "normal_chat" },
    policyDecision: { allowed_tools: [], risk_level: "low" },
    includeGroupMentionContext: true,
    memoryStore,
    config: { chatContextLength: 8192, chatMaxTokens: 256 }
  });

  assert.equal(result.memory_context.recentConversation[0].role, "assistant");
  assert.equal(result.memory_context.context_stats.section_counts.recentConversation, 2);
  assert.equal(JSON.stringify(result.context_stats).includes("主人問人家"), false);
}

testSameScopeAndGroupContext();
testPrivateScopeDoesNotRequestGroupContext();
testAssistantHistoryIsContextOnly();

console.log(
  JSON.stringify({
    status: "PASS",
    context_builder: true
  })
);
