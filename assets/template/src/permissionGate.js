const EXTERNAL_MUTATION_PATTERN =
  /部署|deploy|刪除|delete|安裝|install|git\s+push|broadcast|multicast|narrowcast|群發|廣播|付費|付款/i;
const SECRET_OPERATION_PATTERN =
  /(給我|顯示|列出|查看|輸出|貼上|提供|設定|修改|使用|洩漏).{0,24}(金鑰|token|secret|access\s*token|channel\s*secret)|(金鑰|token|secret|access\s*token|channel\s*secret).{0,24}(給我|顯示|列出|查看|輸出|貼上|提供|設定|修改|使用|洩漏)/i;

function actorType(actor = {}) {
  return String(actor.type || actor.actor_type || "line").trim();
}

function evaluateToolPermission({
  tool = null,
  actor = {},
  routeDecision = null,
  policyDecision = null,
  payload = {},
  confirmed = false
} = {}) {
  if (!tool) {
    return {
      allowed: false,
      requires_confirmation: false,
      risk_level: "unknown",
      reason: "unknown_tool"
    };
  }

  const type = actorType(actor);
  if (tool.actor_scope !== type) {
    return {
      allowed: false,
      requires_confirmation: tool.requires_confirmation === true,
      risk_level: tool.risk_level,
      reason: "actor_scope_denied"
    };
  }

  const text = String(payload.text || payload.questionText || payload.question_text || "");
  if (EXTERNAL_MUTATION_PATTERN.test(text) || SECRET_OPERATION_PATTERN.test(text)) {
    return {
      allowed: false,
      requires_confirmation: tool.requires_confirmation === true,
      risk_level: "high",
      reason: "external_or_secret_action_denied"
    };
  }

  if (type === "line" && tool.name.startsWith("admin_")) {
    return {
      allowed: false,
      requires_confirmation: false,
      risk_level: tool.risk_level,
      reason: "admin_tool_denied_for_line_actor"
    };
  }

  if (type === "admin" && tool.access !== "read") {
    return {
      allowed: false,
      requires_confirmation: tool.requires_confirmation === true,
      risk_level: tool.risk_level,
      reason: "admin_api_write_tool_denied"
    };
  }

  if (policyDecision && policyDecision.allowed === false) {
    return {
      allowed: false,
      requires_confirmation: tool.requires_confirmation === true,
      risk_level: policyDecision.risk_level || tool.risk_level,
      reason: policyDecision.policy_reason || "policy_denied"
    };
  }

  if (tool.requires_confirmation && confirmed !== true) {
    return {
      allowed: false,
      requires_confirmation: true,
      risk_level: tool.risk_level,
      reason: "confirmation_required"
    };
  }

  return {
    allowed: true,
    requires_confirmation: false,
    risk_level: tool.risk_level,
    reason: "allowed",
    tool_name: tool.name,
    route_intent: routeDecision?.intent || "unknown"
  };
}

module.exports = {
  evaluateToolPermission
};
