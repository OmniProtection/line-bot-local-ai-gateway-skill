const crypto = require("node:crypto");
const express = require("express");
const { readConfig, validateConfig } = require("./config");
const { shouldUseDirectModelReply } = require("./directReplyGate");
const {
  createLineClient,
  createLineMiddleware,
  pushText,
  replyText
} = require("./lineClient");
const {
  askLocalModel,
  askLocalModelWithSearchEvidence,
  summarizeGroupMemoryBatch,
  summarizeRollingConversationBatch
} = require("./lmStudioClient");
const { createMemoryStore, getConversationScope, sanitizeMemoryText } = require("./memoryStore");
const { clampReply, shouldHandleEvent } = require("./replyPolicy");
const { errorClass, logEvent } = require("./logger");
const { decideWebSearchRequest, getPushTarget, parseWebSearchCommand } = require("./webSearchCommand");
const { searchWeb } = require("./webSearchService");

const GENERAL_FALLBACK_REPLY = "Sorry, I cannot answer right now. Please try again later.";

function isGroupOrRoom(source) {
  return source?.type === "group" || source?.type === "room";
}

function isBotMentioned(message) {
  const mentionees = message?.mention?.mentionees;
  return Array.isArray(mentionees) && mentionees.some((mentionee) => mentionee?.isSelf === true);
}

function hashText(text) {
  if (typeof text !== "string" || text.length === 0) {
    return null;
  }

  return crypto.createHash("sha256").update(text).digest("hex");
}

function safeJson(value) {
  if (value === undefined || value === null) {
    return null;
  }

  return JSON.stringify(value);
}

function redactMention(mention) {
  const mentionees = Array.isArray(mention?.mentionees) ? mention.mentionees : [];
  return {
    mentionees: mentionees.map((mentionee) => ({
      type: mentionee?.type || "unknown",
      index: Number.isInteger(mentionee?.index) ? mentionee.index : null,
      length: Number.isInteger(mentionee?.length) ? mentionee.length : null,
      isSelf: mentionee?.isSelf === true
    }))
  };
}

function redactRawEvent(event) {
  return {
    type: event?.type || "unknown",
    timestamp: Number(event?.timestamp) || 0,
    sourceType: event?.source?.type || "unknown",
    messageType: event?.message?.type || null,
    hasText: typeof event?.message?.text === "string",
    hasMention: Boolean(event?.message?.mention),
    deliveryIsRedelivery: event?.deliveryContext?.isRedelivery === true
  };
}

function buildFallbackWebhookEventId(event, scope, sourceType, messageId, index) {
  const timestamp = Number(event?.timestamp);
  const eventType = event?.type || "unknown";
  const conversationKey = scope?.key || `${sourceType || "unknown"}:unknown`;
  const stableParts = messageId
    ? [eventType, sourceType || "unknown", conversationKey, messageId]
    : [
        eventType,
        Number.isFinite(timestamp) ? String(timestamp) : "0",
        sourceType || "unknown",
        conversationKey,
        event?.message?.type || "none",
        Number.isInteger(index) ? String(index) : "0"
      ];
  const digest = crypto.createHash("sha256").update(stableParts.join("\u001f")).digest("hex");
  return `missing:${digest.slice(0, 32)}`;
}

