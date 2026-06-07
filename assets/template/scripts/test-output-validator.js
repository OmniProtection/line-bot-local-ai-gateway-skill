const assert = require("assert");
const { validateModelOutput } = require("../src/outputValidator");

function testRejectsMissingKnowledgeEvidence() {
  const result = validateModelOutput({
    modelInput: "Sprint 4 做了什麼？",
    modelOutput: "Sprint 4 加入完整 RAG。",
    knowledgeEvidence: [],
    routeDecision: {
      intent: "general_chat",
      input_style: "technical_question"
    },
    config: {
      knowledgeBaseInsufficientReply: "目前知識庫資料不足，我還不能確定答案。"
    }
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.fallbackUsed, true);
  assert.strictEqual(result.reason, "knowledge_evidence_missing");
  assert.match(result.text, /知識庫資料不足/u);
}

function testAllowsEvidenceBackedAnswer() {
  const result = validateModelOutput({
    modelInput: "Sprint 4 做了什麼？",
    modelOutput: "Sprint 4 使用 SQLite FTS5 匯入 KB。",
    knowledgeEvidence: [{ content: "Sprint 4 使用 SQLite FTS5 匯入 KB。" }],
    routeDecision: {
      intent: "general_chat",
      input_style: "technical_question"
    }
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.fallbackUsed, false);
  assert.strictEqual(result.evidenceCount, 1);
}

function testCasualChatWithoutEvidencePasses() {
  const result = validateModelOutput({
    modelInput: "你在幹嘛",
    modelOutput: "在陪你聊天呀。",
    knowledgeEvidence: [],
    routeDecision: {
      intent: "general_chat",
      input_style: "casual_chat"
    }
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.fallbackUsed, false);
}

function testRejectsUnsupportedKnowledgeClaim() {
  const result = validateModelOutput({
    modelInput: "你是誰",
    modelOutput: "根據知識庫，我是正式部署版本。",
    knowledgeEvidence: [],
    routeDecision: {
      intent: "general_chat",
      input_style: "casual_chat"
    }
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, "unsupported_knowledge_claim");
}

testRejectsMissingKnowledgeEvidence();
testAllowsEvidenceBackedAnswer();
testCasualChatWithoutEvidencePasses();
testRejectsUnsupportedKnowledgeClaim();
console.log("PASS output validator tests");
