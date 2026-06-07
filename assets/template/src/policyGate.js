const HIGH_RISK_ACTION_PATTERN =
  /部署|deploy|刪除|delete|安裝|install|push\s+到|git\s+push|broadcast|multicast|narrowcast|群發|廣播|付費|付款/i;
const SECRET_OPERATION_PATTERN =
  /(給我|顯示|列出|查看|輸出|貼上|提供|設定|修改|使用|洩漏).{0,24}(金鑰|token|secret|access\s*token|channel\s*secret)|(金鑰|token|secret|access\s*token|channel\s*secret).{0,24}(給我|顯示|列出|查看|輸出|貼上|提供|設定|修改|使用|洩漏)/i;

function isHighRiskExternalAction(routeDecision, metadata = {}) {
  const text = String(metadata.modelInput || "");
  return (
    routeDecision?.intent === "general_chat" &&
    (HIGH_RISK_ACTION_PATTERN.test(text) || SECRET_OPERATION_PATTERN.test(text))
  );
}

function evaluatePolicy(routeDecision, metadata = {}) {
  const intent = routeDecision?.intent || "unknown";

  if (
    intent === "unsend" ||
    intent === "ignored_non_text" ||
    intent === "ignored_no_reply_token" ||
    intent === "group_no_mention"
  ) {
    return {
      allowed: false,
      risk_level: "low",
      allowed_tools: [],
      response_mode: "none",
      policy_reason: intent
    };
  }

  if (intent === "web_search_request") {
    return {
      allowed: true,
      risk_level: "medium",
      allowed_tools: ["web_search"],
      response_mode: "reply",
      policy_reason: "reply_api_only_web_search"
    };
  }

  if (intent === "memory_command") {
    return {
      allowed: true,
      risk_level: "medium",
      allowed_tools: ["memory_command"],
      response_mode: "reply",
      policy_reason: "existing_memory_command_flow_only"
    };
  }

  if (isHighRiskExternalAction(routeDecision, metadata)) {
    return {
      allowed: true,
      risk_level: "high",
      allowed_tools: [],
      response_mode: "reply",
      policy_reason: "external_state_mutation_not_allowed"
    };
  }

  if (intent === "general_chat") {
    return {
      allowed: true,
      risk_level: "low",
      allowed_tools: [],
      response_mode: routeDecision?.response_mode || "reply_or_push",
      policy_reason: "general_chat_no_tools"
    };
  }

  return {
    allowed: false,
    risk_level: "unknown",
    allowed_tools: [],
    response_mode: "none",
    policy_reason: "unknown_intent"
  };
}

module.exports = {
  evaluatePolicy
};
