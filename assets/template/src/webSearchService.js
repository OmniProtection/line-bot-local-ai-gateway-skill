const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { errorClass, logEvent } = require("./logger");
const {
  analyzeWebSearchQuery,
  classifySource: classifyPolicySource,
  getHostname,
  isCandidateAllowed: isPolicyCandidateAllowed,
  rankCandidate
} = require("./webSearchPolicy");
const {
  assessEvidenceSecurity,
  assessFetchTarget,
  assessUrlSecurity,
  sanitizeEvidenceText
} = require("./webSearchSecurity");

const SEARCH_ENDPOINT = "https://duckduckgo.com/html/";
const SEARCH_FALLBACK_ENDPOINT = "https://html.duckduckgo.com/html/";
const SEARCH_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const MAX_QUERY_CHARS = 200;
const MAX_TITLE_CHARS = 140;
const MAX_SNIPPET_CHARS = 500;
const MAX_PAGE_TEXT_CHARS = 1600;
const MAX_SEARCH_HTML_BYTES = 512 * 1024;
const MAX_PAGE_HTML_BYTES = 512 * 1024;
const MIN_CANDIDATE_RESULTS = 10;
const MAX_CANDIDATE_RESULTS = 15;
const DEFAULT_WEB_TOOLS_PLUGIN_DIR = path.join(
  process.env.USERPROFILE || "",
  ".lmstudio",
  "extensions",
  "plugins",
  "npacker",
  "web-tools"
);
let impitClientPromise = null;
const nativeFetch = global.fetch;

function clampText(value, maxChars) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= maxChars) {
    return text;
  }

  return `${text.slice(0, maxChars - 1).trim()}…`;
}

function normalizeSearchQueryForEngine(query) {
  return clampText(String(query || "").replace(/[，,。？?！!：:；;]/g, " ").trim(), MAX_QUERY_CHARS);
}

function isRelevantCandidate(candidate, query) {
  return isPolicyCandidateAllowed(candidate, analyzeWebSearchQuery(query));
}

function classifySearchSource(result) {
  return classifyPolicySource(result);
}

function rankSearchCandidates(candidates, query = "") {
  const queryPolicy = analyzeWebSearchQuery(query);
  return [...candidates]
    .map((candidate) => rankCandidate(candidate, queryPolicy))
    .sort((a, b) => {
      if (b.qualityScore !== a.qualityScore) {
        return b.qualityScore - a.qualityScore;
      }
      return a.searchRank - b.searchRank;
    });
}

function selectEvidenceCandidates(candidates, maxResults) {
  const selected = [];
  const seenDomains = new Set();

  for (const candidate of candidates) {
    if (candidate.domain && seenDomains.has(candidate.domain)) {
      continue;
    }
    selected.push(candidate);
    if (candidate.domain) {
      seenDomains.add(candidate.domain);
    }
    if (selected.length >= maxResults) {
      return selected;
    }
  }

  for (const candidate of candidates) {
    if (selected.some((item) => item.url === candidate.url)) {
      continue;
    }
    selected.push(candidate);
    if (selected.length >= maxResults) {
      break;
    }
  }

  return selected;
}

function evidenceMetadata(result) {
  return {
    domain: result.domain || getHostname(result.url),
    sourceType: result.sourceType || classifySearchSource(result).sourceType,
    qualityScore: Number.isFinite(result.qualityScore) ? result.qualityScore : 0,
    qualityReasons: Array.isArray(result.qualityReasons) ? result.qualityReasons.slice(0, 5) : [],
    relevanceScore: Number.isFinite(result.relevanceScore) ? result.relevanceScore : 0,
    sourceProvider: result.sourceProvider || null,
    searchRank: Number.isFinite(result.searchRank) ? result.searchRank : null
  };
}

function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(Number.parseInt(code, 16)));
}

function stripTags(value) {
  return decodeHtmlEntities(String(value || "").replace(/<[^>]+>/g, " "));
}

