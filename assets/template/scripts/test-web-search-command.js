const assert = require("node:assert/strict");
const {
  decideWebSearchRequest,
  getPushTarget,
  parseWebSearchCommand
} = require("../src/webSearchCommand");
const {
  classifySearchSource,
  isRelevantCandidate,
  parseSearchResults,
  rankSearchCandidates,
  selectEvidenceCandidates
} = require("../src/webSearchService");

function run() {
  assert.deepEqual(parseWebSearchCommand("查: 台積電股價"), {
    matched: true,
    command: "查",
    query: "台積電股價"
  });
  assert.deepEqual(parseWebSearchCommand("查：台積電股價"), {
    matched: true,
    command: "查",
    query: "台積電股價"
  });
  assert.deepEqual(parseWebSearchCommand("搜: LM Studio web search"), {
    matched: true,
    command: "搜",
    query: "LM Studio web search"
  });
  assert.deepEqual(parseWebSearchCommand("找: 官方文件"), {
    matched: true,
    command: "找",
    query: "官方文件"
  });
  assert.deepEqual(parseWebSearchCommand("查: 台積電\n明天天氣"), {
    matched: true,
    command: "查",
    query: "台積電\n明天天氣"
  });
  assert.deepEqual(parseWebSearchCommand(" 查: 台積電股價"), { matched: false });
  assert.deepEqual(parseWebSearchCommand("幫我查台積電"), { matched: false });
  assert.deepEqual(parseWebSearchCommand("今天新聞是什麼"), { matched: false });
  assert.deepEqual(parseWebSearchCommand("記住: 查: 測試內容"), { matched: false });
  assert.deepEqual(parseWebSearchCommand("查:"), {
    matched: true,
    command: "查",
    query: ""
  });

  assert.equal(getPushTarget({ type: "user", userId: "U123" }), "U123");
  assert.equal(getPushTarget({ type: "group", groupId: "G123" }), "G123");
  assert.equal(getPushTarget({ type: "room", roomId: "R123" }), "R123");
  assert.equal(getPushTarget({ type: "group" }), null);

  const baseConfig = {
    webSearchEnabled: false,
    webSearchBackgroundPushEnabled: false
  };
  assert.deepEqual(
    decideWebSearchRequest(parseWebSearchCommand("查:"), baseConfig, { type: "user", userId: "U123" }),
    {
      action: "reply",
      reason: "web_search_disabled",
      text: "網路搜尋功能目前未啟用。"
    }
  );
  assert.deepEqual(
    decideWebSearchRequest(
      parseWebSearchCommand("查:"),
      { webSearchEnabled: true, webSearchBackgroundPushEnabled: true },
      { type: "user", userId: "U123" }
    ),
    {
      action: "reply",
      reason: "web_search_empty_query",
      text: "請在 查: 後面加上要搜尋的內容。"
    }
  );
  assert.deepEqual(
    decideWebSearchRequest(
      parseWebSearchCommand("搜:"),
      { webSearchEnabled: true, webSearchBackgroundPushEnabled: true },
      { type: "user", userId: "U123" }
    ),
    {
      action: "reply",
      reason: "web_search_empty_query",
      text: "請在 搜: 後面加上要搜尋的內容。"
    }
  );
  assert.equal(
    decideWebSearchRequest(parseWebSearchCommand("查: 台積電"), baseConfig, {
      type: "user",
      userId: "U123"
    }).reason,
    "web_search_disabled"
  );
  assert.equal(
    decideWebSearchRequest(
      parseWebSearchCommand("查: 台積電"),
      { webSearchEnabled: true, webSearchBackgroundPushEnabled: false },
      { type: "user", userId: "U123" }
    ).action,
    "start"
  );
  assert.deepEqual(
    decideWebSearchRequest(
      parseWebSearchCommand("查: 台積電"),
      { webSearchEnabled: true, webSearchBackgroundPushEnabled: true },
      { type: "group", groupId: "G123" }
    ),
    {
      action: "start",
      query: "台積電"
    }
  );

  const parsedResults = parseSearchResults(
    '<div class="result"><a class="result__a" href="/l/?uddg=https%3A%2F%2Fexample.com%2Fnews">Example &amp; News</a><a class="result__snippet">Snippet <b>text</b></a></div>',
    3
  );
  assert.equal(parsedResults.length, 1);
  assert.equal(parsedResults[0].title, "Example & News");
  assert.equal(parsedResults[0].url, "https://example.com/news");
  assert.equal(parsedResults[0].snippet, "Snippet text");
  assert.equal(parsedResults[0].searchRank, 1);
  assert.equal(parsedResults[0].sourceProvider, "duckduckgo");

  const duckAdResults = parseSearchResults(
    '<div class="result"><a class="result__a" href="https://duckduckgo.com/y.js?ad_domain=aiondesktop.com&amp;ad_provider=bingv7aa&amp;ad_type=txad&amp;u3=https%3A%2F%2Fwww.bing.com%2Faclick%3Fu%3Dhttps%253A%252F%252Fopenclaw.example">OpenClaw ad</a><a class="result__snippet">Ad snippet</a></div>',
    3
  );
  assert.equal(duckAdResults.length, 0);

  const singleQuotedResults = parseSearchResults(
    "<div class='result'><a href='/l/?uddg=https%3A%2F%2Fwww.cwa.gov.tw%2Fweather' class='result__a'>中央氣象署天氣</a><div class='result__snippet'>官方天氣預報</div></div>",
    3
  );
  assert.equal(singleQuotedResults.length, 1);
  assert.equal(singleQuotedResults[0].title, "中央氣象署天氣");
  assert.equal(singleQuotedResults[0].url, "https://www.cwa.gov.tw/weather");
  assert.equal(singleQuotedResults[0].snippet, "官方天氣預報");
  assert.equal(singleQuotedResults[0].sourceProvider, "duckduckgo");

  const googleAdWrappedResults = parseSearchResults(
    '<div class="result"><a class="result__a" href="/l/?uddg=https%3A%2F%2Fgoogleadservices.com%2Fpagead%2Faclk%3Fadurl%3Dhttps%253A%252F%252Fexample.com">Ad wrapped result</a><a class="result__snippet">Ad snippet</a></div>',
    3
  );
  assert.equal(googleAdWrappedResults.length, 0);

  const trackingParamResults = parseSearchResults(
    '<div class="result"><a class="result__a" href="/l/?uddg=https%3A%2F%2Fexample.com%2Fpage%3Futm_source%3Dddg%26fbclid%3Dabc">Tracked result</a><a class="result__snippet">Snippet</a></div>',
    3
  );
  assert.equal(trackingParamResults.length, 1);
  assert.equal(trackingParamResults[0].url, "https://example.com/page");

  assert.equal(
    classifySearchSource({
      title: "中央氣象署",
      url: "https://www.cwa.gov.tw/V8/C/W/County/index.html",
      snippet: "天氣預報"
    }).sourceType,
    "official_primary"
  );
  assert.equal(
    classifySearchSource({
      title: "Government source",
      url: "https://example.gov/data",
      snippet: "Official data"
    }).sourceType,
    "official_primary"
  );
  assert.equal(
    classifySearchSource({
      title: "台積電 Yahoo 股市",
      url: "https://tw.stock.yahoo.com/quote/2330.TW",
      snippet: "即時股價"
    }).sourceType,
    "structured_platform"
  );
  assert.equal(
    classifySearchSource({
      title: "NVIDIA RTX 5060Ti 顯示卡開箱",
      url: "https://www.coolpc.com.tw/tw/shop/gpu/nvidia-rtx5060ti/",
      snippet: "規格、價格與商品資訊"
    }).sourceType,
    "structured_platform"
  );
  assert.equal(
    classifySearchSource({
      title: "5060ti 的價格推薦",
      url: "https://biggo.com.tw/s/5060ti",
      snippet: "比價與商品價格"
    }).sourceType,
    "structured_platform"
  );
  assert.equal(
    classifySearchSource({
      title: "10 間韓式烤肉懶人包推薦",
      url: "https://example-blog.com/post/korean-bbq",
      snippet: "部落格整理"
    }).sourceType,
    "weak_secondary"
  );

  const ranked = rankSearchCandidates([
    {
      title: "10 間韓式烤肉懶人包推薦",
      url: "https://example-blog.com/post/korean-bbq",
      snippet: "部落格整理",
      searchRank: 1
    },
    {
      title: "中央氣象署官方天氣預報",
      url: "https://www.cwa.gov.tw/V8/C/W/County/index.html",
      snippet: "官方天氣資料",
      searchRank: 3
    },
    {
      title: "Yahoo 股市台積電",
      url: "https://tw.stock.yahoo.com/quote/2330.TW",
      snippet: "平台股市資料",
      searchRank: 2
    }
  ]);
  assert.equal(ranked[0].sourceType, "official_primary");
  assert.equal(ranked[1].sourceType, "structured_platform");
  assert.equal(ranked[2].sourceType, "weak_secondary");

  const freshnessRanked = rankSearchCandidates(
    [
      {
        title: "OpenAI 最新消息 - 官方新聞",
        url: "https://openai.com/news/",
        snippet: "OpenAI 官方 news",
        searchRank: 2
      },
      {
        title: "OpenAI - 維基百科",
        url: "https://zh.wikipedia.org/wiki/OpenAI",
        snippet: "OpenAI 是一家人工智慧研究機構",
        searchRank: 1
      },
      {
        title: "一文讀懂 OpenAI 事件",
        url: "https://example-blog.com/openai-explainer",
        snippet: "OpenAI 介紹與歷史事件整理",
        searchRank: 3
      }
    ],
    "OpenAI 最新消息"
  );
  assert.equal(freshnessRanked[0].sourceType, "official_primary");
  assert.equal(
    isRelevantCandidate(freshnessRanked.find((item) => item.domain === "zh.wikipedia.org"), "OpenAI 最新消息"),
    false
  );
  assert.equal(
    isRelevantCandidate(freshnessRanked.find((item) => item.domain === "example-blog.com"), "OpenAI 最新消息"),
    false
  );

  const relevanceRanked = rankSearchCandidates(
    [
      {
        title: "臺中市西區忠孝國民小學服務網",
        url: "https://jses.tc.edu.tw/",
        snippet: "忠孝國小官方網站",
        searchRank: 1
      },
      {
        title: "大安區韓式烤肉餐廳整理",
        url: "https://example-blog.com/korean-bbq",
        snippet: "忠孝東路 大安 韓式烤肉 餐廳",
        searchRank: 2
      }
    ],
    "忠孝東路大安路口附近韓式烤肉"
  );
  assert.equal(relevanceRanked[0].url, "https://example-blog.com/korean-bbq");
  assert.equal(
    isRelevantCandidate(
      relevanceRanked.find((item) => item.url === "https://jses.tc.edu.tw/"),
      "忠孝東路大安路口附近韓式烤肉"
    ),
    false
  );
  assert.equal(isRelevantCandidate(relevanceRanked[0], "忠孝東路大安路口附近韓式烤肉"), true);

  const selected = selectEvidenceCandidates(
    rankSearchCandidates([
      { title: "A1", url: "https://openai.com/news/a", snippet: "", searchRank: 1 },
      { title: "A2", url: "https://openai.com/news/b", snippet: "", searchRank: 2 },
      { title: "B", url: "https://tw.stock.yahoo.com/quote/2330.TW", snippet: "", searchRank: 3 }
    ]),
    2
  );
  assert.equal(selected.length, 2);
  assert.notEqual(selected[0].domain, selected[1].domain);
}

run();
