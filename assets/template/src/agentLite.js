function parseConfirmationCommand(text) {
  const normalized = String(text || "").trim();
  const match = normalized.match(/^(確認|取消)\s+([A-Z0-9]{6,16})$/u);
  if (!match) {
    return null;
  }
  return {
    action: match[1] === "確認" ? "confirm" : "cancel",
    code: match[2]
  };
}

function extractHandoffTicketRequest(text) {
  const normalized = String(text || "").trim();
  const match = normalized.match(/^(建立工單|開工單|建立ticket|建立Ticket)[：:]\s*(.+)$/u);
  if (!match) {
    return null;
  }
  const questionText = match[2].trim();
  if (!questionText) {
    return null;
  }
  return {
    questionText,
    summary: `建立本機人工處理工單：${questionText.slice(0, 80)}`
  };
}

function createToolPlan({ modelInput = "", registry = null } = {}) {
  const handoffRequest = extractHandoffTicketRequest(modelInput);
  if (!handoffRequest) {
    return null;
  }

  const tool = registry?.getTool?.("handoff_ticket_create");
  if (!tool) {
    return {
      ok: false,
      reason: "unknown_tool",
      tool_name: "handoff_ticket_create"
    };
  }

  return {
    ok: true,
    tool_name: "handoff_ticket_create",
    arguments: {
      questionText: handoffRequest.questionText,
      triggerReason: "user_requested_handoff_ticket"
    },
    confidence: 1,
    requires_confirmation: tool.requires_confirmation === true,
    user_visible_summary: handoffRequest.summary,
    reason: "explicit_handoff_ticket_command"
  };
}

module.exports = {
  createToolPlan,
  parseConfirmationCommand
};
