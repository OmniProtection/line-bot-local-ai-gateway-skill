const express = require("express");
const { evaluateToolPermission } = require("./permissionGate");
const { errorClass } = require("./logger");
const { createToolRegistry } = require("./toolRegistry");

function normalizeRemoteAddress(value) {
  return String(value || "")
    .replace(/^::ffff:/, "")
    .replace(/^\[|\]$/g, "");
}

function isLocalAddress(value) {
  const address = normalizeRemoteAddress(value);
  return (
    address === "127.0.0.1" ||
    address === "::1" ||
    address === "localhost"
  );
}

function getRemoteAddress(req) {
  return normalizeRemoteAddress(
    req.socket?.remoteAddress || req.connection?.remoteAddress || req.ip || ""
  );
}

function clampText(value, maxChars = 1800) {
  return String(value || "").trim().slice(0, maxChars);
}

function buildTicketPrompt(ticket, draftType) {
  const kind = draftType === "summary" ? "摘要" : "回覆草稿";
  return [
    `你是 LINE Bot 本機後台助手。請根據 ticket 內容產生${kind}。`,
    "使用繁體中文，直接、務實、短小。不要編造 ticket 沒有提供的資訊。",
    "不要輸出內部推理過程。",
    "",
    `Ticket ID: ${ticket.ticketId}`,
    `Trigger: ${ticket.triggerType} / ${ticket.triggerReason || "unknown"}`,
    `Status: ${ticket.status}`,
    `Question: ${ticket.questionTextSanitized || ""}`,
    `Context: ${JSON.stringify(ticket.contextSnapshot || {})}`
  ].join("\n");
}

function formatError(error) {
  return {
    ok: false,
    error: errorClass(error)
  };
}

