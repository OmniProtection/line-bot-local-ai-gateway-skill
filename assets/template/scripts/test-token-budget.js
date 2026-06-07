const assert = require("node:assert/strict");
const {
  budgetMemoryContext,
  createTokenBudget,
  estimateTokens
} = require("../src/tokenBudget");

function testEstimateAndReserve() {
  assert.equal(estimateTokens("abcdef"), 2);
  const budget = createTokenBudget(
    { chatContextLength: 1200, chatMaxTokens: 256 },
    { currentMessage: "目前訊息" }
  );
  assert.equal(budget.output_reserve_tokens, 256);
  assert.equal(budget.safety_reserve_tokens, 512);
  assert.ok(budget.available_context_tokens > 0);

  const detailed = createTokenBudget(
    { chatContextLength: 1600, chatMaxTokens: 256 },
    { currentMessage: "請詳細規劃", detailedRequest: true }
  );
  assert.equal(detailed.output_reserve_tokens, 768);
}

function testBudgetPriorityAndTruncation() {
  const memoryContext = {
    groupMentionContext: [{ content: "群組前文".repeat(20) }],
    manualMemories: [{ content: "手動記憶".repeat(80) }],
    summaries: [{ source: "rolling_summary", content: "摘要".repeat(120) }],
    retrievedEvidence: [{ content: "原始證據".repeat(120) }],
    recentConversation: [{ role: "user", content: "最新對話".repeat(120) }],
    evidence: [],
    stats: {}
  };

  const budgeted = budgetMemoryContext(memoryContext, { chatContextLength: 650, chatMaxTokens: 80 }, {
    currentMessage: "目前訊息永遠保留"
  });

  assert.equal(budgeted.groupMentionContext.length, 1);
  assert.equal(budgeted.context_stats.truncated, true);
  assert.ok(budgeted.context_stats.selected_estimated_tokens <= budgeted.context_stats.available_context_tokens);
  assert.equal(typeof budgeted.context_stats.selected_chars, "number");
  assert.equal(JSON.stringify(budgeted.context_stats).includes("目前訊息"), false);
  assert.equal(JSON.stringify(budgeted.context_stats).includes("群組前文"), false);
}

testEstimateAndReserve();
testBudgetPriorityAndTruncation();

console.log(
  JSON.stringify({
    status: "PASS",
    token_budget: true
  })
);
