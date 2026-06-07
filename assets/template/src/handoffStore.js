const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");

const DEFAULT_DB_PATH = path.resolve(__dirname, "..", "data", "linebot-memory.sqlite");
const TICKET_STATUSES = new Set(["open", "in_review", "resolved", "closed"]);
const DRAFT_TYPES = new Set(["summary", "draft_reply"]);
const MAX_SANITIZED_TEXT_CHARS = 1200;

function nowIso() {
  return new Date().toISOString();
}

function hashText(value) {
  return crypto.createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

function sanitizeTicketText(value) {
  return String(value || "")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/channel[_-]?access[_-]?token\s*[:=]\s*\S+/gi, "channel_access_token=[REDACTED]")
    .replace(/replyToken\s*[:=]\s*\S+/gi, "replyToken=[REDACTED]")
    .replace(/admin[_-]?api[_-]?token\s*[:=]\s*\S+/gi, "admin_api_token=[REDACTED]")
    .trim()
    .slice(0, MAX_SANITIZED_TEXT_CHARS);
}

function safeJson(value) {
  if (value === undefined || value === null) {
    return null;
  }
  return JSON.stringify(value);
}

function parseJson(value, fallback = null) {
  if (!value) {
    return fallback;
  }
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function normalizeTicket(row) {
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    ticketId: row.ticket_id,
    status: row.status,
    priority: row.priority,
    triggerType: row.trigger_type,
    triggerReason: row.trigger_reason,
    scopeType: row.scope_type,
    conversationKey: row.conversation_key,
    questionTextSanitized: row.question_text_sanitized,
    questionHash: row.question_hash,
    inputChars: row.input_chars,
    routeIntent: row.route_intent,
    inputStyle: row.input_style,
    riskLevel: row.risk_level,
    contextSnapshot: parseJson(row.context_snapshot_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    resolvedAt: row.resolved_at,
    closedAt: row.closed_at,
    dedupeKey: row.dedupe_key
  };
}

function normalizeDraft(row) {
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    ticketId: row.ticket_id,
    draftType: row.draft_type,
    status: row.status,
    contentSanitized: row.content_sanitized,
    provider: row.provider,
    modelName: row.model_name,
    promptChars: row.prompt_chars,
    outputChars: row.output_chars,
    fallbackReason: row.fallback_reason,
    createdAt: row.created_at
  };
}

