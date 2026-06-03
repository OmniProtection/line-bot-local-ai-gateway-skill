const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const targets = [
  path.join(projectRoot, "runtime-server.out.log"),
  path.join(projectRoot, "runtime-server.err.log"),
  path.join(projectRoot, "logs")
];

const COUNTER_EVENTS = [
  "web_search_job_completed",
  "web_search_lmstudio_tools_fallback",
  "web_search_job_error",
  "web_search_no_results",
  "web_search_no_relevant_candidates",
  "web_search_provider_no_candidates",
  "web_search_timeout",
  "web_search_error",
  "lmstudio_web_search_tools_success",
  "lmstudio_web_search_tools_error",
  "lmstudio_plugin_permission_denied",
  "lmstudio_request_timeout",
  "fallback_used",
  "push_api_failed",
  "web_search_push_failed",
  "group_message_ignored_no_self_mention",
  "memory_organization_timeout",
  "general_direct_reply_fallback_to_async",
  "general_reply_job_completed"
];

function listLogFiles(target) {
  if (!fs.existsSync(target)) {
    return [];
  }

  const stat = fs.statSync(target);
  if (stat.isFile()) {
    return [target];
  }

  return fs
    .readdirSync(target)
    .map((name) => path.join(target, name))
    .filter((candidate) => fs.statSync(candidate).isFile())
    .filter((candidate) => /\.(log|ndjson)$/u.test(candidate));
}

