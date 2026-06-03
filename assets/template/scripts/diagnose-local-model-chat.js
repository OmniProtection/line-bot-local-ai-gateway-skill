const ATTEMPTS = 5;
const BASE_URL = "http://127.0.0.1:1234/v1";
const MODEL = "qwen3.6-12b-iq-ultra-heretic-uncensored-thinking-v2-hightop";
const TIMEOUT_MS = 60000;
const REASONING_TRACE_MARKERS = [
  "<think>",
  "</think>",
  "Thinking Process:",
  "Selected draft:",
  "Let's check",
  "User asks:",
  "Wait, I should",
  "Review Constraints:",
  "Analyze the Request:",
  "Determine the Intent:",
  "Draft Responses",
  "Drafting the Response",
  "Internal Monologue",
  "Formulate the Response",
  "Identify the Core Fact",
  "Determine the Response Content",
  "Step-by-step",
  "思考過程",
  "推理過程",
  "分析請求"
];

function errorClass(error) {
  if (error?.name === "AbortError") {
    return "timeout";
  }

  const code = error?.code || error?.cause?.code;
  if (code === "ECONNREFUSED") {
    return "connection_refused";
  }

  return error?.name || "unknown_error";
}

function containsReasoningTrace(text) {
  return REASONING_TRACE_MARKERS.some((marker) =>
    text.toLowerCase().includes(marker.toLowerCase())
  );
}

function extractChatText(payload) {
  const text = payload?.choices?.[0]?.message?.content;
  return typeof text === "string" ? text.trim() : "";
}

function buildBody() {
  return {
    model: MODEL,
    messages: [
      {
        role: "system",
        content:
          "You are a concise LINE chat assistant. You must always return at least one non-empty Traditional Chinese sentence. Never return an empty response. Do not expose reasoning, hidden analysis, or chain-of-thought."
      },
      {
        role: "user",
        content: "請用繁體中文簡短回答測試成功。"
      }
    ],
    temperature: 0,
    top_p: 0.9,
    max_tokens: 900,
    stream: false
  };
}

async function postChatCompletion() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const startedAt = Date.now();

  try {
    const response = await fetch(`${BASE_URL.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(buildBody())
    });
    const durationMs = Date.now() - startedAt;
    const payload = await response.json().catch(() => null);

    if (!payload) {
      return {
        http_status: response.status,
        duration_ms: durationMs,
        error_class: "invalid_json",
        extracted_text_length: 0,
        reasoning_trace_detected: false,
        extracted_text_non_empty: false,
        safe_for_line: false
      };
    }

    const text = extractChatText(payload);
    const reasoningTraceDetected = containsReasoningTrace(text);

    return {
      http_status: response.status,
      duration_ms: durationMs,
      response_keys_count: Object.keys(payload).length,
      choices_count: Array.isArray(payload?.choices) ? payload.choices.length : 0,
      finish_reason:
        typeof payload?.choices?.[0]?.finish_reason === "string"
          ? payload.choices[0].finish_reason
          : null,
      reasoning_trace_detected: reasoningTraceDetected,
      extracted_text_length: text.length,
      extracted_text_non_empty: text.length > 0,
      safe_for_line: text.length > 0 && !reasoningTraceDetected
    };
  } catch (error) {
    return {
      duration_ms: Date.now() - startedAt,
      error_class: errorClass(error),
      extracted_text_length: 0,
      reasoning_trace_detected: false,
      extracted_text_non_empty: false,
      safe_for_line: false
    };
  } finally {
    clearTimeout(timeout);
  }
}

function summarize(results) {
  return {
    status: results.every((result) => result.safe_for_line) ? "PASS" : "PARTIAL",
    endpoint: "http://127.0.0.1:1234/v1/chat/completions",
    model: MODEL,
    attempts: results.length,
    http_200_count: results.filter((result) => result.http_status === 200).length,
    reasoning_trace_detected_count: results.filter((result) => result.reasoning_trace_detected).length,
    extracted_non_empty_count: results.filter((result) => result.extracted_text_non_empty).length,
    extracted_empty_count: results.filter((result) => !result.extracted_text_non_empty).length,
    safe_for_line_count: results.filter((result) => result.safe_for_line).length,
    unsafe_for_line_count: results.filter((result) => !result.safe_for_line).length,
    error_classes: Array.from(new Set(results.map((result) => result.error_class).filter(Boolean))),
    attempts_metadata: results
  };
}

async function main() {
  const results = [];

  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    const result = await postChatCompletion();
    results.push({
      attempt,
      ...result
    });
  }

  console.log(JSON.stringify(summarize(results), null, 2));
}

main().catch((error) => {
  console.log(JSON.stringify({
    status: "FAIL",
    error_class: errorClass(error)
  }, null, 2));
  process.exitCode = 1;
});
