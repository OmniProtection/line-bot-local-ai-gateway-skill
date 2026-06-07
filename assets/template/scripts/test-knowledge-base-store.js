const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createKnowledgeBaseStore, hashText } = require("../src/knowledgeBaseStore");
const { chunkContent, importKnowledgeBase } = require("./import-knowledge-base");

function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "linebot-kb-test-"));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function testStoreSearchAndUnanswered() {
  const store = createKnowledgeBaseStore(":memory:");
  try {
    const documentId = store.upsertDocument({
      sourcePath: "kb/test.md",
      title: "LINE Bot 測試文件",
      contentHash: hashText("Reply API first"),
      updatedAt: "2026-06-07T00:00:00.000Z"
    });
    store.replaceChunks(documentId, [
      {
        title: "LINE Bot 測試文件",
        content: "LINE Bot WebSearch 必須只使用 Reply API，不使用 Push 補送搜尋結果。"
      }
    ]);

    const results = store.searchKnowledge({ query: "WebSearch Reply API", limit: 3 });
    assert.ok(results.length >= 1, "FTS search should return KB chunks");
    assert.match(results[0].content, /Reply API/u);

    store.replaceChunks(documentId, [
      {
        title: "LINE Bot 測試文件",
        content: "Sprint 4 使用 SQLite FTS5 匯入 Markdown 與文字知識庫。"
      }
    ]);
    const updated = store.searchKnowledge({ query: "SQLite FTS5", limit: 3 });
    assert.strictEqual(updated.length, 1, "re-import should not duplicate chunks");
    assert.match(updated[0].content, /SQLite FTS5/u);

    const unansweredId = store.recordUnansweredQuestion({
      scopeType: "user",
      conversationKey: "user:test",
      questionText: "replyToken=secret Sprint 4 目前支援什麼？",
      routeIntent: "general_chat",
      inputStyle: "technical_question",
      knowledgeHit: false,
      validatorReason: "knowledge_evidence_missing"
    });
    const unanswered = store.listUnansweredQuestions({ limit: 10 });
    assert.strictEqual(unanswered[0].id, unansweredId);
    assert.ok(!unanswered[0].questionTextSanitized.includes("secret"));
    assert.strictEqual(unanswered[0].knowledgeHit, false);
    assert.strictEqual(store.markUnansweredResolved(unansweredId, { note: "added KB" }), true);
    assert.strictEqual(store.listUnansweredQuestions({ limit: 10 }).length, 0);
  } finally {
    store.close();
  }
}

function testImportScript() {
  withTempDir((dir) => {
    const sourceDir = path.join(dir, "kb");
    fs.mkdirSync(sourceDir);
    fs.writeFileSync(
      path.join(sourceDir, "ops.md"),
      "# Ops\n\nLINE Bot production readiness uses local health checks.\n\nSprint 4 imports KB files.",
      "utf8"
    );
    fs.writeFileSync(path.join(sourceDir, "notes.txt"), "SQLite FTS5 search notes.", "utf8");
    const dbPath = path.join(dir, "kb.sqlite");
    const result = importKnowledgeBase({
      source: path.relative(path.join(__dirname, ".."), sourceDir),
      dbPath,
      chunkChars: 200
    });
    assert.strictEqual(result.status, "PASS");
    assert.strictEqual(result.fileCount, 2);

    const store = createKnowledgeBaseStore(dbPath);
    try {
      assert.ok(store.searchKnowledge({ query: "production readiness", limit: 2 }).length >= 1);
      assert.ok(chunkContent("a\n\nb", 200).length >= 1);
    } finally {
      store.close();
    }
  });
}

testStoreSearchAndUnanswered();
testImportScript();
console.log("PASS knowledge base store/import tests");
