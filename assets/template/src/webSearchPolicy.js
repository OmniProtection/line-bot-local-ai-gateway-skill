const OFFICIAL_DOMAIN_SUFFIXES = [
  ".gov",
  ".gov.tw",
  ".edu",
  ".edu.tw",
  "bot.com.tw",
  "cwa.gov.tw",
  "developers.google.com",
  "nvidia.com",
  "openai.com",
  "rate.bot.com.tw",
  "tpex.org.tw",
  "twse.com.tw"
];

const STRUCTURED_PLATFORM_DOMAINS = [
  "accuweather.com",
  "biggo.com.tw",
  "cnyes.com",
  "coolpc.com.tw",
  "findrate.tw",
  "momoshop.com.tw",
  "openrice.com",
  "opentable.com",
  "opentable.com.tw",
  "pchome.com.tw",
  "pchome.megatime.com.tw",
  "shopee.tw",
  "tw.stock.yahoo.com",
  "ubereats.com",
  "wantgoo.com",
  "weather.com"
];

const REPUTABLE_SECONDARY_DOMAINS = [
  "bbc.com",
  "cna.com.tw",
  "fortune.com",
  "infosecu.technews.tw",
  "reuters.com",
  "technews.tw",
  "thenewslens.com"
];

const LOW_QUALITY_DOMAIN_PARTS = [
  "answers",
  "blogspot",
  "medium.com",
  "multi-ai.ai",
  "pixnet.net",
  "studioglobal.ai",
  "wordpress"
];

const BLOG_OR_LISTICLE_PATTERNS = [
  /blog/i,
  /forum/i,
  /懶人包/u,
  /推薦/u,
  /排行/u,
  /必吃/u,
  /精選/u,
  /top\s*\d*/i,
  /\d+\s*(?:間|家|大)/u
];

const EVERGREEN_BACKGROUND_PATTERNS = [
  /wikipedia/i,
  /wiki/i,
  /維基/u,
  /百科/u,
  /是什麼/u,
  /懶人包/u,
  /一文(?:讀懂|读懂)/u,
  /介紹/u,
  /教學/u,
  /事件/u,
  /history/i,
  /explainer/i
];

const QUERY_STOP_TERMS = [
  "一下",
  "今天",
  "介紹",
  "幫我",
  "找找",
  "明天",
  "最新",
  "查詢",
  "資料",
  "附近",
  "搜尋",
  "消息"
];
const { validateSafeOutboundUrl } = require("./webSearchSecurity");