function getHeaderValue(headers, name) {
  const normalizedName = String(name || "").toLowerCase();
  if (!headers) {
    return "";
  }
  if (typeof headers.get === "function") {
    return headers.get(name) || "";
  }
  if (Array.isArray(headers)) {
    const found = headers.find(([key]) => String(key || "").toLowerCase() === normalizedName);
    return found ? String(found[1] || "") : "";
  }
  return "";
}

async function getImpitClient() {
  if (global.fetch !== nativeFetch) {
    return null;
  }

  if (!process.env.USERPROFILE) {
    return null;
  }

  if (!impitClientPromise) {
    impitClientPromise = (async () => {
      try {
        const modulePath = path.join(DEFAULT_WEB_TOOLS_PLUGIN_DIR, "node_modules", "impit", "index.js");
        const { Impit } = await import(pathToFileURL(modulePath).href);
        return new Impit({ browser: "chrome" });
      } catch (error) {
        logEvent("web_search_impit_unavailable", {
          error_class: errorClass(error)
        });
        return null;
      }
    })();
  }

  return impitClientPromise;
}

async function fetchSearchResponse(url, options = {}) {
  const impit = await getImpitClient();
  if (impit) {
    const impitOptions = {
      headers:
        options.headers && !Array.isArray(options.headers)
          ? Object.entries(options.headers)
          : options.headers
    };
    return impit.fetch(url, impitOptions);
  }

  return fetch(url, options);
}

function isRedirectStatus(status) {
  return [301, 302, 303, 307, 308].includes(status);
}

function isResponseOk(response) {
  return response?.ok === true || (response?.status >= 200 && response?.status < 300);
}

function normalizeDuckDuckGoUrl(rawUrl) {
  const decoded = decodeHtmlEntities(rawUrl);
  try {
    const url = new URL(decoded, SEARCH_ENDPOINT);
    const decision = assessUrlSecurity(url.href);
    return decision.ok ? decision.canonicalUrl : "";
  } catch {
    const decision = assessUrlSecurity(decoded);
    return decision.ok ? decision.canonicalUrl : "";
  }
}

