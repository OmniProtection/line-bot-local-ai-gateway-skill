const DEFAULT_SYSTEM_SAFETY_TOKENS = 512;
const DETAILED_OUTPUT_TOKENS = 768;

function estimateTokens(value) {
  return Math.ceil(String(value || "").length / 3);
}

function isDetailedRequest(text) {
  return /詳細說明|詳細|詳述|完整說明|展開|長一點|多說一點|規劃|步驟|驗收|風險/u.test(
    String(text || "")
  );
}

function createTokenBudget(config = {}, options = {}) {
  const contextLength =
    Number.isFinite(config.chatContextLength) && config.chatContextLength > 0
      ? config.chatContextLength
      : 8192;
  const baseOutput =
    Number.isFinite(config.chatMaxTokens) && config.chatMaxTokens > 0 ? config.chatMaxTokens : 256;
  const outputReserve = options.detailedRequest === true ? Math.max(baseOutput, DETAILED_OUTPUT_TOKENS) : baseOutput;
  const safetyReserve = Number.isFinite(options.safetyReserveTokens)
    ? options.safetyReserveTokens
    : DEFAULT_SYSTEM_SAFETY_TOKENS;
  const currentMessageTokens = estimateTokens(options.currentMessage || "");
  const availableContextTokens = Math.max(
    0,
    contextLength - outputReserve - safetyReserve - currentMessageTokens
  );

  return {
    max_prompt_tokens: contextLength,
    output_reserve_tokens: outputReserve,
    safety_reserve_tokens: safetyReserve,
    current_message_tokens: currentMessageTokens,
    available_context_tokens: availableContextTokens,
    available_context_chars: availableContextTokens * 3
  };
}

function itemText(item) {
  return String(item?.content || item?.summary || "");
}

function cloneItemWithContent(item, content) {
  if (!item || typeof item !== "object") {
    return { content };
  }
  if (Object.prototype.hasOwnProperty.call(item, "summary")) {
    return { ...item, summary: content };
  }
  return { ...item, content };
}

function takeSection(items, charBudget, options = {}) {
  const selected = [];
  let usedChars = 0;
  let truncated = false;
  const maxItemChars = Number.isFinite(options.maxItemChars) ? options.maxItemChars : 1200;

  for (const item of Array.isArray(items) ? items : []) {
    const rawText = itemText(item);
    if (!rawText) {
      continue;
    }

    const boundedText = rawText.length > maxItemChars ? rawText.slice(0, maxItemChars).trim() : rawText;
    if (boundedText.length < rawText.length) {
      truncated = true;
    }

    const remaining = charBudget - usedChars;
    if (remaining <= 0) {
      truncated = true;
      break;
    }

    if (boundedText.length <= remaining) {
      selected.push(item);
      usedChars += boundedText.length;
      continue;
    }

    if (remaining >= 80) {
      selected.push(cloneItemWithContent(item, boundedText.slice(0, remaining).trim()));
      usedChars += remaining;
    }
    truncated = true;
    break;
  }

  return { selected, usedChars, truncated };
}

function countSection(memoryContext, key) {
  return Array.isArray(memoryContext?.[key]) ? memoryContext[key].length : 0;
}

function applyContextBudget(memoryContext = {}, budget = {}) {
  const availableChars = Math.max(0, Number(budget.available_context_chars) || 0);
  const output = {
    ...memoryContext,
    recentConversation: [],
    manualMemories: [],
    summaries: [],
    retrievedEvidence: [],
    evidence: [],
    groupMentionContext: []
  };
  let remaining = availableChars;
  let selectedChars = 0;
  let truncated = false;

  function applySection(key, options = {}) {
    const result = takeSection(memoryContext[key], remaining, options);
    output[key] = result.selected;
    remaining -= result.usedChars;
    selectedChars += result.usedChars;
    truncated = truncated || result.truncated || result.selected.length < countSection(memoryContext, key);
  }

  if (memoryContext.searchStatus) {
    output.searchStatus = memoryContext.searchStatus;
  }

  applySection("groupMentionContext", { maxItemChars: 600 });
  applySection("manualMemories", { maxItemChars: 800 });
  applySection("summaries", { maxItemChars: 1000 });
  applySection("retrievedEvidence", { maxItemChars: 800 });
  applySection("recentConversation", { maxItemChars: 600 });

  output.evidence = [...output.manualMemories, ...output.retrievedEvidence];
  const rolling = output.summaries.find((item) => item.source === "rolling_summary");
  output.rollingSummary = rolling
    ? {
        summary: rolling.content || rolling.summary || "",
        sourceMessageCount: rolling.sourceMessageCount || 0,
        updatedAt: rolling.updatedAt || null
      }
    : null;

  const sectionCounts = {
    groupMentionContext: output.groupMentionContext.length,
    manualMemories: output.manualMemories.length,
    summaries: output.summaries.length,
    retrievedEvidence: output.retrievedEvidence.length,
    recentConversation: output.recentConversation.length
  };

  output.context_stats = {
    max_prompt_tokens: budget.max_prompt_tokens || 0,
    output_reserve_tokens: budget.output_reserve_tokens || 0,
    safety_reserve_tokens: budget.safety_reserve_tokens || 0,
    current_message_tokens: budget.current_message_tokens || 0,
    available_context_tokens: budget.available_context_tokens || 0,
    selected_chars: selectedChars,
    selected_estimated_tokens: estimateTokens("x".repeat(selectedChars)),
    truncated,
    section_counts: sectionCounts
  };
  output.stats = {
    ...(memoryContext.stats || {}),
    context_budget_selected_chars: selectedChars,
    context_budget_selected_estimated_tokens: output.context_stats.selected_estimated_tokens,
    context_budget_truncated: truncated
  };

  return output;
}

function budgetMemoryContext(memoryContext = {}, config = {}, options = {}) {
  const budget = createTokenBudget(config, {
    currentMessage: options.currentMessage || "",
    detailedRequest:
      options.detailedRequest === true ||
      (options.detailedRequest !== false && isDetailedRequest(options.currentMessage || "")),
    safetyReserveTokens: options.safetyReserveTokens
  });
  return applyContextBudget(memoryContext, budget);
}

module.exports = {
  applyContextBudget,
  budgetMemoryContext,
  createTokenBudget,
  estimateTokens,
  isDetailedRequest
};
