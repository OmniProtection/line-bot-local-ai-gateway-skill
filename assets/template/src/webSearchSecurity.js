const TRACKING_PARAM_PATTERNS = [
  /^utm_/i,
  /^ga_/i,
  /^yclid$/i,
  /^gclid$/i,
  /^fbclid$/i,
  /^msclkid$/i,
  /^mc_cid$/i,
  /^mc_eid$/i,
  /^igshid$/i,
  /^spm$/i
];

const AD_OR_TRACKING_HOST_PATTERNS = [
  /(^|\.)doubleclick\.net$/i,
  /(^|\.)googleadservices\.com$/i,
  /(^|\.)googlesyndication\.com$/i,
  /(^|\.)taboola\.com$/i,
  /(^|\.)outbrain\.com$/i,
  /(^|\.)clickserve\./i,
  /(^|\.)adform\.net$/i,
  /(^|\.)adnxs\.com$/i,
  /(^|\.)adsrvr\.org$/i,
  /(^|\.)criteo\.com$/i
];

const PROMPT_INJECTION_PATTERNS = [
  /ignore (?:all )?(?:previous|prior|above) instructions?/i,
  /disregard (?:all )?(?:previous|prior|above) instructions?/i,
  /system prompt/i,
  /developer message/i,
  /reveal (?:the )?(?:secret|token|api key|password)/i,
  /send (?:the )?(?:secret|token|api key|password|conversation)/i,
  /exfiltrat/i,
  /execute (?:a )?(?:command|tool|function)/i,
  /call (?:a )?(?:tool|function|api)/i,
  /click (?:this|the) link/i,
  /browse to/i,
  /你(?:必須|一定要|應該)?忽略/u,
  /忽略(?:以上|前面|先前|所有).{0,20}(?:指令|規則|限制)/u,
  /系統(?:提示|指令)/u,
  /開發者(?:訊息|指令)/u,
  /洩漏|泄漏/u,
  /金鑰|密鑰|權杖|憑證/u,
  /執行(?:工具|指令|命令)/u,
  /呼叫(?:工具|函式|api)/iu,
  /點擊(?:這個|以下|連結)/u,
  /傳送.{0,20}(?:資料|token|權杖|密鑰|金鑰|secret)/iu,
  /回傳.{0,20}(?:secret|token|權杖|密鑰|金鑰)/iu
];

const MAX_SANITIZED_TEXT_CHARS = 1800;

function normalizeHostname(hostname) {
  return String(hostname || "").toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
}

function addFlag(flags, flag) {
  if (!flags.includes(flag)) {
    flags.push(flag);
  }
}

function parseIpv4(hostname) {
  const parts = String(hostname || "").split(".");
  if (parts.length !== 4) {
    return null;
  }

  const numbers = parts.map((part) => {
    if (!/^\d{1,3}$/.test(part)) {
      return null;
    }
    const value = Number.parseInt(part, 10);
    return value >= 0 && value <= 255 ? value : null;
  });

  return numbers.some((value) => value === null) ? null : numbers;
}

function isPrivateOrLocalHostname(hostname) {
  const normalized = normalizeHostname(hostname).replace(/^\[|\]$/g, "");
  if (!normalized) {
    return true;
  }

  if (
    normalized === "localhost" ||
    normalized === "0.0.0.0" ||
    normalized === "::1" ||
    normalized === "0000:0000:0000:0000:0000:0000:0000:0001" ||
    normalized.endsWith(".local")
  ) {
    return true;
  }

  const ipv4 = parseIpv4(normalized);
  if (ipv4) {
    const [first, second] = ipv4;
    return (
      first === 10 ||
      first === 127 ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168)
    );
  }

  if (
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe80") ||
    normalized === "metadata.google.internal"
  ) {
    return true;
  }

  return false;
}

function hostnameMatchesAny(hostname, patterns) {
  const normalized = normalizeHostname(hostname);
  return patterns.some((pattern) => pattern.test(normalized));
}

function stripTrackingParams(url) {
  const cleaned = new URL(url.href);
  for (const key of [...cleaned.searchParams.keys()]) {
    if (TRACKING_PARAM_PATTERNS.some((pattern) => pattern.test(key))) {
      cleaned.searchParams.delete(key);
    }
  }
  cleaned.hash = "";
  return cleaned;
}

