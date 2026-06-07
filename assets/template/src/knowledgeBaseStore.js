const crypto = require("crypto");
const path = require("path");
const Database = require("better-sqlite3");

const DEFAULT_DB_PATH = path.join(__dirname, "..", "data", "linebot-memory.sqlite");
const MAX_SANITIZED_QUESTION_CHARS = 500;

function nowIso() {
  return new Date().toISOString();
}

function hashText(value) {
  return crypto.createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

function sanitizeQuestionText(value) {
  return String(value || "")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/channel[_-]?access[_-]?token\s*[:=]\s*\S+/gi, "channel_access_token=[REDACTED]")
    .replace(/replyToken\s*[:=]\s*\S+/gi, "replyToken=[REDACTED]")
    .trim()
    .slice(0, MAX_SANITIZED_QUESTION_CHARS);
}

function normalizeSourcePath(sourcePath) {
  return String(sourcePath || "").replace(/\\/g, "/");
}

function buildFtsQuery(query) {
  const terms = String(query || "").match(/[\p{L}\p{N}_-]+/gu) || [];
  const unique = [...new Set(terms.map((term) => term.trim()).filter(Boolean))].slice(0, 8);
  if (unique.length === 0) {
    return "";
  }
  return unique.map((term) => `"${term.replace(/"/g, '""')}"`).join(" OR ");
}

