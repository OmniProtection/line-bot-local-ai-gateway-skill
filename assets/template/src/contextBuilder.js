const { budgetMemoryContext } = require("./tokenBudget");

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

function buildPromptSections(memoryContext = {}) {
  const sections = [];
  if (memoryContext.searchStatus) {
    sections.push("WEB_SEARCH_STATUS");
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
  const budgeted = budgetMemoryContext(guarded, config, {
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
  buildContextPackage,
  buildPromptSections
};
