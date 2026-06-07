const assert = require("node:assert/strict");
const { createConfirmationStore } = require("../src/confirmationStore");

const store = createConfirmationStore(":memory:");

try {
  const created = store.createPendingConfirmation({
    code: "ABC123",
    toolName: "handoff_ticket_create",
    actorType: "line",
    actorId: "U1",
    scopeType: "user",
    conversationKey: "user:U1",
    payload: {
      questionText: "請建立工單 replyToken=secret-token",
      admin_api_token: "secret-admin-token"
    },
    userVisibleSummary: "建立本機工單",
    createdAt: "2026-06-07T02:30:00.000Z",
    ttlMs: 600000
  });
  assert.equal(created.status, "pending");
  assert.equal(created.payload.questionText.includes("secret-token"), false);
  assert.equal(JSON.stringify(created.payload).includes("secret-admin-token"), false);

  const wrongScope = store.resolveConfirmation({
    code: "ABC123",
    conversationKey: "user:U2",
    actorId: "U1",
    now: "2026-06-07T02:31:00.000Z"
  });
  assert.equal(wrongScope.ok, false);
  assert.equal(wrongScope.reason, "confirmation_scope_mismatch");

  const executed = store.resolveConfirmation({
    code: "ABC123",
    conversationKey: "user:U1",
    actorId: "U1",
    now: "2026-06-07T02:31:00.000Z"
  });
  assert.equal(executed.ok, true);
  assert.equal(executed.status, "executed");

  const duplicate = store.resolveConfirmation({
    code: "ABC123",
    conversationKey: "user:U1",
    actorId: "U1",
    now: "2026-06-07T02:32:00.000Z"
  });
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.status, "executed");

  const cancellable = store.createPendingConfirmation({
    code: "CANCEL1",
    toolName: "handoff_ticket_create",
    actorType: "line",
    actorId: "U1",
    conversationKey: "user:U1",
    payload: { questionText: "取消測試" },
    createdAt: "2026-06-07T02:30:00.000Z",
    ttlMs: 600000
  });
  assert.equal(cancellable.status, "pending");
  const cancelled = store.resolveConfirmation({
    code: "CANCEL1",
    conversationKey: "user:U1",
    actorId: "U1",
    action: "cancel",
    now: "2026-06-07T02:31:00.000Z"
  });
  assert.equal(cancelled.ok, true);
  assert.equal(cancelled.status, "cancelled");

  store.createPendingConfirmation({
    code: "EXPIRE1",
    toolName: "handoff_ticket_create",
    actorType: "line",
    actorId: "U1",
    conversationKey: "user:U1",
    payload: { questionText: "過期測試" },
    createdAt: "2026-06-07T02:30:00.000Z",
    ttlMs: 1000
  });
  const expired = store.resolveConfirmation({
    code: "EXPIRE1",
    conversationKey: "user:U1",
    actorId: "U1",
    now: "2026-06-07T02:31:00.000Z"
  });
  assert.equal(expired.ok, false);
  assert.equal(expired.status, "expired");

  console.log("PASS confirmation store tests");
} finally {
  store.close();
}
