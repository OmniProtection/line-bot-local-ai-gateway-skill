const SEARCH_SOURCE_TO_INPUT_STYLE = {
  official: "current_info_request",
  local_places: "local_place_request",
  product_specs: "product_specs_request",
  current_info: "current_info_request",
  general: "current_info_request"
};

function isGroupOrRoomSource(source) {
  return source?.type === "group" || source?.type === "room";
}

function isBotMentioned(message) {
  const mentionees = message?.mention?.mentionees;
  return Array.isArray(mentionees) && mentionees.some((mentionee) => mentionee?.isSelf === true);
}

function clampConfidence(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.max(0, Math.min(1, numeric));
}

function normalizeSearchPlan(searchPlan) {
  if (!searchPlan) {
    return null;
  }

  return {
    needs_search: searchPlan.needsSearch === true,
    confidence: clampConfidence(searchPlan.confidence, 0),
    search_query: String(searchPlan.searchQuery || "").trim(),
    source_preference: String(searchPlan.sourcePreference || "general").trim() || "general",
    answer_without_search_allowed: searchPlan.answerWithoutSearchAllowed === true,
    reason: String(searchPlan.reason || "unknown").slice(0, 160)
  };
}

function classifyInputStyle({ modelInput = "", intent = "unknown", searchPlan = null, forced = false }) {
  if (intent === "memory_command" || forced) {
    return "command";
  }

  const normalizedPlan = normalizeSearchPlan(searchPlan);
  if (intent === "web_search_request") {
    return SEARCH_SOURCE_TO_INPUT_STYLE[normalizedPlan?.source_preference] || "current_info_request";
  }

  const text = String(modelInput || "");
  if (/規劃|計畫|步驟|驗收|風險|roadmap|plan/i.test(text)) {
    return "planning_request";
  }
  if (/api|webhook|replytoken|timeout|json|http|sqlite|db|server|runtime/i.test(text)) {
    return "technical_question";
  }
  if (text.trim()) {
    return "casual_chat";
  }
  return "unknown";
}

function createRouteDecision({
  intent,
  modelInput = "",
  responseMode = "none",
  confidence = 0,
  forced = false,
  searchPlan = null,
  routeReason = "unknown"
}) {
  return {
    intent,
    input_style: classifyInputStyle({ modelInput, intent, searchPlan, forced }),
    response_mode: responseMode,
    confidence: clampConfidence(confidence, 0),
    forced: forced === true,
    search_plan: normalizeSearchPlan(searchPlan),
    route_reason: routeReason
  };
}

function decideIntentRoute({
  event = null,
  normalizedEvent = null,
  modelInput = "",
  hasReplyToken = true,
  shouldHandle = true,
  memoryCommand = null,
  searchCommand = null,
  searchPlan = null
}) {
  if (normalizedEvent?.eventType === "unsend") {
    return createRouteDecision({
      intent: "unsend",
      responseMode: "none",
      confidence: 1,
      routeReason: "unsend_event"
    });
  }

  if (!hasReplyToken) {
    return createRouteDecision({
      intent: "ignored_no_reply_token",
      modelInput,
      responseMode: "none",
      confidence: 1,
      routeReason: "missing_reply_token"
    });
  }

  if (!shouldHandle) {
    return createRouteDecision({
      intent: "ignored_non_text",
      modelInput,
      responseMode: "none",
      confidence: 1,
      routeReason: "unsupported_event_or_message_type"
    });
  }

  if (isGroupOrRoomSource(event?.source) && !isBotMentioned(event?.message)) {
    return createRouteDecision({
      intent: "group_no_mention",
      modelInput,
      responseMode: "none",
      confidence: 1,
      routeReason: "group_or_room_without_bot_mention"
    });
  }

  if (memoryCommand) {
    return createRouteDecision({
      intent: "memory_command",
      modelInput,
      responseMode: "reply",
      confidence: 1,
      routeReason: "memory_command"
    });
  }

  if (searchCommand?.matched) {
    return createRouteDecision({
      intent: "web_search_request",
      modelInput,
      responseMode: "reply",
      confidence: 1,
      forced: true,
      searchPlan,
      routeReason: "forced_web_search_prefix"
    });
  }

  if (searchPlan?.needsSearch === true) {
    return createRouteDecision({
      intent: "web_search_request",
      modelInput,
      responseMode: "reply",
      confidence: searchPlan.confidence,
      searchPlan,
      routeReason: "auto_search_plan"
    });
  }

  return createRouteDecision({
    intent: "general_chat",
    modelInput,
    responseMode: "reply_or_push",
    confidence: searchPlan?.ok === true ? 0.8 : 0.5,
    searchPlan,
    routeReason: searchPlan?.reason || "general_chat"
  });
}

module.exports = {
  classifyInputStyle,
  createRouteDecision,
  decideIntentRoute,
  normalizeSearchPlan
};
