#!/usr/bin/env node

const { assessEvidenceSecurity } = require("../src/webSearchSecurity");

const DEFAULT_SEARXNG_URL = "http://127.0.0.1:8080";
const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_MAX_RESULTS = 8;
const MAX_QUERY_CHARS = 500;
const SERVER_INFO = {
  name: "line-bot-searxng-local",
  version: "0.1.0"
};

function readPositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function clamp(value, min, max) {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(parsed)) {
    return min;
  }
  return Math.min(max, Math.max(min, parsed));
}

function getConfig(env = process.env) {
  return {
    searxngUrl: String(env.SEARXNG_URL || DEFAULT_SEARXNG_URL).replace(/\/+$/, ""),
    timeoutMs: readPositiveInt(env.SEARXNG_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
    maxResults: clamp(env.SEARXNG_MAX_RESULTS || DEFAULT_MAX_RESULTS, 1, 10)
  };
}

function sanitizeQuery(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, MAX_QUERY_CHARS);
}

function getResultSnippet(result) {
  return String(result?.content || result?.snippet || result?.description || "").replace(/\s+/g, " ").trim();
}

function getResultEngine(result) {
  if (typeof result?.engine === "string") {
    return result.engine;
  }
  if (Array.isArray(result?.engines)) {
    return result.engines.filter(Boolean).join(", ");
  }
  return "";
}

function normalizeSearxngResult(result) {
  const security = assessEvidenceSecurity({
    title: result?.title || "來源",
    url: result?.url || "",
    snippet: getResultSnippet(result),
    engine: getResultEngine(result),
    publishedDate: result?.publishedDate || result?.published_date || result?.date || ""
  });

  if (!security.ok) {
    return null;
  }

  return {
    title: security.evidence.title,
    url: security.evidence.canonicalUrl,
    snippet: security.evidence.snippet,
    engine: getResultEngine(result),
    publishedDate: result?.publishedDate || result?.published_date || result?.date || "",
    securityFlags: security.evidence.securityFlags || []
  };
}

async function searchSearxng(query, options = {}) {
  const config = {
    ...getConfig(),
    ...options
  };
  const normalizedQuery = sanitizeQuery(query);
  if (!normalizedQuery) {
    return {
      ok: false,
      reason: "empty_query",
      results: []
    };
  }

  const maxResults = clamp(options.maxResults || config.maxResults, 1, 10);
  const url = new URL(`${config.searxngUrl}/search`);
  url.searchParams.set("q", normalizedQuery);
  url.searchParams.set("format", "json");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  const startedAt = Date.now();

  try {
    const response = await fetch(url.href, {
      method: "GET",
      signal: controller.signal,
      headers: {
        accept: "application/json"
      }
    });

    if (!response.ok) {
      return {
        ok: false,
        reason: response.status === 403 ? "searxng_json_forbidden" : "http_non_200",
        statusCode: response.status,
        results: [],
        durationMs: Date.now() - startedAt
      };
    }

    const payload = await response.json();
    const rawResults = Array.isArray(payload?.results) ? payload.results : [];
    const results = [];

    for (const rawResult of rawResults) {
      const normalized = normalizeSearxngResult(rawResult);
      if (normalized) {
        results.push(normalized);
      }
      if (results.length >= maxResults) {
        break;
      }
    }

    return {
      ok: true,
      query: normalizedQuery,
      results,
      resultCount: results.length,
      durationMs: Date.now() - startedAt
    };
  } catch (error) {
    return {
      ok: false,
      reason: error?.name === "AbortError" ? "timeout" : "fetch_error",
      results: [],
      durationMs: Date.now() - startedAt
    };
  } finally {
    clearTimeout(timeout);
  }
}

function toolDefinition() {
  return {
    name: "web_search",
    description:
      "Search the web through the local SearXNG instance and return bounded, sanitized source evidence.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query."
        },
        max_results: {
          type: "integer",
          minimum: 1,
          maximum: 10,
          description: "Maximum number of source results to return."
        }
      },
      required: ["query"]
    }
  };
}

function jsonRpcResult(id, result) {
  return {
    jsonrpc: "2.0",
    id,
    result
  };
}

function jsonRpcError(id, code, message) {
  return {
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message
    }
  };
}

async function handleJsonRpcMessage(message, options = {}) {
  if (!message || typeof message !== "object") {
    return jsonRpcError(null, -32600, "Invalid request");
  }

  const { id, method, params } = message;
  if (id === undefined && method === "notifications/initialized") {
    return null;
  }

  if (method === "initialize") {
    return jsonRpcResult(id, {
      protocolVersion: params?.protocolVersion || "2024-11-05",
      capabilities: {
        tools: {}
      },
      serverInfo: SERVER_INFO
    });
  }

  if (method === "ping") {
    return jsonRpcResult(id, {});
  }

  if (method === "tools/list") {
    return jsonRpcResult(id, {
      tools: [toolDefinition()]
    });
  }

  if (method === "tools/call") {
    const name = params?.name;
    const args = params?.arguments || {};
    if (name !== "web_search") {
      return jsonRpcError(id, -32602, "Unknown tool");
    }

    const searchResult = await searchSearxng(args.query, {
      ...options,
      maxResults: args.max_results
    });

    return jsonRpcResult(id, {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              ok: searchResult.ok,
              reason: searchResult.reason || "success",
              query: searchResult.query || sanitizeQuery(args.query),
              result_count: searchResult.resultCount || 0,
              results: searchResult.results || [],
              searched_at: new Date().toISOString()
            },
            null,
            2
          )
        }
      ],
      isError: !searchResult.ok
    });
  }

  if (id === undefined) {
    return null;
  }

  return jsonRpcError(id, -32601, "Method not found");
}

function encodeMessage(message) {
  return `${JSON.stringify(message)}\n`;
}

function createStdioServer(input, output, options = {}) {
  let buffer = "";

  input.on("data", async (chunk) => {
    buffer += chunk.toString("utf8");

    while (true) {
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex === -1) {
        return;
      }

      const rawBody = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (!rawBody) {
        continue;
      }

      let message;
      try {
        message = JSON.parse(rawBody);
      } catch {
        output.write(encodeMessage(jsonRpcError(null, -32700, "Parse error")));
        continue;
      }

      const response = await handleJsonRpcMessage(message, options);
      if (response) {
        output.write(encodeMessage(response));
      }
    }
  });
}

if (require.main === module) {
  createStdioServer(process.stdin, process.stdout);
}

module.exports = {
  createStdioServer,
  encodeMessage,
  getConfig,
  handleJsonRpcMessage,
  normalizeSearxngResult,
  searchSearxng,
  sanitizeQuery,
  toolDefinition
};
