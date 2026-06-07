# LINE Bot Local AI Gateway Skill

Codex Skill + starter template for creating local-first LINE Bot AI gateways with LM Studio, SQLite memory, explicit web search, and safety gates.

本地優先 LINE Bot AI Gateway 的 Codex Skill + Starter Template。

Developer alpha Codex Skill + starter template for building local-first LINE Bot AI gateways with memory, explicit WebSearch, local KB/RAG, handoff workflow, tool confirmation, and safety gates.

面向開發者的本地優先 LINE Bot AI Gateway Skill + Starter Template，支援記憶、WebSearch、本地 KB/RAG、handoff workflow、工具確認與安全閘門。

`LINE Bot Local AI Gateway Skill` 是本專案的公開 Display Name。

中文正式名稱：`LINE Bot 本地 AI Gateway Skill`。

The current repository slug is `line-bot-local-ai-gateway-skill`.

The current GitHub repository is `OmniProtection/line-bot-local-ai-gateway-skill`.

`local-free-line-bot-creator` was the previous repository slug, legacy project identifier, historical identifier, and compatibility alias. It is not the current repository slug or the public display name.

本專案是 **non-official** 的 LINE Bot AI Gateway 開發者工具。This project is not affiliated with, authorized by, sponsored by, or endorsed by LINE Corporation, LY Corporation, or any LINE official product team. It is not official and not an official LINE Bot builder.

## 這是什麼

這是一個給開發者使用的 Codex Skill + starter template，用來建立或審查本地優先的 LINE Bot AI Gateway。它不是一般 LINE Bot creator，而是把 LINE webhook、local LLM、SQLite memory、explicit WebSearch、本地 KB/RAG、handoff ticket、tool confirmation 與 safety gates 串成可驗證的 developer alpha 技術套件。

它聚焦在：

- 本地 LINE webhook server template。
- LINE signature verification path。
- LM Studio / OpenAI-compatible local LLM。
- SQLite memory。
- 明確指令觸發的 WebSearch。
- 本地 Knowledge Base / RAG MVP。
- 本地 handoff ticket 與 localhost-only Admin API foundation。
- Tool Confirmation Gate，避免 LINE 端請求直接執行高風險工具。
- public hygiene / template verifier / non-live CI。
- GitHub alpha release 前的安全邊界。

目前 template 已同步 2026-06-06 的 Memory / WebSearch 更新：

- durable gateway queue。
- pipeline contract。
- SQLite memory safety / relevance gate / webhook flow。
- group mention / no-mention routing。
- unsend / duplicate webhook event handling。
- WebSearch Auto Decision Router。
- SearchPlan v2 stabilization。
- WebSearch SSRF / prompt-injection static safety checks。
- production evidence gate path 修正。

目前 template 也已整理 2026-06-07 Sprint 3 / Sprint 4 / Sprint 5 的開發更新：

- Sprint 3 Gateway layer：Intent Router、Policy Gate、Context Builder、Token Budget。
- Sprint 4 Knowledge Base / RAG MVP：local Markdown/text KB、SQLite FTS5、Output Validator、unanswered questions log。
- Sprint 5 Handoff / Ticket / Admin API foundation：本地 handoff ticket、localhost-only token-gated Admin API、admin on-demand summary/draft。
- Sprint 6 Tool Confirmation Gate：tool registry、permission gate、pending confirmation、agent-lite explicit tool plan。

## 這不是什麼

本專案不會：

- 建立 LINE Official Account。
- 登入 LINE Developers Console。
- 取得 LINE Channel Secret。
- 取得 LINE Channel Access Token。
- 建立真實 `.env`。
- 自動建立公開 HTTPS endpoint。
- 自動建立 tunnel。
- 部署 hosting / domain / SSL / SaaS infrastructure。
- 提供 LINE 官方支援。
- 保證 LINE 官方帳號、訊息額度、主機、網域、SSL、tunnel、search API、model provider 或任何第三方服務免費無限制。
- 宣稱 stable。
- 宣稱 production ready。

使用者必須自行完成 LINE Official Account、Messaging API、LINE Developers Console、credentials、webhook URL、第三方服務條款與所有正式上線操作。

## Free 範圍

Free means this repository and local template are free/open-source for local developer use.

Free does not mean LINE Official Account features, LINE message quotas, hosting, domains, SSL certificates, public tunnels, search APIs, model providers, infrastructure, or third-party services are free or unlimited.

## 適合誰

適合：