function createKnowledgeBaseStore(dbPath = DEFAULT_DB_PATH, options = {}) {
  const db = options.db || new Database(dbPath);
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS knowledge_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_path TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      chunk_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      indexed_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS knowledge_chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      document_id INTEGER NOT NULL,
      chunk_index INTEGER NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      char_count INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(document_id, chunk_index),
      FOREIGN KEY(document_id) REFERENCES knowledge_documents(id) ON DELETE CASCADE
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_chunk_fts USING fts5(
      title,
      content,
      source_path UNINDEXED,
      chunk_id UNINDEXED,
      document_id UNINDEXED
    );

    CREATE TABLE IF NOT EXISTS unanswered_questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scope_type TEXT,
      conversation_key TEXT,
      question_text_sanitized TEXT NOT NULL,
      question_hash TEXT NOT NULL,
      input_chars INTEGER NOT NULL DEFAULT 0,
      route_intent TEXT,
      input_style TEXT,
      knowledge_hit INTEGER NOT NULL DEFAULT 0,
      validator_reason TEXT,
      resolved_at TEXT,
      resolution_note TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_document_id
      ON knowledge_chunks(document_id);
    CREATE INDEX IF NOT EXISTS idx_unanswered_questions_resolved_created
      ON unanswered_questions(resolved_at, created_at);
  `);

  const upsertDocumentStmt = db.prepare(`
    INSERT INTO knowledge_documents
      (source_path, title, content_hash, chunk_count, created_at, updated_at, indexed_at)
    VALUES
      (@sourcePath, @title, @contentHash, 0, @now, @updatedAt, @now)
    ON CONFLICT(source_path) DO UPDATE SET
      title = excluded.title,
      content_hash = excluded.content_hash,
      updated_at = excluded.updated_at,
      indexed_at = excluded.indexed_at
    RETURNING id
  `);

  const updateChunkCountStmt = db.prepare(`
    UPDATE knowledge_documents
    SET chunk_count = @chunkCount, indexed_at = @indexedAt
    WHERE id = @documentId
  `);

  const deleteFtsByDocumentStmt = db.prepare(`
    DELETE FROM knowledge_chunk_fts WHERE document_id = ?
  `);
  const deleteChunksStmt = db.prepare(`
    DELETE FROM knowledge_chunks WHERE document_id = ?
  `);
  const insertChunkStmt = db.prepare(`
    INSERT INTO knowledge_chunks
      (document_id, chunk_index, title, content, content_hash, char_count, created_at, updated_at)
    VALUES
      (@documentId, @chunkIndex, @title, @content, @contentHash, @charCount, @now, @now)
  `);
  const insertFtsStmt = db.prepare(`
    INSERT INTO knowledge_chunk_fts
      (rowid, title, content, source_path, chunk_id, document_id)
    VALUES
      (@chunkId, @title, @content, @sourcePath, @chunkId, @documentId)
  `);

  const replaceChunksTx = db.transaction((documentId, chunks) => {
    const document = db
      .prepare("SELECT source_path, title FROM knowledge_documents WHERE id = ?")
      .get(documentId);
    if (!document) {
      throw new Error("knowledge_document_not_found");
    }

    deleteFtsByDocumentStmt.run(documentId);
    deleteChunksStmt.run(documentId);

    const now = nowIso();
    for (const [index, chunk] of chunks.entries()) {
      const content = String(chunk.content || "").trim();
      if (!content) {
        continue;
      }
      const info = insertChunkStmt.run({
        documentId,
        chunkIndex: Number.isInteger(chunk.chunkIndex) ? chunk.chunkIndex : index,
        title: String(chunk.title || document.title || "Untitled").trim(),
        content,
        contentHash: chunk.contentHash || hashText(content),
        charCount: content.length,
        now
      });
      insertFtsStmt.run({
        chunkId: info.lastInsertRowid,
        title: String(chunk.title || document.title || "Untitled").trim(),
        content,
        sourcePath: document.source_path,
        documentId
      });
    }

    const chunkCount = db
      .prepare("SELECT COUNT(*) AS count FROM knowledge_chunks WHERE document_id = ?")
      .get(documentId).count;
    updateChunkCountStmt.run({
      documentId,
      chunkCount,
      indexedAt: now
    });
    return chunkCount;
  });

  function upsertDocument({ sourcePath, title, contentHash, updatedAt }) {
    if (!sourcePath) {
      throw new Error("knowledge_source_path_required");
    }
    const now = nowIso();
    const row = upsertDocumentStmt.get({
      sourcePath: normalizeSourcePath(sourcePath),
      title: String(title || path.basename(sourcePath)).trim() || "Untitled",
      contentHash: contentHash || "",
      updatedAt: updatedAt || now,
      now
    });
    return row.id;
  }

  function replaceChunks(documentId, chunks) {
    return replaceChunksTx(documentId, Array.isArray(chunks) ? chunks : []);
  }

  function searchKnowledge({ query, scope = null, limit = 4, minScore = null } = {}) {
    const trimmed = String(query || "").trim();
    if (!trimmed) {
      return [];
    }

    const boundedLimit = Math.max(1, Math.min(Number(limit) || 4, 10));
    const ftsQuery = buildFtsQuery(trimmed);
    let rows = [];
    if (ftsQuery) {
      try {
        rows = db
          .prepare(
            `
              SELECT
                c.id AS chunk_id,
                c.document_id,
                c.chunk_index,
                c.title,
                c.content,
                c.char_count,
                d.source_path,
                bm25(knowledge_chunk_fts) AS score
              FROM knowledge_chunk_fts
              JOIN knowledge_chunks c ON c.id = knowledge_chunk_fts.chunk_id
              JOIN knowledge_documents d ON d.id = c.document_id
              WHERE knowledge_chunk_fts MATCH ?
              ORDER BY score ASC, c.id ASC
              LIMIT ?
            `
          )
          .all(ftsQuery, boundedLimit);
      } catch (error) {
        rows = [];
      }
    }

    if (rows.length === 0) {
      const like = `%${trimmed.slice(0, 120)}%`;
      rows = db
        .prepare(
          `
            SELECT
              c.id AS chunk_id,
              c.document_id,
              c.chunk_index,
              c.title,
              c.content,
              c.char_count,
              d.source_path,
              0 AS score
            FROM knowledge_chunks c
            JOIN knowledge_documents d ON d.id = c.document_id
            WHERE c.content LIKE ? OR c.title LIKE ?
            ORDER BY c.id ASC
            LIMIT ?
          `
        )
        .all(like, like, boundedLimit);
    }

    return rows
      .filter((row) => minScore === null || minScore === undefined || row.score <= minScore)
      .map((row) => ({
        chunkId: row.chunk_id,
        documentId: row.document_id,
        chunkIndex: row.chunk_index,
        sourcePath: row.source_path,
        title: row.title,
        content: row.content,
        score: row.score,
        charCount: row.char_count,
        scope
      }));
  }

  function recordUnansweredQuestion(entry = {}) {
    const questionText = sanitizeQuestionText(entry.questionText || entry.question_text || "");
    const info = db
      .prepare(
        `
          INSERT INTO unanswered_questions
            (
              scope_type,
              conversation_key,
              question_text_sanitized,
              question_hash,
              input_chars,
              route_intent,
              input_style,
              knowledge_hit,
              validator_reason,
              created_at
            )
          VALUES
            (@scopeType, @conversationKey, @questionText, @questionHash, @inputChars,
             @routeIntent, @inputStyle, @knowledgeHit, @validatorReason, @createdAt)
        `
      )
      .run({
        scopeType: entry.scopeType || entry.scope_type || null,
        conversationKey: entry.conversationKey || entry.conversation_key || null,
        questionText,
        questionHash: entry.questionHash || hashText(questionText),
        inputChars: Number.isFinite(entry.inputChars) ? entry.inputChars : questionText.length,
        routeIntent: entry.routeIntent || entry.route_intent || null,
        inputStyle: entry.inputStyle || entry.input_style || null,
        knowledgeHit: entry.knowledgeHit === true || entry.knowledge_hit === true ? 1 : 0,
        validatorReason: entry.validatorReason || entry.validator_reason || null,
        createdAt: entry.createdAt || nowIso()
      });
    return info.lastInsertRowid;
  }

  function listUnansweredQuestions(filter = {}) {
    const limit = Math.max(1, Math.min(Number(filter.limit) || 50, 500));
    const includeResolved = filter.includeResolved === true;
    const rows = db
      .prepare(
        `
          SELECT
            id,
            scope_type,
            conversation_key,
            question_text_sanitized,
            question_hash,
            input_chars,
            route_intent,
            input_style,
            knowledge_hit,
            validator_reason,
            resolved_at,
            resolution_note,
            created_at
          FROM unanswered_questions
          WHERE (? = 1 OR resolved_at IS NULL)
          ORDER BY created_at DESC, id DESC
          LIMIT ?
        `
      )
      .all(includeResolved ? 1 : 0, limit);
    return rows.map((row) => ({
      id: row.id,
      scopeType: row.scope_type,
      conversationKey: row.conversation_key,
      questionTextSanitized: row.question_text_sanitized,
      questionHash: row.question_hash,
      inputChars: row.input_chars,
      routeIntent: row.route_intent,
      inputStyle: row.input_style,
      knowledgeHit: row.knowledge_hit === 1,
      validatorReason: row.validator_reason,
      resolvedAt: row.resolved_at,
      resolutionNote: row.resolution_note,
      createdAt: row.created_at
    }));
  }

  function markUnansweredResolved(id, metadata = {}) {
    const info = db
      .prepare(
        `
          UPDATE unanswered_questions
          SET resolved_at = @resolvedAt,
              resolution_note = @resolutionNote
          WHERE id = @id
        `
      )
      .run({
        id,
        resolvedAt: metadata.resolvedAt || nowIso(),
        resolutionNote: metadata.note || metadata.resolutionNote || null
      });
    return info.changes > 0;
  }

  return {
    db,
    upsertDocument,
    replaceChunks,
    searchKnowledge,
    recordUnansweredQuestion,
    listUnansweredQuestions,
    markUnansweredResolved,
    close() {
      db.close();
    }
  };
}

module.exports = {
  DEFAULT_DB_PATH,
  createKnowledgeBaseStore,
  hashText,
  sanitizeQuestionText
};
