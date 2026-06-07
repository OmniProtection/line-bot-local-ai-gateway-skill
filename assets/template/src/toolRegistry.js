const VALID_ACCESS = new Set(["read", "local_write"]);
const VALID_ACTOR_SCOPE = new Set(["line", "admin", "system"]);
const VALID_RISK = new Set(["low", "medium", "high"]);

const DEFAULT_TOOL_DEFINITIONS = [
  {
    name: "web_search",
    description: "Reply-only web search using existing deterministic search flow.",
    risk_level: "medium",
    actor_scope: "line",
    access: "read",
    requires_confirmation: false,
    executor: "existing_web_search_runtime"
  },
  {
    name: "knowledge_base_lookup",
    description: "Read-only local knowledge base lookup.",
    risk_level: "low",
    actor_scope: "line",
    access: "read",
    requires_confirmation: false,
    executor: "knowledge_base_store"
  },
  {
    name: "handoff_ticket_create",
    description: "Create a local handoff ticket in SQLite.",
    risk_level: "medium",
    actor_scope: "line",
    access: "local_write",
    requires_confirmation: true,
    executor: "handoff_store"
  },
  {
    name: "admin_ticket_list",
    description: "List local handoff tickets for the localhost Admin API.",
    risk_level: "low",
    actor_scope: "admin",
    access: "read",
    requires_confirmation: false,
    executor: "handoff_store"
  },
  {
    name: "admin_ticket_get",
    description: "Read one local handoff ticket for the localhost Admin API.",
    risk_level: "low",
    actor_scope: "admin",
    access: "read",
    requires_confirmation: false,
    executor: "handoff_store"
  }
];

function normalizeToolDefinition(definition = {}) {
  const tool = {
    name: String(definition.name || "").trim(),
    description: String(definition.description || "").trim(),
    risk_level: String(definition.risk_level || "medium").trim(),
    actor_scope: String(definition.actor_scope || "").trim(),
    access: String(definition.access || "").trim(),
    requires_confirmation: definition.requires_confirmation === true,
    executor: definition.executor
  };

  if (!/^[a-z][a-z0-9_]*$/.test(tool.name)) {
    throw new Error("invalid_tool_name");
  }
  if (!tool.description) {
    throw new Error("invalid_tool_description");
  }
  if (!VALID_RISK.has(tool.risk_level)) {
    throw new Error("invalid_tool_risk_level");
  }
  if (!VALID_ACTOR_SCOPE.has(tool.actor_scope)) {
    throw new Error("invalid_tool_actor_scope");
  }
  if (!VALID_ACCESS.has(tool.access)) {
    throw new Error("invalid_tool_access");
  }
  if (!tool.executor) {
    throw new Error("invalid_tool_executor");
  }

  return tool;
}

function createToolRegistry(definitions = DEFAULT_TOOL_DEFINITIONS) {
  const tools = new Map();

  function registerTool(definition) {
    const tool = normalizeToolDefinition(definition);
    if (tools.has(tool.name)) {
      throw new Error("duplicate_tool_name");
    }
    tools.set(tool.name, Object.freeze(tool));
    return tools.get(tool.name);
  }

  function getTool(name) {
    return tools.get(String(name || "").trim()) || null;
  }

  function listTools(filter = {}) {
    let values = Array.from(tools.values());
    if (filter.actorScope || filter.actor_scope) {
      const actorScope = filter.actorScope || filter.actor_scope;
      values = values.filter((tool) => tool.actor_scope === actorScope);
    }
    if (filter.access) {
      values = values.filter((tool) => tool.access === filter.access);
    }
    return values;
  }

  for (const definition of definitions) {
    registerTool(definition);
  }

  return {
    registerTool,
    getTool,
    listTools
  };
}

module.exports = {
  DEFAULT_TOOL_DEFINITIONS,
  createToolRegistry,
  normalizeToolDefinition
};
