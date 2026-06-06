const assert = require("node:assert/strict");
const {
  buildPipelineRequest,
  intentForRoute,
  normalizeLineEvent,
  redactRawEvent
} = require("../src/pipelineContract");

function textEvent(text, overrides = {}) {
  return {
    type: "message",
    replyToken: "reply-secret",
    timestamp: 1710000000000,
    source: overrides.source || { type: "user", userId: "U123" },
    message: {
      id: overrides.messageId || "msg-1",
      text,
      type: "text",
      ...(overrides.message || {})
    },
    webhookEventId: overrides.webhookEventId || "event-1"
  };
}

function groupSource() {
  return { groupId: "G123", type: "group", userId: "U123" };
}

function roomSource() {
  return { roomId: "R123", type: "room", userId: "U123" };
}

function mentionMessage(textAfterMention) {
  const mentionText = "@冥王星";
  return {
    mention: {
      mentionees: [{ index: 0, isSelf: true, length: mentionText.length, type: "user" }]
    },
    text: `${mentionText}${textAfterMention ? ` ${textAfterMention}` : ""}`
  };
}

function assertNoPrivateRawEventContent(rawEventJson) {
  assert.equal(rawEventJson.includes("reply-secret"), false);
  assert.equal(rawEventJson.includes("LINE secret text"), false);
  assert.equal(rawEventJson.includes("replyToken"), false);
}

function testUserPipelineRequest() {
  const event = textEvent("LINE secret text", { webhookEventId: "event-user" });
  const normalized = normalizeLineEvent(event, "req-1", 0);
  const pipeline = buildPipelineRequest({
    normalizedEvent: normalized,
    lineEventLogId: 10,
    modelInput: event.message.text,
    route: "general_chat",
    responseMode: "reply_or_push",
    createdAt: "2026-06-05T00:00:00.000Z"
  });

  assert.equal(normalized.webhookEventId, "event-user");
  assert.equal(normalized.sourceType, "user");
  assert.equal(normalized.conversationKey, "user:U123");
  assert.equal(normalized.text, "LINE secret text");
  assertNoPrivateRawEventContent(normalized.rawEventJson);
  assert.equal(pipeline.intent, "general_chat");
  assert.equal(pipeline.risk_level, "unknown");
  assert.equal(pipeline.message.text_chars, "LINE secret text".length);
  assert.equal(pipeline.message.text_hash.length, 64);
  assert.equal(JSON.stringify(pipeline).includes("LINE secret text"), false);
  assert.equal(JSON.stringify(pipeline).includes("reply-secret"), false);
}

function testGroupRoomMentionMetadata() {
  const groupEvent = textEvent("@冥王星 查: 台積電", {
    message: mentionMessage("查: 台積電"),
    source: groupSource(),
    webhookEventId: "event-group"
  });
  const group = normalizeLineEvent(groupEvent, "req-2", 1);
  assert.equal(group.sourceType, "group");
  assert.equal(group.conversationKey, "group:G123");
  assert.equal(group.isMentionedBot, true);

  const roomEvent = textEvent("hello", {
    source: roomSource(),
    webhookEventId: "event-room"
  });
  const room = normalizeLineEvent(roomEvent, "req-3", 0);
  assert.equal(room.sourceType, "room");
  assert.equal(room.conversationKey, "room:R123");
  assert.equal(room.isMentionedBot, false);
}

function testIntentMapping() {
  assert.equal(intentForRoute("memory_command"), "memory_command");
  assert.equal(intentForRoute("web_search"), "web_search_request");
  assert.equal(intentForRoute("general_chat"), "general_chat");
  assert.equal(intentForRoute("ignored_non_text"), "ignored_non_text");
  assert.equal(intentForRoute("ignored_no_reply_token"), "ignored_no_reply_token");
  assert.equal(intentForRoute("group_no_mention"), "group_no_mention");
  assert.equal(intentForRoute("unsend"), "unsend");
  assert.equal(intentForRoute("other"), "unknown");
}

function testRawRedaction() {
  const redacted = redactRawEvent(textEvent("LINE secret text"));
  assert.deepEqual(Object.keys(redacted).sort(), [
    "deliveryIsRedelivery",
    "hasMention",
    "hasText",
    "messageType",
    "sourceType",
    "timestamp",
    "type"
  ]);
  assert.equal(JSON.stringify(redacted).includes("LINE secret text"), false);
  assert.equal(JSON.stringify(redacted).includes("reply-secret"), false);
}

testUserPipelineRequest();
testGroupRoomMentionMetadata();
testIntentMapping();
testRawRedaction();

console.log(
  JSON.stringify({
    status: "PASS",
    pipeline_contract: true,
    no_private_text_in_pipeline_request: true
  })
);
