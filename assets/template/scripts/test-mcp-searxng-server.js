const assert = require("node:assert/strict");
const {
  encodeMessage,
  handleJsonRpcMessage,
  normalizeSearxngResult,
  sanitizeQuery,
  toolDefinition
} = require("./mcp-searxng-server");

async function testInitialize() {
  const response = await handleJsonRpcMessage({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05"
    }
  });

  assert.equal(response.id, 1);
  assert.equal(response.result.serverInfo.name, "line-bot-searxng-local");
  assert.deepEqual(response.result.capabilities, { tools: {} });
}

async function testToolsList() {
  const response = await handleJsonRpcMessage({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/list"
  });

  assert.equal(response.id, 2);
  assert.equal(response.result.tools.length, 1);
  assert.equal(response.result.tools[0].name, "web_search");
}

async function testToolsCallUsesMockFetchAndSanitizesEvidence() {
  const originalFetch = global.fetch;
  global.fetch = async (url, options) => {
    assert.ok(url.includes("/search?"));
    assert.ok(url.includes("format=json"));
    assert.ok(options.signal);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        results: [
          {
            title: "OpenAI News",
            url: "https://openai.com/news/?utm_source=test",
            content: "Latest official updates."
          },
          {
            title: "Ad",
            url: "https://duckduckgo.com/y.js?u=https%3A%2F%2Fexample.com",
            content: "ad"
          },
          {
            title: "Local",
            url: "http://127.0.0.1/private",
            content: "local"
          }
        ]
      })
    };
  };

  try {
    const response = await handleJsonRpcMessage(
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "web_search",
          arguments: {
            query: "OpenAI 最新消息",
            max_results: 5
          }
        }
      },
      {
        searxngUrl: "http://127.0.0.1:8080",
        timeoutMs: 100,
        maxResults: 5
      }
    );

    assert.equal(response.id, 3);
    assert.equal(response.result.isError, false);
    const payload = JSON.parse(response.result.content[0].text);
    assert.equal(payload.ok, true);
    assert.equal(payload.results.length, 1);
    assert.equal(payload.results[0].url, "https://openai.com/news/");
  } finally {
    global.fetch = originalFetch;
  }
}

async function testToolsCallTimeout() {
  const originalFetch = global.fetch;
  global.fetch = async (_url, options) =>
    new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      });
    });

  try {
    const response = await handleJsonRpcMessage(
      {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: {
          name: "web_search",
          arguments: {
            query: "timeout"
          }
        }
      },
      {
        searxngUrl: "http://127.0.0.1:8080",
        timeoutMs: 10,
        maxResults: 3
      }
    );

    const payload = JSON.parse(response.result.content[0].text);
    assert.equal(response.result.isError, true);
    assert.equal(payload.reason, "timeout");
  } finally {
    global.fetch = originalFetch;
  }
}

function testNormalizeHelpers() {
  assert.equal(sanitizeQuery("  a\n b  "), "a b");
  assert.equal(toolDefinition().name, "web_search");
  assert.equal(
    normalizeSearxngResult({
      title: "Blocked",
      url: "https://googleadservices.com/page",
      content: "ad"
    }),
    null
  );

  const encoded = encodeMessage({ jsonrpc: "2.0", id: 1, result: {} });
  assert.equal(encoded.endsWith("\n"), true);
  assert.equal(JSON.parse(encoded).id, 1);
}

async function run() {
  await testInitialize();
  await testToolsList();
  await testToolsCallUsesMockFetchAndSanitizesEvidence();
  await testToolsCallTimeout();
  testNormalizeHelpers();
}

run().then(() => {
  console.log(JSON.stringify({ status: "PASS", mcp_searxng_server: true }));
});
