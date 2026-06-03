const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const serverPath = path.resolve(__dirname, "..", "src", "server.js");
const source = fs.readFileSync(serverPath, "utf8");

function find(label, needle, fromIndex = 0) {
  const index = source.indexOf(needle, fromIndex);
  assert.notEqual(index, -1, `${label} should exist`);
  return index;
}

const handleEventStart = find("handleEvent", "async function handleEvent(");
const handleEventEnd = find("handleEvent end", "  app.use((error", handleEventStart);
const handleEventSource = source.slice(handleEventStart, handleEventEnd);

function findInHandle(label, needle, fromIndex = 0) {
  const index = handleEventSource.indexOf(needle, fromIndex);
  assert.notEqual(index, -1, `${label} should exist in handleEvent`);
  return index;
}

function assertBeforeInHandle(beforeLabel, beforeNeedle, afterLabel, afterNeedle) {
  const beforeIndex = findInHandle(beforeLabel, beforeNeedle);
  const afterIndex = findInHandle(afterLabel, afterNeedle);
  assert.ok(beforeIndex < afterIndex, `${beforeLabel} should be before ${afterLabel}`);
}

assertBeforeInHandle(
  "normalizeLineEvent",
  "const normalizedEvent = normalizeLineEvent(event, requestId, index);",
  "saveLineEventLog",
  "const saveResult = memoryStore.saveLineEventLog(normalizedEvent);"
);
assertBeforeInHandle(
  "saveLineEventLog",
  "const saveResult = memoryStore.saveLineEventLog(normalizedEvent);",
  "duplicate guard",
  "if (saveResult.duplicate) {"
);
assertBeforeInHandle(
  "duplicate guard",
  "if (saveResult.duplicate) {",
  "insert failure guard",
  "if (!saveResult.inserted) {"
);
assertBeforeInHandle(
  "insert failure guard",
  "if (!saveResult.inserted) {",
  "unsend guard",
  'if (normalizedEvent.eventType === "unsend") {'
);
assertBeforeInHandle(
  "unsend guard",
  'if (normalizedEvent.eventType === "unsend") {',
  "replyToken guard",
  "if (!event.replyToken) {"
);
assertBeforeInHandle(
  "replyToken guard",
  "if (!event.replyToken) {",
  "text handling guard",
  "if (!shouldHandleEvent(event)) {"
);
assertBeforeInHandle(
  "group raw event log",
  'log("raw_group_event_saved", {',
  "group no mention guard",
  "if (!isBotMentioned(event.message)) {"
);
assertBeforeInHandle(
  "group no mention guard",
  "if (!isBotMentioned(event.message)) {",
  "background extraction enqueue",
  "enqueueMemoryOrganization(scope);"
);
assertBeforeInHandle(
  "background extraction enqueue",
  "enqueueMemoryOrganization(scope);",
  "group mention model branch",
  'log("group_self_mention_detected", context);'
);
assertBeforeInHandle(
  "memory command handling",
  "await handleMemoryCommand(memoryCommand, scope, event, context);",
  "general conversation handoff",
  "await handleGeneralConversation(modelInput, scope, event, context, {"
);

const routeStart = find("webhook route", 'app.post("/webhook"');
const routeEnd = find("sendReply", "async function sendReply", routeStart);
const routeSource = source.slice(routeStart, routeEnd);
const responseEndIndex = routeSource.indexOf("res.status(200).end();");
const enqueueIndex = routeSource.indexOf("enqueueWebhookEvent(event, requestId, index);");
assert.notEqual(responseEndIndex, -1, "webhook route should send HTTP 2xx");
assert.notEqual(enqueueIndex, -1, "webhook route should enqueue event processing");
assert.ok(
  responseEndIndex < enqueueIndex,
  "webhook route should return HTTP 2xx before background event processing"
);

