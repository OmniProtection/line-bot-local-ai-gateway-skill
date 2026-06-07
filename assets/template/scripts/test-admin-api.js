const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");
const { registerAdminRoutes, isLocalAddress } = require("../src/adminApi");
const { createHandoffStore } = require("../src/handoffStore");

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function requestJson(port, method, path, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : "";
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method,
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(payload),
          ...(token ? { "x-admin-api-token": token } : {})
        }
      },
      (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          let parsed = null;
          try {
            parsed = data ? JSON.parse(data) : null;
          } catch {
            parsed = data;
          }
          resolve({
            statusCode: res.statusCode,
            body: parsed
          });
        });
      }
    );
    req.on("error", reject);
    req.end(payload);
  });
}

async function withAdminApp(config, fn, overrides = {}) {
  const app = express();
  const store = createHandoffStore(":memory:", { enableTestHelpers: true });
  const llmCalls = [];
  registerAdminRoutes(app, {
    config,
    handoffStore: store,
    askLocalModel:
      overrides.askLocalModel ||
      (async () => ({
        text: "這是本機後台產生的草稿。",
        fallbackUsed: false,
        reason: "success",
        durationMs: 1,
        retryCount: 0
      })),
    recordLlmCall: (entry) => llmCalls.push(entry),
    nowIso: () => "2026-06-07T01:30:00.000Z"
  });
  const server = await listen(app);
  try {
    await fn(server.address().port, store, llmCalls);
  } finally {
    await closeServer(server);
    store.close();
  }
}

async function run() {
  assert.equal(isLocalAddress("127.0.0.1"), true);
  assert.equal(isLocalAddress(""), false);
  assert.equal(isLocalAddress("8.8.8.8"), false);

  await withAdminApp(
    {
      adminApiEnabled: false,
      adminApiToken: "",
      adminApiLocalhostOnly: true
    },
    async (port) => {
      const disabled = await requestJson(port, "GET", "/admin/health");
      assert.equal(disabled.statusCode, 404);
      assert.equal(disabled.body.error, "admin_api_disabled");
    }
  );

  const enabledConfig = {
    adminApiEnabled: true,
    adminApiToken: "test-admin-token",
    adminApiLocalhostOnly: true,
    localModelProvider: "lmstudio",
    localModelName: "test-model",
    localModelTimeoutMs: 1000
  };

  await withAdminApp(enabledConfig, async (port, store, llmCalls) => {
    const unauthorized = await requestJson(port, "GET", "/admin/health");
    assert.equal(unauthorized.statusCode, 401);
    assert.equal(JSON.stringify(store.readAdminAuditLogs(5)).includes("test-admin-token"), false);

    const health = await requestJson(port, "GET", "/admin/health", null, "test-admin-token");
    assert.equal(health.statusCode, 200);
    assert.equal(health.body.status, "PASS");

    const sendMissing = await requestJson(port, "POST", "/admin/tickets/not-real/send", {}, "test-admin-token");
    assert.equal(sendMissing.statusCode, 404);

    const created = await requestJson(
      port,
      "POST",
      "/admin/tickets",
      {
        question: "請人工確認這個問題",
        scope_type: "user",
        conversation_key: "user:admin-test"
      },
      "test-admin-token"
    );
    assert.equal(created.statusCode, 201);
    const ticketId = created.body.ticket.ticketId;

    const listed = await requestJson(port, "GET", "/admin/tickets", null, "test-admin-token");
    assert.equal(listed.body.tickets.length, 1);

    const detail = await requestJson(port, "GET", `/admin/tickets/${ticketId}`, null, "test-admin-token");
    assert.equal(detail.statusCode, 200);
    assert.equal(detail.body.ticket.events.length >= 1, true);

    const updated = await requestJson(
      port,
      "PATCH",
      `/admin/tickets/${ticketId}/status`,
      { status: "in_review", reason: "checking" },
      "test-admin-token"
    );
    assert.equal(updated.statusCode, 200);
    assert.equal(updated.body.ticket.status, "in_review");

    const invalid = await requestJson(
      port,
      "PATCH",
      `/admin/tickets/${ticketId}/status`,
      { status: "triaged" },
      "test-admin-token"
    );
    assert.equal(invalid.statusCode, 400);

    const summary = await requestJson(port, "POST", `/admin/tickets/${ticketId}/summary`, {}, "test-admin-token");
    assert.equal(summary.statusCode, 200);
    assert.equal(summary.body.draft.draftType, "summary");
    assert.equal(llmCalls.at(-1).handoffTriggered, true);

    const draft = await requestJson(port, "POST", `/admin/tickets/${ticketId}/draft-reply`, {}, "test-admin-token");
    assert.equal(draft.statusCode, 200);
    assert.equal(draft.body.draft.draftType, "draft_reply");
  });
}

run()
  .then(() => {
    console.log("PASS admin API tests");
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
