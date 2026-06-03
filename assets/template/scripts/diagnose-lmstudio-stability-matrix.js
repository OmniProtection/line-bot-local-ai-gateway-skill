const ATTEMPTS_PER_CASE = 20;
const BASE_URL = "http://127.0.0.1:1234/v1";
const MODEL = "qwen3.6-12b-iq-ultra-heretic-uncensored-thinking-v2-hightop";
const TIMEOUT_MS = 60000;

const baseMessages = [
  {
    role: "system",
    content: "You are a concise LINE chat assistant. Reply clearly and briefly."
  },
  {
    role: "user",
    content: "請只用繁體中文回答：測試成功"
  }
];

const strongMessages = [
  {
    role: "system",
    content:
      "You are a concise LINE chat assistant. You must always return at least one non-empty Traditional Chinese sentence. Never return an empty response."
  },
  {
    role: "user",
    content: "請只用繁體中文回答：測試成功"
  }
];

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function extractText(payload) {
  const content = payload?.choices?.[0]?.message?.content;
  return typeof content === "string" ? content.trim() : "";
}

function metadata(payload, status, durationMs, retryCount) {
  const choice = payload?.choices?.[0];
  const content = choice?.message?.content;
  const text = extractText(payload);

  return {
    http_status: status,
    duration_ms: durationMs,
    retry_count: retryCount,
    choices_count: Array.isArray(payload?.choices) ? payload.choices.length : 0,
    finish_reason: typeof choice?.finish_reason === "string" ? choice.finish_reason : null,
    message_content_exists: content !== undefined && content !== null,
    message_content_type: Array.isArray(content) ? "array" : typeof content,
    message_content_length: typeof content === "string" ? content.length : 0,
    message_content_trimmed_length: typeof content === "string" ? content.trim().length : 0,
    choices_text_exists: typeof choice?.text === "string",
    content_array_exists: Array.isArray(content),
    usage_fields_present: Boolean(payload?.usage),
    extracted_text_length: text.length,
    empty_response: text.length === 0
  };
}

async function postJson(url, body) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const startedAt = Date.now();

  try {
    const response = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(body)
    });
    const durationMs = Date.now() - startedAt;
    const payload = await response.json().catch(() => null);

    if (!payload) {
      return {
        http_status: response.status,
        duration_ms: durationMs,
        error_class: "invalid_json",
        empty_response: true
      };
    }

    return {
      payload,
      status: response.status,
      durationMs
    };
  } catch (error) {
    return {
      duration_ms: Date.now() - startedAt,
      error_class: errorClass(error),
      empty_response: true
    };
  } finally {
    clearTimeout(timeout);
  }
}

function openAiBody(settings) {
  return {
    model: MODEL,
    messages: settings.messages,
    temperature: settings.temperature,
    max_tokens: settings.maxTokens,
    stream: false,
    ...(settings.topP === undefined ? {} : { top_p: settings.topP })
  };
}

async function runOpenAiAttempt(settings, retryLimit = 0) {
  const first = await postJson(`${BASE_URL}/chat/completions`, openAiBody(settings));

  if (!first.payload) {
    return {
      ...first,
      empty_before_retry: true,
      retry_success: false,
      retry_exhausted: retryLimit > 0
    };
  }

  const firstMeta = metadata(first.payload, first.status, first.durationMs, 0);

  if (!firstMeta.empty_response || retryLimit === 0) {
    return {
      ...firstMeta,
      empty_before_retry: firstMeta.empty_response,
      retry_success: false,
      retry_exhausted: firstMeta.empty_response && retryLimit > 0
    };
  }

  let lastMeta = firstMeta;
  for (let retryCount = 1; retryCount <= retryLimit; retryCount += 1) {
    await delay(500);
    const retry = await postJson(`${BASE_URL}/chat/completions`, openAiBody(settings));
    if (!retry.payload) {
      lastMeta = {
        ...retry,
        retry_count: retryCount,
        empty_response: true
      };
    } else {
      lastMeta = metadata(retry.payload, retry.status, retry.durationMs, retryCount);
    }

    if (!lastMeta.empty_response) {
      return {
        ...lastMeta,
        empty_before_retry: true,
        retry_success: true,
        retry_exhausted: false
      };
    }
  }

  return {
    ...lastMeta,
    empty_before_retry: true,
    retry_success: false,
    retry_exhausted: true
  };
}

