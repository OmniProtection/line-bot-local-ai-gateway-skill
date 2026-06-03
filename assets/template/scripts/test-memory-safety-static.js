const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} should exist`);

  const bodyStart = source.indexOf("{", start);
  assert.notEqual(bodyStart, -1, `${name} body should start`);

  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, index + 1);
      }
    }
  }

  throw new Error(`${name} body should end`);
}

function extractConstSql(source, name) {
  const marker = `const ${name} = db.prepare(\``;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `${name} SQL should exist`);
  const bodyStart = start + marker.length;
  const end = source.indexOf("`);", bodyStart);
  assert.notEqual(end, -1, `${name} SQL should end`);
  return source.slice(bodyStart, end);
}

function assertIncludes(label, source, needle) {
  assert.ok(source.includes(needle), `${label} should include ${needle}`);
}

function assertExcludes(label, source, needle) {
  assert.ok(!source.includes(needle), `${label} should not include ${needle}`);
}

const memoryStore = read("src/memoryStore.js");
const server = read("src/server.js");
const lineClient = read("src/lineClient.js");
const lmStudioClient = read("src/lmStudioClient.js");
const webSearchCommand = read("src/webSearchCommand.js");

assertIncludes("memoryStore", memoryStore, "CREATE TABLE IF NOT EXISTS line_event_log");
assertIncludes("line_event_log insert", memoryStore, "INSERT OR IGNORE INTO line_event_log");
assertIncludes("line_event_log webhook id", memoryStore, "webhook_event_id TEXT NOT NULL UNIQUE");
assertIncludes("line_event_log timestamp", memoryStore, "event_timestamp_ms INTEGER NOT NULL");
assertIncludes("line_event_log unsent", memoryStore, "is_unsent INTEGER NOT NULL DEFAULT 0");
assertIncludes(
  "line_event_log processed flag",
  memoryStore,
  "processed_for_memory INTEGER NOT NULL DEFAULT 0"
);

for (const redactedKey of [
  '"replyToken"',
  '"text"',
  '"rawEvent"',
  '"rawEventJson"',
  '"requestBody"',
  '"body"'
]) {
  assertIncludes("raw event redaction keys", memoryStore, redactedKey);
}

const redactRawEvent = extractFunction(server, "redactRawEvent");
assertIncludes("server raw event redaction", redactRawEvent, "hasText");
assertIncludes("server raw event redaction", redactRawEvent, "hasMention");
assertExcludes("server raw event redaction", redactRawEvent, "replyToken");
assertExcludes("server raw event redaction", redactRawEvent, "text:");
assertExcludes("server raw event redaction", redactRawEvent, "rawEvent");

const normalizeLineEvent = extractFunction(server, "normalizeLineEvent");
assertIncludes("normalized event raw storage", normalizeLineEvent, "rawEventJson: safeJson(redactRawEvent(event))");

const saveLongTermMemory = extractFunction(memoryStore, "saveLongTermMemory");
assertIncludes("manual long-term memory write", saveLongTermMemory, 'source: "manual"');
assertExcludes("manual long-term memory write", saveLongTermMemory, 'source: "auto"');
assertExcludes("manual long-term memory write", saveLongTermMemory, "source: 'auto'");

const saveAutoGroupMemory = extractFunction(memoryStore, "saveAutoGroupMemory");
assertIncludes("legacy auto memory disabled", saveAutoGroupMemory, "auto_memory_legacy_source_disabled");
assertIncludes("legacy auto memory disabled", saveAutoGroupMemory, "savedCount: 0");
assertExcludes("legacy auto memory disabled", saveAutoGroupMemory, "insertLongTerm");

const selectManualLongTerm = extractConstSql(memoryStore, "selectManualLongTerm");
assertIncludes("manual memory retrieval", selectManualLongTerm, "source = 'manual'");

const selectRecentLineEvents = extractConstSql(memoryStore, "selectRecentLineEvents");
assertIncludes("recent inbound retrieval", selectRecentLineEvents, "FROM line_event_log");
assertIncludes("recent inbound retrieval", selectRecentLineEvents, "source_type IN ('user', 'group', 'room')");
assertIncludes("recent inbound retrieval", selectRecentLineEvents, "id != @exclude_id");
assertIncludes("recent inbound retrieval", selectRecentLineEvents, "is_unsent = 0");
assertIncludes("recent inbound retrieval", selectRecentLineEvents, "ORDER BY event_timestamp_ms DESC");

const selectKeywordLineEvents = extractConstSql(memoryStore, "selectKeywordLineEvents");
assertIncludes("keyword retrieval", selectKeywordLineEvents, "FROM line_event_log");
assertIncludes("keyword retrieval", selectKeywordLineEvents, "source_type IN ('user', 'group', 'room')");
assertIncludes("keyword retrieval", selectKeywordLineEvents, "id != @exclude_id");
assertIncludes("keyword retrieval", selectKeywordLineEvents, "is_unsent = 0");
assertIncludes("keyword retrieval", selectKeywordLineEvents, "ORDER BY event_timestamp_ms DESC");

const selectPendingLineEventBatch = extractConstSql(memoryStore, "selectPendingLineEventBatch");
assertIncludes("background memory extraction", selectPendingLineEventBatch, "FROM line_event_log");
assertIncludes("background memory extraction", selectPendingLineEventBatch, "is_unsent = 0");
assertIncludes("background memory extraction", selectPendingLineEventBatch, "processed_for_memory = 0");
assertIncludes("background memory extraction", selectPendingLineEventBatch, "ORDER BY event_timestamp_ms ASC");

