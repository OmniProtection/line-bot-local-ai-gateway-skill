const assert = require("node:assert/strict");
const {
  analyzeWebSearchQuery,
  classifySource,
  evaluateEvidence,
  isCandidateAllowed,
  rankCandidate,
  validateAnswerAgainstPolicy
} = require("../src/webSearchPolicy");

function hasTag(policy, tag) {
  return policy.intentTags.includes(tag);
}

function run() {
  const stock = analyzeWebSearchQuery("台積電今天股價");
  assert.equal(hasTag(stock, "freshness_required"), true);
  assert.equal(hasTag(stock, "structured_numeric"), true);

  const fx = analyzeWebSearchQuery("美元兌台幣匯率");
  assert.equal(hasTag(fx, "structured_numeric"), true);

  const weather = analyzeWebSearchQuery("台北明天天氣");
  assert.equal(hasTag(weather, "structured_numeric"), true);

  const official = analyzeWebSearchQuery("OpenAI 官方最新消息");
  assert.equal(hasTag(official, "freshness_required"), true);
  assert.equal(hasTag(official, "primary_source_preferred"), true);

  const product = analyzeWebSearchQuery("5060TI 價格 規格 比較");
  assert.equal(hasTag(product, "purchase_decision"), true);
  assert.equal(hasTag(product, "recommendation_or_comparison"), true);
  assert.equal(hasTag(analyzeWebSearchQuery("5060TI"), "purchase_decision"), true);
  const productByPreference = analyzeWebSearchQuery("graphics card model", {
    sourcePreference: "product_specs"
  });
  assert.equal(hasTag(productByPreference, "purchase_decision"), true);

  const local = analyzeWebSearchQuery("忠孝東路大安路口附近韓式烤肉餐廳");
  assert.equal(hasTag(local, "local_place_structured"), true);

  const background = analyzeWebSearchQuery("OpenAI 是什麼 介紹");
  assert.equal(hasTag(background, "background_info"), true);

  assert.equal(
    classifySource({
      title: "中央氣象署",
      url: "https://www.cwa.gov.tw/V8/C/W/County/index.html",
      snippet: "天氣預報"
    }).sourceType,
    "official_primary"
  );
  assert.equal(
    classifySource({
      title: "Yahoo 股市台積電",
      url: "https://tw.stock.yahoo.com/quote/2330.TW",
      snippet: "即時股價"
    }).sourceType,
    "structured_platform"
  );
  assert.equal(
    classifySource({
      title: "OpenAI 推出 Daybreak 安全計畫",
      url: "https://infosecu.technews.tw/2026/05/13/openai-introduces-daybreak/",
      snippet: "OpenAI 發表 Daybreak"
    }).sourceType,
    "reputable_secondary"
  );
  assert.equal(
    classifySource({
      title: "10 間韓式烤肉懶人包推薦",
      url: "https://example-blog.com/post/korean-bbq",
      snippet: "部落格整理"
    }).sourceType,
    "weak_secondary"
  );

  const freshnessPolicy = analyzeWebSearchQuery("OpenAI 最新消息");
  const officialRanked = rankCandidate(
    {
      title: "OpenAI 最新消息",
      url: "https://openai.com/news/",
      snippet: "Research May 20, 2026",
      searchRank: 2
    },
    freshnessPolicy
  );
  const wikiRanked = rankCandidate(
    {
      title: "OpenAI - 維基百科",
      url: "https://zh.wikipedia.org/wiki/OpenAI",
      snippet: "OpenAI 是一家人工智慧研究機構",
      searchRank: 1
    },
    freshnessPolicy
  );
  assert.equal(isCandidateAllowed(officialRanked, freshnessPolicy), true);
  assert.equal(isCandidateAllowed(wikiRanked, freshnessPolicy), false);
  assert.ok(officialRanked.qualityScore > wikiRanked.qualityScore);

  const officialPreferencePolicy = analyzeWebSearchQuery("graphics card specifications", {
    sourcePreference: "official"
  });
  const officialPreferenceRanked = rankCandidate(
    {
      title: "Official product specifications",
      url: "https://www.nvidia.com/en-us/geforce/graphics-cards/50-series/rtx-5060-ti/",
      snippet: "Specifications and features",
      searchRank: 2
    },
    officialPreferencePolicy
  );
  const marketplacePreferenceRanked = rankCandidate(
    {
      title: "Rtx 5060ti 16gb",
      url: "https://www.amazon.com/rtx-5060ti-16gb/s?k=rtx+5060ti+16gb",
      snippet: "Shopping results",
      searchRank: 1
    },
    officialPreferencePolicy
  );
  assert.ok(officialPreferenceRanked.qualityScore > marketplacePreferenceRanked.qualityScore);
  assert.ok(officialPreferenceRanked.qualityReasons.includes("source_preference_official_boost"));

  const schoolCandidate = rankCandidate(
    {
      title: "臺中市西區忠孝國民小學服務網",
      url: "https://jses.tc.edu.tw/",
      snippet: "忠孝國小官方網站",
      searchRank: 1
    },
    local
  );
  assert.equal(isCandidateAllowed(schoolCandidate, local), false);

  const localPolicy = analyzeWebSearchQuery("忠孝東路大安路口附近韓式烤肉");
  const localDecision = evaluateEvidence(
    [
      {
        title: "韓式烤肉懶人包",
        url: "https://example-blog.com/korean-bbq",
        snippet: "忠孝東路 大安 韓式烤肉",
        sourceType: "weak_secondary"
      }
    ],
    localPolicy
  );
  assert.equal(localDecision.answerMode, "conservative_summary");
  assert.equal(localDecision.shouldCallModel, false);

  const localPreferencePolicy = analyzeWebSearchQuery("基隆 燒烤", {
    sourcePreference: "local_places"
  });
  const localPlatformRanked = rankCandidate(
    {
      title: "基隆燒烤餐廳菜單",
      url: "https://www.openrice.com/zh/taiwan/restaurants?what=基隆燒烤",
      snippet: "餐廳 地址 菜單 訂位",
      searchRank: 2
    },
    localPreferencePolicy
  );
  const localBlogRanked = rankCandidate(
    {
      title: "基隆必吃 10 家",
      url: "https://example-blog.com/keelung-food",
      snippet: "旅遊美食推薦",
      searchRank: 1
    },
    localPreferencePolicy
  );
  assert.ok(localPlatformRanked.qualityScore > localBlogRanked.qualityScore);

  const productPolicy = analyzeWebSearchQuery("5060TI 價格 規格");
  const productDecision = evaluateEvidence(
    [
      {
        title: "5060TI 開箱推薦",
        url: "https://example-blog.com/5060ti",
        snippet: "開箱整理",
        sourceType: "weak_secondary"
      }
    ],
    productPolicy
  );
  assert.equal(productDecision.answerMode, "conservative_summary");

  const staleProductNumber = validateAnswerAgainstPolicy(
    "RTX 5060 Ti 價格截至 2025 年約 NT$ 12900。",
    [
      {
        title: "5060ti 的價格推薦 - 2026年5月",
        url: "https://biggo.com.tw/s/5060ti",
        snippet: "5060ti 價格與詳細規格比較，2026年5月，NT$ 13790 起。",
        sourceType: "structured_platform"
      }
    ],
    analyzeWebSearchQuery("5060TI"),
    800
  );
  assert.ok(staleProductNumber.includes("無法逐項驗證更多細節"));
  assert.equal(staleProductNumber.includes("2025 年"), false);

  const productBulletList = validateAnswerAgainstPolicy(
    "- A 顯示卡：NT$ 13790\n- B 顯示卡：NT$ 18990\n- C 顯示卡：NT$ 19590",
    [
      {
        title: "原價屋 5060Ti",
        url: "https://www.coolpc.com.tw/tw/shop/gpu/nvidia-rtx5060ti/",
        snippet: "RTX 5060Ti 8GB/16GB 顯示卡",
        sourceType: "structured_platform"
      },
      {
        title: "BigGo 5060ti 價格",
        url: "https://biggo.com.tw/s/5060ti",
        snippet: "5060ti 價格與詳細規格比較，NT$ 13790 到 NT$ 18990。",
        sourceType: "structured_platform"
      }
    ],
    analyzeWebSearchQuery("5060TI"),
    800
  );
  assert.ok(productBulletList.includes("無法逐項驗證更多細節"));
  assert.equal(productBulletList.includes("C 顯示卡"), false);

  const validatedLocal = validateAnswerAgainstPolicy(
    "這家店距離很近，目前營業中，而且評分很高。\nhttps://trusted.example/place",
    [
      {
        title: "店家頁",
        url: "https://trusted.example/place",
        snippet: "店家介紹與菜單內容",
        sourceType: "structured_platform"
      }
    ],
    localPolicy,
    800
  );
  assert.ok(validatedLocal.includes("無法逐項驗證更多細節"));
  assert.equal(validatedLocal.includes("目前營業中，而且評分很高"), false);

  const recommendPolicy = analyzeWebSearchQuery("韓式烤肉推薦比較");
  const validatedList = validateAnswerAgainstPolicy(
    "1. A 店\n2. B 店\n3. C 店",
    [
      {
        title: "來源一",
        url: "https://example.com/one",
        snippet: "A 店",
        sourceType: "structured_platform"
      },
      {
        title: "來源二",
        url: "https://example.com/two",
        snippet: "B 店",
        sourceType: "structured_platform"
      }
    ],
    recommendPolicy,
    800
  );
  assert.ok(validatedList.includes("無法逐項驗證更多細節"));
  assert.equal(validatedList.includes("3. C 店"), false);
}

run();