async function runNativeAttempt(settings) {
  const result = await postJson(`${BASE_URL.replace(/\/v1$/, "")}/api/v1/chat`, {
    model: MODEL,
    messages: settings.messages,
    temperature: settings.temperature,
    max_output_tokens: settings.maxTokens,
    stream: false
  });

  if (!result.payload) {
    return {
      ...result,
      native_supported: false
    };
  }

  const text =
    typeof result.payload?.content === "string"
      ? result.payload.content.trim()
      : typeof result.payload?.message?.content === "string"
        ? result.payload.message.content.trim()
        : "";

  return {
    http_status: result.status,
    duration_ms: result.durationMs,
    native_supported: true,
    extracted_text_length: text.length,
    empty_response: text.length === 0,
    response_keys_count: Object.keys(result.payload || {}).length
  };
}

function summarizeCase(name, results) {
  const emptyBeforeRetry = results.filter((result) => result.empty_before_retry).length;
  const finalEmpty = results.filter((result) => result.empty_response).length;
  const retrySuccess = results.filter((result) => result.retry_success).length;
  const retryExhausted = results.filter((result) => result.retry_exhausted).length;
  const durations = results
    .map((result) => result.duration_ms)
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);

  return {
    name,
    attempts: results.length,
    http_200_count: results.filter((result) => result.http_status === 200).length,
    empty_response_count_before_retry: emptyBeforeRetry,
    final_empty_response_count: finalEmpty,
    retry_success_count: retrySuccess,
    retry_exhausted_count: retryExhausted,
    timeout_count: results.filter((result) => result.error_class === "timeout").length,
    error_classes: Array.from(
      new Set(results.map((result) => result.error_class).filter(Boolean))
    ),
    finish_reasons: Array.from(
      new Set(results.map((result) => result.finish_reason).filter(Boolean))
    ),
    p50_duration_ms: durations.length ? durations[Math.floor(durations.length / 2)] : null,
    max_duration_ms: durations.length ? durations[durations.length - 1] : null,
    native_supported: results.some((result) => result.native_supported === true)
  };
}

async function runSequentialCase(name, settings, retryLimit = 0) {
  const results = [];
  for (let i = 0; i < ATTEMPTS_PER_CASE; i += 1) {
    results.push(await runOpenAiAttempt(settings, retryLimit));
  }
  return summarizeCase(name, results);
}

async function runParallelCase(name, settings) {
  const results = [];
  for (let batch = 0; batch < 4; batch += 1) {
    const batchResults = await Promise.all(
      Array.from({ length: 5 }, () => runOpenAiAttempt(settings, 0))
    );
    results.push(...batchResults);
  }
  return summarizeCase(name, results);
}

async function runNativeCase(name, settings) {
  const results = [];
  for (let i = 0; i < ATTEMPTS_PER_CASE; i += 1) {
    results.push(await runNativeAttempt(settings));
  }
  return summarizeCase(name, results);
}

async function main() {
  const baseline = {
    messages: baseMessages,
    temperature: 0.4,
    maxTokens: 900
  };
  const deterministic = {
    messages: baseMessages,
    temperature: 0,
    topP: 0.9,
    maxTokens: 900
  };
  const strongPrompt = {
    messages: strongMessages,
    temperature: 0,
    topP: 0.9,
    maxTokens: 900
  };
  const highBudget = {
    messages: strongMessages,
    temperature: 0,
    topP: 0.9,
    maxTokens: 1200
  };

  const cases = [];
  cases.push(await runSequentialCase("baseline_current", baseline, 0));
  cases.push(await runSequentialCase("deterministic", deterministic, 0));
  cases.push(await runSequentialCase("strong_prompt", strongPrompt, 0));
  cases.push(await runSequentialCase("higher_budget", highBudget, 0));
  cases.push(await runSequentialCase("retry2_strong_prompt", strongPrompt, 2));
  cases.push(await runParallelCase("parallel5_baseline", baseline));
  cases.push(await runNativeCase("native_api_v1_chat", strongPrompt));

  const best = [...cases]
    .filter((item) => item.attempts === ATTEMPTS_PER_CASE)
    .sort((a, b) => a.final_empty_response_count - b.final_empty_response_count)[0];

  console.log(JSON.stringify({
    status: "PASS",
    attempts_per_case: ATTEMPTS_PER_CASE,
    cases,
    best_case: best?.name || null,
    recommended_direction:
      best?.final_empty_response_count === 0
        ? best.name
        : "configured model remains unstable; combine strongest app safeguards and consider model switch"
  }, null, 2));
}

main().catch((error) => {
  console.log(JSON.stringify({
    status: "FAIL",
    error_class: errorClass(error)
  }, null, 2));
  process.exitCode = 1;
});
