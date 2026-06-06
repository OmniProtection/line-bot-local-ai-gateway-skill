const express = require("express");
const { readConfig, validateConfig } = require("./config");
const { shouldUseDirectModelReply } = require("./directReplyGate");
const { createGatewayStore } = require("./gatewayStore");
const {
  createLineClient,
  createLineMiddleware,
  pushText,
  replyText
} = require("./lineClient");
const {
  askLocalModel,
  askLocalModelForSearchDecision,
  askLocalModelWithSearchEvidence,
  summarizeGroupMemoryBatch,
  summarizeRollingConversationBatch
} = require("./lmStudioClient");
const { createMemoryStore, sanitizeMemoryText } = require("./memoryStore");
const {
  buildPipelineRequest,
  isBotMentioned,
  normalizeLineEvent: normalizePipelineLineEvent,
  redactRawEvent: redactPipelineRawEvent
} = require("./pipelineContract");
const { clampReply, shouldHandleEvent } = require("./replyPolicy");
const { errorClass, logEvent } = require("./logger");
const { decideWebSearchRequest, getPushTarget, parseWebSearchCommand } = require("./webSearchCommand");
const { searchWeb } = require("./webSearchService");

const GENERAL_FALLBACK_REPLY = "Sorry, I cannot answer right now. Please try again later.";
const WEB_SEARCH_FAILURE_REPLY = "搜尋失敗";
const MAX_DURABLE_RETRY_WAKEUP_MS = 30000;

function isGroupOrRoom(source) {
  return source?.type === "group" || source?.type === "room";
}

function redactRawEvent(event) {
  return redactPipelineRawEvent(event);
}

function normalizeLineEvent(event, requestId, index) {
  return normalizePipelineLineEvent(event, requestId, index);
}

function removeSelfMentionFromText(text, mention) {
  const chars = Array.from(String(text || ""));
  const selfMentions = Array.isArray(mention?.mentionees)
    ? mention.mentionees
        .filter(
          (mentionee) =>
            mentionee?.isSelf === true &&
            Number.isInteger(mentionee.index) &&
            Number.isInteger(mentionee.length) &&
            mentionee.index >= 0 &&
            mentionee.length > 0
        )
        .sort((left, right) => right.index - left.index)
    : [];

  for (const mentionee of selfMentions) {
    chars.splice(mentionee.index, mentionee.length);
  }

  return chars.join("").trim();
}

function parseMemoryCommand(text) {
  const normalized = String(text || "").trim();
  const rememberMatch = normalized.match(/^記住[：:]\s*(.+)$/u);
  if (rememberMatch) {
    return {
      type: "remember",
      value: rememberMatch[1].trim()
    };
  }

  const forgetMatch = normalized.match(/^忘記[：:]\s*(.+)$/u);
  if (forgetMatch) {
    return {
      type: "forget",
      value: forgetMatch[1].trim()
    };
  }

  if (normalized === "列出記憶") {
    return {
      type: "list",
      value: ""
    };
  }

  return null;
}

function formatMemoryList(memories, maxReplyChars) {
  if (memories.length === 0) {
    return "目前沒有記憶。";
  }

  const lines = memories.map((memory, index) => `${index + 1}. ${memory}`);
  return clampReply(`目前記得：\n${lines.join("\n")}`, maxReplyChars);
}

function isSignatureValidationError(error) {
  const name = String(error?.name || "");
  const message = String(error?.message || "").toLowerCase();

  return (
    name === "SignatureValidationFailed" ||
    message.includes("signature validation") ||
    message.includes("no signature")
  );
}