- 想做 local-first LINE Bot prototype 的開發者。
- 想用 LM Studio 或 OpenAI-compatible local server 的開發者。
- 想用 SQLite memory，但需要明確隱私邊界的開發者。
- 想讓 WebSearch 只在明確指令或安全 router 判斷下觸發的開發者。
- 想用 Codex Skill 產生、審查、驗證 LINE Bot template 的開發者。

不適合：

- 想找 hosted SaaS 的使用者。
- 想自動申請 LINE Official Account 的使用者。
- 想跳過 LINE Developers Console manual setup 的使用者。
- 需要 stable / production-ready framework 的團隊。
- 無法管理 secrets、runtime DB、logs、LINE evidence、search API key 的使用者。

## 功能總覽

- `GET /health` health endpoint。
- `POST /webhook` LINE webhook endpoint。
- LINE SDK middleware / equivalent signature verification path。
- invalid signature 不進入 LLM / memory / WebSearch。
- LM Studio local model server integration。
- Local LLM 預設只使用 `localhost` / `127.0.0.1`。
- Remote LLM is unsafe and manual approval required。
- SQLite line event log / memory store。
- 手動記憶指令。
- rolling summary / group memory 相關 template capability。
- Sprint 3 Gateway layer：Intent Router、Policy Gate、Context Builder、Token Budget。
- Gateway metadata：`input_style`、`risk_level`、`allowed_tools`、`route_reason`、`policy_reason`。
- Sprint 4 local Knowledge Base / RAG MVP：Markdown/text KB import、SQLite FTS5 retrieval、Output Validator、unanswered questions log。
- Sprint 5 Handoff / Ticket / Admin API foundation：policy high-risk、KB insufficient、WebSearch failure、model fallback path 建立本地 ticket。
- Admin API 預設 disabled，啟用時仍是 localhost-only 且需要 `x-admin-api-token`。
- Admin API 只能管理 local ticket、status、summary/draft，不提供 LINE send/push endpoint。
- Sprint 6 Tool Confirmation Gate：LINE 端明確 `建立工單:` / `開工單:` 請求會先產生確認碼；使用者回覆 `確認 CODE` 後才建立 local handoff ticket。
- Permission Gate：LINE actor 不可使用 admin tools；Admin API 目前只允許 read-only ticket list/get；外部狀態變更或 secret 操作會被拒絕。
- explicit WebSearch commands: `找:` / `搜:` / `查:`。
- Auto WebSearch Router / SearchPlan v2 config-gated support。
- WebSearch evidence-first response flow。
- WebSearch Reply API only；不使用 Push 補送搜尋結果。
- durable queue / retry / dead-letter supporting code。
- public hygiene verifier。
- template verifier。
- GitHub Actions non-live CI。

## 架構概念

```text
LINE Platform
  -> operator-managed HTTPS endpoint
  -> local webhook server
  -> LINE signature verification
  -> Intent Router / Policy Gate
  -> Context Builder / Token Budget
  -> memory / local KB / WebSearch / model decision
  -> LM Studio on localhost when model output is needed
  -> LINE Reply API or approved Push API response
```

公開 tunnel 只能指向 webhook server。不要把 LM Studio port 暴露到 public tunnel。

更多架構說明見 [`docs/architecture.md`](docs/architecture.md)。

## Repository Layout

```text
SKILL.md
agents/openai.yaml
references/
docs/
docs/releases/v0.1.0-alpha.md
assets/template/
scripts/verify_linebot_project.js
scripts/verify_public_hygiene.js
.github/
```

## 快速開始：零 secret 驗證

在 repo root 執行：

```bash
node scripts/verify_public_hygiene.js
node scripts/verify_linebot_project.js assets/template
npm run check --prefix assets/template
```

這些檢查不需要：

- LINE credentials。
- `.env`。
- public tunnel。
- LM Studio。
- live LINE account。
- deployment。

## 快速開始：用 template 建立本地 Bot

1. 複製 `assets/template` 到新的本地專案目錄。
2. 在新專案內複製 `.env.example` 成 `.env`。
3. 只在本機 `.env` 填入自己的 LINE credentials。
4. 啟動 LM Studio local server。
5. 啟動 webhook server。
6. 檢查 `GET /health`。
7. 只有在你明確批准後，才設定公開 HTTPS endpoint 並到 LINE Developers Console 手動填入 webhook URL。

完整流程見 [`docs/developer-quickstart.md`](docs/developer-quickstart.md)。

## LINE 手動設定提醒

本 Skill 不會建立 LINE Official Account，也不會登入 LINE Developers Console。