function parseJsonLine(line) {
  const trimmed = line.trim();
  if (!trimmed || !trimmed.startsWith("{")) {
    return null;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function percentile(values, ratio) {
  if (values.length === 0) {
    return null;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index];
}

function addCounter(counters, name) {
  counters[name] = (counters[name] || 0) + 1;
}

function audit() {
  const files = [...new Set(targets.flatMap(listLogFiles))];
  const counters = {};
  const webSearchDurations = [];
  const lmstudioToolDurations = [];
  const lmstudioToolTimeoutDurations = [];
  const generalReplyDurations = [];
  const samples = [];
  let parsedLines = 0;

  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    for (const line of text.split(/\r?\n/u)) {
      const event = parseJsonLine(line);
      if (!event?.event) {
        continue;
      }

      parsedLines += 1;
      if (COUNTER_EVENTS.includes(event.event)) {
        addCounter(counters, event.event);
      }
      if (event.event === "web_search_job_completed" && Number.isFinite(event.duration_ms)) {
        webSearchDurations.push(event.duration_ms);
      }
      if (event.event === "lmstudio_web_search_tools_success" && Number.isFinite(event.duration_ms)) {
        lmstudioToolDurations.push(event.duration_ms);
      }
      if (
        event.event === "lmstudio_web_search_tools_error" &&
        event.error_class === "timeout" &&
        Number.isFinite(event.duration_ms)
      ) {
        lmstudioToolTimeoutDurations.push(event.duration_ms);
      }
      if (event.event === "general_reply_job_completed" && Number.isFinite(event.duration_ms)) {
        generalReplyDurations.push(event.duration_ms);
      }
      if (
        [
          "web_search_lmstudio_tools_fallback",
          "memory_organization_timeout",
          "lmstudio_request_timeout",
          "push_api_failed",
          "web_search_push_failed"
        ].includes(event.event)
      ) {
        samples.push({
          event: event.event,
          fallback_reason: event.fallback_reason || null,
          request_id: event.request_id || null,
          source_type: event.source_type || null,
          ts: event.ts || null
        });
      }
    }
  }

  const findings = [];
  if ((counters.memory_organization_timeout || 0) > 0) {
    findings.push({
      severity: "HIGH",
      scenario: "Group/room no-mention background memory organization",
      evidence: `${counters.memory_organization_timeout} memory_organization_timeout events in runtime logs`,
      likelyCause:
        "Group/room raw events are queued for memory organization even when no bot mention is present.",
      recommendation:
        "Keep no-mention group/room events as raw event log only; do not enqueue LM Studio summarization."
    });
  }
  if ((counters.web_search_lmstudio_tools_fallback || 0) > 0) {
    findings.push({
      severity: "MEDIUM",
      scenario: "LM Studio web-search tools instability",
      evidence: `${counters.web_search_lmstudio_tools_fallback} web_search_lmstudio_tools_fallback events`,
      likelyCause: "LM Studio web-tools calls can exceed the configured job budget or fail before fallback.",
      recommendation:
        "Keep explicit fallback routing covered by tests and consider shorter search/tool budgets after observing live smoke results."
    });
  }
  if ((counters.lmstudio_web_search_tools_error || 0) > 0) {
    findings.push({
      severity: "HIGH",
      scenario: "LM Studio web-tools timeout",
      evidence: `${counters.lmstudio_web_search_tools_error} lmstudio_web_search_tools_error events`,
      likelyCause: "LM Studio web-tools integration is slow or unavailable for live search queries.",
      recommendation:
        "Keep LINE runtime search on deterministic web evidence; treat web-tools as experimental smoke only."
    });
  }
  if (
    (counters.web_search_no_results || 0) +
      (counters.web_search_no_relevant_candidates || 0) +
      (counters.web_search_provider_no_candidates || 0) >
    0
  ) {
    findings.push({
      severity: "MEDIUM",
      scenario: "Web evidence empty",
      evidence: `${counters.web_search_no_results || 0} no_results, ${
        counters.web_search_no_relevant_candidates || 0
      } no_relevant_candidates, ${counters.web_search_provider_no_candidates || 0} provider_no_candidates events`,
      likelyCause: "Search provider returned no candidates or ranking/security filters rejected all candidates.",
      recommendation:
        "Keep the user-facing no-evidence Push explicit and preserve query/provider/evidence counters in logs."
    });
  }
  if ((counters.group_message_ignored_no_self_mention || 0) > 0) {
    findings.push({
      severity: "INFO",
      scenario: "Group/room no-mention ignored",
      evidence: `${counters.group_message_ignored_no_self_mention} group_message_ignored_no_self_mention events`,
      likelyCause: "Expected routing rule: group/room messages without @Bot are raw event log only.",
      recommendation: "Keep this visible in audits to prove no-search/no-model routing is working."
    });
  }
  if ((counters.push_api_failed || 0) + (counters.web_search_push_failed || 0) > 0) {
    findings.push({
      severity: "HIGH",
      scenario: "LINE Push delivery failure",
      evidence: `${counters.push_api_failed || 0} push_api_failed and ${
        counters.web_search_push_failed || 0
      } web_search_push_failed events`,
      likelyCause: "LINE push target/token/network failure.",
      recommendation: "Keep push failure visible in report; do not retry with Broadcast/Multicast."
    });
  }

  const output = {
    status: "PASS",
    mode: parsedLines > 0 ? "audited" : "no_log_lines",
    files_scanned: files.map((file) => path.relative(projectRoot, file)),
    parsed_lines: parsedLines,
    counters,
    duration_ms: {
      general_reply_job_completed: {
        count: generalReplyDurations.length,
        max: generalReplyDurations.length ? Math.max(...generalReplyDurations) : null,
        p50: percentile(generalReplyDurations, 0.5),
        p95: percentile(generalReplyDurations, 0.95)
      },
      lmstudio_web_search_tools_success: {
        count: lmstudioToolDurations.length,
        max: lmstudioToolDurations.length ? Math.max(...lmstudioToolDurations) : null,
        p50: percentile(lmstudioToolDurations, 0.5),
        p95: percentile(lmstudioToolDurations, 0.95)
      },
      lmstudio_web_search_tools_timeout: {
        count: lmstudioToolTimeoutDurations.length,
        max: lmstudioToolTimeoutDurations.length ? Math.max(...lmstudioToolTimeoutDurations) : null,
        p50: percentile(lmstudioToolTimeoutDurations, 0.5),
        p95: percentile(lmstudioToolTimeoutDurations, 0.95)
      },
      web_search_job_completed: {
        count: webSearchDurations.length,
        max: webSearchDurations.length ? Math.max(...webSearchDurations) : null,
        p50: percentile(webSearchDurations, 0.5),
        p95: percentile(webSearchDurations, 0.95)
      }
    },
    findings,
    samples: samples.slice(-20)
  };

  console.log(JSON.stringify(output, null, 2));
}

audit();
