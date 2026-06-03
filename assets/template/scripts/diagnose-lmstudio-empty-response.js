const ATTEMPTS = 20;
const BASE_URL = "http://127.0.0.1:1234/v1";
const MODEL = "qwen3.6-12b-iq-ultra-heretic-uncensored-thinking-v2-hightop";
const TIMEOUT_MS = 60000;
const EMPTY_RESPONSE_RETRY_DELAY_MS = 500;

function nowIso() {
  return new Date().toISOString();
}

function contentArrayTextLength(content) {
  if (!Array.isArray(content)) {
    return 0;
  }

  return content.reduce((total, item) => {
    if (typeof item?.text === "string") {
      return total + item.text.trim().length;
    }

    if (typeof item === "string") {
      return total + item.trim().length;
    }

    return total;
  }, 0);
}

function currentExtract(payload) {
  const text = payload?.choices?.[0]?.message?.content;
  return typeof text === "string" ? text.trim() : "";
}

function relaxedExtract(payload) {
  const choice = payload?.choices?.[0];
  const content = choice?.message?.content;

  if (typeof content === "string" && content.trim()) {
    return content.trim();
  }

  if (Array.isArray(content)) {
    const joined = content
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }

        if (typeof item?.text === "string") {
          return item.text;
        }

        return "";
      })
      .join("")
      .trim();

    if (joined) {
      return joined;
    }
  }

  if (typeof choice?.text === "string" && choice.text.trim()) {
    return choice.text.trim();
  }

  return "";
}

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

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function metadataFromPayload(attempt, status, durationMs, payload, retryCount) {
  const choice = payload?.choices?.[0];
  const content = choice?.message?.content;
  const current = currentExtract(payload);
  const relaxed = relaxedExtract(payload);
  const choicesText = choice?.text;
  const contentArrayLength = contentArrayTextLength(content);
  const messageContentLength = typeof content === "string" ? content.length : 0;
  const messageContentTrimmedLength = typeof content === "string" ? content.trim().length : 0;

  return {
    attempt,
    retry_count: retryCount,
    http_status: status,
    duration_ms: durationMs,
    choices_count: Array.isArray(payload?.choices) ? payload.choices.length : 0,
    finish_reason: typeof choice?.finish_reason === "string" ? choice.finish_reason : null,
    message_content_exists: content !== undefined && content !== null,
    message_content_type: Array.isArray(content) ? "array" : typeof content,
    message_content_length: messageContentLength,
    message_content_trimmed_length: messageContentTrimmedLength,
    choices_text_exists: typeof choicesText === "string",
    choices_text_length: typeof choicesText === "string" ? choicesText.length : 0,
    content_array_exists: Array.isArray(content),
    content_array_text_item_count: Array.isArray(content)
      ? content.filter((item) => typeof item === "string" || typeof item?.text === "string").length
      : 0,
    content_array_text_length: contentArrayLength,
    usage_fields_present: Boolean(payload?.usage),
    current_parser_extracted_text_length: current.length,
    relaxed_parser_extracted_text_length: relaxed.length,
    alternate_field_available: !current && Boolean(relaxed),
    empty_response: !current
  };
}

async function requestCompletion(attempt, retryCount) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const startedAt = Date.now();

  try {
    const response = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          {
            role: "system",
            content: "Reply briefly in Traditional Chinese."
          },
          {
            role: "user",
            content: "請只用繁體中文回答：測試成功"
          }
        ],
        temperature: 0.4,
        max_tokens: 900,
        stream: false
      })
    });

    const durationMs = Date.now() - startedAt;
    const payload = await response.json().catch(() => null);

    if (!payload) {
      return {
        attempt,
        retry_count: retryCount,
        http_status: response.status,
        duration_ms: durationMs,
        error_class: "invalid_json",
        empty_response: true
      };
    }

    return metadataFromPayload(attempt, response.status, durationMs, payload, retryCount);
  } catch (error) {
    return {
      attempt,
      retry_count: retryCount,
      duration_ms: Date.now() - startedAt,
      error_class: errorClass(error),
      empty_response: true
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function runAttempt(attempt) {
  const first = await requestCompletion(attempt, 0);

  if (!first.empty_response) {
    return {
      ...first,
      empty_before_retry: false,
      retry_success: false,
      retry_exhausted: false,
      final_empty_response: false
    };
  }

  await delay(EMPTY_RESPONSE_RETRY_DELAY_MS);

  const retry = await requestCompletion(attempt, 1);

  return {
    ...retry,
    first_finish_reason: first.finish_reason || null,
    first_error_class: first.error_class || null,
    first_http_status: first.http_status || null,
    first_message_content_trimmed_length: first.message_content_trimmed_length || 0,
    empty_before_retry: true,
    retry_success: !retry.empty_response,
    retry_exhausted: Boolean(retry.empty_response),
    final_empty_response: Boolean(retry.empty_response)
  };
}

function summarize(results) {
  const emptyBeforeRetryCount = results.filter((result) => result.empty_before_retry).length;
  const retrySuccessCount = results.filter((result) => result.retry_success).length;
  const retryExhaustedCount = results.filter((result) => result.retry_exhausted).length;
  const currentParserEmptyCount = results.filter((result) => result.final_empty_response).length;
  const relaxedParserEmptyCount = results.filter((result) => result.final_empty_response).length;
  const rawContentEmptyCount = results.filter(
    (result) => result.empty_before_retry || result.final_empty_response
  ).length;
  const alternateFieldAvailableCount = results.filter(
    (result) => result.alternate_field_available
  ).length;

  return {
    status: "PASS",
    generated_at: nowIso(),
    endpoint: "http://127.0.0.1:1234/v1/chat/completions",
    model: MODEL,
    attempts: results.length,
    empty_response_count_before_retry: emptyBeforeRetryCount,
    retry_success_count: retrySuccessCount,
    retry_exhausted_count: retryExhaustedCount,
    direct_empty_response_count: currentParserEmptyCount,
    current_parser_empty_count: currentParserEmptyCount,
    relaxed_parser_empty_count: relaxedParserEmptyCount,
    raw_content_empty_count: rawContentEmptyCount,
    alternate_field_available_count: alternateFieldAvailableCount,
    attempts_metadata: results
  };
}

async function main() {
  const results = [];

  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    results.push(await runAttempt(attempt));
  }

  console.log(JSON.stringify(summarize(results), null, 2));
}

main().catch((error) => {
  console.log(JSON.stringify({
    status: "FAIL",
    generated_at: nowIso(),
    error_class: errorClass(error)
  }, null, 2));
  process.exitCode = 1;
});
