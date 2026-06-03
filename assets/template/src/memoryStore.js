const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const { logEvent } = require("./logger");

const DEFAULT_DB_PATH = path.resolve(__dirname, "..", "data", "linebot-memory.sqlite");
const MAX_MEMORY_CHARS = 500;
const MAX_RECENT_MESSAGES = 80;
const MAX_LONG_TERM_MEMORIES = 8;
const MEMORY_CONTEXT_CHAR_BUDGET = 18000;
const MAX_AUTO_GROUP_LONG_TERM_MEMORIES = 2500;
const MAX_ORGANIZED_GROUP_MEMORIES = 500;
const MAX_ORGANIZED_SUMMARY_CHARS = 800;
const MAX_ROLLING_SUMMARY_CHARS = 1600;
const ORGANIZATION_BATCH_THRESHOLD = 10;
const ORGANIZATION_BATCH_LIMIT = 30;
const ROLLING_SUMMARY_BATCH_THRESHOLD = 12;
const ROLLING_SUMMARY_BATCH_LIMIT = 40;
const MAX_ORGANIZED_CONTEXT_MEMORIES = 12;
const MEMORY_SELECTED_CONTEXT_CHAR_BUDGET = 5000;
const MAX_RETRIEVAL_MANUAL_MEMORIES = 5;
const MAX_RETRIEVAL_RECENT_GROUP_MESSAGES = 30;
const MAX_RETRIEVAL_RECENT_GROUP_CHARS = 3000;
const MAX_RETRIEVAL_RAW_KEYWORD_RESULTS = 50;
const MAX_RETRIEVAL_ORGANIZED_CANDIDATES = 30;
const MAX_RETRIEVAL_ORGANIZED_SELECTED = 3;
const MAX_RETRIEVAL_RECENT_INTERACTIONS = 5;
const MAX_RECENT_CONVERSATION_MESSAGES = 40;
const MAX_RECENT_CONVERSATION_CHARS = 8000;
const MAX_RAW_EVENT_JSON_CHARS = 8000;
const NO_MATCH_TERM = "__linebot_no_match__";

const RELEVANCE_THRESHOLDS = {
  manual: 0.28,
  recent_text: 0.3,
  recent_group: 0.3,
  raw_text: 0.36,
  raw_group: 0.36,
  organized: 0.36,
  rolling_summary: 0.3,
  recent_interaction: 0.32
};

const LOW_INFORMATION_TERMS = new Set([
  "什麼",
  "什么",
  "是什",
  "麼是",
  "可以",
  "如何",
  "怎麼",
  "怎么",
  "請問",
  "一下",
  "幫我",
  "告訴",
  "知道",
  "你覺",
  "覺得",
  "是否",
  "是不是"
]);

const RECENCY_HINT_TERMS = ["剛剛", "剛才", "最近", "前面", "剛有", "剛在", "大家", "聊什", "在聊"];
const CONTEXT_SEEKING_TERMS = ["下一步", "怎麼做", "怎么办", "怎麼辦", "建議", "決定", "共識", "討論"];
const REDACTED_RAW_EVENT_KEYS = new Set([
  "replyToken",
  "text",
  "rawEvent",
  "rawEventJson",
  "requestBody",
  "body"
]);

function nowIso() {
  return new Date().toISOString();
}

function sanitizeMemoryText(text) {
  return String(text || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_MEMORY_CHARS);
}

function sanitizeSummaryText(text) {
  return String(text || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_ORGANIZED_SUMMARY_CHARS);
}

function sanitizeRollingSummaryText(text) {
  return String(text || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_ROLLING_SUMMARY_CHARS);
}

function getContentLength(entry) {
  if (typeof entry === "string") {
    return entry.length;
  }

  return String(entry?.content || "").length;
}

function packWithinBudget(entries, remainingBudget, getCost = getContentLength) {
  const selected = [];
  let usedChars = 0;

  for (const entry of entries) {
    const cost = getCost(entry);
    if (cost <= 0) {
      continue;
    }

    if (usedChars + cost > remainingBudget) {
      continue;
    }

    selected.push(entry);
    usedChars += cost;
  }

  return {
    selected,
    usedChars
  };
}

function normalizeForSearch(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function uniqueTerms(terms) {
  return [...new Set(terms.filter(Boolean))];
}

function extractQueryFeatures(queryText) {
  const normalized = normalizeForSearch(queryText).slice(0, 2000);
  const terms = [];
  const latinTerms = normalized.match(/[a-z0-9_+-]{2,}/g) || [];
  terms.push(...latinTerms);

  const hanChars = normalized.match(/[\u3400-\u9fff]/g) || [];
  for (let index = 0; index < hanChars.length - 1; index += 1) {
    terms.push(`${hanChars[index]}${hanChars[index + 1]}`);
  }

  const filteredTerms = uniqueTerms(
    terms.filter((term) => term.length >= 2 && !LOW_INFORMATION_TERMS.has(term))
  ).slice(0, 24);

  return {
    normalized,
    terms: filteredTerms,
    recencyHint: RECENCY_HINT_TERMS.some((term) => normalized.includes(term)),
    contextSeekingHint: CONTEXT_SEEKING_TERMS.some((term) => normalized.includes(term))
  };
}

function getCandidateThreshold(source) {
  return RELEVANCE_THRESHOLDS[source] || 0.36;
}

function sourceWeight(source) {
  if (source === "manual") {
    return 0.08;
  }

  if (source === "recent_text" || source === "recent_group") {
    return 0.04;
  }

  if (source === "organized") {
    return 0.03;
  }

  if (source === "rolling_summary") {
    return 0.04;
  }

  if (source === "recent_interaction") {
    return 0.03;
  }

  return 0.02;
}

function scoreCandidate(candidate, features) {
  const content = normalizeForSearch(candidate.content);
  if (!content) {
    return 0;
  }

  let matchedTerms = 0;
  for (const term of features.terms) {
    if (content.includes(term)) {
      matchedTerms += 1;
    }
  }

  const termBase = Math.max(1, Math.min(features.terms.length, 6));
  const overlapScore = Math.min(1, matchedTerms / termBase) * 0.72;
  const exactQueryScore =
    features.normalized.length >= 6 && content.includes(features.normalized.slice(0, 80))
      ? 0.12
      : 0;
  const recencyScore = Math.max(0, 0.14 - (candidate.recencyRank || 0) * 0.01);
  const recentGroupHintScore =
    (candidate.source === "recent_text" || candidate.source === "recent_group") &&
    features.recencyHint
      ? 0.42
      : 0;
  const contextualRecentScore =
    (candidate.source === "recent_text" || candidate.source === "recent_group") &&
    features.contextSeekingHint
      ? 0.28
      : 0;

  return Math.min(
    1,
    overlapScore +
      exactQueryScore +
      sourceWeight(candidate.source) +
      recencyScore +
      recentGroupHintScore +
      contextualRecentScore
  );
}

function makeCandidate(source, row, recencyRank, contentField = "content") {
  const dedupePrefix =
    source === "recent_text" ||
    source === "recent_group" ||
    source === "raw_text" ||
    source === "raw_group"
      ? "auto"
      : source === "recent_interaction"
        ? "short"
        : source;

  return {
    id: row.id,
    dedupeKey: `${dedupePrefix}:${row.id}`,
    source,
    role: row.role,
    content: row[contentField],
    recencyRank
  };
}

function getConversationScope(source) {
  if (source?.type === "user" && source.userId) {
    return {
      key: `user:${source.userId}`,
      type: "user"
    };
  }

  if (source?.type === "group" && source.groupId) {
    return {
      key: `group:${source.groupId}`,
      type: "group"
    };
  }

  if (source?.type === "room" && source.roomId) {
    return {
      key: `room:${source.roomId}`,
      type: "room"
    };
  }

  return null;
}

function isGroupScope(scope) {
  return scope?.type === "group" || scope?.type === "room";
}

function normalizeExcludeLineEventLogId(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : -1;
}

function toDbBool(value) {
  return value ? 1 : 0;
}

function normalizeOptionalText(value, maxChars = null) {
  if (value === undefined || value === null) {
    return null;
  }

  const text = String(value);
  return maxChars && text.length > maxChars ? text.slice(0, maxChars) : text;
}

function normalizePositiveIntegerId(value) {
  if (Number.isInteger(value) && value > 0) {
    return value;
  }

  if (typeof value === "string" && /^[1-9]\d*$/.test(value)) {
    return Number(value);
  }

  return null;
}

function redactRawEventValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => redactRawEventValue(item));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const redacted = {};
  for (const [key, child] of Object.entries(value)) {
    if (REDACTED_RAW_EVENT_KEYS.has(key)) {
      redacted[key] = "[redacted]";
      continue;
    }

    redacted[key] = redactRawEventValue(child);
  }

  return redacted;
}