function createHandoffStore(dbPath = DEFAULT_DB_PATH, options = {}) {
  if (dbPath !== ":memory:") {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const db = options.db || new Database(dbPath);
  db.pragma("foreign_keys = ON");
  let closed = false;

  db.exec(`
    CREATE TABLE IF NOT EXISTS handoff_tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'open',
      priority TEXT NOT NULL DEFAULT 'normal',
      trigger_type TEXT NOT NULL,
      trigger_reason TEXT,
      scope_type TEXT,
      conversation_key TEXT,
      question_text_sanitized TEXT,
      question_hash TEXT,
      input_chars INTEGER NOT NULL DEFAULT 0,
      route_intent TEXT,
      input_style TEXT,
      risk_level TEXT,
      context_snapshot_json TEXT,
      dedupe_key TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      resolved_at TEXT,
      closed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS ticket_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      actor TEXT NOT NULL DEFAULT 'system',
      previous_status TEXT,
      new_status TEXT,
      reason TEXT,
      metadata_json TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(ticket_id) REFERENCES handoff_tickets(ticket_id)
    );

    CREATE TABLE IF NOT EXISTS ticket_drafts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id TEXT NOT NULL,
      draft_type TEXT NOT NULL,
      status TEXT NOT NULL,
      content_sanitized TEXT,
      provider TEXT,
      model_name TEXT,
      prompt_chars INTEGER,
      output_chars INTEGER,
      fallback_reason TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(ticket_id) REFERENCES handoff_tickets(ticket_id)
    );

    CREATE TABLE IF NOT EXISTS admin_audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      ticket_id TEXT,
      status TEXT NOT NULL,
      reason TEXT,
      remote_address TEXT,
      metadata_json TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_handoff_tickets_status_created
      ON handoff_tickets(status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_ticket_events_ticket
      ON ticket_events(ticket_id, id ASC);
    CREATE INDEX IF NOT EXISTS idx_ticket_drafts_ticket
      ON ticket_drafts(ticket_id, id DESC);
    CREATE INDEX IF NOT EXISTS idx_admin_audit_created
      ON admin_audit_logs(created_at DESC);
  `);

  const insertTicket = db.prepare(`
    INSERT OR IGNORE INTO handoff_tickets (
      ticket_id, status, priority, trigger_type, trigger_reason, scope_type, conversation_key,
      question_text_sanitized, question_hash, input_chars, route_intent, input_style, risk_level,
      context_snapshot_json, dedupe_key, created_at, updated_at
    )
    VALUES (
      @ticket_id, @status, @priority, @trigger_type, @trigger_reason, @scope_type, @conversation_key,
      @question_text_sanitized, @question_hash, @input_chars, @route_intent, @input_style,
      @risk_level, @context_snapshot_json, @dedupe_key, @created_at, @updated_at
    )
  `);
  const selectTicketByTicketId = db.prepare("SELECT * FROM handoff_tickets WHERE ticket_id = ?");
  const selectTicketByDedupeKey = db.prepare("SELECT * FROM handoff_tickets WHERE dedupe_key = ?");
  const updateTicketStatusStmt = db.prepare(`
    UPDATE handoff_tickets
    SET status = @status,
        updated_at = @updated_at,
        resolved_at = CASE WHEN @status = 'resolved' THEN @updated_at ELSE resolved_at END,
        closed_at = CASE WHEN @status = 'closed' THEN @updated_at ELSE closed_at END
    WHERE ticket_id = @ticket_id
  `);
  const insertEvent = db.prepare(`
    INSERT INTO ticket_events (
      ticket_id, event_type, actor, previous_status, new_status, reason, metadata_json, created_at
    )
    VALUES (
      @ticket_id, @event_type, @actor, @previous_status, @new_status, @reason, @metadata_json, @created_at
    )
  `);
  const insertDraft = db.prepare(`
    INSERT INTO ticket_drafts (
      ticket_id, draft_type, status, content_sanitized, provider, model_name,
      prompt_chars, output_chars, fallback_reason, created_at
    )
    VALUES (
      @ticket_id, @draft_type, @status, @content_sanitized, @provider, @model_name,
      @prompt_chars, @output_chars, @fallback_reason, @created_at
    )
  `);
  const insertAuditLog = db.prepare(`
    INSERT INTO admin_audit_logs (
      action, ticket_id, status, reason, remote_address, metadata_json, created_at
    )
    VALUES (
      @action, @ticket_id, @status, @reason, @remote_address, @metadata_json, @created_at
    )
  `);

  function addTicketEvent(ticketId, event = {}) {
    const info = insertEvent.run({
      ticket_id: ticketId,
      event_type: String(event.eventType || event.event_type || "note_added").slice(0, 80),
      actor: String(event.actor || "system").slice(0, 80),
      previous_status: event.previousStatus || event.previous_status || null,
      new_status: event.newStatus || event.new_status || null,
      reason: event.reason ? String(event.reason).slice(0, 240) : null,
      metadata_json: safeJson(event.metadata || event.metadata_json || null),
      created_at: event.createdAt || event.created_at || nowIso()
    });
    return { id: info.lastInsertRowid };
  }

  const createTicketTx = db.transaction((entry) => {
    const createdAt = entry.createdAt || entry.created_at || nowIso();
    const sanitizedText = sanitizeTicketText(entry.questionText || entry.question_text || "");
    const questionHash = entry.questionHash || entry.question_hash || hashText(sanitizedText);
    const dedupeKey =
      entry.dedupeKey ||
      entry.dedupe_key ||
      [
        entry.triggerType || entry.trigger_type || "manual",
        entry.conversationKey || entry.conversation_key || "unknown",
        questionHash
      ].join(":");
    const existing = selectTicketByDedupeKey.get(dedupeKey);
    if (existing) {
      return { inserted: false, duplicate: true, ticket: normalizeTicket(existing) };
    }

    const ticketId =
      entry.ticketId ||
      entry.ticket_id ||
      `HT-${createdAt.replace(/[-:.TZ]/g, "").slice(0, 14)}-${hashText(dedupeKey).slice(0, 8)}`;
    insertTicket.run({
      ticket_id: ticketId,
      status: TICKET_STATUSES.has(entry.status) ? entry.status : "open",
      priority: String(entry.priority || "normal").slice(0, 20),
      trigger_type: String(entry.triggerType || entry.trigger_type || "admin_manual").slice(0, 80),
      trigger_reason: entry.triggerReason || entry.trigger_reason || null,
      scope_type: entry.scopeType || entry.scope_type || null,
      conversation_key: entry.conversationKey || entry.conversation_key || null,
      question_text_sanitized: sanitizedText,
      question_hash: questionHash,
      input_chars: Number.isFinite(entry.inputChars) ? entry.inputChars : sanitizedText.length,
      route_intent: entry.routeIntent || entry.route_intent || null,
      input_style: entry.inputStyle || entry.input_style || null,
      risk_level: entry.riskLevel || entry.risk_level || null,
      context_snapshot_json: safeJson(entry.contextSnapshot || entry.context_snapshot || null),
      dedupe_key: dedupeKey,
      created_at: createdAt,
      updated_at: createdAt
    });
    addTicketEvent(ticketId, {
      eventType: "created",
      actor: entry.actor || "system",
      newStatus: "open",
      reason: entry.triggerReason || entry.trigger_reason || null,
      metadata: entry.eventMetadata || null,
      createdAt
    });
    return { inserted: true, duplicate: false, ticket: normalizeTicket(selectTicketByTicketId.get(ticketId)) };
  });

  function createTicket(entry = {}) {
    return createTicketTx(entry);
  }

  function listTickets(filter = {}) {
    const clauses = [];
    const params = {};
    if (filter.status) {
      clauses.push("status = @status");
      params.status = filter.status;
    }
    if (filter.triggerType || filter.trigger_type) {
      clauses.push("trigger_type = @trigger_type");
      params.trigger_type = filter.triggerType || filter.trigger_type;
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const limit = Math.max(1, Math.min(Number(filter.limit) || 50, 200));
    return db
      .prepare(`SELECT * FROM handoff_tickets ${where} ORDER BY id DESC LIMIT @limit`)
      .all({ ...params, limit })
      .map(normalizeTicket);
  }

  function getTicket(ticketId) {
    const ticket = normalizeTicket(selectTicketByTicketId.get(ticketId));
    if (!ticket) {
      return null;
    }
    const events = db
      .prepare("SELECT * FROM ticket_events WHERE ticket_id = ? ORDER BY id ASC")
      .all(ticketId)
      .map((row) => ({
        id: row.id,
        ticketId: row.ticket_id,
        eventType: row.event_type,
        actor: row.actor,
        previousStatus: row.previous_status,
        newStatus: row.new_status,
        reason: row.reason,
        metadata: parseJson(row.metadata_json, null),
        createdAt: row.created_at
      }));
    return { ...ticket, events, drafts: listTicketDrafts(ticketId) };
  }

  function updateTicketStatus(ticketId, status, metadata = {}) {
    if (!TICKET_STATUSES.has(status)) {
      throw new Error("invalid_ticket_status");
    }
    const current = normalizeTicket(selectTicketByTicketId.get(ticketId));
    if (!current) {
      return null;
    }
    const updatedAt = metadata.updatedAt || nowIso();
    updateTicketStatusStmt.run({ ticket_id: ticketId, status, updated_at: updatedAt });
    addTicketEvent(ticketId, {
      eventType: "status_changed",
      actor: metadata.actor || "admin",
      previousStatus: current.status,
      newStatus: status,
      reason: metadata.reason || null,
      metadata: metadata.metadata || null,
      createdAt: updatedAt
    });
    return normalizeTicket(selectTicketByTicketId.get(ticketId));
  }

  function saveTicketDraft(ticketId, draft = {}) {
    if (!selectTicketByTicketId.get(ticketId)) {
      return null;
    }
    const draftType = DRAFT_TYPES.has(draft.draftType || draft.draft_type)
      ? draft.draftType || draft.draft_type
      : "draft_reply";
    const content = sanitizeTicketText(draft.content || draft.contentSanitized || "");
    const createdAt = draft.createdAt || nowIso();
    const info = insertDraft.run({
      ticket_id: ticketId,
      draft_type: draftType,
      status: draft.status || "completed",
      content_sanitized: content,
      provider: draft.provider || null,
      model_name: draft.modelName || draft.model_name || null,
      prompt_chars: Number.isFinite(draft.promptChars) ? draft.promptChars : null,
      output_chars: content.length,
      fallback_reason: draft.fallbackReason || draft.fallback_reason || null,
      created_at: createdAt
    });
    addTicketEvent(ticketId, {
      eventType: draftType === "summary" ? "summary_generated" : "draft_generated",
      actor: draft.actor || "admin",
      reason: draft.fallbackReason || "success",
      createdAt
    });
    return normalizeDraft(db.prepare("SELECT * FROM ticket_drafts WHERE id = ?").get(info.lastInsertRowid));
  }

  function listTicketDrafts(ticketId) {
    return db
      .prepare("SELECT * FROM ticket_drafts WHERE ticket_id = ? ORDER BY id DESC")
      .all(ticketId)
      .map(normalizeDraft);
  }

  function recordAdminAudit(entry = {}) {
    const info = insertAuditLog.run({
      action: String(entry.action || "unknown").slice(0, 100),
      ticket_id: entry.ticketId || entry.ticket_id || null,
      status: entry.status || "completed",
      reason: entry.reason || null,
      remote_address: entry.remoteAddress || entry.remote_address || null,
      metadata_json: safeJson(entry.metadata || null),
      created_at: entry.createdAt || nowIso()
    });
    return { id: info.lastInsertRowid };
  }

  function readAdminAuditLogs(limit = 50) {
    return db
      .prepare("SELECT * FROM admin_audit_logs ORDER BY id DESC LIMIT ?")
      .all(Math.max(1, Math.min(Number(limit) || 50, 200)));
  }

  function close() {
    if (!closed) {
      db.close();
      closed = true;
    }
    return { closed: true };
  }

  const api = {
    addTicketEvent,
    close,
    createTicket,
    getTicket,
    listTicketDrafts,
    listTickets,
    recordAdminAudit,
    saveTicketDraft,
    sanitizeTicketText,
    updateTicketStatus
  };

  if (options.enableTestHelpers === true) {
    Object.assign(api, {
      countTickets: () => db.prepare("SELECT COUNT(*) AS count FROM handoff_tickets").get().count,
      readAdminAuditLogs,
      readTicketEvents: () => db.prepare("SELECT * FROM ticket_events ORDER BY id ASC").all()
    });
  }

  return api;
}

module.exports = {
  TICKET_STATUSES,
  createHandoffStore,
  hashText,
  sanitizeTicketText
};
