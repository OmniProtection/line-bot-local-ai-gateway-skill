const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { createMemoryStore } = require("../src/memoryStore");

const groupScope = {
  key: "group:test-memory-relevance",
  type: "group"
};

const userScope = {
  key: "user:test-memory-relevance",
  type: "user"
};

const rollingScope = {
  key: "user:test-rolling-summary",
  type: "user"
};

const roomScope = {
  key: "room:test-memory-relevance-room",
  type: "room"
};

function assertNoEvidence(context, label) {
  assert.equal(context.evidence.length, 0, `${label}: expected no selected evidence`);
  assert.equal(
    context.stats.memory_selected_count,
    0,
    `${label}: expected memory_selected_count=0`
  );
}

function hashText(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function saveGroupLineEvent(store, index, text, timestamp) {
  return saveLineEvent(store, groupScope, "group", index, text, timestamp);
}

function saveLineEvent(store, scope, sourceType, index, text, timestamp) {
  const messageId = `${sourceType}-message-${index}`;
  return store.saveLineEventLog({
    webhookEventId: `memory-relevance-${index}`,
    eventType: "message",
    timestamp,
    deliveryIsRedelivery: false,
    sourceType,
    conversationKey: scope.key,
    senderUserId: `user-${index}`,
    groupId: sourceType === "group" ? "test-memory-relevance" : null,
    roomId: sourceType === "room" ? "test-memory-relevance-room" : null,
    messageId,
    messageType: "text",
    text,
    textHash: hashText(text),
    isMentionedBot: false,
    mentionJson: null,
    quotedMessageId: null,
    rawEventJson: JSON.stringify({
      type: "message",
      messageType: "text",
      hasText: true
    })
  });
}

function run() {
  const store = createMemoryStore(":memory:", { enableTestHelpers: true });

  store.saveOrganizedGroupMemory(groupScope, "昨天群組討論午餐要吃壽司，沒有技術決策。", {
    sourceMessageCount: 3,
    firstSourceId: 1,
    lastSourceId: 3
  });

  const generalQuestion = store.loadRelevantMemoryContext(groupScope, "什麼是 webhook？");
  assertNoEvidence(generalQuestion, "general question");
  assert.equal(
    generalQuestion.summaries.length,
    0,
    "unrelated organized group summary should not enter summary context"
  );

  for (let index = 0; index < 10; index += 1) {
    saveGroupLineEvent(
      store,
      index,
      `第${index + 1}則最近群組對話，大家在討論專案進度。`,
      1700000000000 + index
    );
  }

  const recentDiscussion = store.loadRelevantMemoryContext(groupScope, "剛剛大家在聊什麼？");
  assert.ok(
    recentDiscussion.stats.recent_group_selected_count > 0,
    "recent discussion should select recent group evidence"
  );
  assert.ok(
    recentDiscussion.stats.context_chars <= 5000,
    "selected memory context should stay within budget"
  );

  const decisionQuestion = store.loadRelevantMemoryContext(groupScope, "剛剛有決定什麼嗎？");
  assert.ok(
    decisionQuestion.stats.recent_group_selected_count > 0,
    "decision question should provide recent evidence for the model to judge"
  );

  store.saveLongTermMemory(groupScope, "本群偏好使用繁體中文回答。");
  const manualRelevant = store.loadRelevantMemoryContext(groupScope, "本群偏好什麼語言？");
  assert.ok(
    manualRelevant.stats.manual_memory_selected_count > 0,
    "related manual memory should be selected"
  );
  assert.ok(
    manualRelevant.manualMemories.some((item) => item.content.includes("繁體中文")),
    "manual memories should be returned in the dedicated manualMemories layer"
  );

  const privateQuestion = store.loadRelevantMemoryContext(userScope, "剛剛大家在聊什麼？");
  assertNoEvidence(privateQuestion, "private scope should not read group memory");

  const privateInbound = saveLineEvent(
    store,
    userScope,
    "user",
    "private-inbound",
    "我剛剛提到 LINE Bot 私聊記憶修復。",
    1700000001000
  );
  const privateInboundContext = store.loadRelevantMemoryContext(
    userScope,
    "剛剛我提到 LINE Bot 私聊記憶什麼？"
  );
  assert.ok(
    privateInboundContext.stats.inbound_text_selected_count > 0,
    "private inbound text should be retrievable as same-scope conversation memory"
  );
  assert.ok(
    privateInboundContext.retrievedEvidence.some((item) => item.content.includes("私聊記憶修復")),
    "private inbound evidence should include the prior private message in retrievedEvidence"
  );

  const currentOnlyContext = store.loadRelevantMemoryContext(
    userScope,
    "當前訊息排除測試",
    {
      excludeLineEventLogId: saveLineEvent(
        store,
        userScope,
        "user",
        "current-excluded",
        "當前訊息排除測試",
        1700000001001
      ).id
    }
  );
  assert.equal(
    currentOnlyContext.retrievedEvidence.some((item) => item.content.includes("當前訊息排除測試")),
    false,
    "current inbound event should not be selected as its own memory context"
  );

  const roomInbound = saveLineEvent(
    store,
    roomScope,
    "room",
    "room-inbound",
    "room 裡剛剛討論客服記憶一致性。",
    1700000002000
  );
  const roomContext = store.loadRelevantMemoryContext(
    roomScope,
    "剛剛 room 討論什麼客服記憶？"
  );
  assert.ok(roomInbound.id, "room inbound text should be logged");
  assert.ok(
    roomContext.stats.inbound_text_selected_count > 0,
    "room inbound text should be retrievable as same-scope conversation memory"
  );

  const groupShouldNotReadPrivate = store.loadRelevantMemoryContext(
    groupScope,
    "私聊記憶修復是什麼？"
  );
  assert.equal(
    groupShouldNotReadPrivate.retrievedEvidence.some((item) => item.content.includes("私聊記憶修復")),
    false,
    "group scope should not read private inbound text"
  );

  const breakfastQuestion = saveLineEvent(
    store,
    groupScope,
    "group",
    "group-breakfast-question",
    "明天早上吃漢堡",
    1700000003000
  );
  const groupMentionCurrent = saveLineEvent(
    store,
    groupScope,
    "group",
    "group-current-mention",
    "@冥王星 明天早上吃什麼？",
    1700000003001
  );
  const groupMentionContext = store.loadRelevantMemoryContext(groupScope, "明天早上吃什麼？", {
    excludeLineEventLogId: groupMentionCurrent.id,
    includeGroupMentionContext: true
  });
  assert.ok(breakfastQuestion.id, "group no-mention question should be saved");
  assert.equal(
    groupMentionContext.groupMentionContext.some((item) => item.content.includes("明天早上吃漢堡")),
    true,
    "group mention context should include prior same-group no-mention messages for follow-up questions"
  );
  assert.equal(
    groupMentionContext.groupMentionContext.some((item) =>
      item.content.includes("@冥王星 明天早上吃什麼？")
    ),
    false,
    "group mention context should exclude the current mention event"
  );
  assert.equal(
    groupMentionContext.groupMentionContext.some((item) => item.content.includes("私聊記憶修復")),
    false,
    "group mention context should not include private-scope line events"
  );
  assert.equal(
    groupMentionContext.stats.group_mention_context_count > 0,
    true,
    "group mention context should be counted separately from relevance-selected evidence"
  );

  store.saveShortTermExchange(
    userScope,
    "我頭痛",
    "頭痛可能和疲勞、壓力、睡眠或其他原因有關。"
  );
  const followUpQuestion = store.loadRelevantMemoryContext(userScope, "要看哪一科？");
  assert.equal(
    followUpQuestion.stats.recent_conversation_count,
    2,
    "follow-up questions should receive recent same-scope conversation context"
  );
  assert.deepEqual(
    followUpQuestion.recentConversation.map((item) => item.content),
    ["我頭痛", "頭痛可能和疲勞、壓力、睡眠或其他原因有關。"],
    "recent conversation should preserve the prior exchange even without keyword overlap"
  );
  assert.equal(
    followUpQuestion.retrievedEvidence.some((item) => item.source === "recent_interaction"),
    false,
    "short-term chat history should stay in recentConversation and not duplicate into evidence"
  );
  assert.equal(
    followUpQuestion.retrievedEvidence.some((item) => item.role === "assistant"),
    false,
    "old assistant replies should not enter retrievedEvidence"
  );

  store.saveShortTermExchange(userScope, "我不舒服", "請問是哪裡不舒服？");
  store.saveShortTermExchange(
    userScope,
    "腳麻",
    "腳麻可能和姿勢、循環或神經壓迫有關，若持續可考慮神經內科或骨科。"
  );
  for (let index = 0; index < 14; index += 1) {
    store.saveShortTermExchange(
      userScope,
      `第${index + 1}輪食物偏好`,
      `第${index + 1}輪食物回覆`
    );
  }
  const longFollowUpQuestion = store.loadRelevantMemoryContext(userScope, "要看哪一科？");
  const longRecentContents = longFollowUpQuestion.recentConversation.map((item) => item.content);
  assert.ok(
    longRecentContents.includes("腳麻"),
    "recent conversation should preserve earlier same-chat context across many intervening turns"
  );
  assert.ok(
    longFollowUpQuestion.stats.recent_conversation_count > 10,
    "recent conversation window should cover more than a few turns"
  );

  store.saveShortTermExchange(
    rollingScope,
    "我腳麻",
    "腳麻若持續，可以先考慮神經內科或骨科。"
  );
  for (let index = 0; index < 29; index += 1) {
    store.saveShortTermExchange(
      rollingScope,
      `第${index + 1}輪一般閒聊`,
      `第${index + 1}輪一般回覆`
    );
  }

  const rollingBatch = store.getPendingRollingSummaryBatch(rollingScope);
  assert.ok(
    rollingBatch.length >= 12,
    "older conversation turns beyond the recent window should be ready for rolling summary"
  );
  store.saveConversationSummary(
    rollingScope,
    "使用者前面提到腳麻；若之後追問要看哪一科，相關背景是腳麻。",
    {
      sourceMessageCount: rollingBatch.length,
      firstShortTermId: rollingBatch[0].id,
      lastShortTermId: rollingBatch[rollingBatch.length - 1].id
    }
  );

  const unrelatedRollingContext = store.loadRelevantMemoryContext(rollingScope, "什麼是 webhook？");
  assert.ok(
    unrelatedRollingContext.rollingSummary.summary.includes("腳麻"),
    "fixed same-scope context package should include rolling summary even for new questions"
  );
  assert.ok(
    unrelatedRollingContext.stats.rolling_summary_chars > 0,
    "fixed same-scope context package should report rolling summary chars"
  );

  const implicitFollowUpRollingContext = store.loadRelevantMemoryContext(rollingScope, "然後呢？");
  assert.ok(
    implicitFollowUpRollingContext.rollingSummary.summary.includes("腳麻"),
    "follow-up without explicit context keywords should receive same-scope rolling summary"
  );

  const rollingContext = store.loadRelevantMemoryContext(rollingScope, "剛剛我說哪裡不舒服？");
  assert.ok(
    rollingContext.rollingSummary.summary.includes("腳麻"),
    "rolling summary should be returned as a dedicated memory layer"
  );
  assert.ok(
    rollingContext.summaries.some((item) => item.source === "rolling_summary" && item.content.includes("腳麻")),
    "rolling summary should also be returned in the summaries layer"
  );
  assert.ok(
    rollingContext.stats.rolling_summary_chars > 0,
    "rolling summary stats should be visible"
  );

  console.log(
    JSON.stringify({
      status: "PASS",
      organized_summary_direct_injection: false,
      general_question_selected_count: generalQuestion.stats.memory_selected_count,
      recent_group_selected_count: recentDiscussion.stats.recent_group_selected_count,
      private_inbound_selected_count: privateInboundContext.stats.inbound_text_selected_count,
      room_inbound_selected_count: roomContext.stats.inbound_text_selected_count,
      manual_memory_selected_count: manualRelevant.stats.manual_memory_selected_count,
      manual_memories_count: manualRelevant.manualMemories.length,
      recent_conversation_count: followUpQuestion.stats.recent_conversation_count,
      long_recent_conversation_count: longFollowUpQuestion.stats.recent_conversation_count,
      retrieved_evidence_count: privateInboundContext.retrievedEvidence.length,
      summary_count: rollingContext.summaries.length,
      rolling_summary_chars: rollingContext.stats.rolling_summary_chars,
      fixed_context_package_rolling_summary_chars: unrelatedRollingContext.stats.rolling_summary_chars
    })
  );
}

run();