function normalizeRawEventJson(value) {
  if (value === undefined || value === null) {
    return null;
  }

  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      return null;
    }
  }

  return normalizeOptionalText(JSON.stringify(redactRawEventValue(parsed)), MAX_RAW_EVENT_JSON_CHARS);
}

function ensureColumn(db, tableName, columnName, columnSql) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  if (!columns.some((column) => column.name === columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnSql}`);
  }
}

function createMemoryStore(dbPath = DEFAULT_DB_PATH, options = {}) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const enableTestHelpers = options?.enableTestHelpers === true;

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS long_term_memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_key TEXT NOT NULL,
      scope_type TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'manual',
      UNIQUE(conversation_key, content)
    );

    CREATE TABLE IF NOT EXISTS short_term_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_key TEXT NOT NULL,
      scope_type TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS organized_group_memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_key TEXT NOT NULL,
      scope_type TEXT NOT NULL,
      summary TEXT NOT NULL,
      source_message_count INTEGER NOT NULL,
      first_source_id INTEGER NOT NULL,
      last_source_id INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS conversation_summaries (
      conversation_key TEXT PRIMARY KEY,
      scope_type TEXT NOT NULL,
      summary TEXT NOT NULL,
      source_message_count INTEGER NOT NULL,
      first_short_term_id INTEGER NOT NULL DEFAULT 0,
      last_short_term_id INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS line_event_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      webhook_event_id TEXT NOT NULL UNIQUE,
      event_type TEXT NOT NULL,
      event_timestamp_ms INTEGER NOT NULL,
      received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      delivery_is_redelivery INTEGER NOT NULL DEFAULT 0,
      source_type TEXT NOT NULL,
      conversation_key TEXT NOT NULL,
      sender_user_id TEXT,
      group_id TEXT,
      room_id TEXT,
      message_id TEXT,
      message_type TEXT,
      text TEXT,
      text_hash TEXT,
      is_mentioned_bot INTEGER NOT NULL DEFAULT 0,
      mention_json TEXT,
      quoted_message_id TEXT,
      raw_event_json TEXT,
      is_unsent INTEGER NOT NULL DEFAULT 0,
      processed_for_memory INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS memory_organization_state (
      conversation_key TEXT PRIMARY KEY,
      last_organized_auto_id INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_long_term_conversation
      ON long_term_memories(conversation_key, id DESC);

    CREATE INDEX IF NOT EXISTS idx_short_term_conversation
      ON short_term_messages(conversation_key, id DESC);

    CREATE INDEX IF NOT EXISTS idx_organized_group_conversation
      ON organized_group_memories(conversation_key, id DESC);

    CREATE INDEX IF NOT EXISTS idx_conversation_summaries_scope
      ON conversation_summaries(scope_type, updated_at DESC);

    CREATE INDEX IF NOT EXISTS idx_line_event_log_conversation_timestamp
      ON line_event_log(conversation_key, event_timestamp_ms);

    CREATE INDEX IF NOT EXISTS idx_line_event_log_message_id
      ON line_event_log(message_id);

    CREATE INDEX IF NOT EXISTS idx_line_event_log_processed
      ON line_event_log(processed_for_memory);

    CREATE INDEX IF NOT EXISTS idx_line_event_log_source_type
      ON line_event_log(source_type);

    CREATE INDEX IF NOT EXISTS idx_line_event_log_unsent
      ON line_event_log(is_unsent);
  `);

  ensureColumn(db, "long_term_memories", "source", "source TEXT NOT NULL DEFAULT 'manual'");
  ensureColumn(db, "organized_group_memories", "source_first_event_log_id", "source_first_event_log_id INTEGER");
  ensureColumn(db, "organized_group_memories", "source_last_event_log_id", "source_last_event_log_id INTEGER");
  ensureColumn(db, "organized_group_memories", "source_line_event_log_ids", "source_line_event_log_ids TEXT");
  ensureColumn(db, "organized_group_memories", "is_dirty", "is_dirty INTEGER NOT NULL DEFAULT 0");

  const insertLongTerm = db.prepare(`
    INSERT INTO long_term_memories (conversation_key, scope_type, content, created_at, updated_at, source)
    VALUES (@conversation_key, @scope_type, @content, @created_at, @updated_at, @source)
    ON CONFLICT(conversation_key, content)
    DO UPDATE SET
      updated_at = excluded.updated_at,
      source = CASE
        WHEN long_term_memories.source = 'manual' THEN long_term_memories.source
        ELSE excluded.source
      END
  `);

  const deleteLongTermByKeyword = db.prepare(`
    DELETE FROM long_term_memories
    WHERE conversation_key = @conversation_key
      AND source = 'manual'
      AND instr(content, @keyword) > 0
  `);

  const selectManualLongTerm = db.prepare(`
    SELECT id, content, updated_at
    FROM long_term_memories
    WHERE conversation_key = ?
      AND source = 'manual'
    ORDER BY updated_at DESC, id DESC
    LIMIT ?
  `);

  const insertShortTerm = db.prepare(`
    INSERT INTO short_term_messages (conversation_key, scope_type, role, content, created_at)
    VALUES (@conversation_key, @scope_type, @role, @content, @created_at)
  `);

  const selectRecent = db.prepare(`
    SELECT id, role, content, created_at
    FROM short_term_messages
    WHERE conversation_key = ?
    ORDER BY id DESC
    LIMIT ?
  `);

  const selectConversationSummary = db.prepare(`
    SELECT
      conversation_key,
      scope_type,
      summary,
      source_message_count,
      first_short_term_id,
      last_short_term_id,
      updated_at
    FROM conversation_summaries
    WHERE conversation_key = ?
  `);

  const upsertConversationSummary = db.prepare(`
    INSERT INTO conversation_summaries (
      conversation_key,
      scope_type,
      summary,
      source_message_count,
      first_short_term_id,
      last_short_term_id,
      created_at,
      updated_at
    )
    VALUES (
      @conversation_key,
      @scope_type,
      @summary,
      @source_message_count,
      @first_short_term_id,
      @last_short_term_id,
      @created_at,
      @updated_at
    )
    ON CONFLICT(conversation_key)
    DO UPDATE SET
      scope_type = excluded.scope_type,
      summary = excluded.summary,
      source_message_count = conversation_summaries.source_message_count + excluded.source_message_count,
      first_short_term_id = CASE
        WHEN conversation_summaries.first_short_term_id > 0 THEN conversation_summaries.first_short_term_id
        ELSE excluded.first_short_term_id
      END,
      last_short_term_id = excluded.last_short_term_id,
      updated_at = excluded.updated_at
  `);

  const selectPendingRollingSummaryMessages = db.prepare(`
    SELECT id, role, content, created_at
    FROM short_term_messages
    WHERE conversation_key = @conversation_key
      AND id > @last_short_term_id
      AND id NOT IN (
        SELECT id
        FROM short_term_messages
        WHERE conversation_key = @conversation_key
        ORDER BY id DESC
        LIMIT @recent_limit
      )
    ORDER BY id ASC
    LIMIT @limit
  `);

  const insertLineEventLog = db.prepare(`
    INSERT OR IGNORE INTO line_event_log (
      webhook_event_id,
      event_type,
      event_timestamp_ms,
      received_at,
      delivery_is_redelivery,
      source_type,
      conversation_key,
      sender_user_id,
      group_id,
      room_id,
      message_id,
      message_type,
      text,
      text_hash,
      is_mentioned_bot,
      mention_json,
      quoted_message_id,
      raw_event_json,
      is_unsent,
      processed_for_memory
    )
    VALUES (
      @webhook_event_id,
      @event_type,
      @event_timestamp_ms,
      @received_at,
      @delivery_is_redelivery,
      @source_type,
      @conversation_key,
      @sender_user_id,
      @group_id,
      @room_id,
      @message_id,
      @message_type,
      @text,
      @text_hash,
      @is_mentioned_bot,
      @mention_json,
      @quoted_message_id,
      @raw_event_json,
      @is_unsent,
      @processed_for_memory
    )
  `);

  const selectLineEventIdByWebhookId = db.prepare(`
    SELECT id
    FROM line_event_log
    WHERE webhook_event_id = ?
  `);

  const selectLineUnsendMarkerByMessageId = db.prepare(`
    SELECT id
    FROM line_event_log
    WHERE message_id = @message_id
      AND conversation_key = @conversation_key
      AND (event_type = 'unsend' OR is_unsent = 1)
    LIMIT 1
  `);

  const selectRecentLineEvents = db.prepare(`
    SELECT id, text AS content, event_timestamp_ms
    FROM line_event_log
    WHERE conversation_key = @conversation_key
      AND id != @exclude_id
      AND source_type IN ('user', 'group', 'room')
      AND message_type = 'text'
      AND is_unsent = 0
      AND text IS NOT NULL
      AND length(text) > 0
    ORDER BY event_timestamp_ms DESC, id DESC
    LIMIT @limit
  `);

  const selectKeywordLineEvents = db.prepare(`
    SELECT id, text AS content, event_timestamp_ms
    FROM line_event_log
    WHERE conversation_key = @conversation_key
      AND id != @exclude_id
      AND source_type IN ('user', 'group', 'room')
      AND message_type = 'text'
      AND is_unsent = 0
      AND text IS NOT NULL
      AND length(text) > 0
      AND (
        instr(text, @term1) > 0 OR
        instr(text, @term2) > 0 OR
        instr(text, @term3) > 0 OR
        instr(text, @term4) > 0 OR
        instr(text, @term5) > 0
      )
    ORDER BY event_timestamp_ms DESC, id DESC
    LIMIT @limit
  `);

  const pruneRecent = db.prepare(`
    DELETE FROM short_term_messages
    WHERE conversation_key = @conversation_key
      AND id NOT IN (
        SELECT id
        FROM short_term_messages
        WHERE conversation_key = @conversation_key
        ORDER BY id DESC
        LIMIT @limit
      )
  `);

  const countLegacyAutoMemories = db.prepare(`
    SELECT COUNT(*) AS count
    FROM long_term_memories
    WHERE source = 'auto'
  `);

  const countMigratableLegacyAutoMemories = db.prepare(`
    SELECT COUNT(*) AS count
    FROM long_term_memories
    WHERE source = 'auto'
      AND conversation_key IS NOT NULL
      AND scope_type IN ('group', 'room')
      AND content IS NOT NULL
      AND length(content) > 0
  `);

  const countScopedLegacyAutoMemories = db.prepare(`
    SELECT COUNT(*) AS count
    FROM long_term_memories
    WHERE conversation_key = @conversation_key
      AND source = 'auto'
  `);

  const selectPendingLineEventBatch = db.prepare(`
    SELECT id, text AS content
    FROM line_event_log
    WHERE conversation_key = @conversation_key
      AND source_type IN ('group', 'room')
      AND message_type = 'text'
      AND is_unsent = 0
      AND processed_for_memory = 0
      AND text IS NOT NULL
      AND length(text) > 0
    ORDER BY event_timestamp_ms ASC, id ASC
    LIMIT @limit
  `);

  const updateLineEventsProcessedForMemory = db.prepare(`
    UPDATE line_event_log
    SET processed_for_memory = 1
    WHERE id >= @first_id
      AND id <= @last_id
      AND conversation_key = @conversation_key
      AND source_type IN ('group', 'room')
      AND message_type = 'text'
      AND is_unsent = 0
  `);

  const updateLineEventProcessedForMemoryById = db.prepare(`
    UPDATE line_event_log
    SET processed_for_memory = 1
    WHERE id = @id
      AND conversation_key = @conversation_key
      AND source_type IN ('group', 'room')
      AND message_type = 'text'
      AND is_unsent = 0
  `);

  const selectLineEventReadyForMemoryById = db.prepare(`
    SELECT id
    FROM line_event_log
    WHERE id = @id
      AND conversation_key = @conversation_key
      AND source_type IN ('group', 'room')
      AND message_type = 'text'
      AND is_unsent = 0
      AND processed_for_memory = 0
      AND text IS NOT NULL
      AND length(text) > 0
  `);

  const markLineEventIdsProcessedTransaction = db.transaction((scope, lineEventLogIds) => {
    let processedCount = 0;
    for (const id of lineEventLogIds) {
      if (!Number.isInteger(id)) {
        continue;
      }

      const result = updateLineEventProcessedForMemoryById.run({
        id,
        conversation_key: scope.key
      });
      processedCount += result.changes;
    }

    return processedCount;
  });

  const insertOrganizedGroupMemory = db.prepare(`
    INSERT INTO organized_group_memories (
      conversation_key,
      scope_type,
      summary,
      source_message_count,
      first_source_id,
      last_source_id,
      source_first_event_log_id,
      source_last_event_log_id,
      source_line_event_log_ids,
      is_dirty,
      created_at,
      updated_at
    )
    VALUES (
      @conversation_key,
      @scope_type,
      @summary,
      @source_message_count,
      @first_source_id,
      @last_source_id,
      @source_first_event_log_id,
      @source_last_event_log_id,
      @source_line_event_log_ids,
      @is_dirty,
      @created_at,
      @updated_at
    )
  `);

  const selectOrganizedGroupMemories = db.prepare(`
    SELECT id, summary, updated_at
    FROM organized_group_memories
    WHERE conversation_key = ?
      AND is_dirty = 0
    ORDER BY updated_at DESC, id DESC
    LIMIT ?
  `);

  const selectOrganizedGroupMemoryBySummary = db.prepare(`
    SELECT id, summary, source_line_event_log_ids, is_dirty
    FROM organized_group_memories
    WHERE conversation_key = @conversation_key
      AND summary = @summary
    ORDER BY id DESC
    LIMIT 1
  `);

  const updateOrganizedMemorySourceIds = db.prepare(`
    UPDATE organized_group_memories
    SET source_line_event_log_ids = @source_line_event_log_ids
    WHERE id = @id
  `);

  const updateOrganizedMemorySourceRange = db.prepare(`
    UPDATE organized_group_memories
    SET source_first_event_log_id = @source_first_event_log_id,
      source_last_event_log_id = @source_last_event_log_id
    WHERE id = @id
  `);

  const pruneOrganizedGroupMemories = db.prepare(`
    DELETE FROM organized_group_memories
    WHERE conversation_key = @conversation_key
      AND id NOT IN (
        SELECT id
        FROM organized_group_memories
        WHERE conversation_key = @conversation_key
        ORDER BY updated_at DESC, id DESC
        LIMIT @limit
      )
  `);

  const upsertOrganizationState = db.prepare(`
    INSERT INTO memory_organization_state (conversation_key, last_organized_auto_id, updated_at)
    VALUES (@conversation_key, @last_organized_auto_id, @updated_at)
    ON CONFLICT(conversation_key)
    DO UPDATE SET
      last_organized_auto_id = excluded.last_organized_auto_id,
      updated_at = excluded.updated_at
  `);

  const markLineMessageUnsentByMessageId = db.prepare(`
    UPDATE line_event_log
    SET is_unsent = 1
    WHERE message_id = @message_id
      AND (@conversation_key IS NULL OR conversation_key = @conversation_key)
      AND event_type != 'unsend'
      AND is_unsent = 0
  `);

  const selectOriginalLineEventsByMessageId = db.prepare(`
    SELECT id, conversation_key
    FROM line_event_log
    WHERE message_id = @message_id
      AND (@conversation_key IS NULL OR conversation_key = @conversation_key)
      AND event_type != 'unsend'
    ORDER BY id DESC
  `);

  const markOrganizedMemoryDirtyForLineEvent = db.prepare(`
    UPDATE organized_group_memories
    SET is_dirty = 1,
      updated_at = @updated_at
    WHERE conversation_key = @conversation_key
      AND is_dirty = 0
      AND source_line_event_log_ids IS NULL
      AND source_first_event_log_id IS NOT NULL
      AND source_last_event_log_id IS NOT NULL
      AND (
        (source_first_event_log_id <= @line_event_log_id
          AND source_last_event_log_id >= @line_event_log_id)
        OR
        (source_last_event_log_id <= @line_event_log_id
          AND source_first_event_log_id >= @line_event_log_id)
      )
  `);

  const selectCleanOrganizedMemoriesForConversation = db.prepare(`
    SELECT id, source_line_event_log_ids, source_first_event_log_id, source_last_event_log_id
    FROM organized_group_memories
    WHERE conversation_key = @conversation_key
      AND is_dirty = 0
      AND source_line_event_log_ids IS NOT NULL
  `);

  const markOrganizedMemoryDirtyById = db.prepare(`
    UPDATE organized_group_memories
    SET is_dirty = 1,
      updated_at = @updated_at
    WHERE id = @id
      AND is_dirty = 0
  `);

  const countLineEventLog = db.prepare(`
    SELECT COUNT(*) AS count
    FROM line_event_log
  `);

  const countLineEventLogByMessageId = db.prepare(`
    SELECT COUNT(*) AS count
    FROM line_event_log
    WHERE message_id = ?
  `);

  const readLineEventLogByWebhookId = db.prepare(`
    SELECT
      id,
      webhook_event_id,
      event_type,
      event_timestamp_ms,
      source_type,
      conversation_key,
      message_id,
      message_type,
      text,
      text_hash,
      raw_event_json,
      is_unsent,
      processed_for_memory
    FROM line_event_log
    WHERE webhook_event_id = ?
  `);

  const saveShortTermTransaction = db.transaction((scope, userText, assistantText) => {
    const createdAt = nowIso();
    const userContent = sanitizeMemoryText(userText);
    const assistantContent = sanitizeMemoryText(assistantText);

    if (userContent) {
      insertShortTerm.run({
        conversation_key: scope.key,
        scope_type: scope.type,
        role: "user",
        content: userContent,
        created_at: createdAt
      });
    }

    if (assistantContent) {
      insertShortTerm.run({
        conversation_key: scope.key,
        scope_type: scope.type,
        role: "assistant",
        content: assistantContent,
        created_at: createdAt
      });
    }

    pruneRecent.run({
      conversation_key: scope.key,
      limit: MAX_RECENT_MESSAGES
    });

    return Number(Boolean(userContent)) + Number(Boolean(assistantContent));
  });

  logEvent("memory_db_initialized", {
    ready: true
  });

  function saveLineEventLog(normalizedEvent) {
    const webhookEventId = normalizeOptionalText(normalizedEvent?.webhookEventId);
    const eventType = normalizeOptionalText(normalizedEvent?.eventType) || "unknown";
    const eventTimestampMs = Number(normalizedEvent?.timestamp);
    const sourceType = normalizeOptionalText(normalizedEvent?.sourceType) || "unknown";
    const conversationKey =
      normalizeOptionalText(normalizedEvent?.conversationKey) || `${sourceType}:unknown`;
    const messageId = normalizeOptionalText(normalizedEvent?.messageId);

    if (!webhookEventId || !Number.isFinite(eventTimestampMs)) {
      return {
        inserted: false,
        duplicate: false
      };
    }

    const rawEventJson = normalizeRawEventJson(normalizedEvent.rawEventJson);
    const hasPriorUnsendMarker =
      eventType !== "unsend" && messageId
        ? Boolean(
            selectLineUnsendMarkerByMessageId.get({
              message_id: messageId,
              conversation_key: conversationKey
            })
          )
        : false;

    const result = insertLineEventLog.run({
      webhook_event_id: webhookEventId,
      event_type: eventType,
      event_timestamp_ms: eventTimestampMs,
      received_at: nowIso(),
      delivery_is_redelivery: toDbBool(normalizedEvent.deliveryIsRedelivery),
      source_type: sourceType,
      conversation_key: conversationKey,
      sender_user_id: normalizeOptionalText(normalizedEvent.senderUserId),
      group_id: normalizeOptionalText(normalizedEvent.groupId),
      room_id: normalizeOptionalText(normalizedEvent.roomId),
      message_id: messageId,
      message_type: normalizeOptionalText(normalizedEvent.messageType),
      text: normalizeOptionalText(normalizedEvent.text),
      text_hash: normalizeOptionalText(normalizedEvent.textHash),
      is_mentioned_bot: toDbBool(normalizedEvent.isMentionedBot),
      mention_json: normalizeOptionalText(normalizedEvent.mentionJson, MAX_RAW_EVENT_JSON_CHARS),
      quoted_message_id: normalizeOptionalText(normalizedEvent.quotedMessageId),
      raw_event_json: rawEventJson,
      is_unsent: eventType === "unsend" || hasPriorUnsendMarker ? 1 : 0,
      processed_for_memory: 0
    });

    if (result.changes > 0) {
      logEvent("line_event_log_saved", {
        source_type: sourceType,
        event_type: eventType,
        message_type: normalizedEvent.messageType || "none",
        delivery_is_redelivery: toDbBool(normalizedEvent.deliveryIsRedelivery)
      });

      return {
        inserted: true,
        duplicate: false,
        id: Number(result.lastInsertRowid)
      };
    }

    const existing = selectLineEventIdByWebhookId.get(webhookEventId);
    return {
      inserted: false,
      duplicate: true,
      id: existing?.id
    };
  }

  function saveLongTermMemory(scope, text) {
    const content = sanitizeMemoryText(text);
    if (!scope || !content) {
      return { saved: false };
    }

    const timestamp = nowIso();
    insertLongTerm.run({
      conversation_key: scope.key,
      scope_type: scope.type,
      content,
      created_at: timestamp,
      updated_at: timestamp,
      source: "manual"
    });

    logEvent("memory_long_term_saved", {
      scope_type: scope.type,
      content_chars: content.length
    });

    return { saved: true };
  }

  function saveAutoGroupMemory(scope, text) {
    logEvent("auto_memory_legacy_source_disabled", {
      scope_type: scope?.type || "unknown"
    });

    return {
      savedCount: 0,
      prunedCount: 0
    };
  }

  function deleteLongTermMemories(scope, keyword) {
    const normalizedKeyword = sanitizeMemoryText(keyword);
    if (!scope || !normalizedKeyword) {
      return { deletedCount: 0 };
    }

    const result = deleteLongTermByKeyword.run({
      conversation_key: scope.key,
      keyword: normalizedKeyword
    });

    logEvent("memory_long_term_deleted", {
      scope_type: scope.type,
      deleted_count: result.changes
    });

    return { deletedCount: result.changes };
  }

  function listLongTermMemories(scope) {
    if (!scope) {
      return [];
    }

    return selectManualLongTerm.all(scope.key, MAX_LONG_TERM_MEMORIES).map((row) => row.content);
  }

  function selectRecentTextWindow(scope, excludeLineEventLogId = -1) {
    if (!scope) {
      return [];
    }

    let usedChars = 0;
    const rows = selectRecentLineEvents.all({
      conversation_key: scope.key,
      exclude_id: normalizeExcludeLineEventLogId(excludeLineEventLogId),
      limit: MAX_RETRIEVAL_RECENT_GROUP_MESSAGES
    });
    const selected = [];

    for (const [index, row] of rows.entries()) {
      const contentLength = String(row.content || "").length;
      if (contentLength <= 0) {
        continue;
      }

      if (usedChars + contentLength > MAX_RETRIEVAL_RECENT_GROUP_CHARS) {
        continue;
      }

      selected.push(makeCandidate("recent_text", row, index));
      usedChars += contentLength;
    }

    return selected;
  }

  function selectKeywordLineEventCandidates(scope, features, excludeLineEventLogId = -1) {
    if (!scope || features.terms.length === 0) {
      return [];
    }

    const terms = features.terms.slice(0, 5);
    while (terms.length < 5) {
      terms.push(NO_MATCH_TERM);
    }

    return selectKeywordLineEvents
      .all({
        conversation_key: scope.key,
        exclude_id: normalizeExcludeLineEventLogId(excludeLineEventLogId),
        term1: terms[0],
        term2: terms[1],
        term3: terms[2],
        term4: terms[3],
        term5: terms[4],
        limit: MAX_RETRIEVAL_RAW_KEYWORD_RESULTS
      })
      .map((row, index) => makeCandidate("raw_text", row, index));
  }

  function selectOrganizedMemoryCandidates(scope) {
    if (!isGroupScope(scope)) {
      return [];
    }

    return selectOrganizedGroupMemories
      .all(scope.key, MAX_RETRIEVAL_ORGANIZED_CANDIDATES)
      .map((row, index) => makeCandidate("organized", row, index, "summary"));
  }

  function getConversationSummary(scope) {
    if (!scope) {
      return null;
    }

    const row = selectConversationSummary.get(scope.key);
    if (!row?.summary) {
      return null;
    }

    return {
      summary: row.summary,
      sourceMessageCount: row.source_message_count,
      firstShortTermId: row.first_short_term_id,
      lastShortTermId: row.last_short_term_id,
      updatedAt: row.updated_at
    };
  }

  function selectRollingSummaryCandidate(scope) {
    const row = getConversationSummary(scope);
    if (!row?.summary) {
      return [];
    }

    return [
      {
        id: row.lastShortTermId,
        dedupeKey: `rolling_summary:${scope.key}:${row.lastShortTermId}`,
        source: "rolling_summary",
        role: "summary",
        content: row.summary,
        recencyRank: 0
      }
    ];
  }

  function selectManualMemoryCandidates(scope) {
    if (!scope) {
      return [];
    }

    return selectManualLongTerm
      .all(scope.key, MAX_RETRIEVAL_MANUAL_MEMORIES)
      .map((row, index) => makeCandidate("manual", row, index));
  }

  function selectRecentInteractionCandidates(scope) {
    if (!scope) {
      return [];
    }

    return selectRecent
      .all(scope.key, MAX_RETRIEVAL_RECENT_INTERACTIONS)
      .map((row, index) => makeCandidate("recent_interaction", row, index));
  }

  function selectRecentConversation(scope) {
    if (!scope) {
      return [];
    }

    const selected = [];
    let usedChars = 0;
    const rows = selectRecent.all(scope.key, MAX_RECENT_CONVERSATION_MESSAGES);

    for (const row of rows) {
      const content = sanitizeMemoryText(row.content);
      if (!content) {
        continue;
      }

      const cost = String(row.role || "").length + content.length + 10;
      if (usedChars + cost > MAX_RECENT_CONVERSATION_CHARS) {
        continue;
      }

      selected.push({
        role: row.role,
        content,
        created_at: row.created_at
      });
      usedChars += cost;
    }

    return selected.reverse();
  }

  function getPendingRollingSummaryBatch(
    scope,
    threshold = ROLLING_SUMMARY_BATCH_THRESHOLD,
    limit = ROLLING_SUMMARY_BATCH_LIMIT
  ) {
    if (!scope) {
      return [];
    }

    const existing = getConversationSummary(scope);
    const rows = selectPendingRollingSummaryMessages.all({
      conversation_key: scope.key,
      last_short_term_id: existing?.lastShortTermId || 0,
      recent_limit: MAX_RECENT_CONVERSATION_MESSAGES,
      limit
    });

    if (rows.length < threshold) {
      return [];
    }

    logEvent("rolling_summary_source_batch", {
      scope_type: scope.type,
      batch_count: rows.length
    });

    return rows.map((row) => ({
      id: row.id,
      role: row.role,
      content: row.content,
      createdAt: row.created_at
    }));
  }

  function getPendingAutoMemoryBatch(
    scope,
    threshold = ORGANIZATION_BATCH_THRESHOLD,
    limit = ORGANIZATION_BATCH_LIMIT
  ) {
    if (!isGroupScope(scope)) {
      return [];
    }

    const rows = selectPendingLineEventBatch.all({
      conversation_key: scope.key,
      limit
    });

    if (rows.length < threshold) {
      return [];
    }

    logEvent("background_memory_extraction_source", {
      source: "line_event_log",
      scope_type: scope.type,
      batch_count: rows.length
    });

    return rows.map((row) => ({
      id: row.id,
      content: row.content
    }));
  }

  function getActiveLineEventIdsForMemory(scope, lineEventLogIds) {
    if (!isGroupScope(scope) || !Array.isArray(lineEventLogIds)) {
      return [];
    }

    const activeIds = [];
    for (const id of lineEventLogIds) {
      if (!Number.isInteger(id)) {
        continue;
      }

      const row = selectLineEventReadyForMemoryById.get({
        id,
        conversation_key: scope.key
      });
      if (row) {
        activeIds.push(row.id);
      }
    }

    return activeIds;
  }

  function saveOrganizedGroupMemory(scope, summary, metadata) {
    const content = sanitizeSummaryText(summary);
    if (!isGroupScope(scope) || !content) {
      return { saved: false, prunedCount: 0 };
    }

    const safeMetadata = metadata || {};
    const sourceLineEventLogIds = Array.isArray(safeMetadata.sourceLineEventLogIds)
      ? safeMetadata.sourceLineEventLogIds.filter((id) => Number.isInteger(id) && id > 0)
      : [];
    const rawSourceFirstEventLogId = Number.isInteger(safeMetadata.sourceFirstEventLogId)
      ? safeMetadata.sourceFirstEventLogId
      : Number.isInteger(safeMetadata.firstSourceId)
        ? safeMetadata.firstSourceId
        : null;
    const rawSourceLastEventLogId = Number.isInteger(safeMetadata.sourceLastEventLogId)
      ? safeMetadata.sourceLastEventLogId
      : Number.isInteger(safeMetadata.lastSourceId)
        ? safeMetadata.lastSourceId
        : null;
    const sourceRangeIds =
      Number.isInteger(rawSourceFirstEventLogId) && Number.isInteger(rawSourceLastEventLogId)
        ? [rawSourceFirstEventLogId, rawSourceLastEventLogId]
        : [];
    const timestamp = nowIso();
    insertOrganizedGroupMemory.run({
      conversation_key: scope.key,
      scope_type: scope.type,
      summary: content,
      source_message_count: Number.isInteger(safeMetadata.sourceMessageCount)
        ? safeMetadata.sourceMessageCount
        : 0,
      first_source_id: Number.isInteger(safeMetadata.firstSourceId) ? safeMetadata.firstSourceId : 0,
      last_source_id: Number.isInteger(safeMetadata.lastSourceId) ? safeMetadata.lastSourceId : 0,
      source_first_event_log_id:
        sourceRangeIds.length > 0 ? Math.min(...sourceRangeIds) : rawSourceFirstEventLogId,
      source_last_event_log_id:
        sourceRangeIds.length > 0 ? Math.max(...sourceRangeIds) : rawSourceLastEventLogId,
      source_line_event_log_ids:
        sourceLineEventLogIds.length > 0 ? JSON.stringify(sourceLineEventLogIds) : null,
      is_dirty: 0,
      created_at: timestamp,
      updated_at: timestamp
    });

    const pruneResult = pruneOrganizedGroupMemories.run({
      conversation_key: scope.key,
      limit: MAX_ORGANIZED_GROUP_MEMORIES
    });

    logEvent("memory_organized_summary_saved", {
      scope_type: scope.type,
      summary_chars: content.length,
      source_message_count: safeMetadata.sourceMessageCount || 0,
      pruned_count: pruneResult.changes
    });

    return { saved: true, prunedCount: pruneResult.changes };
  }

  function saveConversationSummary(scope, summary, metadata) {
    const content = sanitizeRollingSummaryText(summary);
    if (!scope || !content) {
      return { saved: false };
    }

    const safeMetadata = metadata || {};
    const timestamp = nowIso();
    upsertConversationSummary.run({
      conversation_key: scope.key,
      scope_type: scope.type,
      summary: content,
      source_message_count: Number.isInteger(safeMetadata.sourceMessageCount)
        ? safeMetadata.sourceMessageCount
        : 0,
      first_short_term_id: Number.isInteger(safeMetadata.firstShortTermId)
        ? safeMetadata.firstShortTermId
        : 0,
      last_short_term_id: Number.isInteger(safeMetadata.lastShortTermId)
        ? safeMetadata.lastShortTermId
        : 0,
      created_at: timestamp,
      updated_at: timestamp
    });

    logEvent("rolling_summary_saved", {
      scope_type: scope.type,
      summary_chars: content.length,
      source_message_count: safeMetadata.sourceMessageCount || 0
    });

    return { saved: true };
  }

  function listOrganizedGroupMemories(scope, limit = MAX_ORGANIZED_CONTEXT_MEMORIES) {
    if (!isGroupScope(scope)) {
      return [];
    }

    return selectOrganizedGroupMemories.all(scope.key, limit).map((row) => row.summary);
  }

  function buildRelevantEvidence(candidates, features) {
    const seen = new Set();
    const scored = [];

    for (const candidate of candidates) {
      const content = sanitizeMemoryText(candidate.content);
      if (!content) {
        continue;
      }

      const identity = candidate.dedupeKey || `${candidate.source}:${candidate.id || content}`;
      if (seen.has(identity)) {
        continue;
      }
      seen.add(identity);

      const score = scoreCandidate({ ...candidate, content }, features);
      if (score < getCandidateThreshold(candidate.source)) {
        continue;
      }

      scored.push({
        source: candidate.source,
        role: candidate.role,
        content,
        score
      });
    }

    scored.sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return 0;
    });

    const selected = [];
    let usedChars = 0;
    let organizedSelected = 0;

    for (const item of scored) {
      if (item.source === "organized") {
        if (organizedSelected >= MAX_RETRIEVAL_ORGANIZED_SELECTED) {
          continue;
        }
        organizedSelected += 1;
      }

      const cost =
        String(item.source || "").length +
        String(item.role || "").length +
        String(item.content || "").length +
        20;

      if (usedChars + cost > MEMORY_SELECTED_CONTEXT_CHAR_BUDGET) {
        continue;
      }

      selected.push(item);
      usedChars += cost;
    }

    return {
      selected,
      usedChars,
      topScore: scored.length > 0 ? scored[0].score : 0
    };
  }

  function markAutoMemoryOrganized(scope, lastSourceId) {
    if (!isGroupScope(scope) || !Number.isInteger(lastSourceId)) {
      return;
    }

    upsertOrganizationState.run({
      conversation_key: scope.key,
      last_organized_auto_id: lastSourceId,
      updated_at: nowIso()
    });

    logEvent("memory_organization_state_updated", {
      scope_type: scope.type
    });
  }

  function markLineEventsProcessedForMemory(
    scope,
    firstLineEventLogId,
    lastLineEventLogId,
    lineEventLogIds = null
  ) {
    if (
      !isGroupScope(scope) ||
      !Number.isInteger(firstLineEventLogId) ||
      !Number.isInteger(lastLineEventLogId)
    ) {
      return { processedCount: 0 };
    }

    const processedCount = Array.isArray(lineEventLogIds)
      ? markLineEventIdsProcessedTransaction(scope, lineEventLogIds)
      : updateLineEventsProcessedForMemory.run({
          conversation_key: scope.key,
          first_id: firstLineEventLogId,
          last_id: lastLineEventLogId
        }).changes;

    logEvent("line_event_memory_processed", {
      scope_type: scope.type,
      processed_count: processedCount
    });

    return { processedCount };
  }

  function markLineMessageUnsent(messageId, conversationKey = null) {
    const normalizedMessageId = normalizeOptionalText(messageId);
    const normalizedConversationKey = normalizeOptionalText(conversationKey);
    if (!normalizedMessageId) {
      logEvent("line_message_unsent_marked", {
        found: false,
        affected_summary_count: 0
      });

      return {
        found: false,
        affectedEventCount: 0,
        affectedSummaryCount: 0
      };
    }

    const originalEvents = selectOriginalLineEventsByMessageId.all({
      message_id: normalizedMessageId,
      conversation_key: normalizedConversationKey
    });
    const eventResult = markLineMessageUnsentByMessageId.run({
      message_id: normalizedMessageId,
      conversation_key: normalizedConversationKey
    });

    let affectedSummaryCount = 0;
    for (const existing of originalEvents) {
      const exactDirtyIds = new Set();
      for (const row of selectCleanOrganizedMemoriesForConversation.all({
        conversation_key: existing.conversation_key
      })) {
        const rowRangeStart = Number.isInteger(row.source_first_event_log_id)
          ? Math.min(row.source_first_event_log_id, row.source_last_event_log_id)
          : null;
        const rowRangeEnd = Number.isInteger(row.source_last_event_log_id)
          ? Math.max(row.source_first_event_log_id, row.source_last_event_log_id)
          : null;
        const rowRangeContainsEvent =
          Number.isInteger(rowRangeStart) &&
          Number.isInteger(rowRangeEnd) &&
          rowRangeStart <= existing.id &&
          rowRangeEnd >= existing.id;

        try {
          const sourceIds = JSON.parse(row.source_line_event_log_ids || "[]");
          if (Array.isArray(sourceIds)) {
            const normalizedSourceIds = sourceIds.map((id) => normalizePositiveIntegerId(id));
            const validSourceIds = normalizedSourceIds.filter((id) => id !== null);
            if (validSourceIds.includes(existing.id)) {
              exactDirtyIds.add(row.id);
            } else if (
              (sourceIds.length === 0 || validSourceIds.length !== sourceIds.length) &&
              rowRangeContainsEvent
            ) {
              exactDirtyIds.add(row.id);
            }
          } else if (rowRangeContainsEvent) {
            exactDirtyIds.add(row.id);
          }
        } catch {
          if (rowRangeContainsEvent) {
            exactDirtyIds.add(row.id);
          }
        }
      }

      for (const id of exactDirtyIds) {
        const result = markOrganizedMemoryDirtyById.run({
          id,
          updated_at: nowIso()
        });
        affectedSummaryCount += result.changes;
      }

      const rangeDirtyResult = markOrganizedMemoryDirtyForLineEvent.run({
        conversation_key: existing.conversation_key,
        line_event_log_id: existing.id,
        updated_at: nowIso()
      });
      affectedSummaryCount += rangeDirtyResult.changes;
    }

    logEvent("line_message_unsent_marked", {
      found: originalEvents.length > 0,
      affected_event_count: eventResult.changes,
      affected_summary_count: affectedSummaryCount
    });

    if (affectedSummaryCount > 0) {
      logEvent("memory_may_need_rebuild_after_unsend", {
        affected_summary_count: affectedSummaryCount
      });
    }

    return {
      found: originalEvents.length > 0,
      affectedEventCount: eventResult.changes,
      affectedSummaryCount
    };
  }

  function migrateAutoMemoryToLineEventLogDryRun() {
    const autoMemoryCount = countLegacyAutoMemories.get().count;
    const migratableCount = countMigratableLegacyAutoMemories.get().count;

    return {
      auto_memory_count: autoMemoryCount,
      migratable_count: migratableCount,
      skipped_count: Math.max(0, autoMemoryCount - migratableCount),
      would_create_line_event_count: migratableCount
    };
  }

  function migrateAutoMemoryToLineEventLogApply() {
    throw new Error("legacy auto-memory migration apply requires an explicit approved maintenance task");
  }

  function loadMemoryContext(scope, options = {}) {
    return loadRelevantMemoryContext(scope, "", options);
  }

  function loadRelevantMemoryContext(scope, queryText, options = {}) {
    const startedAt = Date.now();
    const excludeLineEventLogId = normalizeExcludeLineEventLogId(options.excludeLineEventLogId);
    const emptyContext = {
      recentConversation: [],
      rollingSummary: null,
      evidence: [],
      stats: {
        memory_candidates_count: 0,
        memory_selected_count: 0,
        manual_memory_selected_count: 0,
        rolling_summary_selected_count: 0,
        recent_text_selected_count: 0,
        inbound_text_selected_count: 0,
        recent_group_selected_count: 0,
        long_term_selected_count: 0,
        recent_interaction_selected_count: 0,
        recent_conversation_count: 0,
        rolling_summary_chars: 0,
        context_chars: 0,
        top_relevance_score: 0,
        retrieval_duration_ms: 0,
        organized_summary_direct_injection: false
      }
    };

    if (!scope) {
      logEvent("memory_context_loaded", {
        scope_type: "unknown",
        ...emptyContext.stats
      });
      return emptyContext;
    }

    const features = extractQueryFeatures(queryText);
    const recentConversation = selectRecentConversation(scope);
    const rollingSummary = getConversationSummary(scope);
    const candidates = [
      ...selectManualMemoryCandidates(scope),
      ...selectRollingSummaryCandidate(scope),
      ...selectRecentInteractionCandidates(scope)
    ];

    if (scope) {
      logEvent("memory_retrieval_source", {
        source: "line_event_log",
        scope_type: scope.type
      });

      candidates.push(
        ...selectRecentTextWindow(scope, excludeLineEventLogId),
        ...selectKeywordLineEventCandidates(scope, features, excludeLineEventLogId)
      );

      if (isGroupScope(scope)) {
        candidates.push(...selectOrganizedMemoryCandidates(scope));
      }
    }

    const evidencePack = buildRelevantEvidence(candidates, features);
    const selected = evidencePack.selected;
    const stats = {
      memory_candidates_count: candidates.length,
      memory_selected_count: selected.length,
      manual_memory_selected_count: selected.filter((item) => item.source === "manual").length,
      rolling_summary_selected_count: selected.filter((item) => item.source === "rolling_summary")
        .length,
      recent_text_selected_count: selected.filter(
        (item) => item.source === "recent_text" || item.source === "raw_text"
      ).length,
      inbound_text_selected_count: selected.filter(
        (item) => item.source === "recent_text" || item.source === "raw_text"
      ).length,
      recent_group_selected_count: isGroupScope(scope)
        ? selected.filter((item) => item.source === "recent_text" || item.source === "recent_group")
            .length
        : 0,
      long_term_selected_count: selected.filter((item) =>
        item.source === "raw_text" ||
        item.source === "raw_group" ||
        item.source === "organized" ||
        item.source === "rolling_summary"
      ).length,
      recent_interaction_selected_count: selected.filter(
        (item) => item.source === "recent_interaction"
      ).length,
      recent_conversation_count: recentConversation.length,
      rolling_summary_chars: rollingSummary?.summary ? rollingSummary.summary.length : 0,
      context_chars: evidencePack.usedChars,
      top_relevance_score: Number(evidencePack.topScore.toFixed(3)),
      retrieval_duration_ms: Date.now() - startedAt,
      organized_summary_direct_injection: false
    };

    logEvent("memory_context_loaded", {
      scope_type: scope.type,
      ...stats
    });

    return {
      recentConversation,
      rollingSummary,
      evidence: selected,
      stats
    };
  }

  function saveShortTermExchange(scope, userText, assistantText) {
    if (!scope) {
      return { savedCount: 0 };
    }

    const savedCount = saveShortTermTransaction(scope, userText, assistantText);

    logEvent("memory_short_term_saved", {
      scope_type: scope.type,
      entry_count: savedCount
    });

    return { savedCount };
  }

  const storeApi = {
    deleteLongTermMemories,
    getActiveLineEventIdsForMemory,
    getConversationSummary,
    getPendingAutoMemoryBatch,
    getPendingRollingSummaryBatch,
    listLongTermMemories,
    listOrganizedGroupMemories,
    loadRelevantMemoryContext,
    loadMemoryContext,
    markAutoMemoryOrganized,
    markLineEventsProcessedForMemory,
    markLineMessageUnsent,
    migrateAutoMemoryToLineEventLogApply,
    migrateAutoMemoryToLineEventLogDryRun,
    saveAutoGroupMemory,
    saveLineEventLog,
    saveLongTermMemory,
    saveConversationSummary,
    saveOrganizedGroupMemory,
    saveShortTermExchange
  };

  if (enableTestHelpers) {
    Object.assign(storeApi, {
      countLineEventLog: () => countLineEventLog.get().count,
      countLineEventLogByMessageId: (messageId) => countLineEventLogByMessageId.get(messageId).count,
      countLegacyAutoMemories: (scope) =>
        scope
          ? countScopedLegacyAutoMemories.get({ conversation_key: scope.key }).count
          : countLegacyAutoMemories.get().count,
      forceOrganizedMemorySourceIdsForTest: (id, sourceLineEventLogIds) =>
        updateOrganizedMemorySourceIds.run({
          id,
          source_line_event_log_ids: sourceLineEventLogIds
        }),
      forceOrganizedMemorySourceRangeForTest: (id, firstLineEventLogId, lastLineEventLogId) =>
        updateOrganizedMemorySourceRange.run({
          id,
          source_first_event_log_id: firstLineEventLogId,
          source_last_event_log_id: lastLineEventLogId
        }),
      insertLegacyAutoMemoryForTest: ({
        conversationKey,
        scopeType = "group",
        content,
        createdAt = nowIso(),
        updatedAt = createdAt
      }) =>
        insertLongTerm.run({
          conversation_key: normalizeOptionalText(conversationKey),
          scope_type: normalizeOptionalText(scopeType),
          content: normalizeOptionalText(content),
          created_at: createdAt,
          updated_at: updatedAt,
          source: "auto"
        }),
      readOrganizedMemoryBySummary: (scope, summary) =>
        selectOrganizedGroupMemoryBySummary.get({
          conversation_key: scope.key,
          summary: sanitizeSummaryText(summary)
        }),
      readLineEventLogByWebhookId: (webhookEventId) => readLineEventLogByWebhookId.get(webhookEventId)
    });
  }

  return storeApi;
}

module.exports = {
  createMemoryStore,
  getConversationScope,
  sanitizeMemoryText
};