function decodeBingRedirectTarget(value) {
  if (!value) {
    return "";
  }

  const encoded = value.startsWith("a1") ? value.slice(2) : value;
  const padded = `${encoded}${"=".repeat((4 - (encoded.length % 4)) % 4)}`;
  try {
    return Buffer.from(padded.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
  } catch {
    return "";
  }
}

function isSearchProviderHost(hostname) {
  const normalized = normalizeHostname(hostname);
  return (
    normalized === "duckduckgo.com" ||
    normalized.endsWith(".duckduckgo.com") ||
    normalized === "bing.com" ||
    normalized.endsWith(".bing.com") ||
    normalized === "google.com" ||
    normalized.endsWith(".google.com")
  );
}

function unwrapKnownSearchRedirect(url, flags) {
  const hostname = normalizeHostname(url.hostname);
  const pathname = url.pathname.toLowerCase();

  if (hostname === "duckduckgo.com" || hostname.endsWith(".duckduckgo.com")) {
    if (pathname.endsWith("/y.js")) {
      addFlag(flags, "ad_click_url");
      return { blocked: true, reason: "ad_or_tracking_url" };
    }

    const target = url.searchParams.get("uddg");
    if (target) {
      addFlag(flags, "search_redirect_unwrapped");
      return { target };
    }

    if (pathname.startsWith("/l/")) {
      addFlag(flags, "search_redirect_unresolved");
      return { blocked: true, reason: "unresolved_search_redirect" };
    }
  }

  if (hostname === "bing.com" || hostname.endsWith(".bing.com")) {
    if (pathname.includes("/aclick")) {
      addFlag(flags, "ad_click_url");
      return { blocked: true, reason: "ad_or_tracking_url" };
    }

    const target = decodeBingRedirectTarget(url.searchParams.get("u"));
    if (target) {
      addFlag(flags, "search_redirect_unwrapped");
      return { target };
    }

    if (pathname.includes("/ck/")) {
      addFlag(flags, "search_redirect_unresolved");
      return { blocked: true, reason: "unresolved_search_redirect" };
    }
  }

  if (hostname === "google.com" || hostname.endsWith(".google.com")) {
    if (pathname.includes("/aclk")) {
      addFlag(flags, "ad_click_url");
      return { blocked: true, reason: "ad_or_tracking_url" };
    }

    const target = url.searchParams.get("q") || url.searchParams.get("url");
    if (pathname === "/url" && target) {
      addFlag(flags, "search_redirect_unwrapped");
      return { target };
    }

    if (pathname === "/url") {
      addFlag(flags, "search_redirect_unresolved");
      return { blocked: true, reason: "unresolved_search_redirect" };
    }
  }

  return null;
}

function hasSuspiciousOutboundQuery(url) {
  for (const [key, value] of url.searchParams.entries()) {
    const normalizedKey = key.toLowerCase();
    if (/(?:secret|token|api[_-]?key|password|credential|session|cookie)/i.test(normalizedKey)) {
      return true;
    }
    if (/(?:secret|token|api[_-]?key|password|credential|session|cookie)/i.test(value)) {
      return true;
    }
    if ((normalizedKey === "data" || normalizedKey === "payload") && String(value).length > 80) {
      return true;
    }
  }
  return false;
}

function assessParsedUrl(url, flags, depth) {
  if (!["http:", "https:"].includes(url.protocol)) {
    addFlag(flags, "blocked_scheme");
    return blocked("blocked_scheme", flags);
  }

  const redirect = unwrapKnownSearchRedirect(url, flags);
  if (redirect?.blocked) {
    return blocked(redirect.reason, flags);
  }
  if (redirect?.target) {
    if (depth >= 3) {
      addFlag(flags, "redirect_depth_exceeded");
      return blocked("redirect_depth_exceeded", flags);
    }
    return assessUrlSecurity(redirect.target, { _depth: depth + 1, _flags: flags });
  }

  const hostname = normalizeHostname(url.hostname);
  if (isPrivateOrLocalHostname(hostname)) {
    addFlag(flags, "private_or_local_target");
    return blocked("private_or_local_target", flags);
  }

  if (hostnameMatchesAny(hostname, AD_OR_TRACKING_HOST_PATTERNS)) {
    addFlag(flags, "ad_or_tracking_host");
    return blocked("ad_or_tracking_url", flags);
  }

  if (isSearchProviderHost(hostname)) {
    addFlag(flags, "search_provider_url");
    return blocked("search_provider_url_not_evidence", flags);
  }

  const cleaned = stripTrackingParams(url);
  if (cleaned.href !== url.href) {
    addFlag(flags, "tracking_params_removed");
  }

  if (hasSuspiciousOutboundQuery(cleaned)) {
    addFlag(flags, "suspicious_query_param");
    return blocked("suspicious_query_param", flags);
  }

  return {
    ok: true,
    canonicalUrl: cleaned.href,
    hostname,
    riskFlags: flags,
    blockReason: null
  };
}

function blocked(reason, flags) {
  return {
    ok: false,
    canonicalUrl: "",
    hostname: "",
    riskFlags: flags,
    blockReason: reason
  };
}

function assessUrlSecurity(rawUrl, context = {}) {
  const flags = Array.isArray(context._flags) ? context._flags : [];
  const depth = Number.isInteger(context._depth) ? context._depth : 0;
  let url;

  try {
    url = rawUrl instanceof URL ? rawUrl : new URL(String(rawUrl || ""));
  } catch {
    addFlag(flags, "invalid_url");
    return blocked("invalid_url", flags);
  }

  return assessParsedUrl(url, flags, depth);
}

function assessFetchTarget(rawUrl) {
  const result = assessUrlSecurity(rawUrl);
  if (!result.ok) {
    return result;
  }
  return {
    ...result,
    fetchUrl: result.canonicalUrl
  };
}

function normalizeEvidenceText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function sanitizeEvidenceText(value) {
  const original = normalizeEvidenceText(value);
  const flags = [];
  if (!original) {
    return { text: "", riskFlags: flags };
  }

  let text = original;
  for (const pattern of PROMPT_INJECTION_PATTERNS) {
    if (pattern.test(text)) {
      addFlag(flags, "prompt_injection_signal");
      text = text.replace(pattern, "[已移除可疑網頁指令]");
    }
  }

  text = text
    .replace(/(?:\[已移除可疑網頁指令\]\s*){2,}/g, "[已移除可疑網頁指令] ")
    .replace(/\s+/g, " ")
    .trim();

  if (text.length > MAX_SANITIZED_TEXT_CHARS) {
    addFlag(flags, "text_clamped");
    text = text.slice(0, MAX_SANITIZED_TEXT_CHARS - 1).trim() + "…";
  }

  return { text, riskFlags: flags };
}

function assessEvidenceSecurity(evidence) {
  const urlDecision = assessUrlSecurity(evidence?.url || "");
  if (!urlDecision.ok) {
    return {
      ok: false,
      evidence: null,
      reason: urlDecision.blockReason,
      securityFlags: urlDecision.riskFlags
    };
  }

  const title = sanitizeEvidenceText(evidence?.title || "");
  const snippet = sanitizeEvidenceText(evidence?.snippet || "");
  const inputFlags = Array.isArray(evidence?.securityFlags) ? evidence.securityFlags : [];
  const securityFlags = [...inputFlags, ...urlDecision.riskFlags, ...title.riskFlags, ...snippet.riskFlags];
  const hasPromptInjection = securityFlags.includes("prompt_injection_signal");

  return {
    ok: true,
    evidence: {
      ...evidence,
      title: title.text || evidence?.title || "來源",
      url: urlDecision.canonicalUrl,
      canonicalUrl: urlDecision.canonicalUrl,
      domain: evidence?.domain || urlDecision.hostname,
      snippet: snippet.text,
      securityFlags,
      securityAnswerMode: hasPromptInjection ? "conservative_summary" : "model_answer"
    },
    reason: hasPromptInjection ? "prompt_injection_signal" : "safe",
    securityFlags
  };
}

function validateSafeOutboundUrl(rawUrl) {
  const result = assessUrlSecurity(rawUrl);
  return result.ok ? result.canonicalUrl : "";
}

module.exports = {
  assessEvidenceSecurity,
  assessFetchTarget,
  assessUrlSecurity,
  isPrivateOrLocalHostname,
  sanitizeEvidenceText,
  validateSafeOutboundUrl
};
