const assert = require("node:assert/strict");
const { createToolPlan, parseConfirmationCommand } = require("../src/agentLite");
const { createToolRegistry } = require("../src/toolRegistry");

const registry = createToolRegistry();

assert.equal(createToolPlan({ modelInput: "你在幹嘛", registry }), null);
assert.equal(createToolPlan({ modelInput: "Webhook 是 replyToken 嗎？", registry }), null);

const plan = createToolPlan({ modelInput: "建立工單: 請人工確認這個問題", registry });
assert.equal(plan.ok, true);
assert.equal(plan.tool_name, "handoff_ticket_create");
assert.equal(plan.requires_confirmation, true);
assert.equal(plan.arguments.questionText, "請人工確認這個問題");

const missing = createToolPlan({
  modelInput: "建立工單: 請人工確認這個問題",
  registry: { getTool: () => null }
});
assert.equal(missing.ok, false);
assert.equal(missing.reason, "unknown_tool");

assert.deepEqual(parseConfirmationCommand("確認 ABC123"), { action: "confirm", code: "ABC123" });
assert.deepEqual(parseConfirmationCommand("取消 ABC123"), { action: "cancel", code: "ABC123" });
assert.equal(parseConfirmationCommand("確認"), null);
assert.equal(parseConfirmationCommand("我確認 ABC123"), null);

console.log("PASS agent-lite tests");
