const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { createMemoryStore } = require("../src/memoryStore");

const groupScope = {
  key: "group:test-line-event-log",
  type: "group"
};

const userScope = {
  key: "user:test-line-event-log",
  type: "user"
};

function hashText(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function saveEvent(store, overrides = {}) {
  const text = overrides.text === undefined ? "大家在討論專案進度。" : overrides.text;
  return store.saveLineEventLog({
    webhookEventId:
      overrides.webhookEventId === undefined ? `event-${Date.now()}-${Math.random()}` : overrides.webhookEventId,
    eventType: overrides.eventType === undefined ? "message" : overrides.eventType,
    timestamp: overrides.timestamp === undefined ? 1700000000000 : overrides.timestamp,
    deliveryIsRedelivery: Boolean(overrides.deliveryIsRedelivery),
    sourceType: overrides.sourceType === undefined ? "group" : overrides.sourceType,
    conversationKey: overrides.conversationKey === undefined ? groupScope.key : overrides.conversationKey,
    senderUserId: overrides.senderUserId === undefined ? "user-test" : overrides.senderUserId,
    groupId: overrides.groupId === undefined ? "test-line-event-log" : overrides.groupId,
    roomId: overrides.roomId === undefined ? null : overrides.roomId,
    messageId: overrides.messageId === undefined ? "message-test" : overrides.messageId,
    messageType: overrides.messageType === undefined ? "text" : overrides.messageType,
    text,
    textHash: text ? hashText(text) : null,
    isMentionedBot: Boolean(overrides.isMentionedBot),
    mentionJson: overrides.isMentionedBot
      ? JSON.stringify({ mentionees: [{ index: 0, length: 4, isSelf: true }] })
      : null,
    quotedMessageId: overrides.quotedMessageId === undefined ? null : overrides.quotedMessageId,
    rawEventJson:
      overrides.rawEventJson === undefined
        ? JSON.stringify({
            type: overrides.eventType === undefined ? "message" : overrides.eventType,
            messageType: overrides.messageType === undefined ? "text" : overrides.messageType,
            hasText: Boolean(text)
          })
        : overrides.rawEventJson
  });
}

function run() {
  const store = createMemoryStore(":memory:", { enableTestHelpers: true });

  const inserted = saveEvent(store, {
    webhookEventId: "normal-1",
    messageId: "message-normal-1",
    text: "大家在討論專案進度。"
  });
  assert.equal(inserted.inserted, true, "normal text event should insert");
  assert.equal(store.countLineEventLog(), 1, "line_event_log count should increase");

  const duplicate = saveEvent(store, {
    webhookEventId: "normal-1",
    messageId: "message-normal-1",
    text: "大家在討論專案進度。"
  });
  assert.equal(duplicate.duplicate, true, "duplicate webhookEventId should be ignored");
  assert.equal(store.countLineEventLog(), 1, "duplicate should not increase count");

  const invalid = store.saveLineEventLog({
    webhookEventId: "",
    eventType: "message",
    timestamp: Number.NaN,
    sourceType: "group",
    conversationKey: groupScope.key
  });
  assert.equal(invalid.inserted, false, "invalid event should not insert");
  assert.equal(invalid.duplicate, false, "invalid event is not a duplicate");

  saveEvent(store, {
    webhookEventId: "redaction-1",
    messageId: "message-redaction-1",
    text: "這段文字只能保存在 text 欄位，不得重複保存在 raw JSON。",
    rawEventJson: JSON.stringify({
      replyToken: "secret-reply-token",
      body: { events: [{ message: { text: "raw secret body text" } }] },
      message: { type: "text", text: "raw secret message text" },
      source: { type: "group" }
    })
  });
  const redacted = store.readLineEventLogByWebhookId("redaction-1");
  assert.equal(
    redacted.raw_event_json.includes("secret-reply-token"),
    false,
    "raw_event_json should redact replyToken"
  );
  assert.equal(
    redacted.raw_event_json.includes("raw secret"),
    false,
    "raw_event_json should redact message/request text"
  );

  saveEvent(store, {
    webhookEventId: "older-order",
    messageId: "message-order-old",
    timestamp: 1700000001000,
    text: "排序測試 舊訊息 討論部署。"
  });
  saveEvent(store, {
    webhookEventId: "newer-order",
    messageId: "message-order-new",
    timestamp: 1700000003000,
    text: "排序測試 新訊息 討論部署。"
  });
  const ordered = store.loadRelevantMemoryContext(groupScope, "剛剛排序測試大家在聊什麼？");
  assert.match(
    ordered.evidence[0]?.content || "",
    /新訊息/,
    "recent group retrieval should prefer event_timestamp_ms ordering"
  );

  const beforeAutoCount = store.countLegacyAutoMemories(groupScope);
  const noMention = saveEvent(store, {
    webhookEventId: "group-no-mention",
    messageId: "message-no-mention",
    text: "這是沒有提及機器人的群組原始事件。"
  });
  assert.equal(noMention.inserted, true, "group no-mention raw event should be logged");
  assert.deepEqual(
    store.getActiveLineEventIdsForMemory(groupScope, [noMention.id]),
    [noMention.id],
    "active memory extraction revalidation should include normal raw events"
  );
  store.saveAutoGroupMemory(groupScope, "legacy auto memory should not be written");
  assert.equal(
    store.countLegacyAutoMemories(groupScope),
    beforeAutoCount,
    "new group raw chat should not write long_term_memories source=auto"
  );

  saveEvent(store, {
    webhookEventId: "mention-1",
    messageId: "message-mention-1",
    text: "@冥王星 本群偏好什麼語言？",
    isMentionedBot: true
  });
  const mentionContext = store.loadRelevantMemoryContext(groupScope, "本群偏好什麼語言？");
  assert.equal(
    mentionContext.stats.organized_summary_direct_injection,
    false,
    "organized summaries must remain candidate-only"
  );

  const unsent = saveEvent(store, {
    webhookEventId: "unsent-source",
    messageId: "message-unsent",
    timestamp: 1700000004000,
    text: "收回測試 專案密碼是測試文字。"
  });
  store.saveOrganizedGroupMemory(groupScope, "收回測試 這段摘要應該變 dirty。", {
    sourceMessageCount: 1,
    firstSourceId: unsent.id,
    lastSourceId: unsent.id,
    sourceFirstEventLogId: unsent.id,
    sourceLastEventLogId: unsent.id,
    sourceLineEventLogIds: [unsent.id]
  });
  saveEvent(store, {
    webhookEventId: "unsent-event",
    eventType: "unsend",
    messageId: "message-unsent",
    messageType: null,
    timestamp: 1700000005000,
    text: null
  });
  const unsendResult = store.markLineMessageUnsent("message-unsent");
  assert.equal(unsendResult.found, true, "unsend should find original message");
  assert.equal(unsendResult.affectedEventCount, 1, "unsend should mark the original message event only");
  const afterUnsend = store.loadRelevantMemoryContext(groupScope, "收回測試 剛剛大家在聊什麼？");
  assert.equal(
    afterUnsend.evidence.some((item) => item.content.includes("專案密碼")),
    false,
    "retrieval should exclude unsent raw event"
  );
  assert.equal(
    afterUnsend.evidence.some((item) => item.content.includes("應該變 dirty")),
    false,
    "retrieval should exclude dirty organized summary"
  );
  const pendingAfterUnsend = store.getPendingAutoMemoryBatch(groupScope, 1, 50);
  assert.equal(
    pendingAfterUnsend.some((item) => item.content.includes("專案密碼")),
    false,
    "background extraction should exclude unsent raw event"
  );
  assert.deepEqual(
    store.getActiveLineEventIdsForMemory(groupScope, [unsent.id]),
    [],
    "active memory extraction revalidation should exclude unsent raw events"
  );

  saveEvent(store, {
    webhookEventId: "early-unsend-event",
    eventType: "unsend",
    messageId: "message-early-unsend",
    messageType: null,
    timestamp: 1700000003990,
    text: null
  });
  const earlyUnsendResult = store.markLineMessageUnsent("message-early-unsend");
  assert.equal(earlyUnsendResult.found, false, "early unsend may arrive before original message");
  assert.equal(
    earlyUnsendResult.affectedEventCount,
    0,
    "early unsend should not count the unsend marker as an affected original event"
  );
  const lateOriginal = saveEvent(store, {
    webhookEventId: "late-original-after-unsend",
    messageId: "message-early-unsend",
    timestamp: 1700000003980,
    text: "先收回後補到的原始訊息不能進記憶。"
  });
  assert.equal(lateOriginal.inserted, true, "late original message should still be logged");
  const lateOriginalRow = store.readLineEventLogByWebhookId("late-original-after-unsend");
  assert.equal(lateOriginalRow.is_unsent, 1, "late original message should inherit prior unsend marker");
  const lateOriginalContext = store.loadRelevantMemoryContext(groupScope, "先收回後補到 剛剛大家在聊什麼？");
  assert.equal(
    lateOriginalContext.evidence.some((item) => item.content.includes("先收回後補到")),
    false,
    "retrieval should exclude original messages inserted after an earlier unsend"
  );
  const pendingAfterEarlyUnsend = store.getPendingAutoMemoryBatch(groupScope, 1, 50);
  assert.equal(
    pendingAfterEarlyUnsend.some((item) => item.content.includes("先收回後補到")),
    false,
    "background extraction should exclude original messages inserted after an earlier unsend"
  );
  assert.deepEqual(
    store.getActiveLineEventIdsForMemory(groupScope, [lateOriginal.id]),
    [],
    "active memory extraction revalidation should exclude late originals after earlier unsend"
  );

  saveEvent(store, {
    webhookEventId: "scoped-unsend-marker",
    eventType: "unsend",
    messageId: "message-shared-unsend-marker",
    messageType: null,
    timestamp: 1700000003995,
    text: null
  });
  const crossScopeOriginal = saveEvent(store, {
    webhookEventId: "cross-scope-original-after-unsend",
    sourceType: "user",
    conversationKey: userScope.key,
    senderUserId: "user-cross-scope",
    groupId: null,
    messageId: "message-shared-unsend-marker",
    timestamp: 1700000003996,
    text: "另一個 conversation 的同 messageId 不應被收回標記污染。"
  });
  assert.equal(crossScopeOriginal.inserted, true, "cross-scope original should still be logged");
  assert.equal(
    store.readLineEventLogByWebhookId("cross-scope-original-after-unsend").is_unsent,
    0,
    "prior unsend markers should be scoped by conversation_key"
  );

  const sharedGroupOriginal = saveEvent(store, {
    webhookEventId: "shared-scope-group-original",
    messageId: "message-shared-scope",
    timestamp: 1700000003997,
    text: "同 messageId 群組原始訊息。"
  });
  saveEvent(store, {
    webhookEventId: "shared-scope-user-original",
    sourceType: "user",
    conversationKey: userScope.key,
    senderUserId: "user-shared-scope",
    groupId: null,
    messageId: "message-shared-scope",
    timestamp: 1700000003998,
    text: "同 messageId 私訊原始訊息。"
  });
  const scopedUnsendResult = store.markLineMessageUnsent("message-shared-scope", groupScope.key);
  assert.equal(scopedUnsendResult.affectedEventCount, 1, "scoped unsend should only mark one conversation");
  assert.equal(
    store.readLineEventLogByWebhookId("shared-scope-group-original").is_unsent,
    1,
    "scoped unsend should mark the matching group event"
  );
  assert.equal(
    store.readLineEventLogByWebhookId("shared-scope-user-original").is_unsent,
    0,
    "scoped unsend should not mark other conversations with the same messageId"
  );
  assert.deepEqual(
    store.getActiveLineEventIdsForMemory(groupScope, [sharedGroupOriginal.id]),
    [],
    "active memory extraction revalidation should respect scoped unsend marks"
  );

  const malformedSource = saveEvent(store, {
    webhookEventId: "malformed-source",
    messageId: "message-malformed-source",
    timestamp: 1700000004100,
    text: "壞掉的來源清單仍需支援 legacy range fallback。"
  });
  store.saveOrganizedGroupMemory(groupScope, "壞掉的來源清單 summary 也要被 dirty。", {
    sourceMessageCount: 1,
    firstSourceId: malformedSource.id,
    lastSourceId: malformedSource.id,
    sourceFirstEventLogId: malformedSource.id,
    sourceLastEventLogId: malformedSource.id,
    sourceLineEventLogIds: [malformedSource.id]
  });
  const malformedSummary = store.readOrganizedMemoryBySummary(groupScope, "壞掉的來源清單 summary 也要被 dirty。");
  store.forceOrganizedMemorySourceIdsForTest(malformedSummary.id, "{malformed-json");
  store.markLineMessageUnsent("message-malformed-source");
  const malformedContext = store.loadRelevantMemoryContext(groupScope, "壞掉的來源清單 summary");
  assert.equal(
    malformedContext.evidence.some((item) => item.content.includes("也要被 dirty")),
    false,
    "malformed exact source ids should fall back to source id range"
  );

  const nonArraySource = saveEvent(store, {
    webhookEventId: "non-array-source",
    messageId: "message-non-array-source",
    timestamp: 1700000004200,
    text: "非陣列來源清單仍需支援 legacy range fallback。"
  });
  store.saveOrganizedGroupMemory(groupScope, "非陣列來源清單 summary 也要被 dirty。", {
    sourceMessageCount: 1,
    firstSourceId: nonArraySource.id,
    lastSourceId: nonArraySource.id,
    sourceFirstEventLogId: nonArraySource.id,
    sourceLastEventLogId: nonArraySource.id,
    sourceLineEventLogIds: [nonArraySource.id]
  });
  const nonArraySummary = store.readOrganizedMemoryBySummary(groupScope, "非陣列來源清單 summary 也要被 dirty。");
  store.forceOrganizedMemorySourceIdsForTest(nonArraySummary.id, "{\"ids\":[]}");
  store.markLineMessageUnsent("message-non-array-source");
  const nonArrayContext = store.loadRelevantMemoryContext(groupScope, "非陣列來源清單 summary");
  assert.equal(
    nonArrayContext.evidence.some((item) => item.content.includes("非陣列來源清單 summary")),
    false,
    "non-array exact source ids should fall back to source id range"
  );

  const emptyArraySource = saveEvent(store, {
    webhookEventId: "empty-array-source",
    messageId: "message-empty-array-source",
    timestamp: 1700000004250,
    text: "空陣列來源清單仍需支援 legacy range fallback。"
  });
  store.saveOrganizedGroupMemory(groupScope, "空陣列來源清單 summary 也要被 dirty。", {
    sourceMessageCount: 1,
    firstSourceId: emptyArraySource.id,
    lastSourceId: emptyArraySource.id,
    sourceFirstEventLogId: emptyArraySource.id,
    sourceLastEventLogId: emptyArraySource.id,
    sourceLineEventLogIds: [emptyArraySource.id]
  });
  const emptyArraySummary = store.readOrganizedMemoryBySummary(groupScope, "空陣列來源清單 summary 也要被 dirty。");
  store.forceOrganizedMemorySourceIdsForTest(emptyArraySummary.id, "[]");
  store.markLineMessageUnsent("message-empty-array-source");
  const emptyArrayContext = store.loadRelevantMemoryContext(groupScope, "空陣列來源清單 summary");
  assert.equal(
    emptyArrayContext.evidence.some((item) => item.content.includes("空陣列來源清單 summary")),
    false,
    "empty exact source ids should fall back to source id range"
  );

  const invalidIdSource = saveEvent(store, {
    webhookEventId: "invalid-id-source",
    messageId: "message-invalid-id-source",
    timestamp: 1700000004260,
    text: "無效來源 ID 仍需支援 legacy range fallback。"
  });
  store.saveOrganizedGroupMemory(groupScope, "無效來源 ID summary 也要被 dirty。", {
    sourceMessageCount: 1,
    firstSourceId: invalidIdSource.id,
    lastSourceId: invalidIdSource.id,
    sourceFirstEventLogId: invalidIdSource.id,
    sourceLastEventLogId: invalidIdSource.id,
    sourceLineEventLogIds: [invalidIdSource.id]
  });
  const invalidIdSummary = store.readOrganizedMemoryBySummary(groupScope, "無效來源 ID summary 也要被 dirty。");
  store.forceOrganizedMemorySourceIdsForTest(invalidIdSummary.id, "[null,\"\"]");
  store.markLineMessageUnsent("message-invalid-id-source");
  const invalidIdContext = store.loadRelevantMemoryContext(groupScope, "無效來源 ID summary");
  assert.equal(
    invalidIdContext.evidence.some((item) => item.content.includes("無效來源 ID summary")),
    false,
    "invalid exact source ids should fall back to source id range"
  );

  const stringIdSource = saveEvent(store, {
    webhookEventId: "string-id-source",
    messageId: "message-string-id-source",
    timestamp: 1700000004300,
    text: "字串來源 ID 也要正確標記 dirty。"
  });
  store.saveOrganizedGroupMemory(groupScope, "字串來源 ID summary 也要被 dirty。", {
    sourceMessageCount: 1,
    firstSourceId: stringIdSource.id,
    lastSourceId: stringIdSource.id,
    sourceFirstEventLogId: stringIdSource.id,
    sourceLastEventLogId: stringIdSource.id,
    sourceLineEventLogIds: [stringIdSource.id]
  });
  const stringIdSummary = store.readOrganizedMemoryBySummary(groupScope, "字串來源 ID summary 也要被 dirty。");
  store.forceOrganizedMemorySourceIdsForTest(stringIdSummary.id, `["${stringIdSource.id}"]`);
  store.markLineMessageUnsent("message-string-id-source");
  const stringIdContext = store.loadRelevantMemoryContext(groupScope, "字串來源 ID summary");
  assert.equal(
    stringIdContext.evidence.some((item) => item.content.includes("字串來源 ID summary")),
    false,
    "string event ids in source_line_event_log_ids should match numeric event ids"
  );

  const laterInsertedEarlierTimestamp = saveEvent(store, {
    webhookEventId: "non-monotonic-early",
    messageId: "message-non-monotonic-early",
    timestamp: 1700000000500,
    text: "非單調排序 收回後 summary 必須失效。"
  });
  const earlierInsertedLaterTimestamp = inserted;
  store.saveOrganizedGroupMemory(groupScope, "非單調排序 這段 summary 必須被 dirty。", {
    sourceMessageCount: 2,
    firstSourceId: laterInsertedEarlierTimestamp.id,
    lastSourceId: earlierInsertedLaterTimestamp.id,
    sourceFirstEventLogId: laterInsertedEarlierTimestamp.id,
    sourceLastEventLogId: earlierInsertedLaterTimestamp.id,
    sourceLineEventLogIds: [laterInsertedEarlierTimestamp.id, earlierInsertedLaterTimestamp.id]
  });
  store.markLineMessageUnsent("message-non-monotonic-early");
  const nonMonotonicContext = store.loadRelevantMemoryContext(groupScope, "非單調排序 剛剛大家在聊什麼？");
  assert.equal(
    nonMonotonicContext.evidence.some((item) => item.content.includes("必須被 dirty")),
    false,
    "dirty summary should use exact event ids, not only first/last id range"
  );

  const fallbackEarlierInsertedLaterTimestamp = saveEvent(store, {
    webhookEventId: "non-monotonic-fallback-late",
    messageId: "message-non-monotonic-fallback-late",
    timestamp: 1700000008000,
    text: "非單調 fallback 範圍另一端。"
  });
  const fallbackLaterInsertedEarlierTimestamp = saveEvent(store, {
    webhookEventId: "non-monotonic-fallback-early",
    messageId: "message-non-monotonic-fallback-early",
    timestamp: 1700000000450,
    text: "非單調 fallback 收回後 summary 必須失效。"
  });
  store.saveOrganizedGroupMemory(groupScope, "非單調 fallback 這段 summary 必須被 dirty。", {
    sourceMessageCount: 2,
    firstSourceId: fallbackLaterInsertedEarlierTimestamp.id,
    lastSourceId: fallbackEarlierInsertedLaterTimestamp.id,
    sourceFirstEventLogId: fallbackLaterInsertedEarlierTimestamp.id,
    sourceLastEventLogId: fallbackEarlierInsertedLaterTimestamp.id,
    sourceLineEventLogIds: [
      fallbackLaterInsertedEarlierTimestamp.id,
      fallbackEarlierInsertedLaterTimestamp.id
    ]
  });
  const nonMonotonicFallbackSummary = store.readOrganizedMemoryBySummary(
    groupScope,
    "非單調 fallback 這段 summary 必須被 dirty。"
  );
  store.forceOrganizedMemorySourceIdsForTest(nonMonotonicFallbackSummary.id, "{bad-json");
  store.markLineMessageUnsent("message-non-monotonic-fallback-early");
  const nonMonotonicFallbackContext = store.loadRelevantMemoryContext(
    groupScope,
    "非單調 fallback 剛剛大家在聊什麼？"
  );
  assert.equal(
    nonMonotonicFallbackContext.evidence.some((item) => item.content.includes("非單調 fallback 這段 summary")),
    false,
    "malformed exact source ids should still dirty non-monotonic id ranges"
  );

  const legacyRangeHighId = saveEvent(store, {
    webhookEventId: "legacy-reversed-range-high",
    messageId: "message-legacy-reversed-range-high",
    timestamp: 1700000008100,
    text: "legacy reversed range 範圍高 ID。"
  });
  const legacyRangeLowId = saveEvent(store, {
    webhookEventId: "legacy-reversed-range-low",
    messageId: "message-legacy-reversed-range-low",
    timestamp: 1700000000400,
    text: "legacy reversed range 收回後 summary 必須失效。"
  });
  store.saveOrganizedGroupMemory(groupScope, "legacy reversed range summary 必須被 dirty。", {
    sourceMessageCount: 2,
    firstSourceId: legacyRangeLowId.id,
    lastSourceId: legacyRangeHighId.id,
    sourceFirstEventLogId: legacyRangeLowId.id,
    sourceLastEventLogId: legacyRangeHighId.id,
    sourceLineEventLogIds: [legacyRangeLowId.id, legacyRangeHighId.id]
  });
  const legacyRangeSummary = store.readOrganizedMemoryBySummary(
    groupScope,
    "legacy reversed range summary 必須被 dirty。"
  );
  store.forceOrganizedMemorySourceIdsForTest(legacyRangeSummary.id, null);
  store.forceOrganizedMemorySourceRangeForTest(
    legacyRangeSummary.id,
    legacyRangeHighId.id,
    legacyRangeLowId.id
  );
  store.markLineMessageUnsent("message-legacy-reversed-range-low");
  const legacyRangeContext = store.loadRelevantMemoryContext(
    groupScope,
    "legacy reversed range 剛剛大家在聊什麼？"
  );
  assert.equal(
    legacyRangeContext.evidence.some((item) => item.content.includes("legacy reversed range summary")),
    false,
    "legacy reversed source ranges should dirty through range fallback"
  );

  const keepFirst = saveEvent(store, {
    webhookEventId: "exact-keep-first",
    messageId: "message-exact-keep-first",
    timestamp: 1700000005000,
    text: "精確清單保留測試 第一個來源。"
  });
  const keepMiddle = saveEvent(store, {
    webhookEventId: "exact-keep-middle",
    messageId: "message-exact-keep-middle",
    timestamp: 1700000006000,
    text: "精確清單保留測試 中間事件會被收回。"
  });
  const keepLast = saveEvent(store, {
    webhookEventId: "exact-keep-last",
    messageId: "message-exact-keep-last",
    timestamp: 1700000007000,
    text: "精確清單保留測試 最後一個來源。"
  });
  store.saveOrganizedGroupMemory(groupScope, "精確清單保留測試 summary 不應被 dirty。", {
    sourceMessageCount: 2,
    firstSourceId: keepFirst.id,
    lastSourceId: keepLast.id,
    sourceFirstEventLogId: keepFirst.id,
    sourceLastEventLogId: keepLast.id,
    sourceLineEventLogIds: [keepFirst.id, keepLast.id]
  });
  store.markLineMessageUnsent("message-exact-keep-middle");
  const exactListContext = store.loadRelevantMemoryContext(groupScope, "精確清單保留測試 summary");
  assert.equal(
    exactListContext.evidence.some((item) => item.content.includes("不應被 dirty")),
    true,
    "range fallback should not dirty summaries that have exact source ids excluding the unsent event"
  );

  store.saveLongTermMemory(groupScope, "本群偏好使用繁體中文回答。");
  const manualRelevant = store.loadRelevantMemoryContext(groupScope, "本群偏好什麼語言？");
  assert.ok(manualRelevant.stats.manual_memory_selected_count > 0, "manual memory should be selected");
  assert.deepEqual(
    store.listLongTermMemories(userScope),
    [],
    "private scope should not list group memory"
  );
  assert.equal(
    store.listLongTermMemories(groupScope).length,
    1,
    "list memory should include manual memory only"
  );

  const emptyDryRun = store.migrateAutoMemoryToLineEventLogDryRun();
  assert.equal(emptyDryRun.auto_memory_count, 0, "legacy auto-memory writes should be disabled");

  store.insertLegacyAutoMemoryForTest({
    conversationKey: groupScope.key,
    scopeType: "group",
    content: "legacy migratable raw group text"
  });
  store.insertLegacyAutoMemoryForTest({
    conversationKey: "user:legacy-skip",
    scopeType: "user",
    content: "legacy skipped private text"
  });

  const dryRun = store.migrateAutoMemoryToLineEventLogDryRun();
  assert.deepEqual(
    dryRun,
    {
      auto_memory_count: 2,
      migratable_count: 1,
      skipped_count: 1,
      would_create_line_event_count: 1
    },
    "legacy auto-memory dry-run should report counts only"
  );

  console.log(
    JSON.stringify({
      status: "PASS",
      duplicate_webhook_event_id_ignored: true,
      event_timestamp_ordering_verified: true,
      unsend_handling_verified: true,
      source_auto_legacy_write_disabled: true,
      retrieval_source: "line_event_log",
      organized_summary_direct_injection: false
    })
  );
}

run();