function getHostname(value) {
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function hostnameMatches(hostname, suffix) {
  const normalized = String(suffix || "").toLowerCase().replace(/^www\./, "").replace(/^\./, "");
  return hostname === normalized || hostname.endsWith(`.${normalized}`);
}

function hasAnyPattern(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

function addTag(tags, reasons, tag, reason) {
  tags.add(tag);
  reasons.add(reason || tag);
}

function normalizeSourcePreference(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (["official", "local_places", "product_specs", "current_info", "general"].includes(normalized)) {
    return normalized;
  }
  return "general";
}

function applySourcePreference(queryPolicy, sourcePreference) {
  const preference = normalizeSourcePreference(sourcePreference);
  const policy = {
    ...(queryPolicy || {}),
    intentTags: [...(queryPolicy?.intentTags || [])],
    evidenceRequirements: [...(queryPolicy?.evidenceRequirements || [])],
    claimRestrictions: [...(queryPolicy?.claimRestrictions || [])],
    reasons: [...(queryPolicy?.reasons || [])],
    sourcePreference: preference
  };

  const addPolicyTag = (tag, requirement, restriction, reason) => {
    if (tag && !policy.intentTags.includes(tag)) {
      policy.intentTags.push(tag);
    }
    if (requirement && !policy.evidenceRequirements.includes(requirement)) {
      policy.evidenceRequirements.push(requirement);
    }
    if (restriction && !policy.claimRestrictions.includes(restriction)) {
      policy.claimRestrictions.push(restriction);
    }
    if (reason && !policy.reasons.includes(reason)) {
      policy.reasons.push(reason);
    }
  };

  if (preference === "official") {
    addPolicyTag(
      "primary_source_preferred",
      "primary_or_authoritative_source",
      null,
      "source_preference_official"
    );
  } else if (preference === "local_places") {
    addPolicyTag(
      "local_place_structured",
      "structured_place_evidence",
      "no_local_precision_without_structured_evidence",
      "source_preference_local_places"
    );
    policy.answerModeHint = "conservative_if_unstructured";
  } else if (preference === "product_specs") {
    addPolicyTag(
      "purchase_decision",
      "product_or_platform_evidence",
      "numbers_must_be_grounded",
      "source_preference_product_specs"
    );
  } else if (preference === "current_info") {
    addPolicyTag(
      "freshness_required",
      "fresh_or_dated_evidence",
      "no_stale_background_as_current",
      "source_preference_current_info"
    );
  }

  return policy;
}

function analyzeWebSearchQuery(query, options = {}) {
  const text = String(query || "").trim();
  const lower = text.toLowerCase();
  const intentTags = new Set();
  const evidenceRequirements = new Set(["grounded_urls"]);
  const claimRestrictions = new Set(["no_webpage_instruction_following"]);
  const reasons = new Set();

  if (/最新|今天|今日|新聞|消息|公告|即時|latest|news|update|release/i.test(text)) {
    addTag(intentTags, reasons, "freshness_required", "fresh_or_current_terms");
    evidenceRequirements.add("fresh_or_dated_evidence");
    claimRestrictions.add("no_stale_background_as_current");
  }

  if (/官方|公告|文件|法規|公司消息|官網|原廠|official|documentation|docs/i.test(text)) {
    addTag(intentTags, reasons, "primary_source_preferred", "primary_source_terms");
    evidenceRequirements.add("primary_or_authoritative_source");
  }

  if (/股價|匯率|價格|價錢|天氣|日期|狀態|利率|金價|成交價|報價|price|stock|exchange|weather|status/i.test(text)) {
    addTag(intentTags, reasons, "structured_numeric", "structured_or_numeric_terms");
    evidenceRequirements.add("structured_or_numeric_evidence");
    claimRestrictions.add("numbers_must_be_grounded");
  }

  if (/附近|店家|餐廳|地址|營業中|營業時間|評分|距離|走路|步行|nearby|restaurant|open now|rating|address/i.test(text)) {
    addTag(intentTags, reasons, "local_place_structured", "local_place_terms");
    evidenceRequirements.add("structured_place_evidence");
    claimRestrictions.add("no_local_precision_without_structured_evidence");
  }

  if (
    /商品|規格|價格|價錢|比價|購買|開箱|顯示卡|cpu|gpu|筆電|比較|推薦|spec|price|review/i.test(lower) ||
    /\b(?:rtx|gtx)?\s*\d{4}\s*ti\b/i.test(lower)
  ) {
    addTag(intentTags, reasons, "purchase_decision", "purchase_or_product_terms");
    evidenceRequirements.add("product_or_platform_evidence");
    claimRestrictions.add("purchase_claims_must_be_grounded");
    claimRestrictions.add("numbers_must_be_grounded");
  }

  if (/推薦|排行|最好|比較|top|best|recommend/i.test(text)) {
    addTag(intentTags, reasons, "recommendation_or_comparison", "recommendation_terms");
    evidenceRequirements.add("per_item_evidence");
    claimRestrictions.add("items_must_not_exceed_evidence");
  }

  if (/是什麼|介紹|教學|歷史|wiki|維基|百科|how to|what is/i.test(text)) {
    addTag(intentTags, reasons, "background_info", "background_terms");
  }

  if (intentTags.size === 0) {
    addTag(intentTags, reasons, "general_lookup", "default_general_lookup");
  }

  let answerModeHint = "model_answer";
  if (intentTags.has("local_place_structured")) {
    answerModeHint = "conservative_if_unstructured";
  }
  if (intentTags.has("recommendation_or_comparison")) {
    answerModeHint = "per_item_evidence_required";
  }

  return applySourcePreference({
    query: text,
    intentTags: [...intentTags],
    evidenceRequirements: [...evidenceRequirements],
    claimRestrictions: [...claimRestrictions],
    answerModeHint,
    reasons: [...reasons]
  }, options.sourcePreference);
}

function hasIntent(queryPolicy, tag) {
  return Array.isArray(queryPolicy?.intentTags) && queryPolicy.intentTags.includes(tag);
}

function hasRestriction(queryPolicy, restriction) {
  return Array.isArray(queryPolicy?.claimRestrictions) && queryPolicy.claimRestrictions.includes(restriction);
}

function hasEvergreenBackgroundSignal(result) {
  const text = `${result?.title || ""} ${result?.snippet || ""} ${getHostname(result?.url || "")}`;
  return hasAnyPattern(text, EVERGREEN_BACKGROUND_PATTERNS);
}

function hasFreshnessSignal(result) {
  const text = `${result?.title || ""} ${result?.snippet || ""}`;
  return /(?:20\d{2}|19\d{2})|今天|今日|昨天|\d+\s*(?:天|小時|分鐘)前|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec/i.test(
    text
  );
}

function hasLocalPlaceSignal(result) {
  const text = `${result?.title || ""} ${result?.snippet || ""} ${getHostname(result?.url || "")}`;
  return /餐廳|店家|韓式|烤肉|美食|地址|菜單|營業|訂位|外送|openrice|opentable|ubereats|restaurant|menu|address|booking/i.test(
    text
  );
}

function classifySource(result) {
  const url = String(result?.url || "");
  const hostname = getHostname(url);
  const path = (() => {
    try {
      return new URL(url).pathname.toLowerCase();
    } catch {
      return "";
    }
  })();
  const titleAndSnippet = `${result?.title || ""} ${result?.snippet || ""}`;
  const reasons = [];
  let sourceType = "general_web";
  let baseScore = 50;

  if (OFFICIAL_DOMAIN_SUFFIXES.some((suffix) => hostnameMatches(hostname, suffix))) {
    sourceType = "official_primary";
    baseScore = 115;
    reasons.push("official_or_primary_domain");
  } else if (STRUCTURED_PLATFORM_DOMAINS.some((domain) => hostnameMatches(hostname, domain))) {
    sourceType = "structured_platform";
    baseScore = 88;
    reasons.push("structured_platform_domain");
  } else if (REPUTABLE_SECONDARY_DOMAINS.some((domain) => hostnameMatches(hostname, domain))) {
    sourceType = "reputable_secondary";
    baseScore = 68;
    reasons.push("reputable_secondary_domain");
  }

  if (hasAnyPattern(titleAndSnippet, BLOG_OR_LISTICLE_PATTERNS) || /\/(?:blog|post|article)\//i.test(path)) {
    if (sourceType === "general_web") {
      sourceType = "weak_secondary";
      baseScore = 35;
    } else {
      baseScore -= 12;
    }
    reasons.push("blog_or_listicle_signal");
  }

  if (
    LOW_QUALITY_DOMAIN_PARTS.some((part) => hostname.includes(part)) ||
    /\/(?:answers|discover\/answers|ai|generated)\//i.test(path)
  ) {
    sourceType = "low_quality_or_seo";
    baseScore = Math.min(baseScore, 10);
    reasons.push("low_quality_or_seo_signal");
  }

  return {
    domain: hostname,
    sourceType,
    baseScore,
    reasons
  };
}

function extractQueryTerms(query) {
  const normalized = String(query || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  const terms = new Set();

  for (const token of normalized.split(/\s+/).filter(Boolean)) {
    if (/^[a-z0-9][a-z0-9.-]{1,}$/i.test(token) && !QUERY_STOP_TERMS.includes(token)) {
      terms.add(token);
      continue;
    }

    const cleaned = QUERY_STOP_TERMS.reduce((value, stopTerm) => value.replaceAll(stopTerm, " "), token)
      .replace(/\s+/g, "")
      .trim();
    if (cleaned.length < 2) {
      continue;
    }

    if (cleaned.length <= 4) {
      terms.add(cleaned);
      for (const size of [2, 3]) {
        for (let index = 0; index <= cleaned.length - size; index += 1) {
          terms.add(cleaned.slice(index, index + size));
        }
      }
      continue;
    }

    for (const size of [2, 3, 4]) {
      for (let index = 0; index <= cleaned.length - size; index += 1) {
        terms.add(cleaned.slice(index, index + size));
      }
    }
  }

  return [...terms].slice(0, 40);
}

function computeQueryRelevance(result, queryTerms) {
  if (!Array.isArray(queryTerms) || queryTerms.length === 0) {
    return { relevanceScore: 10, matchedTerms: [] };
  }

  const haystack = `${result?.title || ""} ${result?.snippet || ""} ${getHostname(result?.url || "")}`
    .toLowerCase()
    .replace(/\s+/g, " ");
  const matchedTerms = queryTerms.filter((term) => haystack.includes(term));
  const relevanceScore = matchedTerms.reduce((score, term) => {
    if (/^[a-z0-9][a-z0-9.-]*$/i.test(term)) {
      return score + 12;
    }
    if (term.length >= 4) {
      return score + 8;
    }
    if (term.length === 3) {
      return score + 5;
    }
    return score + 4;
  }, 0);

  return {
    relevanceScore: Math.min(40, relevanceScore),
    matchedTerms: matchedTerms.slice(0, 8)
  };
}

function rankCandidate(candidate, queryPolicy) {
  const classification = classifySource(candidate);
  const relevance = computeQueryRelevance(candidate, extractQueryTerms(queryPolicy?.query || ""));
  const searchRank = Number.isFinite(candidate.searchRank) ? candidate.searchRank : 999;
  const reasons = [...classification.reasons];
  let policyPenalty = 0;
  let preferenceBoost = 0;
  const sourcePreference = normalizeSourcePreference(queryPolicy?.sourcePreference);

  if (
    hasIntent(queryPolicy, "freshness_required") &&
    classification.sourceType !== "official_primary" &&
    hasEvergreenBackgroundSignal(candidate)
  ) {
    policyPenalty += 45;
    reasons.push("freshness_blocks_evergreen_background");
  }

  if (
    hasIntent(queryPolicy, "primary_source_preferred") &&
    !["official_primary", "structured_platform"].includes(classification.sourceType)
  ) {
    policyPenalty += 15;
    reasons.push("primary_source_preferred_penalty");
  }

  if (
    hasIntent(queryPolicy, "structured_numeric") &&
    ["general_web", "weak_secondary", "low_quality_or_seo"].includes(classification.sourceType)
  ) {
    policyPenalty += classification.sourceType === "general_web" ? 12 : 30;
    reasons.push("structured_numeric_weak_source_penalty");
  }

  if (hasIntent(queryPolicy, "local_place_structured") && !hasLocalPlaceSignal(candidate)) {
    policyPenalty += classification.sourceType === "official_primary" ? 85 : 45;
    reasons.push("local_place_missing_place_signal");
  }

  if (sourcePreference === "official") {
    if (classification.sourceType === "official_primary") {
      preferenceBoost += 45;
      reasons.push("source_preference_official_boost");
    } else if (classification.sourceType === "structured_platform") {
      preferenceBoost += 8;
    } else {
      policyPenalty += classification.sourceType === "general_web" ? 25 : 45;
      reasons.push("source_preference_official_penalty");
    }
  } else if (sourcePreference === "product_specs") {
    if (["official_primary", "structured_platform"].includes(classification.sourceType)) {
      preferenceBoost += 25;
      reasons.push("source_preference_product_specs_boost");
    } else if (["weak_secondary", "low_quality_or_seo"].includes(classification.sourceType)) {
      policyPenalty += 35;
      reasons.push("source_preference_product_specs_penalty");
    }
  } else if (sourcePreference === "local_places") {
    if (classification.sourceType === "structured_platform" && hasLocalPlaceSignal(candidate)) {
      preferenceBoost += 35;
      reasons.push("source_preference_local_places_boost");
    } else if (!hasLocalPlaceSignal(candidate)) {
      policyPenalty += 35;
      reasons.push("source_preference_local_places_penalty");
    }
  } else if (sourcePreference === "current_info") {
    if (classification.sourceType === "official_primary" || hasFreshnessSignal(candidate)) {
      preferenceBoost += 20;
      reasons.push("source_preference_current_info_boost");
    } else if (hasEvergreenBackgroundSignal(candidate)) {
      policyPenalty += 25;
      reasons.push("source_preference_current_info_penalty");
    }
  }

  const qualityScore = Math.max(
    0,
    classification.baseScore + preferenceBoost + relevance.relevanceScore - searchRank * 1.5 - policyPenalty
  );

  return {
    ...candidate,
    domain: classification.domain,
    sourceType: classification.sourceType,
    qualityScore,
    qualityReasons: [
      ...reasons,
      ...(relevance.matchedTerms.length > 0 ? ["query_relevance_match"] : [])
    ],
    relevanceScore: relevance.relevanceScore,
    matchedQueryTerms: relevance.matchedTerms
  };
}

function isCandidateAllowed(candidate, queryPolicy) {
  if (!candidate || candidate.sourceType === "low_quality_or_seo") {
    return false;
  }

  if (
    hasIntent(queryPolicy, "freshness_required") &&
    candidate.sourceType !== "official_primary" &&
    hasEvergreenBackgroundSignal(candidate)
  ) {
    return false;
  }

  if (hasIntent(queryPolicy, "local_place_structured") && !hasLocalPlaceSignal(candidate)) {
    return false;
  }

  if (candidate.relevanceScore >= 8) {
    return true;
  }

  if (["official_primary", "structured_platform", "reputable_secondary"].includes(candidate.sourceType)) {
    return candidate.relevanceScore >= 4;
  }

  return false;
}

function formatConservativeEvidenceSummary(evidence, maxReplyChars) {
  const items = (Array.isArray(evidence) ? evidence : [])
    .map((item) => ({
      ...item,
      url: validateSafeOutboundUrl(item?.url || "")
    }))
    .filter((item) => item.url)
    .slice(0, 3);
  if (items.length === 0) {
    return "我沒有足夠來源可以可靠回答。";
  }

  const lines = ["我找到以下來源，但無法逐項驗證更多細節。請以來源內容為準："];
  for (const [index, item] of items.entries()) {
    const title = String(item.title || "來源").slice(0, 80);
    const snippet = String(item.snippet || "").replace(/\s+/g, " ").trim().slice(0, 120);
    const sourceType = String(item.sourceType || "general_web").slice(0, 40);
    lines.push(
      `${index + 1}. ${title}\n${item.url}\n來源類型：${sourceType}${snippet ? `\n摘要：${snippet}` : ""}`
    );
  }

  return lines.join("\n").slice(0, maxReplyChars);
}

function isWeakEvidenceOnly(evidence) {
  const items = Array.isArray(evidence) ? evidence : [];
  const sourceTypes = items.map((item) => item?.sourceType).filter(Boolean);
  if (sourceTypes.length === 0) {
    return false;
  }

  return sourceTypes.every((sourceType) =>
    ["weak_secondary", "low_quality_or_seo", "secondary_blog_or_listicle"].includes(sourceType)
  );
}

function hasStructuredPlaceEvidence(evidence) {
  return (Array.isArray(evidence) ? evidence : []).some((item) =>
    ["official_primary", "structured_platform"].includes(item?.sourceType) && hasLocalPlaceSignal(item)
  );
}

function hasAuthoritativeNumericEvidence(evidence) {
  return (Array.isArray(evidence) ? evidence : []).some((item) =>
    ["official_primary", "structured_platform", "reputable_secondary", "authoritative_platform"].includes(
      item?.sourceType
    )
  );
}

function hasFreshEvidence(evidence) {
  return (Array.isArray(evidence) ? evidence : []).some((item) =>
    ["official_primary", "structured_platform", "reputable_secondary", "authoritative_platform"].includes(
      item?.sourceType
    ) && hasFreshnessSignal(item)
  );
}

function evaluateEvidence(evidence, queryPolicy = analyzeWebSearchQuery("")) {
  const items = Array.isArray(evidence) ? evidence : [];
  if (items.length === 0) {
    return {
      answerMode: "insufficient_evidence",
      shouldCallModel: false,
      reason: "no_evidence"
    };
  }

  if (
    items.some(
      (item) =>
        item?.securityAnswerMode === "conservative_summary" ||
        (Array.isArray(item?.securityFlags) && item.securityFlags.includes("prompt_injection_signal"))
    )
  ) {
    return {
      answerMode: "conservative_summary",
      shouldCallModel: false,
      reason: "security_risk_evidence"
    };
  }

  if (isWeakEvidenceOnly(items)) {
    return {
      answerMode: "conservative_summary",
      shouldCallModel: false,
      reason: "weak_evidence_only"
    };
  }

  if (hasIntent(queryPolicy, "local_place_structured") && !hasStructuredPlaceEvidence(items)) {
    return {
      answerMode: "conservative_summary",
      shouldCallModel: false,
      reason: "local_place_without_structured_evidence"
    };
  }

  if (hasIntent(queryPolicy, "structured_numeric") && !hasAuthoritativeNumericEvidence(items)) {
    return {
      answerMode: "conservative_summary",
      shouldCallModel: false,
      reason: "structured_numeric_without_authoritative_evidence"
    };
  }

  if (hasIntent(queryPolicy, "freshness_required") && !hasFreshEvidence(items)) {
    return {
      answerMode: "conservative_summary",
      shouldCallModel: false,
      reason: "freshness_without_fresh_evidence"
    };
  }

  return {
    answerMode: "model_answer",
    shouldCallModel: true,
    reason: "sufficient_evidence"
  };
}

function ensureEvidenceSourceUrls(text, evidence, maxReplyChars) {
  const reply = String(text || "").trim();
  const items = (Array.isArray(evidence) ? evidence : [])
    .map((item) => ({
      ...item,
      url: validateSafeOutboundUrl(item?.url || "")
    }))
    .filter((item) => item.url)
    .slice(0, 3);
  const missingSources = items.filter((item) => {
    const url = String(item?.url || "").trim();
    return url && !reply.includes(url);
  });

  if (missingSources.length === 0) {
    return reply.slice(0, maxReplyChars);
  }

  const sourceLines = ["", "來源："];
  for (const [index, item] of missingSources.entries()) {
    const title = String(item.title || "來源").slice(0, 80);
    sourceLines.push(`${index + 1}. ${title}\n${item.url}`);
  }

  const suffix = sourceLines.join("\n");
  const availableReplyChars = Math.max(0, maxReplyChars - suffix.length);
  return `${reply.slice(0, availableReplyChars).trim()}${suffix}`.slice(0, maxReplyChars);
}

function countMainNumberedItems(text) {
  const mainAnswer = String(text || "").split(/\n來源[:：]/u)[0];
  return (mainAnswer.match(/(?:^|\n)\s*(?:\d+[.、]|[-*•])\s+/g) || []).length;
}

function extractUrls(text) {
  return [
    ...String(text || "").matchAll(/https?:\/\/[^\s<>"'）)]+/gi)
  ].map((match) => match[0]);
}

function containsUnsafeOrUnsupportedUrl(text, evidence) {
  const allowedUrls = new Set(
    (Array.isArray(evidence) ? evidence : [])
      .map((item) => validateSafeOutboundUrl(item?.url || ""))
      .filter(Boolean)
  );
  for (const url of extractUrls(text)) {
    const safeUrl = validateSafeOutboundUrl(url);
    if (!safeUrl || !allowedUrls.has(safeUrl)) {
      return true;
    }
  }
  return false;
}

function extractGroundingNumbers(text) {
  return [
    ...String(text || "")
      .replace(/https?:\/\/\S+/gi, " ")
      .matchAll(/\b\d{2,}(?:[,.]\d+)*\b/g)
  ].map((match) => match[0].replace(/,/g, ""));
}

function containsUnsupportedClaim(text, evidence, queryPolicy) {
  const answer = String(text || "");
  const evidenceText = (Array.isArray(evidence) ? evidence : [])
    .map((item) => `${item?.title || ""} ${item?.snippet || ""}`)
    .join(" ");
  const restrictedPatterns = [];

  if (hasRestriction(queryPolicy, "no_local_precision_without_structured_evidence")) {
    restrictedPatterns.push(/附近/u, /距離/u, /步行/u, /走路/u, /營業中/u, /營業時間/u, /評分/u, /星級/u, /排名/u);
  }

  if (hasRestriction(queryPolicy, "numbers_must_be_grounded")) {
    restrictedPatterns.push(/價格/u, /股價/u, /匯率/u, /天氣/u, /溫度/u, /狀態/u);
    const evidenceNumbers = new Set(extractGroundingNumbers(evidenceText));
    if (extractGroundingNumbers(answer).some((number) => !evidenceNumbers.has(number))) {
      return true;
    }
  }

  if (hasRestriction(queryPolicy, "no_stale_background_as_current")) {
    restrictedPatterns.push(/最新/u, /今天/u, /今日/u, /目前/u, /近期/u);
  }

  return restrictedPatterns.some((pattern) => pattern.test(answer) && !pattern.test(evidenceText));
}

function validateAnswerAgainstPolicy(text, evidence, queryPolicy, maxReplyChars) {
  const evidenceCount = Array.isArray(evidence) ? evidence.length : 0;
  if (evidenceCount === 0) {
    return "我沒有足夠來源可以可靠回答。".slice(0, maxReplyChars);
  }

  const evidenceDecision = evaluateEvidence(evidence, queryPolicy);
  if (evidenceDecision.answerMode !== "model_answer") {
    return formatConservativeEvidenceSummary(evidence, maxReplyChars);
  }

  if (containsUnsafeOrUnsupportedUrl(text, evidence)) {
    return formatConservativeEvidenceSummary(evidence, maxReplyChars);
  }

  if (extractUrls(text).length === 0) {
    return formatConservativeEvidenceSummary(evidence, maxReplyChars);
  }

  const numberedItemCount = countMainNumberedItems(text);
  if (
    evidenceCount > 0 &&
    hasRestriction(queryPolicy, "items_must_not_exceed_evidence") &&
    numberedItemCount > evidenceCount
  ) {
    return formatConservativeEvidenceSummary(evidence, maxReplyChars);
  }

  if (numberedItemCount > evidenceCount) {
    return formatConservativeEvidenceSummary(evidence, maxReplyChars);
  }

  if (containsUnsupportedClaim(text, evidence, queryPolicy)) {
    return formatConservativeEvidenceSummary(evidence, maxReplyChars);
  }

  return ensureEvidenceSourceUrls(text, evidence, maxReplyChars);
}

module.exports = {
  applySourcePreference,
  analyzeWebSearchQuery,
  classifySource,
  computeQueryRelevance,
  evaluateEvidence,
  formatConservativeEvidenceSummary,
  getHostname,
  hasEvergreenBackgroundSignal,
  isCandidateAllowed,
  isWeakEvidenceOnly,
  rankCandidate,
  validateAnswerAgainstPolicy
};