function normalizeLineEvent(event, requestId, index) {
  const scope = getConversationScope(event.source);
  const sourceType = event.source?.type || "unknown";
  const message = event.message || {};
  const messageText = event.type === "message" && message.type === "text" ? message.text : null;
  const messageId = message.id || event.unsend?.messageId || null;
  const fallbackEventId = buildFallbackWebhookEventId(event, scope, sourceType, messageId, index);

  return {
    webhookEventId: event.webhookEventId || fallbackEventId,
    eventType: event.type || "unknown",
    timestamp: Number(event.timestamp) || Date.now(),
    deliveryIsRedelivery: event.deliveryContext?.isRedelivery === true,
    sourceType,
    conversationKey: scope?.key || `${sourceType}:unknown`,
    senderUserId: event.source?.userId || null,
    groupId: event.source?.groupId || null,
    roomId: event.source?.roomId || null,
    messageId,
    messageType: message.type || null,
    text: messageText,
    textHash: hashText(messageText),
    isMentionedBot: isBotMentioned(message),
    mentionJson: message.mention ? safeJson(redactMention(message.mention)) : null,
    quotedMessageId: message.quotedMessageId || null,
    rawEventJson: safeJson(redactRawEvent(event)),
    scope
  };
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
  const log = deps.logEvent || logEvent;
  const now = deps.now || (() => Date.now());
  const middlewareFactory = deps.createLineMiddleware || createLineMiddleware;
  const services = {
    askLocalModel: deps.askLocalModel || askLocalModel,
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

    res.status(200).end();

    for (const [index, event] of events.entries()) {
      enqueueWebhookEvent(event, requestId, index);
    }
  });

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

  function enqueueWebhookEvent(event, requestId, index) {
    webhookEventQueue = webhookEventQueue
      .then(() => handleEvent(event, requestId, index))
      .catch((error) => {
        log("webhook_event_processing_error", {
          request_id: requestId,
          event_index: index,
          error_class: errorClass(error)
        });
      });
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

    memoryOrganizationQueue = memoryOrganizationQueue
      .then(() => organizePendingMemory(scope))
      .catch((error) => {
        log("memory_organization_error", {
          error_class: errorClass(error)
        });
      });
  }

  function enqueueRollingSummary(scope) {
    if (!scope) {
      return;
    }

    memoryOrganizationQueue = memoryOrganizationQueue
      .then(() => updateRollingSummary(scope))
      .catch((error) => {
        log("rolling_summary_error", {
          error_class: errorClass(error)
        });
      });
  }

  function enqueueWebSearchJob(job) {
    log("web_search_job_queued", {
      request_id: job.requestId,
      event_index: job.eventIndex,
      source_type: job.sourceType,
      query_chars: job.query.length
    });

    webSearchQueue = webSearchQueue
      .then(() => runWebSearchJob(job))
      .catch((error) => {
        log("web_search_job_error", {
          request_id: job.requestId,
          event_index: job.eventIndex,
          error_class: errorClass(error)
        });
      });
  }

  function enqueueGeneralReplyJob(job) {
    log("general_reply_job_queued", {
      request_id: job.requestId,
      event_index: job.eventIndex,
      source_type: job.sourceType,
      input_chars: job.modelInput.length
    });

    generalReplyQueue = generalReplyQueue
      .then(() => runGeneralReplyJob(job))
      .catch((error) => {
        log("general_reply_job_error", {
          request_id: job.requestId,
          event_index: job.eventIndex,
          error_class: errorClass(error)
        });
      });
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

  async function runWebSearchJob(job) {
    const startedAt = now();
    const deadlineMs = getJobDeadlineMs(job);
    const context = {
      request_id: job.requestId,
      event_index: job.eventIndex,
      source_type: job.sourceType,
      query_chars: job.query.length
    };

    log("web_search_job_started", context);

    try {
      if (getRemainingJobMs(deadlineMs) <= 0) {
        await sendPush(
          job.pushTarget,
          formatSearchFailure("timeout"),
          {
            ...context,
            fallback_used: true,
            fallback_reason: "timeout"
          },
          "web_search_push_failed"
        );
        return;
      }

      const searchDeadlineMs = getSearchDeadlineMs(deadlineMs);
      const searchResult = await services.searchWeb(job.query, config, {
        deadlineMs: searchDeadlineMs,
        now
      });
      if (!searchResult.ok) {
        await sendPush(
          job.pushTarget,
          formatSearchFailure(searchResult.reason),
          {
            ...context,
            fallback_used: true,
            fallback_reason: searchResult.reason
          },
          "web_search_push_failed"
        );
        return;
      }

      const remainingForModelMs = getRemainingJobMs(deadlineMs);
      if (remainingForModelMs <= 0) {
        await sendPush(
          job.pushTarget,
          formatSearchFailure("timeout"),
          {
            ...context,
            fallback_used: true,
            fallback_reason: "timeout"
          },
          "web_search_push_failed"
        );
        return;
      }

      const modelResult = await services.askLocalModelWithSearchEvidence(
        job.query,
        searchResult.evidence,
        config,
        {
          deadlineMs,
          timeoutMs: remainingForModelMs
        }
      );
      const fallbackReason = modelResult.reason;
      const reply = clampReply(modelResult.text, getWebSearchReplyLimit());

      await sendPush(
        job.pushTarget,
        reply,
        {
          ...context,
          fallback_used: modelResult.fallbackUsed,
          fallback_reason: fallbackReason,
          evidence_count: searchResult.evidence.length
        },
        "web_search_push_failed"
      );

      log("web_search_job_completed", {
        ...context,
        duration_ms: now() - startedAt,
        evidence_count: searchResult.evidence.length
      });
    } catch (error) {
      const reason = errorClass(error) === "timeout" ? "timeout" : "error";
      log("web_search_job_error", {
        ...context,
        error_class: errorClass(error),
        duration_ms: now() - startedAt
      });
      await sendPush(
        job.pushTarget,
        formatSearchFailure(reason),
        {
          ...context,
          fallback_used: true,
          fallback_reason: reason
        },
        "web_search_push_failed"
      );
    }
  }

  async function runGeneralReplyJob(job) {
    const startedAt = now();
    const context = {
      request_id: job.requestId,
      event_index: job.eventIndex,
      source_type: job.sourceType,
      input_chars: job.modelInput.length
    };

    log("general_reply_job_started", context);

    try {
      const memoryContext = memoryStore.loadRelevantMemoryContext(job.scope, job.modelInput, {
        excludeLineEventLogId: job.lineEventLogId
      });
      const modelResult = await services.askLocalModel(job.modelInput, config, memoryContext);
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

      log("general_reply_job_completed", {
        ...context,
        duration_ms: now() - startedAt,
        push_ok: pushOk,
        fallback_used: modelResult.fallbackUsed,
        fallback_reason: modelResult.reason
      });
    } catch (error) {
      const reason = errorClass(error);
      log("general_reply_job_error", {
        ...context,
        error_class: reason,
        duration_ms: now() - startedAt
      });
      await sendPush(job.pushTarget, GENERAL_FALLBACK_REPLY, {
        ...context,
        fallback_used: true,
        fallback_reason: reason
      });
    }
  }

  async function handleWebSearchCommand(searchCommand, event, context) {
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

    await sendReply(event.replyToken, config.webSearchPendingReplyText, {
      ...context,
      fallback_used: false,
      fallback_reason: "web_search_pending"
    });

    enqueueWebSearchJob({
      requestId: context.request_id,
      eventIndex: context.event_index,
      sourceType: context.source_type,
      pushTarget: decision.pushTarget,
      query: decision.query,
      createdAt: new Date(now()).toISOString(),
      createdAtMs: now()
    });
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
      eventIndex: context.event_index,
      sourceType: context.source_type,
      pushTarget,
      modelInput,
      scope,
      lineEventLogId: memoryOptions.lineEventLogId,
      createdAt: new Date(now()).toISOString(),
      createdAtMs: now()
    });
  }

  async function updateRollingSummary(scope) {
    const batch = memoryStore.getPendingRollingSummaryBatch(scope);
    if (batch.length === 0) {
      return;
    }

    const existingSummary = memoryStore.getConversationSummary(scope);
    const result = await services.summarizeRollingConversationBatch(batch, existingSummary, config);

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

      const memoryContext = memoryStore.loadRelevantMemoryContext(scope, modelInput, {
        excludeLineEventLogId: memoryOptions.lineEventLogId
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
          reason: errorClass(error)
        };
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

  async function organizePendingMemory(scope) {
    const batch = memoryStore.getPendingAutoMemoryBatch(scope);
    if (batch.length === 0) {
      return;
    }

    const firstLineEventLogId = batch[0].id;
    const lastLineEventLogId = batch[batch.length - 1].id;
    const result = await services.summarizeGroupMemoryBatch(batch, config);

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

  async function handleEvent(event, requestId, index) {
    const context = {
      request_id: requestId,
      event_index: index,
      event_type: event.type,
      message_type: event.message?.type || "none",
      source_type: event.source?.type || "unknown"
    };

    log("webhook_event_received", context);

    const normalizedEvent = normalizeLineEvent(event, requestId, index);
    const saveResult = memoryStore.saveLineEventLog(normalizedEvent);
    if (saveResult.duplicate) {
      log("line_event_duplicate_ignored", context);
      return;
    }

    if (!saveResult.inserted) {
      log("line_event_log_save_failed", context);
      return;
    }

    if (normalizedEvent.eventType === "unsend") {
      memoryStore.markLineMessageUnsent(normalizedEvent.messageId, normalizedEvent.conversationKey);
      return;
    }

    if (!event.replyToken) {
      log("non_text_message_ignored", {
        ...context,
        reason: "missing_reply_token"
      });
      return;
    }

    if (!shouldHandleEvent(event)) {
      log("non_text_message_ignored", context);
      return;
    }

    log("message_type_text", context);

    let modelInput = event.message.text;
    const scope = normalizedEvent.scope;

    if (isGroupOrRoom(event.source)) {
      log("raw_group_event_saved", {
        ...context,
        storage: "line_event_log"
      });

      if (!isBotMentioned(event.message)) {
        log("group_message_ignored_no_self_mention", context);
        return;
      }

      enqueueMemoryOrganization(scope);
      log("group_self_mention_detected", context);
      modelInput = removeSelfMentionFromText(event.message.text, event.message.mention);

      if (!modelInput) {
        log("group_mention_text_empty", context);
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
      await handleMemoryCommand(memoryCommand, scope, event, context);
      return;
    }

    const searchCommand = parseWebSearchCommand(modelInput);
    if (searchCommand.matched) {
      await handleWebSearchCommand(searchCommand, event, context);
      return;
    }

    await handleGeneralConversation(modelInput, scope, event, context, {
      lineEventLogId: saveResult.id
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

  return {
    app,
    config,
    drainWebhookEventQueue: () => webhookEventQueue,
    drainGeneralReplyQueue: () => generalReplyQueue,
    drainMemoryOrganizationQueue: () => memoryOrganizationQueue,
    drainWebSearchQueue: () => webSearchQueue,
    handleEvent,
    runWebSearchJob
  };
}

function startServer() {
  const runtime = createBotRuntime();
  const config = runtime.config || readConfig();

  return runtime.app.listen(config.port, () => {
    logEvent("server_started", {
      port: config.port
    });
  });
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
