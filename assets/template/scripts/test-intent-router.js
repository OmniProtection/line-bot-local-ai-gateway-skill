const assert = require("node:assert/strict");
const { decideIntentRoute } = require("../src/intentRouter");

function textEvent(text, overrides = {}) {
  return {
    type: "message",
    replyToken: "reply-token",
    source: overrides.source || { type: "user", userId: "U1" },
    message: {
      id: "m1",
      type: "text",
      text,
      ...(overrides.message || {})
    }
  };
}

function groupMentionEvent(text) {
  return textEvent(`@冥王星 ${text}`, {
    source: { type: "group", groupId: "G1", userId: "U1" },
    message: {
      mention: {
        mentionees: [{ index: 0, length: 4, isSelf: true, type: "user" }]
      }
    }
  });
}

function testRoutingPrecedence() {
  const memoryFirst = decideIntentRoute({
    event: textEvent("記住: 搜: 不應搜尋"),
    modelInput: "記住: 搜: 不應搜尋",
    memoryCommand: { type: "remember", value: "搜: 不應搜尋" },
    searchCommand: { matched: true, query: "不應搜尋" }
  });
  assert.equal(memoryFirst.intent, "memory_command");
  assert.equal(memoryFirst.input_style, "command");

  const forcedSearch = decideIntentRoute({
    event: textEvent("搜: 5060ti 規格"),
    modelInput: "搜: 5060ti 規格",
    searchCommand: { matched: true, query: "5060ti 規格" }
  });
  assert.equal(forcedSearch.intent, "web_search_request");
  assert.equal(forcedSearch.forced, true);
  assert.equal(forcedSearch.response_mode, "reply");
}

function testAutoSearchPlan() {
  const autoSearch = decideIntentRoute({
    event: textEvent("搜尋5060ti規格"),
    modelInput: "搜尋5060ti規格",
    searchPlan: {
      ok: true,
      needsSearch: true,
      confidence: 0.92,
      searchQuery: "NVIDIA GeForce RTX 5060 Ti specifications official",
      sourcePreference: "product_specs",
      answerWithoutSearchAllowed: false,
      reason: "product_specs_need_current_source"
    }
  });

  assert.equal(autoSearch.intent, "web_search_request");
  assert.equal(autoSearch.input_style, "product_specs_request");
  assert.equal(autoSearch.search_plan.search_query.includes("5060"), true);
  assert.equal(autoSearch.search_plan.source_preference, "product_specs");
}

function testGeneralTechnicalChatAndIgnoredRoutes() {
  const technical = decideIntentRoute({
    event: textEvent("Webhook 是 replyToken 嗎？"),
    modelInput: "Webhook 是 replyToken 嗎？",
    searchPlan: {
      ok: true,
      needsSearch: false,
      confidence: 0.9,
      reason: "stable_technical_question"
    }
  });
  assert.equal(technical.intent, "general_chat");
  assert.equal(technical.input_style, "technical_question");

  const groupNoMention = decideIntentRoute({
    event: textEvent("明天早上吃漢堡", {
      source: { type: "group", groupId: "G1", userId: "U1" }
    }),
    modelInput: "明天早上吃漢堡"
  });
  assert.equal(groupNoMention.intent, "group_no_mention");
  assert.equal(groupNoMention.response_mode, "none");

  const groupMention = decideIntentRoute({
    event: groupMentionEvent("明天早上吃什麼？"),
    modelInput: "明天早上吃什麼？"
  });
  assert.equal(groupMention.intent, "general_chat");
}

testRoutingPrecedence();
testAutoSearchPlan();
testGeneralTechnicalChatAndIgnoredRoutes();

console.log(
  JSON.stringify({
    status: "PASS",
    intent_router: true
  })
);
