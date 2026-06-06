const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");

const DEFAULT_DB_PATH = path.resolve(__dirname, "..", "data", "linebot-memory.sqlite");
const JOB_STATUSES = new Set(["pending", "running", "completed", "failed"]);

function nowIso() {
  return new Date().toISOString();
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

function normalizeInt(value, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeBool(value) {
  return value === true || value === 1 ? 1 : 0;
}

function sanitizeError(error) {
  if (!error) {
    return null;
  }
  if (typeof error === "string") {
    return error.slice(0, 500);
  }
  return String(error.errorClass || error.name || error.message || "error").slice(0, 500);
}

function rowToJob(row) {
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    requestId: row.request_id,
    webhookEventId: row.webhook_event_id,
    lineEventLogId: row.line_event_log_id,
    jobType: row.job_type,
    status: row.status,
    dedupeKey: row.dedupe_key,
    payload: parseJson(row.payload_json, {}),
    attemptCount: row.attempt_count,
    maxAttempts: row.max_attempts,
    nextRunAt: row.next_run_at,
    lockedBy: row.locked_by,
    lockedAt: row.locked_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastError: row.last_error,
    completedAt: row.completed_at,
    attemptId: row.attempt_id || null
  };
}

function createGatewayStore(dbPath = DEFAULT_DB_PATH, options = {}) {
  if (dbPath !== ":memory:") {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  const enableTestHelpers = options?.enableTestHelpers === true;
  let closed = false;

  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id TEXT NOT NULL,
      webhook_event_id TEXT,
      line_event_log_id INTEGER,
      job_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      dedupe_key TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 3,
      next_run_at TEXT NOT NULL,
      locked_by TEXT,
      locked_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_error TEXT,
      completed_at TEXT,
      UNIQUE(job_type, dedupe_key)
    );

    CREATE TABLE IF NOT EXISTS job_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL,
      attempt_number INTEGER NOT NULL,
      worker_id TEXT,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      duration_ms INTEGER,
      error_class TEXT,
      error_message TEXT,
      FOREIGN KEY(job_id) REFERENCES jobs(id)
    );

    CREATE TABLE IF NOT EXISTS dead_letter_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL UNIQUE,
      request_id TEXT NOT NULL,
      webhook_event_id TEXT,
      line_event_log_id INTEGER,
      job_type TEXT NOT NULL,
      dedupe_key TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      attempt_count INTEGER NOT NULL,
      last_error TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS pipeline_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id TEXT,
      job_id INTEGER,
      job_type TEXT,
      stage TEXT NOT NULL,
      source_type TEXT,
      intent TEXT,
      risk_level TEXT,
      status TEXT NOT NULL,
      fallback_reason TEXT,
      duration_ms INTEGER,
      input_chars INTEGER,
      output_chars INTEGER,
      evidence_count INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS llm_call_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id TEXT,
      job_id INTEGER,
      call_type TEXT NOT NULL,
      conversation_key TEXT,
      intent TEXT,
      risk_level TEXT,
      provider TEXT,
      model_name TEXT,
      prompt_chars INTEGER,
      completion_chars INTEGER,
      latency_ms INTEGER,
      retry_count INTEGER,
      timeout INTEGER NOT NULL DEFAULT 0,
      fallback_used INTEGER NOT NULL DEFAULT 0,
      fallback_reason TEXT,
      knowledge_hit INTEGER NOT NULL DEFAULT 0,
      handoff_triggered INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS model_health_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT,
      model_name TEXT,
      status TEXT NOT NULL,
      latency_ms INTEGER,
      fallback_reason TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_jobs_status_next_run
      ON jobs(status, next_run_at, id);
    CREATE INDEX IF NOT EXISTS idx_jobs_type_status
      ON jobs(job_type, status, id);
    CREATE INDEX IF NOT EXISTS idx_job_attempts_job
      ON job_attempts(job_id, id DESC);
    CREATE INDEX IF NOT EXISTS idx_pipeline_logs_request
      ON pipeline_logs(request_id, id DESC);
    CREATE INDEX IF NOT EXISTS idx_llm_call_logs_status
      ON llm_call_logs(status, id DESC);
    CREATE INDEX IF NOT EXISTS idx_llm_call_logs_provider_model
      ON llm_call_logs(provider, model_name, id DESC);
  `);

  const selectJobById = db.prepare("SELECT * FROM jobs WHERE id = ?");
  const selectExistingJob = db.prepare("SELECT * FROM jobs WHERE job_type = ? AND dedupe_key = ?");

  const insertJob = db.prepare(`
    INSERT OR IGNORE INTO jobs (
      request_id, webhook_event_id, line_event_log_id, job_type, status, dedupe_key,
      payload_json, attempt_count, max_attempts, next_run_at, created_at, updated_at
    )
    VALUES (
      @request_id, @webhook_event_id, @line_event_log_id, @job_type, 'pending', @dedupe_key,
      @payload_json, 0, @max_attempts, @next_run_at, @created_at, @updated_at
    )
  `);

  const selectClaimableJob = db.prepare(`
    SELECT *
    FROM jobs
    WHERE status = 'pending'
      AND next_run_at <= @now
      AND (@job_types_json IS NULL OR job_type IN (SELECT value FROM json_each(@job_types_json)))
    ORDER BY id ASC
    LIMIT 1
  `);

  const markJobRunning = db.prepare(`
    UPDATE jobs
    SET status = 'running',
      locked_by = @worker_id,
      locked_at = @now,
      attempt_count = attempt_count + 1,
      updated_at = @now
    WHERE id = @id AND status = 'pending'
  `);

  const insertAttempt = db.prepare(`
    INSERT INTO job_attempts (job_id, attempt_number, worker_id, status, started_at)
    VALUES (@job_id, @attempt_number, @worker_id, 'running', @started_at)
  `);

  const completeJobStmt = db.prepare(`
    UPDATE jobs
    SET status = 'completed',
      completed_at = @now,
      updated_at = @now,
      locked_by = NULL,
      locked_at = NULL,
      last_error = NULL
    WHERE id = @id
  `);

  const finishAttempt = db.prepare(`
    UPDATE job_attempts
    SET status = @status,
      finished_at = @finished_at,
      duration_ms = CAST((julianday(@finished_at) - julianday(started_at)) * 86400000 AS INTEGER),
      error_class = @error_class,
      error_message = @error_message
    WHERE id = @id
  `);

  const retryJobStmt = db.prepare(`
    UPDATE jobs
    SET status = 'pending',
      next_run_at = @next_run_at,
      updated_at = @now,
      locked_by = NULL,
      locked_at = NULL,
      last_error = @last_error
    WHERE id = @id
  `);

  const failJobStmt = db.prepare(`
    UPDATE jobs
    SET status = 'failed',
      updated_at = @now,
      locked_by = NULL,
      locked_at = NULL,
      last_error = @last_error
    WHERE id = @id
  `);

  const insertDeadLetter = db.prepare(`
    INSERT OR IGNORE INTO dead_letter_jobs (
      job_id, request_id, webhook_event_id, line_event_log_id, job_type, dedupe_key,
      payload_json, attempt_count, last_error, created_at
    )
    SELECT id, request_id, webhook_event_id, line_event_log_id, job_type, dedupe_key,
      payload_json, attempt_count, last_error, @now
    FROM jobs
    WHERE id = @id
  `);

  const recoverStale = db.prepare(`
    UPDATE jobs
    SET status = 'pending',
      next_run_at = @now,
      updated_at = @now,
      locked_by = NULL,
      locked_at = NULL,
      last_error = 'recovered_stale_running'
    WHERE status = 'running'
      AND locked_at <= @threshold
  `);

  const insertPipelineLog = db.prepare(`
    INSERT INTO pipeline_logs (
      request_id, job_id, job_type, stage, source_type, intent, risk_level, status,
      fallback_reason, duration_ms, input_chars, output_chars, evidence_count, created_at
    )
    VALUES (
      @request_id, @job_id, @job_type, @stage, @source_type, @intent, @risk_level, @status,
      @fallback_reason, @duration_ms, @input_chars, @output_chars, @evidence_count, @created_at
    )
  `);

  const insertLlmCall = db.prepare(`
    INSERT INTO llm_call_logs (
      request_id, job_id, call_type, conversation_key, intent, risk_level, provider, model_name,
      prompt_chars, completion_chars, latency_ms, retry_count, timeout, fallback_used,
      fallback_reason, knowledge_hit, handoff_triggered, status, created_at
    )
    VALUES (
      @request_id, @job_id, @call_type, @conversation_key, @intent, @risk_level, @provider, @model_name,
      @prompt_chars, @completion_chars, @latency_ms, @retry_count, @timeout, @fallback_used,
      @fallback_reason, @knowledge_hit, @handoff_triggered, @status, @created_at
    )
  `);

  const insertModelHealth = db.prepare(`
    INSERT INTO model_health_logs (provider, model_name, status, latency_ms, fallback_reason, created_at)
    VALUES (@provider, @model_name, @status, @latency_ms, @fallback_reason, @created_at)
  `);

  const listDeadLettersStmt = db.prepare(`
    SELECT *
    FROM dead_letter_jobs
    WHERE (@job_type IS NULL OR job_type = @job_type)
    ORDER BY id DESC
    LIMIT @limit
  `);

  function enqueueJob(job) {
    const createdAt = job.createdAt || nowIso();
    const jobType = String(job.jobType || job.job_type || "").trim();
    const dedupeKey = String(job.dedupeKey || job.dedupe_key || "").trim();
    if (!jobType || !dedupeKey) {
      return { inserted: false, reason: "invalid_job" };
    }
    const payload = job.payload === undefined ? {} : job.payload;
    const row = {
      request_id: String(job.requestId || job.request_id || ""),
      webhook_event_id: job.webhookEventId || job.webhook_event_id || null,
      line_event_log_id: Number.isInteger(job.lineEventLogId)
        ? job.lineEventLogId
        : job.line_event_log_id || null,
      job_type: jobType,
      dedupe_key: dedupeKey,
      payload_json: safeJson(payload) || "{}",
      max_attempts: normalizeInt(job.maxAttempts || job.max_attempts, 3),
      next_run_at: job.nextRunAt || job.next_run_at || createdAt,
      created_at: createdAt,
      updated_at: createdAt
    };
    const result = insertJob.run(row);
    const current = selectExistingJob.get(jobType, dedupeKey);
    return {
      inserted: result.changes > 0,
      duplicate: result.changes === 0,
      job: rowToJob(current)
    };
  }

  const claimTransaction = db.transaction(({ workerId, jobTypes, now }) => {
    const jobTypesJson = Array.isArray(jobTypes) && jobTypes.length ? JSON.stringify(jobTypes) : null;
    const row = selectClaimableJob.get({ now, job_types_json: jobTypesJson });
    if (!row) {
      return null;
    }
    const updated = markJobRunning.run({ id: row.id, worker_id: workerId, now });
    if (updated.changes === 0) {
      return null;
    }
    const current = selectJobById.get(row.id);
    const attempt = insertAttempt.run({
      job_id: current.id,
      attempt_number: current.attempt_count,
      worker_id: workerId,
      started_at: now
    });
    return rowToJob({ ...current, attempt_id: attempt.lastInsertRowid });
  });

  function claimNextJob({ workerId = "worker", jobTypes = null, now = nowIso() } = {}) {
    return claimTransaction({ workerId, jobTypes, now });
  }

  function completeJob(jobId, result = {}) {
    const now = result.completedAt || nowIso();
    completeJobStmt.run({ id: jobId, now });
    if (result.attemptId) {
      finishAttempt.run({
        id: result.attemptId,
        status: "completed",
        finished_at: now,
        error_class: null,
        error_message: null
      });
    }
    return rowToJob(selectJobById.get(jobId));
  }

  function failJob(jobId, error, retryPolicy = {}) {
    const now = retryPolicy.now || nowIso();
    const row = selectJobById.get(jobId);
    if (!row) {
      return null;
    }
    const lastError = sanitizeError(error);
    if (retryPolicy.attemptId) {
      finishAttempt.run({
        id: retryPolicy.attemptId,
        status: "failed",
        finished_at: now,
        error_class: lastError,
        error_message: lastError
      });
    }
    if (row.attempt_count >= row.max_attempts) {
      failJobStmt.run({ id: jobId, now, last_error: lastError });
      insertDeadLetter.run({ id: jobId, now });
    } else {
      const delayMs = normalizeInt(retryPolicy.retryDelayMs, 1000);
      retryJobStmt.run({
        id: jobId,
        now,
        next_run_at: new Date(Date.parse(now) + delayMs).toISOString(),
        last_error: lastError
      });
    }
    return rowToJob(selectJobById.get(jobId));
  }

  function recoverStaleRunningJobs({ olderThanMs = 60000, now = nowIso() } = {}) {
    const threshold = new Date(Date.parse(now) - olderThanMs).toISOString();
    return {
      recovered: recoverStale.run({ now, threshold }).changes
    };
  }

  function recordPipelineLog(entry = {}) {
    const info = {
      request_id: entry.requestId || entry.request_id || null,
      job_id: entry.jobId || entry.job_id || null,
      job_type: entry.jobType || entry.job_type || null,
      stage: String(entry.stage || "unknown"),
      source_type: entry.sourceType || entry.source_type || null,
      intent: entry.intent || "unknown",
      risk_level: entry.riskLevel || entry.risk_level || "unknown",
      status: JOB_STATUSES.has(entry.status) || entry.status === "PASS" || entry.status === "FAIL"
        ? String(entry.status)
        : "completed",
      fallback_reason: entry.fallbackReason || entry.fallback_reason || null,
      duration_ms: Number.isFinite(entry.durationMs) ? entry.durationMs : entry.duration_ms || null,
      input_chars: Number.isFinite(entry.inputChars) ? entry.inputChars : entry.input_chars || null,
      output_chars: Number.isFinite(entry.outputChars) ? entry.outputChars : entry.output_chars || null,
      evidence_count: Number.isFinite(entry.evidenceCount)
        ? entry.evidenceCount
        : entry.evidence_count || null,
      created_at: entry.createdAt || entry.created_at || nowIso()
    };
    return { id: insertPipelineLog.run(info).lastInsertRowid };
  }

  function recordLlmCall(entry = {}) {
    const info = {
      request_id: entry.requestId || entry.request_id || null,
      job_id: entry.jobId || entry.job_id || null,
      call_type: String(entry.callType || entry.call_type || "unknown"),
      conversation_key: entry.conversationKey || entry.conversation_key || null,
      intent: entry.intent || "unknown",
      risk_level: entry.riskLevel || entry.risk_level || "unknown",
      provider: entry.provider || null,
      model_name: entry.modelName || entry.model_name || null,
      prompt_chars: Number.isFinite(entry.promptChars) ? entry.promptChars : entry.prompt_chars || null,
      completion_chars: Number.isFinite(entry.completionChars)
        ? entry.completionChars
        : entry.completion_chars || null,
      latency_ms: Number.isFinite(entry.latencyMs) ? entry.latencyMs : entry.latency_ms || null,
      retry_count: Number.isFinite(entry.retryCount) ? entry.retryCount : entry.retry_count || 0,
      timeout: normalizeBool(entry.timeout),
      fallback_used: normalizeBool(entry.fallbackUsed || entry.fallback_used),
      fallback_reason: entry.fallbackReason || entry.fallback_reason || null,
      knowledge_hit: normalizeBool(entry.knowledgeHit || entry.knowledge_hit),
      handoff_triggered: normalizeBool(entry.handoffTriggered || entry.handoff_triggered),
      status: entry.status || "completed",
      created_at: entry.createdAt || entry.created_at || nowIso()
    };
    return { id: insertLlmCall.run(info).lastInsertRowid };
  }

  function recordModelHealth(entry = {}) {
    return {
      id: insertModelHealth.run({
        provider: entry.provider || null,
        model_name: entry.modelName || entry.model_name || null,
        status: entry.status || "unknown",
        latency_ms: Number.isFinite(entry.latencyMs) ? entry.latencyMs : entry.latency_ms || null,
        fallback_reason: entry.fallbackReason || entry.fallback_reason || null,
        created_at: entry.createdAt || entry.created_at || nowIso()
      }).lastInsertRowid
    };
  }

  function listJobs(filter = {}) {
    const clauses = [];
    const params = {};
    if (filter.status) {
      clauses.push("status = @status");
      params.status = filter.status;
    }
    if (filter.jobType || filter.job_type) {
      clauses.push("job_type = @job_type");
      params.job_type = filter.jobType || filter.job_type;
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const limit = normalizeInt(filter.limit, 100);
    return db.prepare(`SELECT * FROM jobs ${where} ORDER BY id DESC LIMIT @limit`).all({
      ...params,
      limit
    }).map(rowToJob);
  }

  function listDeadLetterJobs(filter = {}) {
    return listDeadLettersStmt.all({
      job_type: filter.jobType || filter.job_type || null,
      limit: normalizeInt(filter.limit, 100)
    });
  }

  function listRecentLlmFailures(limit = 100) {
    return db
      .prepare(
        `SELECT * FROM llm_call_logs
         WHERE status != 'success' OR fallback_used = 1 OR timeout = 1
         ORDER BY id DESC
         LIMIT ?`
      )
      .all(normalizeInt(limit, 100));
  }

  function getLlmLatencyStats(filter = {}) {
    const rows = db
      .prepare(
        `SELECT COUNT(*) AS count, AVG(latency_ms) AS average_latency_ms
         FROM llm_call_logs
         WHERE latency_ms IS NOT NULL
           AND (@provider IS NULL OR provider = @provider)
           AND (@model_name IS NULL OR model_name = @model_name)
           AND (@intent IS NULL OR intent = @intent)`
      )
      .get({
        provider: filter.provider || null,
        model_name: filter.modelName || filter.model_name || null,
        intent: filter.intent || null
      });
    return {
      count: rows.count,
      averageLatencyMs: rows.average_latency_ms
    };
  }

  function getFallbackRate(filter = {}) {
    const row = db
      .prepare(
        `SELECT COUNT(*) AS count, SUM(CASE WHEN fallback_used = 1 THEN 1 ELSE 0 END) AS fallback_count
         FROM llm_call_logs
         WHERE (@provider IS NULL OR provider = @provider)
           AND (@model_name IS NULL OR model_name = @model_name)
           AND (@intent IS NULL OR intent = @intent)`
      )
      .get({
        provider: filter.provider || null,
        model_name: filter.modelName || filter.model_name || null,
        intent: filter.intent || null
      });
    const count = row.count || 0;
    const fallbackCount = row.fallback_count || 0;
    return {
      count,
      fallbackCount,
      fallbackRate: count > 0 ? fallbackCount / count : 0
    };
  }

  function close() {
    if (!closed) {
      db.close();
      closed = true;
    }
    return { closed: true };
  }

  const api = {
    claimNextJob,
    close,
    completeJob,
    enqueueJob,
    failJob,
    getFallbackRate,
    getLlmLatencyStats,
    listDeadLetterJobs,
    listJobs,
    listRecentLlmFailures,
    recoverStaleRunningJobs,
    recordLlmCall,
    recordModelHealth,
    recordPipelineLog
  };

  if (enableTestHelpers) {
    Object.assign(api, {
      countJobs: () => db.prepare("SELECT COUNT(*) AS count FROM jobs").get().count,
      countPipelineLogs: () => db.prepare("SELECT COUNT(*) AS count FROM pipeline_logs").get().count,
      countLlmCallLogs: () => db.prepare("SELECT COUNT(*) AS count FROM llm_call_logs").get().count,
      readPipelineLogs: () => db.prepare("SELECT * FROM pipeline_logs ORDER BY id ASC").all(),
      readLlmCallLogs: () => db.prepare("SELECT * FROM llm_call_logs ORDER BY id ASC").all()
    });
  }

  return api;
}

module.exports = {
  createGatewayStore
};