const generalJobStart = find("runGeneralReplyJob", "async function runGeneralReplyJob(");
const generalJobEnd = find("handleWebSearchCommand", "async function handleWebSearchCommand", generalJobStart);
const generalJobSource = source.slice(generalJobStart, generalJobEnd);
assert.ok(
  generalJobSource.includes("services.askLocalModel(job.modelInput, config, memoryContext)"),
  "general reply job should call LM Studio in the background"
);
assert.ok(
  generalJobSource.includes("excludeLineEventLogId: job.lineEventLogId"),
  "general reply job should exclude the current inbound event from memory context"
);
assert.ok(
  generalJobSource.includes("memoryStore.saveShortTermExchange(job.scope, job.modelInput, reply);"),
  "general reply job should preserve short-term memory after final reply"
);
assert.ok(
  generalJobSource.includes("enqueueRollingSummary(job.scope);"),
  "general reply job should enqueue rolling summary after saving conversation turn"
);

const generalHandlerStart = find("handleGeneralConversation", "async function handleGeneralConversation(");
const generalHandlerEnd = find("handleEvent", "async function handleEvent(", generalHandlerStart);
const generalHandlerSource = source.slice(generalHandlerStart, generalHandlerEnd);
const asyncGeneralStart = find(
  "startAsyncGeneralConversation",
  "async function startAsyncGeneralConversation("
);
const asyncGeneralEnd = find("handleGeneralConversation", "async function handleGeneralConversation(");
const asyncGeneralSource = source.slice(asyncGeneralStart, asyncGeneralEnd);
assert.ok(
  asyncGeneralSource.includes("config.generalPendingReplyText"),
  "general conversation should send a pending Reply API message"
);
assert.ok(
  generalHandlerSource.includes("startAsyncGeneralConversation(") &&
    asyncGeneralSource.includes("enqueueGeneralReplyFromEvent("),
  "general conversation should enqueue the final Push API reply"
);
assert.ok(
  generalHandlerSource.includes("enqueueRollingSummary(scope);"),
  "direct general reply should enqueue rolling summary after saving conversation turn"
);

const duplicateGuardStart = findInHandle("duplicate guard", "if (saveResult.duplicate) {");
const duplicateGuardEnd = findInHandle("insert failure guard", "if (!saveResult.inserted) {", duplicateGuardStart);
const duplicateGuardSource = handleEventSource.slice(duplicateGuardStart, duplicateGuardEnd);
assert.ok(duplicateGuardSource.includes("return;"), "duplicate guard should return before model/reply");

const unsendGuardStart = findInHandle("unsend guard", 'if (normalizedEvent.eventType === "unsend") {');
const unsendGuardEnd = findInHandle("replyToken guard", "if (!event.replyToken) {", unsendGuardStart);
const unsendGuardSource = handleEventSource.slice(unsendGuardStart, unsendGuardEnd);
assert.ok(unsendGuardSource.includes("memoryStore.markLineMessageUnsent("), "unsend guard should mark memory");
assert.ok(unsendGuardSource.includes("return;"), "unsend guard should return before reply/model");

const noMentionGuardStart = findInHandle("group no mention guard", "if (!isBotMentioned(event.message)) {");
const noMentionGuardEnd = findInHandle(
  "group mention model branch",
  'log("group_self_mention_detected", context);',
  noMentionGuardStart
);
const noMentionGuardSource = handleEventSource.slice(noMentionGuardStart, noMentionGuardEnd);
assert.ok(noMentionGuardSource.includes("return;"), "group no-mention guard should return before model/reply");
assert.ok(
  noMentionGuardSource.indexOf("return;") <
    noMentionGuardSource.indexOf("enqueueMemoryOrganization(scope);"),
  "group no-mention guard should return before background memory organization"
);

console.log(
  JSON.stringify({
    status: "PASS",
    duplicate_returns_before_model: true,
    unsend_returns_before_reply_token: true,
    group_no_mention_returns_before_background_memory: true,
    group_no_mention_returns_before_model: true,
    webhook_flow_source: "server.js"
  })
);
