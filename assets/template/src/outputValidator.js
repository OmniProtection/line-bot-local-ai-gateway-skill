const DEFAULT_INSUFFICIENT_KB_REPLY = "目前知識庫資料不足，我還不能確定答案。";

const KB_REQUIRED_INPUT_STYLES = new Set([
  "technical_question",
  "planning_request"
]);

function normalizeEvidence(knowledgeEvidence) {
  if (Array.isArray(knowledgeEvidence)) {
    return knowledgeEvidence;
  }
  if (Array.isArray(knowledgeEvidence?.items)) {
    return knowledgeEvidence.items;
  }
  return [];
}

function claimsKnowledgeBase(text) {
  return /根據知識庫|知識庫|根據文件|文件指出|資料庫顯示/u.test(String(text || ""));
}

function isKnowledgeRequired(routeDecision = {}) {
  if (routeDecision.knowledge_required === true) {
    return true;
  }
  if (routeDecision.intent !== "general_chat") {
    return false;
  }
  return KB_REQUIRED_INPUT_STYLES.has(routeDecision.input_style || "");
}

function fallbackText(config = {}) {
  return String(config.knowledgeBaseInsufficientReply || DEFAULT_INSUFFICIENT_KB_REPLY);
}

function validateModelOutput({
  modelInput = "",
  modelOutput = "",
  knowledgeEvidence = [],
  routeDecision = {},
  policyDecision = {},
  config = {}
} = {}) {
  const evidence = normalizeEvidence(knowledgeEvidence);
  const evidenceCount = evidence.length;
  const outputText =
    typeof modelOutput === "string" ? modelOutput : String(modelOutput?.text || modelOutput?.answer || "");
  const text = outputText.trim();
  const knowledgeRequired = isKnowledgeRequired(routeDecision);

  if (!text) {
    return {
      ok: false,
      text: fallbackText(config),
      fallbackUsed: true,
      reason: "empty_model_output",
      evidenceCount
    };
  }

  if (evidenceCount === 0 && (knowledgeRequired || claimsKnowledgeBase(text))) {
    return {
      ok: false,
      text: fallbackText(config),
      fallbackUsed: true,
      reason: knowledgeRequired ? "knowledge_evidence_missing" : "unsupported_knowledge_claim",
      evidenceCount
    };
  }

  return {
    ok: true,
    text,
    fallbackUsed: false,
    reason: "validated",
    evidenceCount,
    policyMode: policyDecision?.response_mode || null,
    inputChars: String(modelInput || "").length,
    outputChars: text.length
  };
}

module.exports = {
  DEFAULT_INSUFFICIENT_KB_REPLY,
  validateModelOutput
};