const selectLineEventReadyForMemoryById = extractConstSql(memoryStore, "selectLineEventReadyForMemoryById");
assertIncludes("background memory revalidation", selectLineEventReadyForMemoryById, "is_unsent = 0");
assertIncludes(
  "background memory revalidation",
  selectLineEventReadyForMemoryById,
  "processed_for_memory = 0"
);

const selectOrganizedGroupMemories = extractConstSql(memoryStore, "selectOrganizedGroupMemories");
assertIncludes("organized summary retrieval", selectOrganizedGroupMemories, "is_dirty = 0");
assertIncludes("organized summaries candidate-only", memoryStore, "organized_summary_direct_injection: false");
assertIncludes("generic inbound selected stat", memoryStore, "recent_text_selected_count");
assertExcludes("rolling summary should not use heuristic gate", memoryStore, "shouldIncludeRollingSummaryLayer");
assertExcludes("do not add context hint expansion", memoryStore, '"要看"');
assertExcludes("do not add context hint expansion", memoryStore, '"這個"');
assertIncludes("fixed same-scope context package", memoryStore, "rollingSummary,");

const markLineMessageUnsent = extractFunction(memoryStore, "markLineMessageUnsent");
assertIncludes("unsend handling", markLineMessageUnsent, "markLineMessageUnsentByMessageId.run");
assertIncludes("unsend dirty handling", markLineMessageUnsent, "memory_may_need_rebuild_after_unsend");

const serverAndLineClient = `${server}\n${lineClient}`;
for (const forbidden of ["broadcast", "multicast", "narrowcast"]) {
  assertExcludes("LINE proactive API", serverAndLineClient, forbidden);
}
assertIncludes("controlled Push API wrapper", lineClient, "function pushText");
assertIncludes("controlled Push API wrapper", lineClient, "pushMessage");
assertIncludes("web search Push API gate", webSearchCommand, "webSearchBackgroundPushEnabled");
assertIncludes("web search Push API gate", server, "decideWebSearchRequest(searchCommand, config, event.source)");
assertIncludes("web search Push API gate", server, "handleWebSearchCommand");
assertIncludes("web search Push API use", server, "sendPush(job.pushTarget");
assertIncludes("general reply Push API handoff", server, "async function handleGeneralConversation");
assertIncludes("general reply Push API handoff", server, "config.generalPendingReplyText");
assertIncludes("general reply Push API handoff", server, "enqueueGeneralReplyJob");
assertIncludes("general reply memory gate", server, "if (pushOk && !modelResult.fallbackUsed)");
assertExcludes("server must not call LINE pushMessage directly", server, "pushMessage");

const lineEventLogSavedStart = memoryStore.indexOf('logEvent("line_event_log_saved"');
assert.notEqual(lineEventLogSavedStart, -1, "line_event_log_saved log should exist");
const lineEventLogSavedEnd = memoryStore.indexOf("});", lineEventLogSavedStart);
const lineEventLogSaved = memoryStore.slice(lineEventLogSavedStart, lineEventLogSavedEnd);
for (const forbidden of ["text", "raw_event_json", "rawEventJson", "replyToken", "message_id"]) {
  assertExcludes("line_event_log_saved sanitized logging", lineEventLogSaved, forbidden);
}

let unsendLogSearchStart = 0;
let unsendLogCount = 0;
while (true) {
  const unsendLogStart = memoryStore.indexOf('logEvent("line_message_unsent_marked"', unsendLogSearchStart);
  if (unsendLogStart === -1) {
    break;
  }

  const unsendLogEnd = memoryStore.indexOf("});", unsendLogStart);
  const unsendLog = memoryStore.slice(unsendLogStart, unsendLogEnd);
  for (const forbidden of ["message_id", "messageId", "normalizedMessageId", "text", "raw_event_json"]) {
    assertExcludes("line_message_unsent_marked sanitized logging", unsendLog, forbidden);
  }
  unsendLogCount += 1;
  unsendLogSearchStart = unsendLogEnd + 3;
}
assert.ok(unsendLogCount >= 1, "line_message_unsent_marked logs should exist");

const coreRuntimeSources = `${server}\n${memoryStore}\n${lmStudioClient}`;
for (const forbidden of ["error.stack", "err.stack", "response.text()", "request body"]) {
  assertExcludes("sensitive runtime logging", coreRuntimeSources, forbidden);
}

const handleEvent = extractFunction(server, "handleEvent");
assertIncludes("webhook line event log save", handleEvent, "memoryStore.saveLineEventLog(normalizedEvent)");
assertIncludes("webhook duplicate guard", handleEvent, "line_event_duplicate_ignored");
assertIncludes("webhook unsend handling", handleEvent, "memoryStore.markLineMessageUnsent(");
assertIncludes("webhook raw group event log", handleEvent, "raw_group_event_saved");

console.log(
  JSON.stringify({
    status: "PASS",
    line_event_log_required: true,
    source_auto_write_disabled: true,
    retrieval_excludes_unsent: true,
    background_extraction_excludes_unsent: true,
    push_api_controlled: true
  })
);