function createBotRuntime(deps = {}) {
  const config = deps.config || readConfig();
  if (deps.validateConfig !== false) {
    validateConfig(config);
  }

  const app = deps.app || express();
  const lineClient = deps.lineClient || createLineClient(config);
  const memoryStore = deps.memoryStore || createMemoryStore();
  const gatewayStore =
    deps.gatewayStore ||
    createGatewayStore(deps.memoryStore && !deps.gatewayStorePath ? ":memory:" : deps.gatewayStorePath);
  const log = deps.logEvent || logEvent;
  const now = deps.now || (() => Date.now());
  const nowIso = () => new Date(now()).toISOString();
  const workerId = deps.workerId || `linebot-worker-${process.pid}`;
  const setRetryTimeout = deps.setTimeout || setTimeout;
  const clearRetryTimeout = deps.clearTimeout || clearTimeout;
  const middlewareFactory = deps.createLineMiddleware || createLineMiddleware;
  const services = {
    askLocalModel: deps.askLocalModel || askLocalModel,
    askLocalModelForSearchDecision:
      deps.askLocalModelForSearchDecision || askLocalModelForSearchDecision,
    askLocalModelWithSearchEvidence:
      deps.askLocalModelWithSearchEvidence || askLocalModelWithSearchEvidence,
    pushText: deps.pushText || pushText,
    replyText: deps.replyText || replyText,
    searchWeb: deps.searchWeb || searchWeb,
    summarizeGroupMemoryBatch: deps.summarizeGroupMemoryBatch || summarizeGroupMemoryBatch,
    summarizeRollingConversationBatch:
      deps.summarizeRollingConversationBatch || summarizeRollingConversationBatch
  };

  let requestSequence = 0;
  let webhookEventQueue = Promise.resolve();
  let generalReplyQueue = Promise.resolve();
  let memoryOrganizationQueue = Promise.resolve();
  let webSearchQueue = Promise.resolve();
  const durableWorkerQueues = new Map();
  const durableRetryTimers = new Map();

  app.get("/health", (req, res) => {
    res.json({
      ok: true,
      modelProvider: config.localModelProvider,
      modelName: config.localModelName
    });
  });

  app.post("/webhook", middlewareFactory(config), (req, res) => {
    const events = Array.isArray(req.body.events) ? req.body.events : [];
    const requestId = `req_${++requestSequence}`;

    log("webhook_event_count", {
      request_id: requestId,
      count: events.length
    });

    for (const [index, event] of events.entries()) {
      enqueueWebhookEvent(event, requestId, index, { process: false });
    }

    res.status(200).end();
    webhookEventQueue = drainDurableJobs(["webhook_event"]);
  });

  function recordPipeline(pipelineRequest, details = {}) {
    gatewayStore.recordPipelineLog({
      requestId: pipelineRequest?.request_id || details.requestId,
      jobId: details.jobId || null,
      jobType: details.jobType || null,
      stage: details.stage || pipelineRequest?.route || "unknown",
      sourceType: pipelineRequest?.source?.type || details.sourceType || null,
      intent: pipelineRequest?.intent || details.intent || "unknown",
      riskLevel: pipelineRequest?.risk_level || details.riskLevel || "unknown",
      status: details.status || "completed",
      fallbackReason: details.fallbackReason || null,
      durationMs: details.durationMs,
      inputChars: details.inputChars ?? pipelineRequest?.message?.text_chars,
      outputChars: details.outputChars,
      evidenceCount: details.evidenceCount,
      createdAt: details.createdAt || nowIso()
    });
  }

  function recordLlmCall({
    callType,
    context = {},
    durableJob = null,
    scope = null,
    modelInput = "",
    modelResult = null,
    durationMs = null,
    evidenceCount = 0
  }) {
    gatewayStore.recordLlmCall({
      requestId: context.request_id,
      jobId: durableJob?.id || null,
      callType,
      conversationKey: scope?.key || null,
      intent: context.intent || "unknown",
      riskLevel: context.risk_level || "unknown",
      provider: config.localModelProvider,
      modelName: config.localModelName,
      promptChars: String(modelInput || "").length,
      completionChars: String(modelResult?.text || modelResult?.summary || "").length,
      latencyMs: Number.isFinite(durationMs) ? durationMs : modelResult?.durationMs || null,
      retryCount: modelResult?.retryCount || 0,
      timeout: modelResult?.reason === "timeout",
      fallbackUsed: modelResult?.fallbackUsed === true || modelResult?.ok === false,
      fallbackReason: modelResult?.reason || null,
      knowledgeHit: evidenceCount > 0,
      handoffTriggered: false,
      status:
        modelResult?.fallbackUsed === true || modelResult?.ok === false
          ? modelResult?.reason || "fallback"
          : "success",
      createdAt: nowIso()
    });
  }

  function buildRequestFor(normalizedEvent, lineEventLogId, modelInput, route, responseMode) {
    return buildPipelineRequest({
      normalizedEvent,
      lineEventLogId,
      modelInput,
      route,
      responseMode,
      createdAt: nowIso()
    });
  }

  function enqueueDurableJob(jobType, dedupeKey, payload, context = {}, options = {}) {
    const result = gatewayStore.enqueueJob({
      jobType,
      requestId: context.request_id || context.requestId || "",
      webhookEventId: context.webhook_event_id || context.webhookEventId || null,
      lineEventLogId: context.line_event_log_id || context.lineEventLogId || null,
      dedupeKey,
      maxAttempts: options.maxAttempts || 3,
      payload,
      createdAt: nowIso(),
      nextRunAt: options.nextRunAt || nowIso()
    });

    gatewayStore.recordPipelineLog({
      requestId: context.request_id || context.requestId || "",
      jobId: result.job?.id || null,
      jobType,
      stage: `${jobType}_queued`,
      sourceType: context.source_type || context.sourceType || null,
      intent: context.intent || "unknown",
      riskLevel: context.risk_level || "unknown",
      status: result.duplicate ? "completed" : "pending",
      fallbackReason: result.duplicate ? "duplicate_job" : null,
      inputChars: context.input_chars || context.inputChars || null,
      evidenceCount: context.evidence_count || context.evidenceCount || null,
      createdAt: nowIso()
    });

    const queue =
      options.process === false ? null : drainDurableJobs(options.jobTypes || [jobType]);
    return { ...result, queue };
  }

  function durableQueueKey(jobTypes) {
    if (!Array.isArray(jobTypes) || jobTypes.length === 0) {
      return "__all__";
    }
    return [...jobTypes].sort().join(",");
  }

  function drainDurableJobs(jobTypes = null) {
    const key = durableQueueKey(jobTypes);
    const existingQueue = durableWorkerQueues.get(key) || Promise.resolve();
    const nextQueue = existingQueue.then(
      () => runDurableJobs(jobTypes),
      () => runDurableJobs(jobTypes)
    );
    const trackedQueue = nextQueue.finally(() => {
      if (durableWorkerQueues.get(key) === trackedQueue) {
        durableWorkerQueues.delete(key);
      }
    });
    durableWorkerQueues.set(key, trackedQueue);
    return trackedQueue;
  }

  function scheduleDurableRetry(job) {
    if (!job || job.status !== "pending" || !job.nextRunAt) {
      return;
    }

    const retryAtMs = Date.parse(job.nextRunAt);
    if (!Number.isFinite(retryAtMs)) {
      return;
    }

    const jobTypes = [job.jobType];
    const key = durableQueueKey(jobTypes);
    const existing = durableRetryTimers.get(key);
    if (existing && existing.retryAtMs <= retryAtMs) {
      return;
    }
    if (existing) {
      clearRetryTimeout(existing.timer);
    }

    const delayMs = Math.min(Math.max(0, retryAtMs - now()), MAX_DURABLE_RETRY_WAKEUP_MS);
    const timer = setRetryTimeout(() => {
      durableRetryTimers.delete(key);
      if (now() < retryAtMs) {
        scheduleDurableRetry(job);
        return;
      }
      return drainDurableJobs(jobTypes).catch((error) => {
        log("durable_retry_wakeup_error", {
          job_type: job.jobType,
          error_class: errorClass(error)
        });
      });
    }, delayMs);
    if (typeof timer?.unref === "function") {
      timer.unref();
    }

    durableRetryTimers.set(key, {
      retryAtMs,
      timer
    });
  }

  function schedulePendingDurableRetries(jobTypes = null) {
    const allowedTypes = Array.isArray(jobTypes) && jobTypes.length ? new Set(jobTypes) : null;
    for (const job of gatewayStore.listJobs({ status: "pending", limit: 100 })) {
      if (allowedTypes && !allowedTypes.has(job.jobType)) {
        continue;
      }
      if (Date.parse(job.nextRunAt) > now()) {
        scheduleDurableRetry(job);
      }
    }
  }

  async function runDurableJobs(jobTypes = null) {
    gatewayStore.recoverStaleRunningJobs({ olderThanMs: 60000, now: nowIso() });
    while (true) {
      const job = gatewayStore.claimNextJob({ workerId, jobTypes, now: nowIso() });
      if (!job) {
        schedulePendingDurableRetries(jobTypes);
        return;
      }
      await runDurableJob(job);
    }
  }

  async function runDurableJob(durableJob) {
    const startedAt = now();
    try {
      const payload = durableJob.payload || {};
      if (durableJob.jobType === "webhook_event") {
        await handleEvent(payload.event, payload.requestId || durableJob.requestId, payload.index || 0, {
          durableJob
        });
      } else if (durableJob.jobType === "general_reply") {
        await runGeneralReplyJob(payload.job, durableJob);
      } else if (durableJob.jobType === "web_search") {
        await runWebSearchJob(payload.job, durableJob);
      } else if (durableJob.jobType === "memory_organization") {
        await organizePendingMemory(payload.scope, durableJob);
      } else if (durableJob.jobType === "rolling_summary") {
        await updateRollingSummary(payload.scope, durableJob);
      } else {
        throw new Error(`Unsupported durable job type: ${durableJob.jobType}`);
      }

      gatewayStore.completeJob(durableJob.id, { attemptId: durableJob.attemptId, completedAt: nowIso() });
      gatewayStore.recordPipelineLog({
        requestId: durableJob.requestId,
        jobId: durableJob.id,
        jobType: durableJob.jobType,
        stage: `${durableJob.jobType}_completed`,
        status: "completed",
        durationMs: now() - startedAt,
        createdAt: nowIso()
      });
    } catch (error) {
      const failedJob = gatewayStore.failJob(durableJob.id, error, {
        attemptId: durableJob.attemptId,
        now: nowIso(),
        retryDelayMs: 1000
      });
      gatewayStore.recordPipelineLog({
        requestId: durableJob.requestId,
        jobId: durableJob.id,
        jobType: durableJob.jobType,
        stage: `${durableJob.jobType}_failed`,
        status: "failed",
        fallbackReason: errorClass(error),
        durationMs: now() - startedAt,
        createdAt: nowIso()
      });
      scheduleDurableRetry(failedJob);
    }
  }

  async function sendReply(replyToken, text, context) {
    log("reply_api_started", context);

    try {
      await services.replyText(lineClient, replyToken, text);
      log("reply_api_success", context);
    } catch (error) {
      log("reply_api_error", {
        ...context,
        error_class: errorClass(error)
      });
      throw error;
    }
  }

  async function sendPush(to, text, context, failureEvent = "push_api_failed") {
    log("push_api_started", context);

    try {
      await services.pushText(lineClient, to, text);
      log("push_api_success", context);
      return true;
    } catch (error) {
      log(failureEvent, {
        ...context,
        error_class: errorClass(error)
      });
      return false;
    }
  }

  function enqueueWebhookEvent(event, requestId, index, options = {}) {
    const normalizedEvent = normalizeLineEvent(event, requestId, index);
    const result = enqueueDurableJob(
      "webhook_event",
      normalizedEvent.webhookEventId,
      { event, requestId, index },
      {
        request_id: requestId,
        webhook_event_id: normalizedEvent.webhookEventId,
        event_index: index,
        source_type: normalizedEvent.sourceType
      },
      { process: options.process !== false }
    );

    if (options.process !== false) {
      webhookEventQueue = drainDurableJobs(["webhook_event"]);
    }

    return result;
  }

  async function handleMemoryCommand(command, scope, event, context) {
    if (!scope) {
      log("memory_command_handled", {
        ...context,
        command_type: command.type,
        handled: false,
        reason: "missing_conversation_scope"
      });

      await sendReply(event.replyToken, "目前無法存取這個對話的記憶。", {
        ...context,
        fallback_used: false,
        fallback_reason: "memory_scope_missing"
      });
      return;
    }

    if (command.type === "remember") {
      const memory = sanitizeMemoryText(command.value);
      if (!memory) {
        log("memory_command_handled", {
          ...context,
          command_type: command.type,
          scope_type: scope.type,
          handled: false,
          reason: "empty_memory"
        });

        await sendReply(event.replyToken, "請在「記住：」後面加上要記住的內容。", {
          ...context,
          fallback_used: false,
          fallback_reason: "empty_memory"
        });
        return;
      }

      memoryStore.saveLongTermMemory(scope, memory);
      log("memory_command_handled", {
        ...context,
        command_type: command.type,
        scope_type: scope.type,
        handled: true
      });

      await sendReply(event.replyToken, "已記住。", {
        ...context,
        fallback_used: false,
        fallback_reason: "memory_command"
      });
      return;
    }

    if (command.type === "forget") {
      const keyword = sanitizeMemoryText(command.value);
      const result = memoryStore.deleteLongTermMemories(scope, keyword);
      log("memory_command_handled", {
        ...context,
        command_type: command.type,
        scope_type: scope.type,
        handled: true,
        deleted_count: result.deletedCount
      });

      await sendReply(event.replyToken, `已刪除 ${result.deletedCount} 筆記憶。`, {
        ...context,
        fallback_used: false,
        fallback_reason: "memory_command"
      });
      return;
    }

    if (command.type === "list") {
      const memories = memoryStore.listLongTermMemories(scope);
      log("memory_command_handled", {
        ...context,
        command_type: command.type,
        scope_type: scope.type,
        handled: true,
        memory_count: memories.length
      });

      await sendReply(event.replyToken, formatMemoryList(memories, config.maxReplyChars), {
        ...context,
        fallback_used: false,
        fallback_reason: "memory_command"
      });
    }
  }

  function enqueueMemoryOrganization(scope) {
    if (!isGroupOrRoom({ type: scope?.type })) {
      return;
    }

    const result = enqueueDurableJob(
      "memory_organization",
      `${scope.key}:memory_organization:${now()}`,
      { scope },
      {
        request_id: "",
        source_type: scope.type,
        intent: "memory_command"
      },
      { jobTypes: ["memory_organization"] }
    );
    memoryOrganizationQueue = result.queue || memoryOrganizationQueue;
  }

  function enqueueRollingSummary(scope) {
    if (!scope) {
      return;
    }

    const result = enqueueDurableJob(
      "rolling_summary",
      `${scope.key}:rolling_summary:${now()}`,
      { scope },
      {
        request_id: "",
        source_type: scope.type,
        intent: "general_chat"
      },
      { jobTypes: ["rolling_summary"] }
    );
    memoryOrganizationQueue = result.queue || memoryOrganizationQueue;
  }

  function normalizeDedupeKeyPart(value) {
    if (value === null || value === undefined) {
      return null;
    }
    const text = String(value).trim();
    return text || null;
  }

  function buildEventJobDedupeKey(job, jobType) {
    const eventId = normalizeDedupeKeyPart(job.webhookEventId || job.webhook_event_id);
    const lineEventLogId = normalizeDedupeKeyPart(job.lineEventLogId);
    const eventIndex = Number.isInteger(job.eventIndex) ? job.eventIndex : 0;
    const stableParts = [];

    if (eventId) {
      stableParts.push(`event:${eventId}`);
    }
    if (lineEventLogId) {
      stableParts.push(`line:${lineEventLogId}`);
    }

    if (stableParts.length > 0) {
      return `${stableParts.join(":")}:index:${eventIndex}:job:${jobType}`;
    }

    return `${job.requestId}:${eventIndex}:${jobType}`;
  }

  function enqueueWebSearchJob(job) {
    log("web_search_job_queued", {
      request_id: job.requestId,
      event_index: job.eventIndex,
      source_type: job.sourceType,
      query_chars: job.query.length
    });

    const result = enqueueDurableJob(
      "web_search",
      buildEventJobDedupeKey(job, "web_search"),
      { job },
      {
        request_id: job.requestId,
        webhook_event_id: job.webhookEventId || null,
        event_index: job.eventIndex,
        source_type: job.sourceType,
        intent: "web_search_request",
        input_chars: job.query.length,
        line_event_log_id: job.lineEventLogId
      },
      { jobTypes: ["web_search"] }
    );
    webSearchQueue = result.queue || webSearchQueue;
  }

  function enqueueGeneralReplyJob(job) {
    log("general_reply_job_queued", {
      request_id: job.requestId,
      event_index: job.eventIndex,
      source_type: job.sourceType,
      input_chars: job.modelInput.length
    });

    const result = enqueueDurableJob(
      "general_reply",
      buildEventJobDedupeKey(job, "general_reply"),
      { job },
      {
        request_id: job.requestId,
        webhook_event_id: job.webhookEventId || null,
        event_index: job.eventIndex,
        source_type: job.sourceType,
        intent: "general_chat",
        input_chars: job.modelInput.length,
        line_event_log_id: job.lineEventLogId
      },
      { jobTypes: ["general_reply"] }
    );
    generalReplyQueue = result.queue || generalReplyQueue;
  }

  function formatSearchFailure(reason) {
    if (reason === "timeout") {
      return "搜尋逾時，沒有取得足夠可靠資料。";
    }

    if (reason === "service_unavailable") {
      return "搜尋服務目前不可用，請稍後再試。";
    }

    return "我沒有找到足夠可靠的搜尋結果。";
  }

  function getWebSearchReplyLimit() {
    return Number.isFinite(config.webSearchMaxReplyChars) && config.webSearchMaxReplyChars > 0
      ? config.webSearchMaxReplyChars
      : config.maxReplyChars;
  }

  function getJobDeadlineMs(job) {
    const createdAtMs = Number.isFinite(job.createdAtMs) ? job.createdAtMs : now();
    const jobTimeoutMs = Number.isFinite(config.webSearchJobTimeoutMs)
      ? config.webSearchJobTimeoutMs
      : config.webSearchTotalTimeoutMs;
    return createdAtMs + jobTimeoutMs;
  }

  function getRemainingJobMs(deadlineMs) {
    return Math.max(0, deadlineMs - now());
  }

  function getSearchDeadlineMs(jobDeadlineMs) {
    const searchTimeoutMs = Number.isFinite(config.webSearchTotalTimeoutMs)
      ? config.webSearchTotalTimeoutMs
      : config.webSearchJobTimeoutMs;
    return Math.min(now() + searchTimeoutMs, jobDeadlineMs);
  }

  function getReplySearchDeadlineMs() {
    const configured = Number.isFinite(config.webSearchReplyDeadlineMs)
      ? config.webSearchReplyDeadlineMs
      : 59000;
    return now() + Math.min(Math.max(1, configured), 59000);
  }

  async function replySearchFailure(replyToken, context, reason) {
    return sendReply(replyToken, WEB_SEARCH_FAILURE_REPLY, {
      ...context,
      fallback_used: true,
      fallback_reason: reason || "web_search_failed"
    });
  }

  function getPlannedSearchQuery(rawQuery, searchPlan = null) {
    const planned = String(searchPlan?.searchQuery || "").trim();
    return planned || String(rawQuery || "").trim();
  }

  function getSearchSourcePreference(searchPlan = null) {
    const value = String(searchPlan?.sourcePreference || "general").trim();
    return ["official", "local_places", "product_specs", "current_info", "general"].includes(value)
      ? value
      : "general";
  }

  function withSearchStatus(memoryContext, memoryOptions = {}) {
    if (memoryOptions.webSearchPerformed !== false) {
      return memoryContext;
    }
    return {
      ...(memoryContext || {}),
      searchStatus: {
        webSearchPerformed: false,
        reason: memoryOptions.searchDecisionReason || "search_not_performed"
      }
    };
  }

  async function runReplyWebSearch(job, durableJob = null) {
    const startedAt = now();
    const deadlineMs = Number.isFinite(job.deadlineMs) ? job.deadlineMs : getReplySearchDeadlineMs();
    let llmAttempted = false;
    let llmLogged = false;
    const searchQuery = getPlannedSearchQuery(job.query, job);
    const sourcePreference = getSearchSourcePreference(job);
    const originalQuestion = String(job.originalQuestion || job.query || "");
    const context = {
      request_id: job.requestId,
      webhook_event_id: job.webhookEventId || null,
      event_index: job.eventIndex,
      source_type: job.sourceType,
      intent: "web_search_request",
      risk_level: "unknown",
      query_chars: String(job.query || "").length,
      search_query_chars: String(job.searchQuery || job.query || "").length,
      source_preference: job.sourcePreference || "general",
      forced_search: job.forcedSearch === true
    };

    log("web_search_reply_started", context);

    try {
      if (getRemainingJobMs(deadlineMs) <= 0) {
        await replySearchFailure(job.replyToken, context, "timeout");
        return { ok: false, reason: "timeout" };
      }

      const searchDeadlineMs = getSearchDeadlineMs(deadlineMs);
      const searchResult = await services.searchWeb(searchQuery, config, {
        deadlineMs: searchDeadlineMs,
        now,
        sourcePreference
      });
      if (!searchResult.ok) {
        await replySearchFailure(job.replyToken, context, searchResult.reason || "search_failed");
        return { ok: false, reason: searchResult.reason || "search_failed" };
      }

      const remainingForModelMs = getRemainingJobMs(deadlineMs);
      if (remainingForModelMs <= 0) {
        await replySearchFailure(job.replyToken, context, "timeout");
        return { ok: false, reason: "timeout" };
      }

      llmAttempted = true;
      const modelResult = await services.askLocalModelWithSearchEvidence(
        searchQuery,
        searchResult.evidence,
        config,
        {
          deadlineMs,
          timeoutMs: remainingForModelMs,
          originalQuestion,
          searchQuery,
          sourcePreference
        }
      );
      recordLlmCall({
        callType: "search_answer",
        context,
        durableJob,
        modelInput: originalQuestion,
        modelResult,
        evidenceCount: searchResult.evidence.length
      });
      llmLogged = true;

      if (
        modelResult.fallbackUsed === true &&
        ["timeout", "http_non_200", "invalid_json", "empty_response", "error"].includes(
          modelResult.reason
        )
      ) {
        await replySearchFailure(job.replyToken, context, modelResult.reason || "search_answer_failed");
        return { ok: false, reason: modelResult.reason || "search_answer_failed" };
      }

      const reply = clampReply(modelResult.text, getWebSearchReplyLimit());
      await sendReply(job.replyToken, reply, {
        ...context,
        fallback_used: modelResult.fallbackUsed,
        fallback_reason: modelResult.reason,
        evidence_count: searchResult.evidence.length
      });

      log("web_search_reply_completed", {
        ...context,
        duration_ms: now() - startedAt,
        evidence_count: searchResult.evidence.length
      });
      return { ok: true, reason: "success" };
    } catch (error) {
      const reason = errorClass(error) === "timeout" ? "timeout" : "error";
      if (llmAttempted && !llmLogged) {
        recordLlmCall({
          callType: "search_answer",
          context,
          durableJob,
          modelInput: originalQuestion,
          modelResult: {
            text: "",
            fallbackUsed: true,
            reason,
            durationMs: now() - startedAt
          }
        });
      }
      log("web_search_reply_error", {
        ...context,
        error_class: errorClass(error),
        duration_ms: now() - startedAt
      });
      try {
        await replySearchFailure(job.replyToken, context, reason);
      } catch (replyError) {
        log("web_search_reply_failure_reply_failed", {
          ...context,
          error_class: errorClass(replyError)
        });
      }
      return { ok: false, reason };
    }
  }

  async function runWebSearchJob(job, durableJob = null) {
    log("web_search_legacy_push_job_skipped", {
      request_id: job?.requestId || null,
      event_index: job?.eventIndex || null,
      source_type: job?.sourceType || null,
      job_id: durableJob?.id || null,
      reason: "web_search_reply_only_mode"
    });
    return { ok: false, reason: "web_search_reply_only_mode" };
  }

  async function runGeneralReplyJob(job, durableJob = null) {
    const startedAt = now();
    let llmAttempted = false;
    let llmLogged = false;
    const context = {
      request_id: job.requestId,
      event_index: job.eventIndex,
      source_type: job.sourceType,
      intent: "general_chat",
      risk_level: "unknown",
      input_chars: job.modelInput.length
    };

    log("general_reply_job_started", context);

    try {
      const memoryContext = withSearchStatus(memoryStore.loadRelevantMemoryContext(job.scope, job.modelInput, {
        excludeLineEventLogId: job.lineEventLogId,
        includeGroupMentionContext: job.includeGroupMentionContext === true
      }), job);
      llmAttempted = true;
      const modelResult = await services.askLocalModel(job.modelInput, config, memoryContext);
      recordLlmCall({
        callType: "general_reply",
        context,
        durableJob,
        scope: job.scope,
        modelInput: job.modelInput,
        modelResult
      });
      llmLogged = true;
      const reply = clampReply(modelResult.text, config.maxReplyChars);
      const pushOk = await sendPush(job.pushTarget, reply, {
        ...context,
        fallback_used: modelResult.fallbackUsed,
        fallback_reason: modelResult.reason
      });

      if (pushOk && !modelResult.fallbackUsed) {
        memoryStore.saveShortTermExchange(job.scope, job.modelInput, reply);
        enqueueRollingSummary(job.scope);
      }
      if (!pushOk) {
        throw new Error("general_reply_push_failed");
      }

      log("general_reply_job_completed", {
        ...context,
        duration_ms: now() - startedAt,
        push_ok: pushOk,
        fallback_used: modelResult.fallbackUsed,
        fallback_reason: modelResult.reason
      });
    } catch (error) {
      const reason = errorClass(error);
      if (llmAttempted && !llmLogged) {
        recordLlmCall({
          callType: "general_reply",
          context,
          durableJob,
          scope: job.scope,
          modelInput: job.modelInput,
          modelResult: {
            text: GENERAL_FALLBACK_REPLY,
            fallbackUsed: true,
            reason,
            durationMs: now() - startedAt
          }
        });
      }
      log("general_reply_job_error", {
        ...context,
        error_class: reason,
        duration_ms: now() - startedAt
      });
      const pushed = await sendPush(job.pushTarget, GENERAL_FALLBACK_REPLY, {
        ...context,
        fallback_used: true,
        fallback_reason: reason
      });
      if (!pushed) {
        throw error;
      }
    }
  }

  async function handleWebSearchCommand(searchCommand, event, context, memoryOptions = {}) {
    const decision = decideWebSearchRequest(searchCommand, config, event.source);
    if (decision.action === "reply") {
      log(decision.reason, context);
      await sendReply(event.replyToken, decision.text, {
        ...context,
        fallback_used: false,
        fallback_reason: decision.reason
      });
      return;
    }

    const replyDeadlineMs = getReplySearchDeadlineMs();
    const searchPlan = await services.askLocalModelForSearchDecision(decision.query, config, {
      timeoutMs: Math.min(
        config.webSearchDecisionTimeoutMs,
        Math.max(1, getRemainingJobMs(replyDeadlineMs))
      )
    });
    log("web_search_forced_search_plan_completed", {
      ...context,
      ok: searchPlan?.ok === true,
      confidence: searchPlan?.confidence || 0,
      search_query_chars: String(searchPlan?.searchQuery || "").length,
      source_preference: getSearchSourcePreference(searchPlan),
      fallback_reason: searchPlan?.reason || "unknown"
    });

    await runReplyWebSearch({
      requestId: context.request_id,
      webhookEventId: context.webhook_event_id,
      eventIndex: context.event_index,
      sourceType: context.source_type,
      replyToken: event.replyToken,
      lineEventLogId: memoryOptions.lineEventLogId,
      query: decision.query,
      originalQuestion: decision.query,
      searchQuery: searchPlan?.ok === true ? getPlannedSearchQuery(decision.query, searchPlan) : decision.query,
      sourcePreference: searchPlan?.ok === true ? getSearchSourcePreference(searchPlan) : "general",
      forcedSearch: memoryOptions.forcedSearch === true,
      deadlineMs: replyDeadlineMs,
      createdAt: new Date(now()).toISOString(),
      createdAtMs: now()
    });
  }

  function shouldRunAutoSearchDecision() {
    return config.webSearchEnabled === true && config.webSearchAutoDecisionEnabled === true;
  }

  function recordSearchDecisionMetadata(context, modelInput, decision, durableJob = null) {
    const safeReason = String(decision?.reason || "unknown").slice(0, 120);
    gatewayStore.recordPipelineLog({
      requestId: context.request_id,
      jobId: durableJob?.id || null,
      jobType: durableJob?.jobType || "webhook_event",
      stage: "search_decision",
      sourceType: context.source_type,
      intent: decision?.needsSearch ? "web_search_request" : "general_chat",
      riskLevel: "unknown",
      status: decision?.needsSearch ? "completed" : "skipped",
      fallbackReason: safeReason,
      durationMs: decision?.durationMs,
      inputChars: String(modelInput || "").length,
      outputChars: null,
      evidenceCount: null,
      createdAt: nowIso()
    });
    log("web_search_plan_metadata", {
      request_id: context.request_id,
      webhook_event_id: context.webhook_event_id || null,
      event_index: context.event_index,
      ok: decision?.ok === true,
      needs_search: decision?.needsSearch === true,
      model_needs_search: decision?.modelNeedsSearch === true,
      confidence: decision?.confidence || 0,
      source_preference: getSearchSourcePreference(decision),
      search_query_chars: String(decision?.searchQuery || "").length,
      input_chars: String(modelInput || "").length,
      duration_ms: decision?.durationMs || null,
      fallback_reason: safeReason
    });
    recordLlmCall({
      callType: "search_decision",
      context: {
        ...context,
        intent: decision?.needsSearch ? "web_search_request" : "general_chat",
        risk_level: "unknown"
      },
      durableJob,
      modelInput,
      modelResult: {
        text: "",
        fallbackUsed: decision?.ok !== true,
        reason: safeReason,
        durationMs: decision?.durationMs || null,
        retryCount: 0
      }
    });
  }

  async function decideAutoWebSearch(modelInput, context, durableJob = null, options = {}) {
    if (!shouldRunAutoSearchDecision()) {
      return {
        ok: true,
        needsSearch: false,
        reason: "auto_search_disabled",
        durationMs: 0
      };
    }

    const decision = await services.askLocalModelForSearchDecision(modelInput, config, {
      timeoutMs: Number.isFinite(options.timeoutMs)
        ? options.timeoutMs
        : config.webSearchDecisionTimeoutMs
    });
    recordSearchDecisionMetadata(context, modelInput, decision, durableJob);
    return decision;
  }

  function enqueueGeneralReplyFromEvent(
    modelInput,
    scope,
    event,
    context,
    pushTarget,
    memoryOptions = {}
  ) {
    enqueueGeneralReplyJob({
      requestId: context.request_id,
      webhookEventId: context.webhook_event_id,
      eventIndex: context.event_index,
      sourceType: context.source_type,
      pushTarget,
      modelInput,
      scope,
      lineEventLogId: memoryOptions.lineEventLogId,
      includeGroupMentionContext: memoryOptions.includeGroupMentionContext === true,
      webSearchPerformed: memoryOptions.webSearchPerformed,
      searchDecisionReason: memoryOptions.searchDecisionReason,
      createdAt: new Date(now()).toISOString(),
      createdAtMs: now()
    });
  }

  async function updateRollingSummary(scope, durableJob = null) {
    const batch = memoryStore.getPendingRollingSummaryBatch(scope);
    if (batch.length === 0) {
      return;
    }

    const existingSummary = memoryStore.getConversationSummary(scope);
    const result = await services.summarizeRollingConversationBatch(batch, existingSummary, config);
    recordLlmCall({
      callType: "rolling_summary",
      context: {
        request_id: durableJob?.requestId || "",
        intent: "general_chat",
        risk_level: "unknown"
      },
      durableJob,
      scope,
      modelInput: batch.map((item) => item.content || "").join("\n"),
      modelResult: result
    });

    if (!result.ok || !result.summary) {
      log("rolling_summary_empty_or_failed", {
        scope_type: scope.type,
        source_message_count: batch.length,
        reason: result.reason || "empty_summary"
      });
      return;
    }

    memoryStore.saveConversationSummary(scope, result.summary, {
      sourceMessageCount: batch.length,
      firstShortTermId: batch[0].id,
      lastShortTermId: batch[batch.length - 1].id
    });
  }

  async function startAsyncGeneralConversation(
    modelInput,
    scope,
    event,
    context,
    pushTarget,
    memoryOptions = {}
  ) {
    await sendReply(event.replyToken, config.generalPendingReplyText, {
      ...context,
      fallback_used: false,
      fallback_reason: "general_reply_pending"
    });

    enqueueGeneralReplyFromEvent(modelInput, scope, event, context, pushTarget, memoryOptions);
  }

  async function handleGeneralConversation(modelInput, scope, event, context, memoryOptions = {}) {
    const pushTarget = getPushTarget(event.source);
    if (!pushTarget) {
      log("general_reply_push_target_missing", context);
      await sendReply(event.replyToken, "目前無法在這個對話補送回覆。", {
        ...context,
        fallback_used: false,
        fallback_reason: "general_reply_push_target_missing"
      });
      return;
    }

    if (shouldUseDirectModelReply(modelInput, config)) {
      const directStartedAt = now();
      const deadlineMs = directStartedAt + config.generalDirectModelTimeoutMs;
      log("general_direct_reply_started", {
        ...context,
        input_chars: modelInput.trim().length,
        timeout_ms: config.generalDirectModelTimeoutMs
      });

      const memoryContext = withSearchStatus(memoryStore.loadRelevantMemoryContext(scope, modelInput, {
        excludeLineEventLogId: memoryOptions.lineEventLogId,
        includeGroupMentionContext: memoryOptions.includeGroupMentionContext === true
      }), memoryOptions);
      let modelResult;
      try {
        modelResult = await services.askLocalModel(modelInput, config, memoryContext, {
          deadlineMs,
          timeoutMs: config.generalDirectModelTimeoutMs,
          maxEmptyResponseRetries: 0
        });
      } catch (error) {
        modelResult = {
          text: GENERAL_FALLBACK_REPLY,
          fallbackUsed: true,
          reason: errorClass(error),
          durationMs: now() - directStartedAt
        };
      }
      recordLlmCall({
        callType: "general_direct_reply",
        context: {
          ...context,
          intent: "general_chat",
          risk_level: "unknown"
        },
        scope,
        modelInput,
        modelResult,
        durationMs: now() - directStartedAt
      });

      if (!modelResult.fallbackUsed) {
        const reply = clampReply(modelResult.text, config.maxReplyChars);
        await sendReply(event.replyToken, reply, {
          ...context,
          fallback_used: false,
          fallback_reason: "general_direct_reply"
        });
        memoryStore.saveShortTermExchange(scope, modelInput, reply);
        enqueueRollingSummary(scope);
        log("general_direct_reply_completed", {
          ...context,
          duration_ms: now() - directStartedAt,
          fallback_used: false,
          fallback_reason: modelResult.reason
        });
        return;
      }

      log("general_direct_reply_fallback_to_async", {
        ...context,
        duration_ms: now() - directStartedAt,
        fallback_used: true,
        fallback_reason: modelResult.reason
      });
    }

    await startAsyncGeneralConversation(modelInput, scope, event, context, pushTarget, memoryOptions);
  }

  async function organizePendingMemory(scope, durableJob = null) {
    const batch = memoryStore.getPendingAutoMemoryBatch(scope);
    if (batch.length === 0) {
      return;
    }

    const firstLineEventLogId = batch[0].id;
    const lastLineEventLogId = batch[batch.length - 1].id;
    const result = await services.summarizeGroupMemoryBatch(batch, config);
    recordLlmCall({
      callType: "group_memory_summary",
      context: {
        request_id: durableJob?.requestId || "",
        intent: "memory_command",
        risk_level: "unknown"
      },
      durableJob,
      scope,
      modelInput: batch.map((item) => item.content || "").join("\n"),
      modelResult: result
    });

    if (!result.ok) {
      return;
    }

    const batchLineEventIds = batch.map((item) => item.id);
    const activeLineEventIds = memoryStore.getActiveLineEventIdsForMemory(scope, batchLineEventIds);
    if (
      activeLineEventIds.length !== batchLineEventIds.length ||
      activeLineEventIds.some((id, itemIndex) => id !== batchLineEventIds[itemIndex])
    ) {
      log("memory_organization_batch_invalidated_by_unsend", {
        scope_type: scope.type,
        source_message_count: batch.length,
        active_message_count: activeLineEventIds.length
      });
      return;
    }

    if (result.summary) {
      memoryStore.saveOrganizedGroupMemory(scope, result.summary, {
        sourceMessageCount: batch.length,
        firstSourceId: firstLineEventLogId,
        lastSourceId: lastLineEventLogId,
        sourceFirstEventLogId: firstLineEventLogId,
        sourceLastEventLogId: lastLineEventLogId,
        sourceLineEventLogIds: batchLineEventIds
      });
    } else {
      log("memory_organization_empty_summary", {
        scope_type: scope.type,
        source_message_count: batch.length
      });
    }

    memoryStore.markLineEventsProcessedForMemory(
      scope,
      firstLineEventLogId,
      lastLineEventLogId,
      batchLineEventIds
    );
  }

  async function handleEvent(event, requestId, index, options = {}) {
    const durableJob = options.durableJob || null;
    const context = {
      request_id: requestId,
      webhook_event_id: event.webhookEventId || null,
      event_index: index,
      event_type: event.type,
      message_type: event.message?.type || "none",
      source_type: event.source?.type || "unknown"
    };

    log("webhook_event_received", context);

    const normalizedEvent = normalizeLineEvent(event, requestId, index);
    context.webhook_event_id = normalizedEvent.webhookEventId;
    const saveResult = memoryStore.saveLineEventLog(normalizedEvent);
    const recordRoute = (route, responseMode, modelInput = null, status = "completed", fallbackReason = null) => {
      const pipelineRequest = buildRequestFor(
        normalizedEvent,
        saveResult.id,
        modelInput,
        route,
        responseMode
      );
      recordPipeline(pipelineRequest, {
        jobId: durableJob?.id || null,
        jobType: durableJob?.jobType || "webhook_event",
        status,
        fallbackReason
      });
      return pipelineRequest;
    };

    if (saveResult.duplicate) {
      log("line_event_duplicate_ignored", context);
      recordRoute("duplicate", "none", null, "completed", "duplicate_webhook_event");
      return;
    }

    if (!saveResult.inserted) {
      log("line_event_log_save_failed", context);
      recordRoute("unknown", "none", null, "failed", "line_event_log_save_failed");
      return;
    }

    if (normalizedEvent.eventType === "unsend") {
      memoryStore.markLineMessageUnsent(normalizedEvent.messageId, normalizedEvent.conversationKey);
      recordRoute("unsend", "none");
      return;
    }

    if (!event.replyToken) {
      log("non_text_message_ignored", {
        ...context,
        reason: "missing_reply_token"
      });
      recordRoute("ignored_no_reply_token", "none", normalizedEvent.text);
      return;
    }

    if (!shouldHandleEvent(event)) {
      log("non_text_message_ignored", context);
      recordRoute("ignored_non_text", "none");
      return;
    }

    log("message_type_text", context);

    let modelInput = event.message.text;
    const scope = normalizedEvent.scope;
    let includeGroupMentionContext = false;

    if (isGroupOrRoom(event.source)) {
      log("raw_group_event_saved", {
        ...context,
        storage: "line_event_log"
      });

      if (!isBotMentioned(event.message)) {
        log("group_message_ignored_no_self_mention", context);
        recordRoute("group_no_mention", "none", modelInput);
        return;
      }

      enqueueMemoryOrganization(scope);
      log("group_self_mention_detected", context);
      modelInput = removeSelfMentionFromText(event.message.text, event.message.mention);
      includeGroupMentionContext = true;

      if (!modelInput) {
        log("group_mention_text_empty", context);
        recordRoute("unknown", "reply", modelInput, "completed", "empty_group_mention");
        await sendReply(event.replyToken, "請在 @冥王星 後面加上你要問的內容。", {
          ...context,
          fallback_used: false,
          fallback_reason: "empty_group_mention"
        });
        return;
      }

      log("group_mention_text_forwarded_to_model", context);
    } else {
      log("one_on_one_message_handled", context);
    }

    const memoryCommand = parseMemoryCommand(modelInput);
    if (memoryCommand) {
      recordRoute("memory_command", "reply", modelInput);
      await handleMemoryCommand(memoryCommand, scope, event, context);
      return;
    }

    const searchCommand = parseWebSearchCommand(modelInput);
    if (searchCommand.matched) {
      recordRoute("web_search", "reply", modelInput);
      await handleWebSearchCommand(searchCommand, event, context, {
        lineEventLogId: saveResult.id,
        forcedSearch: true
      });
      return;
    }

    const replySearchDeadlineMs = getReplySearchDeadlineMs();
    const searchDecision = await decideAutoWebSearch(modelInput, context, durableJob, {
      timeoutMs: Math.min(
        config.webSearchDecisionTimeoutMs,
        Math.max(1, getRemainingJobMs(replySearchDeadlineMs))
      )
    });
    if (searchDecision.needsSearch === true) {
      recordRoute("web_search", "reply", modelInput);
      await runReplyWebSearch({
        requestId: context.request_id,
        webhookEventId: context.webhook_event_id,
        eventIndex: context.event_index,
        sourceType: context.source_type,
        replyToken: event.replyToken,
        lineEventLogId: saveResult.id,
        query: modelInput,
        originalQuestion: modelInput,
        searchQuery: getPlannedSearchQuery(modelInput, searchDecision),
        sourcePreference: getSearchSourcePreference(searchDecision),
        forcedSearch: false,
        deadlineMs: replySearchDeadlineMs,
        createdAt: new Date(now()).toISOString(),
        createdAtMs: now()
      }, durableJob);
      return;
    }

    recordRoute("general_chat", "reply_or_push", modelInput);
    await handleGeneralConversation(modelInput, scope, event, context, {
      lineEventLogId: saveResult.id,
      includeGroupMentionContext,
      webSearchPerformed: false,
      searchDecisionReason: searchDecision.reason || "no_search"
    });
  }

  app.use((error, req, res, next) => {
    if (isSignatureValidationError(error)) {
      log("request_failed", {
        name: "SignatureValidationFailed",
        type: "invalid_signature"
      });

      return res.status(401).json({
        ok: false,
        error: "invalid_signature"
      });
    }

    log("request_failed", {
      name: error?.name || "Error",
      type: "internal_error"
    });

    if (res.headersSent) {
      return next(error);
    }

    return res.status(500).json({ ok: false });
  });

  function closeRuntime() {
    for (const { timer } of durableRetryTimers.values()) {
      clearRetryTimeout(timer);
    }
    durableRetryTimers.clear();
    if (typeof gatewayStore.close === "function") {
      gatewayStore.close();
    }
    return { closed: true };
  }

  return {
    app,
    close: closeRuntime,
    config,
    drainWebhookEventQueue: () => webhookEventQueue,
    drainGeneralReplyQueue: () => generalReplyQueue,
    drainMemoryOrganizationQueue: () => memoryOrganizationQueue,
    drainWebSearchQueue: () => webSearchQueue,
    drainDurableJobs: () => drainDurableJobs(),
    gatewayStore,
    handleEvent,
    runWebSearchJob
  };
}

function startServer() {
  const runtime = createBotRuntime();
  const config = runtime.config || readConfig();

  const server = runtime.app.listen(config.port, () => {
    logEvent("server_started", {
      port: config.port
    });
  });
  runtime.drainDurableJobs();
  return server;
}

if (require.main === module) {
  startServer();
}

module.exports = {
  createBotRuntime,
  isSignatureValidationError,
  normalizeLineEvent,
  parseMemoryCommand,
  redactRawEvent,
  startServer
};
