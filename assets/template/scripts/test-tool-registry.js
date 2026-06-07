const assert = require("node:assert/strict");
const { createToolRegistry } = require("../src/toolRegistry");

const registry = createToolRegistry();

assert.equal(registry.getTool("web_search").access, "read");
assert.equal(registry.getTool("knowledge_base_lookup").risk_level, "low");
assert.equal(registry.getTool("handoff_ticket_create").requires_confirmation, true);
assert.equal(registry.getTool("admin_ticket_list").actor_scope, "admin");
assert.equal(registry.getTool("admin_ticket_get").actor_scope, "admin");
assert.equal(registry.getTool("missing_tool"), null);

const lineTools = registry.listTools({ actorScope: "line" }).map((tool) => tool.name);
assert.deepEqual(lineTools, ["web_search", "knowledge_base_lookup", "handoff_ticket_create"]);

assert.throws(
  () =>
    registry.registerTool({
      name: "web_search",
      description: "duplicate",
      risk_level: "low",
      actor_scope: "line",
      access: "read",
      executor: "test"
    }),
  /duplicate_tool_name/
);

assert.throws(
  () =>
    createToolRegistry([
      {
        name: "Bad Tool",
        description: "bad",
        risk_level: "low",
        actor_scope: "line",
        access: "read",
        executor: "test"
      }
    ]),
  /invalid_tool_name/
);

console.log("PASS tool registry tests");