function getResultBlocks(html) {
  const value = String(html || "");
  const starts = [];
  const pattern = /<div\b[^>]*class=(["'])[^"']*\bresult\b[^"']*\1[^>]*>/gi;
  let match;

  while ((match = pattern.exec(value)) !== null) {
    starts.push(match.index);
  }

  return starts.map((start, index) => value.slice(start, starts[index + 1] || value.length));
}

function parseSearchResults(html, maxResults) {
  const results = [];
  const blocks = getResultBlocks(html);

  for (const block of blocks) {
    const linkMatch = block.match(
      /<a\b(?=[^>]*class=(["'])[^"']*\bresult__a\b[^"']*\1)(?=[^>]*href=(["'])([^"']+)\2)[^>]*>([\s\S]*?)<\/a>/i
    );
    if (!linkMatch) {
      continue;
    }

    const snippetMatch = block.match(
      /<[^>]+class=(["'])[^"']*\bresult__snippet\b[^"']*\1[^>]*>([\s\S]*?)<\/[^>]+>/i
    );
    const title = clampText(stripTags(linkMatch[4]), MAX_TITLE_CHARS);
    const url = normalizeDuckDuckGoUrl(linkMatch[3]);
    const snippet = clampText(stripTags(snippetMatch?.[2] || ""), MAX_SNIPPET_CHARS);

    if (!title || !url || results.some((item) => item.url === url)) {
      continue;
    }

    results.push({
      title,
      url,
      snippet,
      searchRank: results.length + 1,
      sourceProvider: "duckduckgo"
    });
    if (results.length >= maxResults) {
      break;
    }
  }

  return results;
}

function createTimeoutError() {
  const error = new Error("Operation timed out");
  error.name = "AbortError";
  return error;
}

async function runWithTimeout(timeoutMs, operation) {
  const controller = new AbortController();
  let timeout;
  const timeoutPromise = new Promise((_, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(createTimeoutError());
    }, timeoutMs);
  });

  try {
    return await Promise.race([operation(controller.signal), timeoutPromise]);
  } finally {
    clearTimeout(timeout);
  }
}

async function readResponseTextWithLimit(response, maxBytes) {
  const contentLength = Number.parseInt(getHeaderValue(response.headers, "content-length") || "", 10);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    const error = new Error("Response body is too large");
    error.name = "BodyTooLarge";
    throw error;
  }

  if (!response.body || typeof response.body.getReader !== "function") {
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > maxBytes) {
      const error = new Error("Response body is too large");
      error.name = "BodyTooLarge";
      throw error;
    }
    return text;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let receivedBytes = 0;
  let text = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    receivedBytes += value.byteLength;
    if (receivedBytes > maxBytes) {
      try {
        await reader.cancel();
      } catch {
        // Best-effort cancellation only.
      }
      const error = new Error("Response body is too large");
      error.name = "BodyTooLarge";
      throw error;
    }
    text += decoder.decode(value, { stream: true });
  }

  text += decoder.decode();
  return text;
}

function isReadableTextContentType(contentType) {
  const normalized = String(contentType || "").toLowerCase();
  return (
    !normalized ||
    normalized.includes("text/html") ||
    normalized.includes("text/plain") ||
    normalized.includes("application/xhtml")
  );
}

async function fetchSearchHtmlWithTimeout(url, timeoutMs, options = {}) {
  return runWithTimeout(timeoutMs, async (signal) => {
    let currentUrl = url;
    let response = null;

    for (let redirectCount = 0; redirectCount <= 3; redirectCount += 1) {
      response = await fetchSearchResponse(currentUrl, {
        ...options,
        signal,
        headers: {
          "accept-language": "zh-TW,zh;q=0.9,en;q=0.8",
          "user-agent": SEARCH_USER_AGENT,
          ...(options.headers || {})
        }
      });

      if (!isRedirectStatus(response.status)) {
        break;
      }

      const location = getHeaderValue(response.headers, "location");
      if (!location || redirectCount === 3) {
        return "";
      }
      currentUrl = new URL(location, currentUrl).href;
    }

    if (!isResponseOk(response) || !isReadableTextContentType(getHeaderValue(response.headers, "content-type"))) {
      return "";
    }

    return readResponseTextWithLimit(response, MAX_SEARCH_HTML_BYTES);
  });
}

async function fetchSearchCandidates(query, candidateLimit, timeoutMs, getRemainingMs = () => timeoutMs) {
  const providers = [
    {
      name: "duckduckgo",
      url: `${SEARCH_ENDPOINT}?q=${encodeURIComponent(query)}&p=`,
      parser: parseSearchResults
    },
    {
      name: "duckduckgo_legacy",
      url: `${SEARCH_FALLBACK_ENDPOINT}?q=${encodeURIComponent(query)}&p=`,
      parser: parseSearchResults
    }
  ];
  const candidates = [];
  const seenUrls = new Set();

  for (const provider of providers) {
    const providerTimeoutMs = Math.min(timeoutMs, getRemainingMs());
    if (providerTimeoutMs <= 0) {
      break;
    }

    const html = await fetchSearchHtmlWithTimeout(provider.url, providerTimeoutMs);
    const providerCandidates = provider.parser(html, candidateLimit);

    if (providerCandidates.length === 0) {
      logEvent("web_search_provider_no_candidates", {
        provider: provider.name
      });
      continue;
    }

    for (const candidate of providerCandidates) {
      if (seenUrls.has(candidate.url)) {
        continue;
      }
      seenUrls.add(candidate.url);
      candidates.push({
        ...candidate,
        searchRank: candidates.length + 1
      });
      if (candidates.length >= candidateLimit) {
        break;
      }
    }

    if (candidates.length >= candidateLimit) {
      break;
    }
  }

  return {
    provider: candidates.length > 0 ? "duckduckgo" : null,
    candidates
  };
}

async function fetchPageHtmlWithTimeout(url, timeoutMs, options = {}) {
  return runWithTimeout(timeoutMs, async (signal) => {
    let fetchTarget = assessFetchTarget(url);
    if (!fetchTarget.ok) {
      return { shouldSummarize: false, html: "", finalUrl: "", securityFlags: fetchTarget.riskFlags };
    }

    let response;
    for (let redirectCount = 0; redirectCount <= 3; redirectCount += 1) {
      response = await fetch(fetchTarget.fetchUrl, {
        ...options,
        redirect: "manual",
        signal,
        headers: {
          "user-agent": SEARCH_USER_AGENT,
          ...(options.headers || {})
        }
      });

      if (![301, 302, 303, 307, 308].includes(response.status)) {
        break;
      }

      const location = response.headers.get("location");
      if (!location || redirectCount === 3) {
        return {
          shouldSummarize: false,
          html: "",
          finalUrl: fetchTarget.canonicalUrl,
          securityFlags: ["redirect_unresolved"]
        };
      }

      const nextUrl = new URL(location, fetchTarget.canonicalUrl).href;
      fetchTarget = assessFetchTarget(nextUrl);
      if (!fetchTarget.ok) {
        return { shouldSummarize: false, html: "", finalUrl: "", securityFlags: fetchTarget.riskFlags };
      }
    }

    if (!response.ok) {
      return { shouldSummarize: false, html: "", finalUrl: fetchTarget.canonicalUrl, securityFlags: [] };
    }

    const contentType = response.headers.get("content-type") || "";
    if (!isReadableTextContentType(contentType)) {
      return {
        shouldSummarize: false,
        html: "",
        finalUrl: fetchTarget.canonicalUrl,
        securityFlags: ["unsupported_content_type"]
      };
    }

    return {
      shouldSummarize: true,
      html: await readResponseTextWithLimit(response, MAX_PAGE_HTML_BYTES),
      finalUrl: fetchTarget.canonicalUrl,
      securityFlags: []
    };
  });
}

function extractHtmlSummary(html) {
  const safeHtml = String(html || "");
  const titleMatch = safeHtml.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const descriptionMatch = safeHtml.match(
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["'][^>]*>/i
  );
  const bodyText = safeHtml
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");

  return {
    title: clampText(stripTags(titleMatch?.[1] || ""), MAX_TITLE_CHARS),
    summary: clampText(
      [descriptionMatch?.[1], stripTags(bodyText)].filter(Boolean).join(" "),
      MAX_PAGE_TEXT_CHARS
    )
  };
}

async function fetchPageEvidence(result, timeoutMs) {
  const metadata = evidenceMetadata(result);
  try {
    const fetchTarget = assessFetchTarget(result.url);
    if (!fetchTarget.ok) {
      return null;
    }

    const pageResponse = await fetchPageHtmlWithTimeout(result.url, timeoutMs);
    if (!pageResponse.shouldSummarize) {
      const fallbackDecision = assessEvidenceSecurity({
        title: result.title,
        url: fetchTarget.canonicalUrl,
        snippet: result.snippet,
        ...metadata,
        securityFlags: [...(result.securityFlags || []), ...(pageResponse.securityFlags || [])],
        fetchedAt: new Date().toISOString()
      });
      return fallbackDecision.ok ? fallbackDecision.evidence : null;
    }

    const page = extractHtmlSummary(pageResponse.html);
    const decision = assessEvidenceSecurity({
      title: page.title || result.title,
      url: pageResponse.finalUrl || fetchTarget.canonicalUrl,
      snippet: page.summary || result.snippet,
      ...metadata,
      securityFlags: [...(result.securityFlags || []), ...(pageResponse.securityFlags || [])],
      fetchedAt: new Date().toISOString()
    });
    return decision.ok ? decision.evidence : null;
  } catch {
    const decision = assessEvidenceSecurity({
      title: result.title,
      url: result.url,
      snippet: result.snippet,
      ...metadata,
      securityFlags: result.securityFlags || [],
      fetchedAt: new Date().toISOString()
    });
    return decision.ok ? decision.evidence : null;
  }
}

function secureSearchCandidate(candidate) {
  const urlDecision = assessUrlSecurity(candidate?.url || "");
  if (!urlDecision.ok) {
    return null;
  }

  const title = sanitizeEvidenceText(candidate.title);
  const snippet = sanitizeEvidenceText(candidate.snippet);
  return {
    ...candidate,
    title: clampText(title.text || candidate.title, MAX_TITLE_CHARS),
    url: urlDecision.canonicalUrl,
    snippet: clampText(snippet.text, MAX_SNIPPET_CHARS),
    domain: urlDecision.hostname,
    securityFlags: [...urlDecision.riskFlags, ...title.riskFlags, ...snippet.riskFlags]
  };
}

async function searchWeb(query, config, options = {}) {
  const startedAt = Date.now();
  const now = typeof options.now === "function" ? options.now : () => Date.now();
  const deadline = Number.isFinite(options.deadlineMs)
    ? options.deadlineMs
    : startedAt + config.webSearchTotalTimeoutMs;
  const safeQuery = normalizeSearchQueryForEngine(query);
  const maxResults = Math.max(1, Math.min(config.webSearchMaxResults || 3, 5));
  const candidateLimit = Math.max(
    maxResults,
    Math.min(MAX_CANDIDATE_RESULTS, Math.max(MIN_CANDIDATE_RESULTS, maxResults * 4))
  );

  logEvent("web_search_started", {
    query_chars: safeQuery.length,
    max_results: maxResults,
    candidate_limit: candidateLimit,
    total_timeout_ms: config.webSearchTotalTimeoutMs
  });

  try {
    const searchTimeoutMs = Math.min(config.webSearchTotalTimeoutMs, deadline - now());
    if (searchTimeoutMs <= 0) {
      throw createTimeoutError();
    }

    const searchResult = await fetchSearchCandidates(
      safeQuery,
      candidateLimit,
      searchTimeoutMs,
      () => deadline - now()
    );
    const candidates = searchResult.candidates.map(secureSearchCandidate).filter(Boolean);

    if (candidates.length === 0) {
      logEvent("web_search_no_results", {
        duration_ms: Date.now() - startedAt
      });
      return { ok: false, reason: "no_results", evidence: [], durationMs: Date.now() - startedAt };
    }

    const rankedCandidates = rankSearchCandidates(candidates, safeQuery);
    const relevantCandidates = rankedCandidates.filter((candidate) =>
      isRelevantCandidate(candidate, safeQuery)
    );
    if (relevantCandidates.length === 0) {
      logEvent("web_search_no_relevant_candidates", {
        provider: searchResult.provider,
        candidate_count: candidates.length,
        duration_ms: Date.now() - startedAt
      });
      return { ok: false, reason: "no_results", evidence: [], durationMs: Date.now() - startedAt };
    }

    const results = selectEvidenceCandidates(relevantCandidates, maxResults);

    logEvent("web_search_candidates_ranked", {
      provider: searchResult.provider,
      candidate_count: candidates.length,
      relevant_count: relevantCandidates.length,
      selected_count: results.length,
      selected_source_types: results.map((item) => item.sourceType).slice(0, 5)
    });

    const evidence = [];
    for (const result of results) {
      const remainingMs = deadline - now();
      if (remainingMs <= 0) {
        break;
      }
      const pageTimeoutMs = Math.max(1, Math.min(config.webSearchPageTimeoutMs, remainingMs));
      const item = await fetchPageEvidence(result, pageTimeoutMs);
      if (item) {
        evidence.push(item);
      }
    }

    if (evidence.length === 0) {
      logEvent("web_search_no_results", {
        duration_ms: Date.now() - startedAt
      });
      return { ok: false, reason: "no_results", evidence: [], durationMs: Date.now() - startedAt };
    }

    logEvent("web_search_success", {
      duration_ms: Date.now() - startedAt,
      evidence_count: evidence.length,
      evidence_source_types: evidence.map((item) => item.sourceType).slice(0, 5)
    });

    return { ok: true, evidence, durationMs: Date.now() - startedAt };
  } catch (error) {
    const reason = errorClass(error) === "timeout" ? "timeout" : "error";
    logEvent(reason === "timeout" ? "web_search_timeout" : "web_search_error", {
      error_class: errorClass(error),
      duration_ms: Date.now() - startedAt
    });

    return { ok: false, reason, evidence: [], durationMs: Date.now() - startedAt };
  }
}

module.exports = {
  classifySearchSource,
  isRelevantCandidate,
  parseSearchResults,
  rankSearchCandidates,
  selectEvidenceCandidates,
  searchWeb
};