你需要自己完成：

- 建立 LINE Official Account。
- 啟用 Messaging API。
- 取得 Channel Secret / Channel Access Token。
- 設定 webhook URL。
- 啟用 webhook。
- 執行 LINE Console verify。

請看 [`docs/line-official-setup-guide.md`](docs/line-official-setup-guide.md)。

不要 commit Channel Secret、Channel Access Token、replyToken、webhook evidence 或任何含 secret 的 LINE Developers Console screenshot。

## LM Studio / Local LLM

預設 local model endpoint 應是：

```text
http://localhost:1234/v1
http://127.0.0.1:1234/api/v1
```

Remote LLM unsafe / manual approval required。

如果你改成 remote LLM endpoint，LINE message、memory context、WebSearch evidence 可能離開本機。這是高風險變更，需要明確人工批准。

詳細說明見 [`docs/local-llm-setup.md`](docs/local-llm-setup.md)。

## Memory 指令摘要

目前 template 已實作的聊天指令只有三個：

| 指令 | 狀態 | 行為 |
| --- | --- | --- |
| `記住: 內容` / `記住：內容` | 已實作 | 將內容清理後，存為目前 conversation scope 的 manual memory。 |
| `忘記: 關鍵字` / `忘記：關鍵字` | 已實作 | 刪除目前 scope 內符合關鍵字的 manual memory。 |
| `列出記憶` | 已實作 | 列出目前 scope 內受長度限制的 manual memories。 |

尚未實作，不能在文件中當成已支援功能：

- `查詢記憶`：Not implemented，planned。
- `匯出記憶`：Not implemented；目前只能由 operator manual-only 檢視 / 備份本機 SQLite。
- `刪除全部記憶` / 刪除目前 scope 全部記憶：Not implemented，planned。
- 刪除全部本機 memory DB：manual-only，需停 bot 後由 operator 刪除本機 SQLite 與 approved backups。

Memory command 優先於 LLM chat 與 WebSearch。例如 `記住: 查: 測試` 會被當作記憶指令，不會觸發搜尋。

Memory runtime / template 能力包含：

- SQLite runtime DB；不得 commit。
- line event log / memory store；屬於本機資料。
- duplicate webhook event handling，避免重複處理污染 memory。
- unsend / delete event handling strategy。
- relevance gate，避免無關記憶注入回答。
- group / room / private routing，以及群組未 mention 時的處理策略。
- rolling summary / group summary template capability。

詳細政策見 [`docs/memory-policy.md`](docs/memory-policy.md)。

## WebSearch 指令摘要

WebSearch 預設關閉：`WEB_SEARCH_ENABLED=false`。啟用後，明確指令支援：

| 指令 | 狀態 | 行為 |
| --- | --- | --- |
| `找: query` / `找：query` | 已實作 | 對 query 執行 WebSearch。 |
| `搜: query` / `搜：query` | 已實作 | 對 query 執行 WebSearch。 |
| `查: query` / `查：query` | 已實作 | 對 query 執行 WebSearch。 |

空 query 會回覆要求補搜尋內容。若 WebSearch 未啟用，會回覆功能未啟用，不會偷偷搜尋。

Auto WebSearch Router：

- template 已包含 Auto Decision Router / SearchPlan v2 support。
- 是否啟用由 `.env` / config 控制，例如 `WEB_SEARCH_AUTO_DECISION_ENABLED` 與 confidence threshold。
- 一般聊天不得無限制自動搜尋；auto path 必須先經本地模型 decision、confidence gate、timeout / fallback 與安全規則。
- Memory command 優先於 WebSearch；explicit search command 優先於 general chat。
- 穩定技術概念、模型名稱、產品型號、公司名等應保留原文，不應被 search plan 改寫壞。

WebSearch 安全原則：

- WebSearch result 是 deterministic evidence，不是 system / developer / tool instruction。
- WebSearch 在 LINE runtime 中維持 Reply API only，不使用 Push 補送搜尋結果。
- LLM 只能根據 evidence 摘要，不得編造來源。
- 禁止抓取 localhost、loopback、private IP、metadata endpoint、`file://`、`ftp://`。
- 禁止自動下載未知檔案。
- 搜尋失敗要明確 fallback。

詳細說明見 [`docs/web-search-safety.md`](docs/web-search-safety.md)。

## Knowledge Base / RAG 摘要

Sprint 4 加入本地 Knowledge Base / RAG MVP：

