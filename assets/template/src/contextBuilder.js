const { budgetMemoryContext } = require("./tokenBudget");

const KB_REQUIRED_INPUT_STYLES = new Set([
  "technical_question",
  "planning_request"
]);

function addSearchStatus(memoryContext, routeDecision, policyDecision) {
  if (routeDecision?.intent !== "general_chat") {
    return memoryContext;
  }

  const searchPlan = routeDecision.search_plan;
  const shouldGuard =
    !searchPlan ||
    searchPlan.needs_search !== true ||
    policyDecision?.allowed_tools?.includes("web_search") !== true;

  if (!shouldGuard) {
    return memoryContext;
  }

  return {
    ...(memoryContext || {}),
    searchStatus: {
      webSearchPerformed: false,
      reason: routeDecision?.route_reason || searchPlan?.reason || "search_not_performed"
    }
  };
}

function shouldSearchKnowledgeBase(routeDecision, config) {
  return (
    config?.knowledgeBaseEnabled !== false &&
    routeDecision?.intent === "general_chat"
  );
}

function isKnowledgeRequired(routeDecision) {
  if (routeDecision?.knowledge_required === true) {
    return true;
  }
  return (
    routeDecision?.intent === "general_chat" &&
    KB_REQUIRED_INPUT_STYLES.has(routeDecision?.input_style || "")
  );
}

function addKnowledgeContext(memoryContext, {
  modelInput = "",
  routeDecision = null,
  knowledgeBaseStore = null,
  config = {}
} = {}) {
  if (
    !shouldSearchKnowledgeBase(routeDecision, config) ||
    !knowledgeBaseStore ||
    typeof knowledgeBaseStore.searchKnowledge !== "function"
  ) {
    return memoryContext;
  }

  const required = isKnowledgeRequired(routeDecision);
  const limit =
    Number.isFinite(config.knowledgeBaseMaxResults) && config.knowledgeBaseMaxResults > 0
      ? config.knowledgeBaseMaxResults
      : 4;
  const results = knowledgeBaseStore.searchKnowledge({
    query: modelInput,
    limit
  });

  return {
    ...(memoryContext || {}),
    knowledgeContext: results,
    knowledgeStatus: {
      searched: true,
      hit: results.length > 0,
      required,
      resultCount: results.length
    }
  };
}

function buildPromptSections(memoryContext = {}) {
  const sections = [];
  if (memoryContext.searchStatus) {
    sections.push("WEB_SEARCH_STATUS");
  }
  if (Array.isArray(memoryContext.knowledgeContext) && memoryContext.knowledgeContext.length > 0) {
    sections.push("KNOWLEDGE_BASE_CONTEXT");
  } else if (memoryContext.knowledgeStatus?.searched === true) {
    sections.push("KNOWLEDGE_BASE_STATUS");
  }
  if (Array.isArray(memoryContext.groupMentionContext) && memoryContext.groupMentionContext.length > 0) {
    sections.push("GROUP_RECENT_CONTEXT");
  }
  if (Array.isArray(memoryContext.recentConversation) && memoryContext.recentConversation.length > 0) {
    sections.push("LATEST_TURNS");
  }
  if (Array.isArray(memoryContext.manualMemories) && memoryContext.manualMemories.length > 0) {
    sections.push("MANUAL_MEMORY");
  }
  if (Array.isArray(memoryContext.summaries) && memoryContext.summaries.length > 0) {
    sections.push("SUMMARY_CONTEXT");
  }
  if (Array.isArray(memoryContext.retrievedEvidence) && memoryContext.retrievedEvidence.length > 0) {
    sections.push("RETRIEVED_EVIDENCE");
  }
  return sections;
}

function buildContextPackage({
  scope,
  modelInput = "",
  routeDecision = null,
  policyDecision = null,
  lineEventLogId = null,
  includeGroupMentionContext = false,
  memoryStore,
  knowledgeBaseStore = null,
  config = {}
}) {
  if (!memoryStore || typeof memoryStore.loadRelevantMemoryContext !== "function") {
    throw new Error("context_builder_missing_memory_store");
  }

  const loaded = memoryStore.loadRelevantMemoryContext(scope, modelInput, {
    excludeLineEventLogId: lineEventLogId,
    includeGroupMentionContext: includeGroupMentionContext === true
  });
  const guarded = addSearchStatus(loaded, routeDecision, policyDecision);
  const withKnowledge = addKnowledgeContext(guarded, {
    modelInput,
    routeDecision,
    knowledgeBaseStore,
    config
  });
  const budgeted = budgetMemoryContext(withKnowledge, config, {
    currentMessage: modelInput
  });

  return {
    prompt_sections: buildPromptSections(budgeted),
    memory_context: budgeted,
    context_stats: budgeted.context_stats
  };
}

module.exports = {
  addSearchStatus,
  addKnowledgeContext,
  buildContextPackage,
  buildPromptSections,
  isKnowledgeRequired,
  shouldSearchKnowledgeBase
};
