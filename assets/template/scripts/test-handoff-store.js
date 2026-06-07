const assert = require("node:assert/strict");
const { createHandoffStore } = require("../src/handoffStore");

function run() {
  const store = createHandoffStore(":memory:", { enableTestHelpers: true });
  try {
    const created = store.createTicket({
      triggerType: "policy_high_risk",
      triggerReason: "external_state_mutation_not_allowed",
      priority: "high",
      scopeType: "user",
      conversationKey: "user:test",
      questionText: "請部署 replyToken=secret",
      routeIntent: "general_chat",
      inputStyle: "planning_request",
      riskLevel: "high"
    });
    assert.equal(created.inserted, true);
    assert.equal(created.ticket.status, "open");
    assert.equal(created.ticket.priority, "high");
    assert.equal(created.ticket.questionTextSanitized.includes("secret"), false);

    const duplicate = store.createTicket({
      triggerType: "policy_high_risk",
      triggerReason: "external_state_mutation_not_allowed",
      scopeType: "user",
      conversationKey: "user:test",
      questionText: "請部署 replyToken=secret"
    });
    assert.equal(duplicate.duplicate, true);
    assert.equal(store.countTickets(), 1);

    const updated = store.updateTicketStatus(created.ticket.ticketId, "in_review", {
      actor: "admin",
      reason: "reviewing"
    });
    assert.equal(updated.status, "in_review");
    assert.throws(() => store.updateTicketStatus(created.ticket.ticketId, "triaged"), /invalid_ticket_status/);

    const draft = store.saveTicketDraft(created.ticket.ticketId, {
      draftType: "draft_reply",
      status: "completed",
      content: "建議先確認操作範圍。",
      provider: "lmstudio",
      modelName: "test-model",
      promptChars: 20
    });
    assert.equal(draft.outputChars > 0, true);
    assert.equal(store.listTicketDrafts(created.ticket.ticketId).length, 1);

    const full = store.getTicket(created.ticket.ticketId);
    assert.equal(full.events.length >= 3, true);
    assert.equal(full.drafts.length, 1);

    store.recordAdminAudit({
      action: "GET /admin/tickets",
      status: "completed",
      metadata: { token: "[not stored]" }
    });
    const audit = store.readAdminAuditLogs(1)[0];
    assert.equal(JSON.stringify(audit).includes("admin-token-value"), false);
  } finally {
    assert.deepEqual(store.close(), { closed: true });
  }

  const reopened = createHandoffStore(":memory:");
  reopened.close();
}

run();
console.log("PASS handoff store tests");
