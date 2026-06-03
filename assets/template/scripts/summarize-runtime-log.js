const fs = require("fs");

const logPath = process.argv[2];
const baselineIso = process.argv[3];
const targetMessages = Number.parseInt(process.argv[4] || "5", 10);
const timeoutMs = Number.parseInt(process.argv[5] || "120000", 10);

if (!logPath || !baselineIso) {
  console.log(JSON.stringify({
    status: "FAIL",
    error_class: "missing_arguments"
  }, null, 2));
  process.exit(1);
}

const baseline = Date.parse(baselineIso);
const startedAt = Date.now();

function parseLines() {
  const text = fs.existsSync(logPath) ? fs.readFileSync(logPath, "utf8") : "";
  return text
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .filter((entry) => Date.parse(entry.ts || "") >= baseline);
}

function summarize(entries, timedOut) {
  const requestIds = new Set(
    entries
      .filter((entry) => entry.event === "message_type_text" && entry.request_id)
      .map((entry) => entry.request_id)
  );
  const lmSuccess = entries.filter((entry) => entry.event === "lmstudio_request_success").length;
  const lmTimeout = entries.filter((entry) => entry.event === "lmstudio_request_timeout").length;
  const lmErrors = entries.filter((entry) => entry.event === "lmstudio_request_error");
  const fallbackTrue = entries.filter(
    (entry) => entry.event === "fallback_used" && entry.used === true
  );
  const fallbackFalse = entries.filter(
    (entry) => entry.event === "fallback_used" && entry.used === false
  );
  const replySuccess = entries.filter((entry) => entry.event === "reply_api_success").length;
  const replyError = entries.filter((entry) => entry.event === "reply_api_error").length;

  return {
    status: timedOut ? "PARTIAL" : "PASS",
    target_messages: targetMessages,
    total_line_messages_observed: requestIds.size,
    webhook_event_count_seen: entries.some((entry) => entry.event === "webhook_event_count"),
    webhook_event_received_count: entries.filter(
      (entry) => entry.event === "webhook_event_received"
    ).length,
    message_type_text_count: requestIds.size,
    lmstudio_request_started_count: entries.filter(
      (entry) => entry.event === "lmstudio_request_started"
    ).length,
    lmstudio_request_success_count: lmSuccess,
    lmstudio_request_timeout_count: lmTimeout,
    lmstudio_request_error_count: lmErrors.length,
    lmstudio_error_classes: Array.from(new Set(lmErrors.map((entry) => entry.error_class))),
    fallback_count: fallbackTrue.length,
    fallback_false_count: fallbackFalse.length,
    fallback_reasons: Array.from(new Set(fallbackTrue.map((entry) => entry.reason))),
    reply_success_count: replySuccess,
    reply_error_count: replyError
  };
}

function poll() {
  const entries = parseLines();
  const observed = new Set(
    entries
      .filter((entry) => entry.event === "message_type_text" && entry.request_id)
      .map((entry) => entry.request_id)
  ).size;

  if (observed >= targetMessages) {
    console.log(JSON.stringify(summarize(entries, false), null, 2));
    return;
  }

  if (Date.now() - startedAt >= timeoutMs) {
    console.log(JSON.stringify(summarize(entries, true), null, 2));
    return;
  }

  setTimeout(poll, 1000);
}

poll();
