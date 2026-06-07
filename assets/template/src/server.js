const express = require("express");
const { createToolPlan, parseConfirmationCommand } = require("./agentLite");
const { registerAdminRoutes } = require("./adminApi");
const { createConfirmationStore } = require("./confirmationStore");
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
const { buildContextPackage } = require("./contextBuilder");
const { createHandoffStore } = require("./handoffStore");
const { createKnowledgeBaseStore } = require("./knowledgeBaseStore");
const { createMemoryStore, sanitizeMemoryText } = require("./memoryStore");
const { validateModelOutput } = require("./outputValidator");
const {
  buildPipelineRequest,
  isBotMentioned,
  normalizeLineEvent: normalizePipelineLineEvent,
  redactRawEvent: redactPipelineRawEvent
} = require("./pipelineContract");
const { decideIntentRoute } = require("./intentRouter");
const { evaluateToolPermission } = require("./permissionGate");
const { evaluatePolicy } = require("./policyGate");
const { clampReply, shouldHandleEvent } = require("./replyPolicy");
const { errorClass, logEvent } = require("./logger");
const { createToolRegistry } = require("./toolRegistry");
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
  const knowledgeBaseStore =
    deps.knowledgeBaseStore ||
    createKnowledgeBaseStore(
      deps.memoryStore && !deps.knowledgeBaseStorePath ? ":memory:" : deps.knowledgeBaseStorePath
    );
  const handoffStore =
    deps.handoffStore ||
    createHandoffStore(
      deps.memoryStore && !deps.handoffStorePath ? ":memory:" : deps.handoffStorePath
    );
  const confirmationStore =
    deps.confirmationStore ||
    createConfirmationStore(
      deps.memoryStore && !deps.confirmationStorePath ? ":memory:" : deps.confirmationStorePath
    );
  const gatewayStore =
    deps.gatewayStore ||
    createGatewayStore(deps.memoryStore && !deps.gatewayStorePath ? ":memory:" : deps.gatewayStorePath);
  const toolRegistry = deps.toolRegistry || createToolRegistry();
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
  const volatileReplyTokens = new Map();

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
    evidenceCount = 0,
    handoffTriggered = false
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
      handoffTriggered: handoffTriggered === true || modelResult?.handoffTriggered === true,
      status:
        modelResult?.fallbackUsed === true || modelResult?.ok === false
          ? modelResult?.reason || "fallback"
          : "success",
      createdAt: nowIso()
    });
  }

  function getKnowledgeEvidence(memoryContext) {
    return Array.isArray(memoryContext?.knowledgeContext) ? memoryContext.knowledgeContext : [];
  }

  registerAdminRoutes(app, {
    config,
    handoffStore,
    toolRegistry,
    askLocalModel: services.askLocalModel,
    recordLlmCall,
    nowIso
  });

  function createHandoffTicket({
    triggerType,
    triggerReason,
    priority = "normal",
    scope = null,
    modelInput = "",
    routeDecision = null,
    policyDecision = null,
    context = {},
    lineEventLogId = null,
    dedupeSuffix = ""
  } = {}) {
    if (config.humanHandoffEnabled !== true) {
      return null;
    }

    const result = handoffStore.createTicket({
      triggerType,
      triggerReason,
      priority,
      scopeType: scope?.type || null,
      conversationKey: scope?.key || null,
      questionText: modelInput,
      inputChars: String(modelInput || "").length,
      routeIntent: routeDecision?.intent || context.intent || "unknown",
      inputStyle: routeDecision?.input_style || "unknown",
      riskLevel: policyDecision?.risk_level || context.risk_level || "unknown",
      contextSnapshot: {
        request_id: context.request_id || null,
        webhook_event_id: context.webhook_event_id || null,
        event_index: context.event_index ?? null,
        source_type: context.source_type || null,
        line_event_log_id: lineEventLogId || null
      },
      dedupeKey: [
        triggerType || "handoff",
        scope?.key || "unknown",
        context.webhook_event_id || context.request_id || "unknown",
        dedupeSuffix || String(modelInput || "").length
      ].join(":"),
      actor: "system",
      createdAt: nowIso()
    });
    log("handoff_ticket_created", {
      request_id: context.request_id || null,
      webhook_event_id: context.webhook_event_id || null,
      ticket_id: result.ticket?.ticketId || null,
      inserted: result.inserted === true,
      duplicate: result.duplicate === true,
      trigger_type: triggerType,
      trigger_reason: triggerReason,
      input_chars: String(modelInput || "").length
    });
    return result;
  }

  function getLineActorId(source = {}) {
    return source.userId || source.groupId || source.roomId || "unknown";
  }

  function formatConfirmationRequest(confirmation) {
    return clampReply(
      [
        `請確認是否執行：${confirmation.userVisibleSummary || confirmation.toolName}`,
        `確認碼：${confirmation.code}`,
        `回覆「確認 ${confirmation.code}」執行，或「取消 ${confirmation.code}」取消。`
      ].join("\n"),
      config.maxReplyChars
    );
  }

  function formatConfirmationResult(result) {
    if (result.status === "not_found") {
      return "找不到這個確認碼。";
    }
    if (result.status === "expired") {
      return "這個確認碼已過期，請重新建立。";
    }
    if (result.status === "cancelled") {
      return result.ok ? "已取消。" : "這個確認碼已取消。";
    }
    if (result.status === "executed") {
      return "這個確認碼已經執行過。";
    }
    return "確認碼無法使用。";
  }

  function executeConfirmedTool({ confirmation, scope, routeDecision, policyDecision, context, lineEventLogId }) {
    if (confirmation.toolName !== "handoff_ticket_create") {
      return { ok: false, reason: "unsupported_confirmed_tool" };
    }

    const tool = toolRegistry.getTool(confirmation.toolName);
    const permission = evaluateToolPermission({
      tool,
      actor: { type: "line" },
      routeDecision,
      policyDecision,
      payload: confirmation.payload,
      confirmed: true
    });
    if (!permission.allowed) {
      return { ok: false, reason: permission.reason };
    }

    const ticketResult = createHandoffTicket({
      triggerType: "user_confirmed_tool",
      triggerReason: confirmation.payload.triggerReason || "confirmed_handoff_ticket_create",
      priority: "normal",
      scope,
      modelInput: confirmation.payload.questionText || "",
      routeDecision,
      policyDecision,
      context,
      lineEventLogId,
      dedupeSuffix: confirmation.code
    });

    return {
      ok: Boolean(ticketResult?.ticket),
      reason: ticketResult?.ticket ? "ticket_created" : "ticket_create_failed",
      ticket: ticketResult?.ticket || null
    };
  }

  async function handleConfirmationCommand(command, scope, event, context, routeDecision, policyDecision, lineEventLogId) {
    const result = confirmationStore.resolveConfirmation({
      code: command.code,
      conversationKey: scope.key,
      actorId: getLineActorId(event.source),
      action: command.action,
      now: nowIso()
    });

    if (!result.ok || command.action === "cancel") {
      await sendReply(event.replyToken, formatConfirmationResult(result), {
        ...context,
        fallback_used: false,
        fallback_reason: result.reason
      });
      return;
    }

    const execution = executeConfirmedTool({
      confirmation: result.confirmation,
      scope,
      routeDecision,
      policyDecision,
      context,
      lineEventLogId
    });

    await sendReply(
      event.replyToken,
      execution.ok && execution.ticket
        ? `已建立本機工單：${execution.ticket.ticketId}`
        : `無法執行：${execution.reason}`,
      {
        ...context,
        fallback_used: !execution.ok,
        fallback_reason: execution.reason
      }
    );
  }

  async function handleAgentLiteToolPlan(plan, scope, event, context, routeDecision, policyDecision) {
    const tool = toolRegistry.getTool(plan.tool_name);
    const permission = evaluateToolPermission({
      tool,
      actor: { type: "line" },
      routeDecision,
      policyDecision,
      payload: {
        text: plan.arguments?.questionText || "",
        ...plan.arguments
      },
      confirmed: false
    });

    if (permission.requires_confirmation) {
      const confirmation = confirmationStore.createPendingConfirmation({
        toolName: plan.tool_name,
        actorType: "line",
        actorId: getLineActorId(event.source),
        scopeType: scope.type,
        conversationKey: scope.key,
        payload: plan.arguments,
        userVisibleSummary: plan.user_visible_summary,
        createdAt: nowIso()
      });
      await sendReply(event.replyToken, formatConfirmationRequest(confirmation), {
        ...context,
        fallback_used: false,
        fallback_reason: "tool_confirmation_required"
      });
      return;
    }

    if (!permission.allowed) {
      await sendReply(event.replyToken, "這個工具目前不能執行。", {
        ...context,
        fallback_used: true,
        fallback_reason: permission.reason
      });
      return;
    }

    await sendReply(event.replyToken, "這個工具目前不支援直接執行。", {
      ...context,
      fallback_used: true,
      fallback_reason: "direct_tool_execution_not_supported"
    });
  }

  function validateGeneralReply({
    modelInput,
    modelResult,
    memoryContext,
    routeDecision,
    policyDecision,
    context,
    durableJob = null,
    scope = null
  }) {
    const knowledgeEvidence = getKnowledgeEvidence(memoryContext);
    const validation = validateModelOutput({
      modelInput,
      modelOutput: modelResult?.text || "",
      knowledgeEvidence,
      routeDecision,
      policyDecision,
      config
    });

    recordPipeline(
      {
        request_id: context.request_id,
        source: { type: context.source_type || null },
        intent: routeDecision?.intent || context.intent || "unknown",
        risk_level: policyDecision?.risk_level || context.risk_level || "unknown",
        message: { text_chars: String(modelInput || "").length },
        route: "output_validator"
      },
      {
        jobId: durableJob?.id || null,
        jobType: durableJob?.jobType || null,
        stage: "output_validator",
        status: validation.ok ? "completed" : "failed",
        fallbackReason: validation.fallbackUsed ? validation.reason : null,
        outputChars: validation.text.length,
        evidenceCount: validation.evidenceCount
      }
    );

    if (
      validation.fallbackUsed &&
      knowledgeBaseStore &&
      typeof knowledgeBaseStore.recordUnansweredQuestion === "function"
    ) {
      knowledgeBaseStore.recordUnansweredQuestion({
        scopeType: scope?.type || null,
        conversationKey: scope?.key || null,
        questionText: modelInput,
        inputChars: String(modelInput || "").length,
        routeIntent: routeDecision?.intent || "unknown",
        inputStyle: routeDecision?.input_style || "unknown",
        knowledgeHit: validation.evidenceCount > 0,
        validatorReason: validation.reason,
        createdAt: nowIso()
      });
    }
    let handoffTriggered = false;
    if (validation.fallbackUsed) {
      const ticketResult = createHandoffTicket({
        triggerType: "kb_insufficient",
        triggerReason: validation.reason,
        priority: "normal",
        scope,
        modelInput,
        routeDecision,
        policyDecision,
        context,
        lineEventLogId: context.line_event_log_id || null,
        dedupeSuffix: validation.reason
      });
      handoffTriggered = Boolean(ticketResult?.ticket);
    }

    return {
      ...modelResult,
      text: validation.text,
      fallbackUsed: modelResult?.fallbackUsed === true || validation.fallbackUsed === true,
      reason: validation.fallbackUsed ? validation.reason : modelResult?.reason || validation.reason,
      validatorStatus: validation.ok ? "pass" : "fallback",
      validatorReason: validation.reason,
      knowledgeEvidenceCount: validation.evidenceCount,
      handoffTriggered
    };
  }

  function buildRequestFor(
    normalizedEvent,
    lineEventLogId,
    modelInput,
    route,
    responseMode,
    routeDecision = null,
    policyDecision = null
  ) {
    return buildPipelineRequest({
      normalizedEvent,
      lineEventLogId,
      modelInput,
      route,
      responseMode,
      routeDecision,
      policyDecision,
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

  function parseStoredJson(value, fallback = null) {
    if (!value) {
      return fallback;
    }
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }

  function sourceFromLineEventLog(row) {
    const source = { type: row?.source_type || "unknown" };
    if (row?.sender_user_id) {
      source.userId = row.sender_user_id;
    }
    if (row?.group_id) {
      source.groupId = row.group_id;
    }
    if (row?.room_id) {
      source.roomId = row.room_id;
    }
    return source;
  }

  function eventFromLineEventLog(row, replyToken = null) {
    if (!row) {
      return null;
    }

    const event = {
      type: row.event_type || "unknown",
      webhookEventId: row.webhook_event_id,
      timestamp: Number(row.event_timestamp_ms) || Date.now(),
      deliveryContext: {
        isRedelivery: row.delivery_is_redelivery === 1
      },
      source: sourceFromLineEventLog(row)
    };

    if (replyToken) {
      event.replyToken = replyToken;
    }

    if (row.event_type === "unsend") {
      event.unsend = {
        messageId: row.message_id || null
      };
      return event;
    }

    if (row.message_type) {
      event.message = {
        id: row.message_id || undefined,
        type: row.message_type
      };
      if (row.message_type === "text") {
        event.message.text = row.text || "";
      }
      const mention = parseStoredJson(row.mention_json, null);
      if (mention) {
        event.message.mention = mention;
      }
      if (row.quoted_message_id) {
        event.message.quotedMessageId = row.quoted_message_id;
      }
    }

    return event;
  }

  function consumeVolatileReplyToken(webhookEventId, { keep = false } = {}) {
    if (!webhookEventId || !volatileReplyTokens.has(webhookEventId)) {
      return null;
    }
    const replyToken = volatileReplyTokens.get(webhookEventId);
    if (!keep) {
      volatileReplyTokens.delete(webhookEventId);
    }
    return replyToken;
  }

  function forgetVolatileReplyToken(webhookEventId) {
    if (webhookEventId) {
      volatileReplyTokens.delete(webhookEventId);
    }
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
        const webhookEventId = payload.webhookEventId || durableJob.webhookEventId;
        const lineEventLog = memoryStore.getLineEventLogByWebhookId
          ? memoryStore.getLineEventLogByWebhookId(webhookEventId)
          : null;
        const replyToken = consumeVolatileReplyToken(webhookEventId, { keep: true });
        const event = lineEventLog
          ? eventFromLineEventLog(lineEventLog, replyToken)
          : payload.event;
        if (!event) {
          throw new Error("missing_webhook_event_payload");
        }
        await handleEvent(event, payload.requestId || durableJob.requestId, payload.index || 0, {
          durableJob,
          lineEventLogSaveResult: lineEventLog
            ? {
                inserted: true,
                duplicate: false,
                id: lineEventLog.id,
                persisted: true
              }
            : null
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
      if (durableJob.jobType === "webhook_event") {
        forgetVolatileReplyToken(durableJob.webhookEventId || durableJob.payload?.webhookEventId);
      }
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
      if (durableJob.jobType === "webhook_event" && failedJob?.status === "failed") {
        forgetVolatileReplyToken(durableJob.webhookEventId || durableJob.payload?.webhookEventId);
      }
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
    const saveResult = memoryStore.saveLineEventLog(normalizedEvent);
    if (saveResult.duplicate && !saveResult.id) {
      log("line_event_duplicate_ignored", {
        request_id: requestId,
        webhook_event_id: normalizedEvent.webhookEventId,
        event_index: index,
        event_type: normalizedEvent.eventType,
        message_type: normalizedEvent.messageType || "none",
        source_type: normalizedEvent.sourceType
      });
      return {
        inserted: false,
        duplicate: true,
        reason: "duplicate_webhook_event",
        job: null,
        queue: null
      };
    }
    if (saveResult.duplicate) {
      log("line_event_duplicate_requeued", {
        request_id: requestId,
        webhook_event_id: normalizedEvent.webhookEventId,
        line_event_log_id: saveResult.id,
        event_index: index,
        event_type: normalizedEvent.eventType,
        message_type: normalizedEvent.messageType || "none",
        source_type: normalizedEvent.sourceType
      });
    }
    if (!saveResult.inserted && !saveResult.duplicate) {
      log("line_event_log_save_failed", {
        request_id: requestId,
        webhook_event_id: normalizedEvent.webhookEventId,
        event_index: index,
        event_type: normalizedEvent.eventType,
        message_type: normalizedEvent.messageType || "none",
        source_type: normalizedEvent.sourceType
      });
      return {
        inserted: false,
        duplicate: false,
        reason: "line_event_log_save_failed",
        job: null,
        queue: null
      };
    }
    if (event.replyToken) {
      volatileReplyTokens.set(normalizedEvent.webhookEventId, event.replyToken);
    }
    const result = enqueueDurableJob(
      "webhook_event",
      normalizedEvent.webhookEventId,
      {
        webhookEventId: normalizedEvent.webhookEventId,
        lineEventLogId: saveResult.id,
        requestId,
        index
      },
      {
        request_id: requestId,
        webhook_event_id: normalizedEvent.webhookEventId,
        line_event_log_id: saveResult.id,
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

  async function replySearchFailure(replyToken, context, reason, handoffOptions = {}) {
    createHandoffTicket({
      triggerType: "web_search_failure",
      triggerReason: reason || "web_search_failed",
      priority: "normal",
      scope: handoffOptions.scope || null,
      modelInput: handoffOptions.modelInput || "",
      routeDecision: handoffOptions.routeDecision || null,
      policyDecision: handoffOptions.policyDecision || null,
      context,
      lineEventLogId: handoffOptions.lineEventLogId || null,
      dedupeSuffix: reason || "web_search_failed"
    });
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
      line_event_log_id: job.lineEventLogId || null,
      intent: "web_search_request",
      risk_level: "unknown",
      query_chars: String(job.query || "").length,
      search_query_chars: String(job.searchQuery || job.query || "").length,
      source_preference: job.sourcePreference || "general",
      forced_search: job.forcedSearch === true
    };
    const handoffFailureOptions = {
      scope: job.scope,
      modelInput: originalQuestion,
      routeDecision: job.routeDecision || null,
      policyDecision: job.policyDecision || null,
      lineEventLogId: job.lineEventLogId || null
    };

    log("web_search_reply_started", context);

    try {
      if (getRemainingJobMs(deadlineMs) <= 0) {
        await replySearchFailure(job.replyToken, context, "timeout", handoffFailureOptions);
        return { ok: false, reason: "timeout" };
      }

      const searchDeadlineMs = getSearchDeadlineMs(deadlineMs);
      const searchResult = await services.searchWeb(searchQuery, config, {
        deadlineMs: searchDeadlineMs,
        now,
        sourcePreference
      });
      if (!searchResult.ok) {
        await replySearchFailure(
          job.replyToken,
          context,
          searchResult.reason || "search_failed",
          handoffFailureOptions
        );
        return { ok: false, reason: searchResult.reason || "search_failed" };
      }

      const remainingForModelMs = getRemainingJobMs(deadlineMs);
      if (remainingForModelMs <= 0) {
        await replySearchFailure(job.replyToken, context, "timeout", handoffFailureOptions);
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
        await replySearchFailure(
          job.replyToken,
          context,
          modelResult.reason || "search_answer_failed",
          handoffFailureOptions
        );
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
        await replySearchFailure(job.replyToken, context, reason, handoffFailureOptions);
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
    const routeDecision =
      job.routeDecision ||
      decideIntentRoute({
        modelInput: job.modelInput,
        searchPlan: job.searchPlan || null
      });
    const policyDecision =
      job.policyDecision || evaluatePolicy(routeDecision, { modelInput: job.modelInput });
    const context = {
      request_id: job.requestId,
      event_index: job.eventIndex,
      source_type: job.sourceType,
      line_event_log_id: job.lineEventLogId || null,
      intent: routeDecision.intent,
      risk_level: policyDecision.risk_level,
      input_chars: job.modelInput.length
    };

    log("general_reply_job_started", context);

    try {
      const contextPackage = buildContextPackage({
        scope: job.scope,
        modelInput: job.modelInput,
        routeDecision,
        policyDecision,
        lineEventLogId: job.lineEventLogId,
        includeGroupMentionContext: job.includeGroupMentionContext === true,
        memoryStore,
        knowledgeBaseStore,
        config
      });
      const memoryContext = contextPackage.memory_context;
      log("context_builder_completed", {
        ...context,
        stage: "general_reply_job",
        selected_chars: contextPackage.context_stats?.selected_chars || 0,
        selected_estimated_tokens: contextPackage.context_stats?.selected_estimated_tokens || 0,
        truncated: contextPackage.context_stats?.truncated === true,
        section_counts: contextPackage.context_stats?.section_counts || {}
      });
      llmAttempted = true;
      let modelResult = await services.askLocalModel(job.modelInput, config, memoryContext);
      modelResult = validateGeneralReply({
        modelInput: job.modelInput,
        modelResult,
        memoryContext,
        routeDecision,
        policyDecision,
        context,
        durableJob,
        scope: job.scope
      });
      if (modelResult.fallbackUsed && modelResult.validatorStatus !== "fallback") {
        createHandoffTicket({
          triggerType: "model_failure",
          triggerReason: modelResult.reason || "general_reply_fallback",
          priority: "normal",
          scope: job.scope,
          modelInput: job.modelInput,
          routeDecision,
          policyDecision,
          context,
          lineEventLogId: job.lineEventLogId,
          dedupeSuffix: modelResult.reason || "general_reply_fallback"
        });
        modelResult = {
          ...modelResult,
          handoffTriggered: true
        };
      }
      recordLlmCall({
        callType: "general_reply",
        context,
        durableJob,
        scope: job.scope,
        modelInput: job.modelInput,
        modelResult,
        evidenceCount: modelResult.knowledgeEvidenceCount || 0
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
      createHandoffTicket({
        triggerType: "model_failure",
        triggerReason: reason,
        priority: "normal",
        scope: job.scope,
        modelInput: job.modelInput,
        routeDecision,
        policyDecision,
        context,
        lineEventLogId: job.lineEventLogId,
        dedupeSuffix: reason
      });
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
      scope: memoryOptions.scope || null,
      query: decision.query,
      originalQuestion: decision.query,
      searchQuery: searchPlan?.ok === true ? getPlannedSearchQuery(decision.query, searchPlan) : decision.query,
      sourcePreference: searchPlan?.ok === true ? getSearchSourcePreference(searchPlan) : "general",
      forcedSearch: memoryOptions.forcedSearch === true,
      routeDecision: memoryOptions.routeDecision || null,
      policyDecision: memoryOptions.policyDecision || null,
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
      searchPlan: memoryOptions.searchPlan || null,
      routeDecision: memoryOptions.routeDecision || null,
      policyDecision: memoryOptions.policyDecision || null,
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
    context.line_event_log_id = memoryOptions.lineEventLogId || null;
    const pushTarget = getPushTarget(event.source);
    const routeDecision =
      memoryOptions.routeDecision ||
      decideIntentRoute({
        event,
        modelInput,
        searchPlan: memoryOptions.searchPlan || null
      });
    const policyDecision =
      memoryOptions.policyDecision || evaluatePolicy(routeDecision, { modelInput });
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

      const contextPackage = buildContextPackage({
        scope,
        modelInput,
        routeDecision,
        policyDecision,
        lineEventLogId: memoryOptions.lineEventLogId,
        includeGroupMentionContext: memoryOptions.includeGroupMentionContext === true,
        memoryStore,
        knowledgeBaseStore,
        config
      });
      const memoryContext = contextPackage.memory_context;
      log("context_builder_completed", {
        ...context,
        stage: "general_direct_reply",
        selected_chars: contextPackage.context_stats?.selected_chars || 0,
        selected_estimated_tokens: contextPackage.context_stats?.selected_estimated_tokens || 0,
        truncated: contextPackage.context_stats?.truncated === true,
        section_counts: contextPackage.context_stats?.section_counts || {}
      });
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
      if (!modelResult.fallbackUsed) {
        modelResult = validateGeneralReply({
          modelInput,
          modelResult,
          memoryContext,
          routeDecision,
          policyDecision,
          context,
          scope
        });
      }
      recordLlmCall({
        callType: "general_direct_reply",
        context: {
          ...context,
          intent: routeDecision.intent,
          risk_level: policyDecision.risk_level
        },
        scope,
        modelInput,
        modelResult,
        durationMs: now() - directStartedAt,
        evidenceCount: modelResult.knowledgeEvidenceCount || 0
      });

      if (modelResult.validatorStatus === "fallback") {
        const reply = clampReply(modelResult.text, config.maxReplyChars);
        await sendReply(event.replyToken, reply, {
          ...context,
          fallback_used: true,
          fallback_reason: modelResult.validatorReason
        });
        log("general_direct_reply_validator_fallback", {
          ...context,
          duration_ms: now() - directStartedAt,
          fallback_used: true,
          fallback_reason: modelResult.validatorReason
        });
        return;
      }

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

    const normalizedEvent = options.normalizedEvent || normalizeLineEvent(event, requestId, index);
    context.webhook_event_id = normalizedEvent.webhookEventId;
    const saveResult =
      options.lineEventLogSaveResult || memoryStore.saveLineEventLog(normalizedEvent);
    const recordRoute = (
      route,
      responseMode,
      modelInput = null,
      status = "completed",
      fallbackReason = null,
      routeDecision = null,
      policyDecision = null
    ) => {
      const pipelineRequest = buildRequestFor(
        normalizedEvent,
        saveResult.id,
        modelInput,
        route,
        responseMode,
        routeDecision,
        policyDecision
      );
      recordPipeline(pipelineRequest, {
        jobId: durableJob?.id || null,
        jobType: durableJob?.jobType || "webhook_event",
        status,
        fallbackReason
      });
      return pipelineRequest;
    };
    const decideRoutePolicy = (params = {}) => {
      const modelInputForDecision = params.modelInput ?? normalizedEvent.text ?? "";
      const routeDecision = decideIntentRoute({
        event,
        normalizedEvent,
        modelInput: modelInputForDecision,
        hasReplyToken: params.hasReplyToken ?? Boolean(event.replyToken),
        shouldHandle: params.shouldHandle ?? shouldHandleEvent(event),
        memoryCommand: params.memoryCommand || null,
        searchCommand: params.searchCommand || null,
        searchPlan: params.searchPlan || null
      });
      const policyDecision = evaluatePolicy(routeDecision, {
        modelInput: modelInputForDecision,
        sourceType: context.source_type
      });
      return { routeDecision, policyDecision };
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
      const { routeDecision, policyDecision } = decideRoutePolicy({ modelInput: normalizedEvent.text || "" });
      recordRoute("unsend", "none", null, "completed", null, routeDecision, policyDecision);
      return;
    }

    if (!event.replyToken) {
      log("non_text_message_ignored", {
        ...context,
        reason: "missing_reply_token"
      });
      const { routeDecision, policyDecision } = decideRoutePolicy({
        modelInput: normalizedEvent.text || "",
        hasReplyToken: false
      });
      recordRoute(
        "ignored_no_reply_token",
        "none",
        normalizedEvent.text,
        "completed",
        null,
        routeDecision,
        policyDecision
      );
      return;
    }

    if (!shouldHandleEvent(event)) {
      log("non_text_message_ignored", context);
      const { routeDecision, policyDecision } = decideRoutePolicy({
        modelInput: normalizedEvent.text || "",
        shouldHandle: false
      });
      recordRoute("ignored_non_text", "none", null, "completed", null, routeDecision, policyDecision);
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
        const { routeDecision, policyDecision } = decideRoutePolicy({ modelInput });
        recordRoute(
          "group_no_mention",
          "none",
          modelInput,
          "completed",
          null,
          routeDecision,
          policyDecision
        );
        return;
      }

      enqueueMemoryOrganization(scope);
      log("group_self_mention_detected", context);
      modelInput = removeSelfMentionFromText(event.message.text, event.message.mention);
      includeGroupMentionContext = true;

      if (!modelInput) {
        log("group_mention_text_empty", context);
        const routeDecision = decideIntentRoute({
          event,
          normalizedEvent,
          modelInput,
          hasReplyToken: true,
          shouldHandle: true
        });
        const policyDecision = evaluatePolicy(routeDecision, { modelInput, sourceType: context.source_type });
        recordRoute(
          "unknown",
          "reply",
          modelInput,
          "completed",
          "empty_group_mention",
          routeDecision,
          policyDecision
        );
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

    const confirmationCommand = parseConfirmationCommand(modelInput);
    if (confirmationCommand) {
      const { routeDecision, policyDecision } = decideRoutePolicy({ modelInput });
      recordRoute(
        "tool_confirmation",
        "reply",
        modelInput,
        "completed",
        null,
        routeDecision,
        policyDecision
      );
      await handleConfirmationCommand(
        confirmationCommand,
        scope,
        event,
        context,
        routeDecision,
        policyDecision,
        saveResult.id
      );
      return;
    }

    const memoryCommand = parseMemoryCommand(modelInput);
    if (memoryCommand) {
      const { routeDecision, policyDecision } = decideRoutePolicy({ modelInput, memoryCommand });
      recordRoute(
        "memory_command",
        "reply",
        modelInput,
        "completed",
        null,
        routeDecision,
        policyDecision
      );
      await handleMemoryCommand(memoryCommand, scope, event, context);
      return;
    }

    const toolPlan = createToolPlan({ modelInput, registry: toolRegistry });
    if (toolPlan?.ok === true) {
      const { routeDecision, policyDecision } = decideRoutePolicy({ modelInput });
      recordRoute(
        "agent_lite_tool_plan",
        "reply",
        modelInput,
        "completed",
        "tool_confirmation_required",
        routeDecision,
        policyDecision
      );
      await handleAgentLiteToolPlan(toolPlan, scope, event, context, routeDecision, policyDecision);
      return;
    }

    const searchCommand = parseWebSearchCommand(modelInput);
    if (searchCommand.matched) {
      const { routeDecision, policyDecision } = decideRoutePolicy({ modelInput, searchCommand });
      recordRoute("web_search", "reply", modelInput, "completed", null, routeDecision, policyDecision);
      await handleWebSearchCommand(searchCommand, event, context, {
        lineEventLogId: saveResult.id,
        scope,
        forcedSearch: true,
        routeDecision,
        policyDecision
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
      const { routeDecision, policyDecision } = decideRoutePolicy({
        modelInput,
        searchPlan: searchDecision
      });
      recordRoute("web_search", "reply", modelInput, "completed", null, routeDecision, policyDecision);
      await runReplyWebSearch({
        requestId: context.request_id,
        webhookEventId: context.webhook_event_id,
        eventIndex: context.event_index,
        sourceType: context.source_type,
        replyToken: event.replyToken,
        lineEventLogId: saveResult.id,
        scope,
        query: modelInput,
        originalQuestion: modelInput,
        searchQuery: getPlannedSearchQuery(modelInput, searchDecision),
        sourcePreference: getSearchSourcePreference(searchDecision),
        forcedSearch: false,
        routeDecision,
        policyDecision,
        deadlineMs: replySearchDeadlineMs,
        createdAt: new Date(now()).toISOString(),
        createdAtMs: now()
      }, durableJob);
      return;
    }

    const { routeDecision, policyDecision } = decideRoutePolicy({
      modelInput,
      searchPlan: searchDecision
    });
    if (policyDecision.policy_reason === "external_state_mutation_not_allowed") {
      recordRoute(
        "general_chat",
        "reply",
        modelInput,
        "completed",
        "human_handoff_required",
        routeDecision,
        policyDecision
      );
      createHandoffTicket({
        triggerType: "policy_high_risk",
        triggerReason: policyDecision.policy_reason,
        priority: "high",
        scope,
        modelInput,
        routeDecision,
        policyDecision,
        context,
        lineEventLogId: saveResult.id,
        dedupeSuffix: policyDecision.policy_reason
      });
      await sendReply(event.replyToken, config.humanHandoffReplyText, {
        ...context,
        fallback_used: true,
        fallback_reason: "human_handoff_required"
      });
      return;
    }
    recordRoute(
      "general_chat",
      "reply_or_push",
      modelInput,
      "completed",
      null,
      routeDecision,
      policyDecision
    );
    await handleGeneralConversation(modelInput, scope, event, context, {
      lineEventLogId: saveResult.id,
      includeGroupMentionContext,
      webSearchPerformed: false,
      searchDecisionReason: searchDecision.reason || "no_search",
      searchPlan: searchDecision,
      routeDecision,
      policyDecision
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
    if (typeof knowledgeBaseStore.close === "function") {
      knowledgeBaseStore.close();
    }
    if (typeof handoffStore.close === "function") {
      handoffStore.close();
    }
    if (typeof confirmationStore.close === "function") {
      confirmationStore.close();
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
    handoffStore,
    confirmationStore,
    toolRegistry,
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