function registerAdminRoutes(app, deps = {}) {
  const config = deps.config || {};
  const handoffStore = deps.handoffStore;
  const toolRegistry = deps.toolRegistry || createToolRegistry();
  const askLocalModel = deps.askLocalModel;
  const recordLlmCall = deps.recordLlmCall || (() => {});
  const nowIso = deps.nowIso || (() => new Date().toISOString());
  const adminEnabled = () => config.adminApiEnabled === true && Boolean(config.adminApiToken);
  const router = express.Router();

  router.use(express.json({ limit: "64kb" }));

  router.use((req, res, next) => {
    const remoteAddress = getRemoteAddress(req);
    if (!adminEnabled()) {
      return res.status(404).json({ ok: false, error: "admin_api_disabled" });
    }
    if (config.adminApiLocalhostOnly !== false && !isLocalAddress(remoteAddress)) {
      handoffStore?.recordAdminAudit?.({
        action: `${req.method} ${req.path}`,
        status: "rejected",
        reason: "non_localhost",
        remoteAddress
      });
      return res.status(403).json({ ok: false, error: "localhost_only" });
    }
    if (req.get("x-admin-api-token") !== config.adminApiToken) {
      handoffStore?.recordAdminAudit?.({
        action: `${req.method} ${req.path}`,
        status: "rejected",
        reason: "invalid_token",
        remoteAddress
      });
      return res.status(401).json({ ok: false, error: "unauthorized" });
    }
    res.locals.adminRemoteAddress = remoteAddress;
    return next();
  });

  router.get("/health", (req, res) => {
    handoffStore.recordAdminAudit({
      action: "GET /admin/health",
      status: "completed",
      remoteAddress: res.locals.adminRemoteAddress
    });
    res.json({ ok: true, status: "PASS" });
  });

  router.get("/tickets", (req, res) => {
    const permission = evaluateToolPermission({
      tool: toolRegistry?.getTool?.("admin_ticket_list"),
      actor: { type: "admin" },
      payload: {}
    });
    if (!permission.allowed) {
      return res.status(403).json({ ok: false, error: permission.reason });
    }
    const tickets = handoffStore.listTickets({
      status: req.query.status,
      triggerType: req.query.trigger_type || req.query.triggerType,
      limit: Number(req.query.limit) || 50
    });
    handoffStore.recordAdminAudit({
      action: "GET /admin/tickets",
      status: "completed",
      remoteAddress: res.locals.adminRemoteAddress,
      metadata: { count: tickets.length }
    });
    res.json({ ok: true, tickets });
  });

  router.post("/tickets", (req, res) => {
    const body = req.body || {};
    const result = handoffStore.createTicket({
      triggerType: "admin_manual",
      triggerReason: clampText(body.trigger_reason || body.reason || "manual_admin_ticket", 180),
      priority: body.priority || "normal",
      scopeType: body.scope_type || body.scopeType || null,
      conversationKey: body.conversation_key || body.conversationKey || null,
      questionText: body.question || body.question_text || body.text || "",
      routeIntent: body.route_intent || "admin_manual",
      inputStyle: body.input_style || "unknown",
      riskLevel: body.risk_level || "unknown",
      contextSnapshot: body.context_snapshot || null,
      actor: "admin",
      createdAt: nowIso()
    });
    handoffStore.recordAdminAudit({
      action: "POST /admin/tickets",
      ticketId: result.ticket.ticketId,
      status: result.inserted ? "created" : "duplicate",
      remoteAddress: res.locals.adminRemoteAddress
    });
    res.status(result.inserted ? 201 : 200).json({ ok: true, ...result });
  });

  router.get("/tickets/:ticketId", (req, res) => {
    const permission = evaluateToolPermission({
      tool: toolRegistry?.getTool?.("admin_ticket_get"),
      actor: { type: "admin" },
      payload: { ticketId: req.params.ticketId }
    });
    if (!permission.allowed) {
      return res.status(403).json({ ok: false, error: permission.reason });
    }
    const ticket = handoffStore.getTicket(req.params.ticketId);
    if (!ticket) {
      return res.status(404).json({ ok: false, error: "ticket_not_found" });
    }
    handoffStore.recordAdminAudit({
      action: "GET /admin/tickets/:ticketId",
      ticketId: ticket.ticketId,
      status: "completed",
      remoteAddress: res.locals.adminRemoteAddress
    });
    return res.json({ ok: true, ticket });
  });

  router.patch("/tickets/:ticketId/status", (req, res) => {
    try {
      const updated = handoffStore.updateTicketStatus(req.params.ticketId, req.body?.status, {
        actor: "admin",
        reason: clampText(req.body?.reason || "", 180),
        updatedAt: nowIso()
      });
      if (!updated) {
        return res.status(404).json({ ok: false, error: "ticket_not_found" });
      }
      handoffStore.recordAdminAudit({
        action: "PATCH /admin/tickets/:ticketId/status",
        ticketId: updated.ticketId,
        status: "completed",
        remoteAddress: res.locals.adminRemoteAddress,
        metadata: { new_status: updated.status }
      });
      return res.json({ ok: true, ticket: updated });
    } catch (error) {
      return res.status(400).json(formatError(error));
    }
  });

  async function generateDraft(req, res, draftType) {
    const ticket = handoffStore.getTicket(req.params.ticketId);
    if (!ticket) {
      return res.status(404).json({ ok: false, error: "ticket_not_found" });
    }
    if (typeof askLocalModel !== "function") {
      return res.status(503).json({ ok: false, error: "model_unavailable" });
    }

    const prompt = buildTicketPrompt(ticket, draftType);
    const startedAt = Date.now();
    let modelResult;
    try {
      modelResult = await askLocalModel(prompt, config, null, {
        timeoutMs: config.localModelTimeoutMs
      });
    } catch (error) {
      modelResult = {
        text: "",
        fallbackUsed: true,
        reason: errorClass(error),
        durationMs: Date.now() - startedAt,
        retryCount: 0
      };
    }

    recordLlmCall({
      callType: draftType === "summary" ? "handoff_summary" : "handoff_draft",
      context: {
        request_id: ticket.ticketId,
        intent: ticket.routeIntent || "handoff",
        risk_level: ticket.riskLevel || "unknown"
      },
      scope: {
        key: ticket.conversationKey
      },
      modelInput: prompt,
      modelResult,
      handoffTriggered: true
    });

    const draft = handoffStore.saveTicketDraft(ticket.ticketId, {
      draftType,
      status: modelResult.fallbackUsed ? "failed" : "completed",
      content: modelResult.text || "",
      provider: config.localModelProvider,
      modelName: config.localModelName,
      promptChars: prompt.length,
      fallbackReason: modelResult.reason,
      actor: "admin",
      createdAt: nowIso()
    });
    handoffStore.recordAdminAudit({
      action:
        draftType === "summary"
          ? "POST /admin/tickets/:ticketId/summary"
          : "POST /admin/tickets/:ticketId/draft-reply",
      ticketId: ticket.ticketId,
      status: draft?.status || "failed",
      reason: modelResult.reason,
      remoteAddress: res.locals.adminRemoteAddress
    });

    if (modelResult.fallbackUsed) {
      return res.status(502).json({ ok: false, error: modelResult.reason || "draft_failed", draft });
    }
    return res.json({ ok: true, draft });
  }

  router.post("/tickets/:ticketId/summary", (req, res) => {
    generateDraft(req, res, "summary").catch((error) => {
      res.status(500).json(formatError(error));
    });
  });

  router.post("/tickets/:ticketId/draft-reply", (req, res) => {
    generateDraft(req, res, "draft_reply").catch((error) => {
      res.status(500).json(formatError(error));
    });
  });

  app.use("/admin", router);
  return router;
}

module.exports = {
  buildTicketPrompt,
  isLocalAddress,
  registerAdminRoutes
};
