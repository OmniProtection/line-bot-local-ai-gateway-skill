const assert = require("assert");
const { buildContextPackage } = require("../src/contextBuilder");
const { applyContextBudget } = require("../src/tokenBudget");

function createMemoryStore() {
  return {
    loadRelevantMemoryContext() {
      return {
        recentConversation: [
          { role: "assistant", content: "主人叫我回答啦。" },
          { role: "user", content: "一般歷史訊息" }
        ],
        groupMentionContext: [{ content: "同群組上一句" }],
        manualMemories: [{ content: "手動記憶" }]
      };
    }
  };
}

function testKnowledgeContextInjected() {
  const knowledgeBaseStore = {
    searchKnowledge({ query, limit }) {
      assert.strictEqual(query, "Sprint 4 的 KB 做什麼？");
      assert.strictEqual(limit, 4);
      return [
        {
          title: "Sprint 4",
          sourcePath: "kb/sprint4.md",
          content: "Sprint 4 使用 SQLite FTS5 作為 Knowledge Base MVP。"
        }
      ];
    }
  };

  const contextPackage = buildContextPackage({
    scope: { type: "user", key: "user:test" },
    modelInput: "Sprint 4 的 KB 做什麼？",
    routeDecision: {
      intent: "general_chat",
      input_style: "technical_question"
    },
    policyDecision: {
      allowed_tools: [],
      response_mode: "reply"
    },
    includeGroupMentionContext: true,
    memoryStore: createMemoryStore(),
    knowledgeBaseStore,
    config: {
      knowledgeBaseEnabled: true,
      knowledgeBaseMaxResults: 4,
      chatContextLength: 4096,
      chatMaxTokens: 256
    }
  });

  assert.ok(contextPackage.prompt_sections.includes("KNOWLEDGE_BASE_CONTEXT"));
  assert.strictEqual(contextPackage.memory_context.knowledgeContext.length, 1);
  assert.strictEqual(contextPackage.context_stats.section_counts.knowledgeContext, 1);
  assert.match(contextPackage.memory_context.knowledgeContext[0].content, /SQLite FTS5/u);
}

function testNoKnowledgeHitStatusForTechnicalQuestion() {
  const contextPackage = buildContextPackage({
    scope: { type: "user", key: "user:test" },
    modelInput: "未知專案設定在哪裡？",
    routeDecision: {
      intent: "general_chat",
      input_style: "technical_question"
    },
    policyDecision: {
      allowed_tools: [],
      response_mode: "reply"
    },
    memoryStore: createMemoryStore(),
    knowledgeBaseStore: {
      searchKnowledge() {
        return [];
      }
    },
    config: {
      knowledgeBaseEnabled: true,
      chatContextLength: 4096,
      chatMaxTokens: 256
    }
  });

  assert.ok(contextPackage.prompt_sections.includes("KNOWLEDGE_BASE_STATUS"));
  assert.strictEqual(contextPackage.memory_context.knowledgeStatus.searched, true);
  assert.strictEqual(contextPackage.memory_context.knowledgeStatus.hit, false);
  assert.strictEqual(contextPackage.memory_context.knowledgeStatus.required, true);
}

function testTokenBudgetPriorityKeepsKnowledgeBeforeMemory() {
  const result = applyContextBudget(
    {
      knowledgeContext: [{ content: "K".repeat(400) }],
      groupMentionContext: [{ content: "G".repeat(400) }],
      manualMemories: [{ content: "M".repeat(400) }],
      recentConversation: [{ role: "user", content: "R".repeat(400) }]
    },
    {
      available_context_chars: 700,
      max_prompt_tokens: 1000,
      output_reserve_tokens: 256,
      safety_reserve_tokens: 512,
      current_message_tokens: 1,
      available_context_tokens: 233
    }
  );
  assert.strictEqual(result.knowledgeContext.length, 1);
  assert.strictEqual(result.groupMentionContext.length, 1);
  assert.strictEqual(result.manualMemories.length, 0);
  assert.strictEqual(result.context_stats.truncated, true);
}

testKnowledgeContextInjected();
testNoKnowledgeHitStatusForTechnicalQuestion();
testTokenBudgetPriorityKeepsKnowledgeBeforeMemory();
console.log("PASS RAG context flow tests");
