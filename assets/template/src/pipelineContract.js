const crypto = require("node:crypto");
const { getConversationScope } = require("./memoryStore");

const DEFAULT_TENANT_ID = "default";

function isGroupOrRoomSource(source) {
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
    requestId,
    eventIndex: Number.isInteger(index) ? index : 0,
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

function intentForRoute(route) {
  const value = String(route || "unknown");
  if (value === "memory_command") {
    return "memory_command";
  }
  if (value === "web_search") {
    return "web_search_request";
  }
  if (value === "general_chat" || value === "general_direct_reply" || value === "general_async_reply") {
    return "general_chat";
  }
  if (value === "ignored_non_text") {
    return "ignored_non_text";
  }
  if (value === "ignored_no_reply_token") {
    return "ignored_no_reply_token";
  }
  if (value === "group_no_mention") {
    return "group_no_mention";
  }
  if (value === "unsend") {
    return "unsend";
  }
  return "unknown";
}

function buildSource(normalizedEvent) {
  return {
    type: normalizedEvent?.sourceType || "unknown",
    user_id_present: Boolean(normalizedEvent?.senderUserId),
    group_id_present: Boolean(normalizedEvent?.groupId),
    room_id_present: Boolean(normalizedEvent?.roomId)
  };
}

function buildMessageMetadata(normalizedEvent, modelInput) {
  const input = typeof modelInput === "string" ? modelInput : normalizedEvent?.text;
  return {
    type: normalizedEvent?.messageType || "none",
    has_text: typeof input === "string" && input.length > 0,
    text_hash: hashText(input),
    text_chars: typeof input === "string" ? input.length : 0,
    is_mentioned_bot: normalizedEvent?.isMentionedBot === true
  };
}

function buildPipelineRequest({
  normalizedEvent,
  lineEventLogId = null,
  modelInput = null,
  route = "unknown",
  responseMode = "none",
  createdAt = new Date().toISOString()
}) {
  const intent = intentForRoute(route);
  return {
    request_id: normalizedEvent?.requestId || "",
    tenant_id: DEFAULT_TENANT_ID,
    webhook_event_id: normalizedEvent?.webhookEventId || "",
    line_event_log_id: Number.isInteger(lineEventLogId) ? lineEventLogId : null,
    source: buildSource(normalizedEvent),
    conversation_scope: {
      type: normalizedEvent?.scope?.type || normalizedEvent?.sourceType || "unknown",
      key: normalizedEvent?.conversationKey || ""
    },
    message: buildMessageMetadata(normalizedEvent, modelInput),
    intent,
    risk_level: "unknown",
    memory_context: {},
    knowledge_evidence: [],
    allowed_tools: [],
    response_mode: responseMode,
    route,
    created_at: createdAt
  };
}

module.exports = {
  DEFAULT_TENANT_ID,
  buildFallbackWebhookEventId,
  buildPipelineRequest,
  hashText,
  intentForRoute,
  isBotMentioned,
  isGroupOrRoomSource,
  normalizeLineEvent,
  redactRawEvent
};