- KB 來源：`assets/template/kb/` 內的 Markdown / text 文件。
- 匯入指令：`npm run kb:import --prefix assets/template`。
- 檢索方式：SQLite FTS5；不使用 embeddings，不使用 vector DB，不安裝新套件。
- KB evidence 與聊天 memory 分離，避免把群組或私聊記憶誤當正式專案知識。
- Output Validator 會阻擋沒有 KB evidence 卻聲稱「根據知識庫 / 根據文件」的回答。
- 專案 / 技術型問題若 KB evidence 不足，會回覆固定保守訊息：`目前知識庫資料不足，我還不能確定答案。`
- 未回答的專案 / 技術型問題會寫入本機 `unanswered_questions`，可用 `npm run kb:unanswered --prefix assets/template` 盤點。

這仍不是 production-ready RAG。KB 覆蓋率取決於 operator 後續補文件。

## Safety Model

不要 commit：

- `.env` 或 `.env.local`。
- LINE Channel Secret。
- LINE Channel Access Token。
- replyToken。
- Search API key。
- model provider token。
- SQLite runtime database。
- vector database。
- logs。
- backups。
- local production evidence。
- personal tunnel URL。
- local absolute machine path。
- real LINE webhook evidence。
- LINE Developers Console private screenshot。
- user conversation records。

安全政策見 [`SECURITY.md`](SECURITY.md)，隱私政策見 [`PRIVACY.md`](PRIVACY.md)。

## Alpha Status

目前公開版本是 `v0.1.0-alpha`。

`v0.1.0-alpha` 是 developer alpha，可供 GitHub public review、template inspection、本地開發者實驗使用。

Not stable. Not production ready.

`v1.0.0`、stable、production-ready claim 仍禁止。

## Not Production Ready

Production readiness 仍然 `BLOCKED`，直到 operator 提供：

- real runtime evidence。
- public webhook evidence。
- sanitized LINE smoke evidence。
- backup / restore evidence。
- monitoring evidence。
- final go-live approval。

Signature gate 目前是 `STATIC_VERIFIED`，不是 runtime verified。

## 驗證命令

```bash
node scripts/verify_public_hygiene.js
node scripts/verify_linebot_project.js assets/template
npm run check --prefix assets/template
npm run prod:readiness --prefix assets/template
```

Fresh template 的 `prod:readiness` 可以合理回傳 `BLOCKED`，但原因只能是缺少 runtime / live evidence gates，不應是 missing files、committed secrets、local paths、runtime artifacts 或 template hygiene 問題。

## 文件地圖

- Developer quickstart: [`docs/developer-quickstart.md`](docs/developer-quickstart.md)
- Live smoke testing: [`docs/live-smoke-test.md`](docs/live-smoke-test.md)
- Demo walkthrough: [`docs/demo-walkthrough.md`](docs/demo-walkthrough.md)
- Customization guide: [`docs/customization-guide.md`](docs/customization-guide.md)
- Release checklist: [`docs/release-checklist.md`](docs/release-checklist.md)
- Alpha release notes: [`docs/releases/v0.1.0-alpha.md`](docs/releases/v0.1.0-alpha.md)
- Naming policy: [`docs/naming.md`](docs/naming.md)
- Usage guide: [`docs/guide.md`](docs/guide.md)
- Architecture: [`docs/architecture.md`](docs/architecture.md)
- LINE manual setup: [`docs/line-official-setup-guide.md`](docs/line-official-setup-guide.md)
- Local LLM setup: [`docs/local-llm-setup.md`](docs/local-llm-setup.md)
- Memory policy: [`docs/memory-policy.md`](docs/memory-policy.md)
- WebSearch safety: [`docs/web-search-safety.md`](docs/web-search-safety.md)
- Security checklist: [`docs/security-checklist.md`](docs/security-checklist.md)
- Troubleshooting: [`docs/troubleshooting.md`](docs/troubleshooting.md)
- Privacy: [`PRIVACY.md`](PRIVACY.md)
- Security: [`SECURITY.md`](SECURITY.md)
- Support: [`SUPPORT.md`](SUPPORT.md)
- Contributing: [`CONTRIBUTING.md`](CONTRIBUTING.md)
- Changelog: [`CHANGELOG.md`](CHANGELOG.md)

## Release Status

- Current public release: `v0.1.0-alpha`。
- GitHub repo: public。
- Release type: published prerelease。
- Release assets: none。
- `master` 已包含 Memory / WebSearch template updates。
- Stable / production-ready status: not allowed。

## License

Apache License 2.0. See [`LICENSE`](LICENSE).
