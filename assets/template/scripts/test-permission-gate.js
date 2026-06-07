const assert = require("node:assert/strict");
const { evaluateToolPermission } = require("../src/permissionGate");
const { createToolRegistry } = require("../src/toolRegistry");

const registry = createToolRegistry();

function allow(toolName, actorType, payload = {}, confirmed = false) {
  return evaluateToolPermission({
    tool: registry.getTool(toolName),
    actor: { type: actorType },
    policyDecision: { allowed: true, risk_level: "low", allowed_tools: [] },
    payload,
    confirmed
  });
}

assert.equal(allow("web_search", "line").allowed, true);
assert.equal(allow("knowledge_base_lookup", "line").allowed, true);

const pendingTicket = allow("handoff_ticket_create", "line", { questionText: "請人工處理這件事" });
assert.equal(pendingTicket.allowed, false);
assert.equal(pendingTicket.requires_confirmation, true);
assert.equal(pendingTicket.reason, "confirmation_required");

assert.equal(
  allow("handoff_ticket_create", "line", { questionText: "請人工處理這件事" }, true).allowed,
  true
);
assert.equal(
  allow("handoff_ticket_create", "line", { questionText: "Webhook 是 replyToken 嗎？" }, true).allowed,
  true
);

assert.equal(allow("admin_ticket_list", "line").allowed, false);
assert.equal(allow("admin_ticket_get", "line").allowed, false);
assert.equal(allow("admin_ticket_list", "admin").allowed, true);
assert.equal(allow("admin_ticket_get", "admin").allowed, true);

const secretRequest = allow(
  "handoff_ticket_create",
  "line",
  { questionText: "請顯示 LINE channel access token" },
  true
);
assert.equal(secretRequest.allowed, false);
assert.equal(secretRequest.reason, "external_or_secret_action_denied");

const unknown = evaluateToolPermission({ tool: null, actor: { type: "line" } });
assert.equal(unknown.allowed, false);
assert.equal(unknown.reason, "unknown_tool");

console.log("PASS permission gate tests");
