const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");
const { sanitizeTicketText } = require("./handoffStore");

const DEFAULT_DB_PATH = path.resolve(__dirname, "..", "data", "linebot-memory.sqlite");
const DEFAULT_TTL_MS = 10 * 60 * 1000;
const VALID_STATUSES = new Set(["pending", "executed", "cancelled", "expired"]);

function nowIso() {
  return new Date().toISOString();
}

function hashText(value) {
  return crypto.createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

function generateCode() {
  return crypto.randomBytes(4).toString("hex").toUpperCase();
}

function safeJson(value) {
  if (value === undefined || value === null) {
    return "{}";
  }
  return JSON.stringify(sanitizePayload(value));
}

function sanitizePayload(value) {
  if (typeof value === "string") {
    return sanitizeTicketText(value);
  }
  if (Array.isArray(value)) {
    return value.map(sanitizePayload);
  }
  if (value && typeof value === "object") {
    const result = {};
    for (const [key, item] of Object.entries(value)) {
      if (/token|secret|replyToken|accessToken|admin_api_token/i.test(key)) {
        result[key] = "[REDACTED]";
      } else {
        result[key] = sanitizePayload(item);
      }
    }
    return result;
  }
  return value;
}

function parseJson(value) {
  if (!value) {
    return {};
  }
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function normalize(row) {
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    code: row.code,
    status: row.status,
    toolName: row.tool_name,
    actorType: row.actor_type,
    actorId: row.actor_id,
    scopeType: row.scope_type,
    conversationKey: row.conversation_key,
    payload: parseJson(row.payload_json_sanitized),
    payloadHash: row.payload_hash,
    userVisibleSummary: row.user_visible_summary,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    executedAt: row.executed_at,
    cancelledAt: row.cancelled_at
  };
}

function createConfirmationStore(dbPath = DEFAULT_DB_PATH, options = {}) {
  if (dbPath !== ":memory:") {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const db = options.db || new Database(dbPath);
  let closed = false;

  db.exec(`
    CREATE TABLE IF NOT EXISTS pending_tool_confirmations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'pending',
      tool_name TEXT NOT NULL,
      actor_type TEXT NOT NULL,
      actor_id TEXT,
      scope_type TEXT,
      conversation_key TEXT,
      payload_json_sanitized TEXT NOT NULL,
      payload_hash TEXT NOT NULL,
      user_visible_summary TEXT,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      executed_at TEXT,
      cancelled_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_pending_tool_confirmations_status
      ON pending_tool_confirmations(status, expires_at);
    CREATE INDEX IF NOT EXISTS idx_pending_tool_confirmations_conversation
      ON pending_tool_confirmations(conversation_key, code);
  `);

  const insertConfirmation = db.prepare(`
    INSERT INTO pending_tool_confirmations (
      code, status, tool_name, actor_type, actor_id, scope_type, conversation_key,
      payload_json_sanitized, payload_hash, user_visible_summary, expires_at, created_at
    )
    VALUES (
      @code, @status, @tool_name, @actor_type, @actor_id, @scope_type, @conversation_key,
      @payload_json_sanitized, @payload_hash, @user_visible_summary, @expires_at, @created_at
    )
  `);
  const selectByCode = db.prepare("SELECT * FROM pending_tool_confirmations WHERE code = ?");
  const updateStatus = db.prepare(`
    UPDATE pending_tool_confirmations
    SET status = @status,
        executed_at = CASE WHEN @status = 'executed' THEN @changed_at ELSE executed_at END,
        cancelled_at = CASE WHEN @status = 'cancelled' THEN @changed_at ELSE cancelled_at END
    WHERE code = @code AND status = 'pending'
  `);

  function createPendingConfirmation(entry = {}) {
    const createdAt = entry.createdAt || entry.created_at || nowIso();
    const expiresAt =
      entry.expiresAt ||
      entry.expires_at ||
      new Date(Date.parse(createdAt) + (entry.ttlMs || DEFAULT_TTL_MS)).toISOString();
    const payloadJson = safeJson(entry.payload || {});
    const code = String(entry.code || generateCode()).toUpperCase();
    insertConfirmation.run({
      code,
      status: "pending",
      tool_name: String(entry.toolName || entry.tool_name || "").slice(0, 80),
      actor_type: String(entry.actorType || entry.actor_type || "line").slice(0, 40),
      actor_id: entry.actorId || entry.actor_id || null,
      scope_type: entry.scopeType || entry.scope_type || null,
      conversation_key: entry.conversationKey || entry.conversation_key || null,
      payload_json_sanitized: payloadJson,
      payload_hash: hashText(payloadJson),
      user_visible_summary: sanitizeTicketText(entry.userVisibleSummary || entry.user_visible_summary || ""),
      expires_at: expiresAt,
      created_at: createdAt
    });
    return normalize(selectByCode.get(code));
  }

  function resolveConfirmation({ code, conversationKey, actorId = null, action = "confirm", now = nowIso() } = {}) {
    const normalizedCode = String(code || "").trim().toUpperCase();
    const row = selectByCode.get(normalizedCode);
    if (!row) {
      return { ok: false, status: "not_found", reason: "confirmation_not_found" };
    }
    const item = normalize(row);
    if (conversationKey && item.conversationKey !== conversationKey) {
      return { ok: false, status: "not_found", reason: "confirmation_scope_mismatch" };
    }
    if (actorId && item.actorId && item.actorId !== actorId) {
      return { ok: false, status: "not_found", reason: "confirmation_actor_mismatch" };
    }
    if (item.status !== "pending") {
      return { ok: false, status: item.status, reason: `confirmation_${item.status}`, confirmation: item };
    }
    if (Date.parse(item.expiresAt) <= Date.parse(now)) {
      updateStatus.run({ code: normalizedCode, status: "expired", changed_at: now });
      return {
        ok: false,
        status: "expired",
        reason: "confirmation_expired",
        confirmation: normalize(selectByCode.get(normalizedCode))
      };
    }
    if (action === "cancel") {
      updateStatus.run({ code: normalizedCode, status: "cancelled", changed_at: now });
      return {
        ok: true,
        status: "cancelled",
        reason: "confirmation_cancelled",
        confirmation: normalize(selectByCode.get(normalizedCode))
      };
    }
    updateStatus.run({ code: normalizedCode, status: "executed", changed_at: now });
    return {
      ok: true,
      status: "executed",
      reason: "confirmation_executed",
      confirmation: normalize(selectByCode.get(normalizedCode))
    };
  }

  function listConfirmations(filter = {}) {
    const clauses = [];
    const params = {};
    if (filter.status) {
      clauses.push("status = @status");
      params.status = filter.status;
    }
    if (filter.conversationKey || filter.conversation_key) {
      clauses.push("conversation_key = @conversation_key");
      params.conversation_key = filter.conversationKey || filter.conversation_key;
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const limit = Math.max(1, Math.min(Number(filter.limit) || 50, 200));
    return db
      .prepare(`SELECT * FROM pending_tool_confirmations ${where} ORDER BY id DESC LIMIT @limit`)
      .all({ ...params, limit })
      .map(normalize);
  }

  function close() {
    if (!closed) {
      db.close();
      closed = true;
    }
    return { closed: true };
  }

  return {
    close,
    createPendingConfirmation,
    listConfirmations,
    resolveConfirmation
  };
}

module.exports = {
  createConfirmationStore
};
