# LINE Bot 本地 AI Gateway Skill 使用與創建教學

這份教學說明如何使用 `LINE Bot Local AI Gateway Skill`，建立或審查本地優先 LINE Bot AI gateway 專案。`local-free-line-bot-creator` 是 repo slug / legacy identifier / compatibility alias，不是公開 Display Name。目標是讓使用者用 Codex 產生或審查專案，並保留安全預設：LINE webhook 由本機伺服器處理、LM Studio 保持在本機、SQLite 儲存記憶、web-search 只能由明確指令觸發。

## Skill 目標與適用情境

這個 Skill 適合用在下列情境：

- 建立新的 LINE Bot 專案骨架。
- 把現有 LINE Bot 接到 LM Studio 本地模型。
- 加入 SQLite conversation memory。
- 加入安全、可追溯來源的 web-search 指令。
- 檢查 LINE signature verification、Reply API、記憶流程、搜尋流程與 secret hygiene。
- 準備本機 production readiness gate，但不自動部署、不自動登入外部帳號。

這個 Skill 不會自動建立 LINE Official Account、不會登入 LINE Developers Console、不會取得 Channel Secret 或 Access Token，也不會自動建立公開 HTTPS endpoint。這些外部帳號與憑證步驟必須由使用者手動完成。

## Repo 結構與各資料夾用途

```text
SKILL.md
agents/
references/
assets/template/
scripts/
docs/
```

- `SKILL.md`：Codex 使用這個 Skill 時的主要規則與工作流。
- `agents/`：Skill metadata，可協助代理工具辨識用途。
- `references/`：架構、記憶、web-search、production gates 的長篇參考資料。
- `assets/template/`：乾淨的 LINE Bot starter template，包含 source、測試腳本、production docs placeholder 與 `.env.example`。
- `scripts/`：用來驗證 template 與 public hygiene 的 repo-level scripts。
- `docs/`：GitHub 使用者教學文件。

## 使用 Codex Skill 的建議 prompt

在 Codex 中使用時，可以直接指定這個 Skill 名稱或描述目標。

建立完整本地 LINE Bot：

```text
使用 LINE Bot Local AI Gateway Skill，建立一個 LINE Bot AI gateway，連接 LM Studio，本地 SQLite 記憶，並支援 找: / 搜: / 查: web-search 指令。不要建立真實 .env，不要部署。
```

審查既有專案：

```text
使用 LINE Bot Local AI Gateway Skill，檢查這個 LINE Bot AI gateway 是否符合：LINE signature verification、Reply API 優先、LM Studio 只走 localhost、沒有 hardcoded secrets、記憶與 web-search 流程安全。
```

只建立教學或 README：

```text
使用 LINE Bot Local AI Gateway Skill，替這個 LINE Bot AI gateway 專案產生 GitHub README，包含本機啟動、LINE Console 手動設定、LM Studio 啟動、測試與故障排除。
```

## 從 template 建立 LINE Bot 的流程

1. 複製或產生一份 `assets/template` 到你的新專案資料夾。
2. 在新專案中保留 `.env.example`，並由使用者自己建立本機用的設定檔。
3. 安裝 Node.js dependencies。
4. 啟動 LM Studio，載入要使用的本地模型，並開啟 OpenAI-compatible server。
5. 啟動 LINE Bot webhook server。
6. 用 `GET /health` 確認本機 server、LM Studio、SQLite 狀態。
7. 建立 HTTPS tunnel，只 exposing webhook server，不 exposing LM Studio。
8. 在 LINE Developers Console 手動設定 webhook URL。
9. 進行真實 LINE smoke test：私訊、群組不 @、群組 @、記憶、列出記憶、搜尋。

新專案至少應保留這些能力：

- `GET /health`
- `POST /webhook`
- LINE signature verification
- private/group/room routing
- LM Studio timeout 與 fallback
- SQLite memory
- explicit web-search command
- secret-free verification scripts

## LINE Console 需要手動準備的項目

LINE 相關帳號與憑證必須由使用者自行在 LINE 官方介面完成：

- 建立 LINE Official Account。
- 建立或選擇 LINE Developers Provider。
- 建立 Messaging API Channel。
- 取得 Channel Secret 與 Channel Access Token。
- 在本機設定檔填入憑證。
- 將 webhook URL 設成你的 HTTPS tunnel `/webhook` endpoint。
- 啟用 webhook。
- 使用 LINE Console 的 verify 功能確認 webhook 可連線。

注意：不要把 Channel Secret、Access Token、reply token 或任何真實 webhook evidence commit 到 GitHub。

## LM Studio 本地 LLM 連接步驟

1. 安裝並開啟 LM Studio。
2. 下載並載入一個本機模型。
3. 啟用 OpenAI-compatible local server。
4. 確認 LINE Bot 設定使用 `localhost` base URL。
5. 先用本機 health check 確認 `/v1/models` 可連線。
6. 再進行 LINE webhook 測試。

LM Studio 必須保持 private。公開 tunnel 只能指向 LINE Bot webhook server，不能直接指向 LM Studio port。

## SQLite 記憶功能與記憶指令概念

template 的 memory 設計以 SQLite 為主，適合本機使用與低成本部署。常見資料類型包含：

- long-term manual memories
- short-term conversation messages
- LINE event log
- group organized summaries
- rolling summaries
- unsend dirty marking
- relevance retrieval

記憶指令應優先於模型回答與 web-search。也就是說，當使用者明確要求新增、列出、查詢或整理記憶時，bot 應先執行 memory command，不應把它當成一般聊天或搜尋。

## web-search 顯式觸發方式與安全限制

web-search 必須由明確指令觸發，例如：

```text
找: 查詢內容
搜: 查詢內容
查: 查詢內容
```

安全規則：

- 不因一般聊天自動搜尋。
- 先建立 deterministic evidence，再交給本地模型摘要。
- 摘要只能根據搜尋 evidence，不應編造來源。
- URL 與文字要做基本清理。
- 不把 LM Studio 的 web-tools 當作主要 production search 路徑。
- 搜尋失敗時回覆明確 fallback，不假裝已查到結果。

## 本機驗證命令與 GitHub push 前檢查

在 Skill repo 根目錄檢查：

```powershell
node scripts\verify_public_hygiene.js
node scripts\verify_linebot_project.js assets\template
npm run check --prefix assets\template
```

在 template 專案內檢查：

```powershell
npm run check
npm run test:line-routing
npm run test:web-search
node scripts\test-memory-relevance-gate.js
node scripts\test-memory-webhook-flow-static.js
node scripts\test-memory-safety-static.js
node scripts\test-line-event-log.js
```

Fresh template 的 production readiness 可以是 `BLOCKED`，因為它尚未連接真實 LINE Channel、公開 webhook、LM Studio runtime 與人工 smoke evidence。可接受的狀態是明確 `BLOCKED`，不可接受的是 hardcoded personal endpoint、secret、runtime artifact 或未處理的檔案錯誤。

GitHub push 前確認：

- 沒有真實設定檔。
- 沒有 SQLite runtime DB。
- 沒有 logs、backups、node_modules。
- 沒有 Channel Secret、Access Token、reply token。
- 沒有個人 tunnel URL 或本機絕對路徑。
- GitHub Actions 只跑 non-live checks。

## 常見問題與故障排除

### LINE Bot 沒有回應

先確認本機 server 是否正在執行，再檢查 `/health`。如果本機正常，檢查 HTTPS tunnel 是否仍有效，最後確認 LINE Console webhook URL 是否指向目前 tunnel 的 `/webhook`。

### LINE Console verify 失敗

確認 tunnel 指向的是 webhook server，不是 LM Studio。也確認 webhook endpoint 是 `/webhook`，且 server 有處理 LINE signature verification。

### LM Studio 沒有回應

確認 LM Studio 已啟動 local server、模型已載入、base URL 指向 `localhost`，並檢查模型名稱是否與設定一致。

### 群組訊息一直亂回

群組情境應區分提及與未提及。未提及 bot 時應忽略或只記錄必要 event，不應主動回覆。

### web-search 查不到或回答不穩

確認訊息有使用 `找:`、`搜:` 或 `查:` 開頭。搜尋結果不足時，bot 應回覆無足夠 evidence，而不是憑空生成答案。

### readiness 顯示 BLOCKED

Fresh template 顯示 `BLOCKED` 是正常的。只有在真實 runtime、公開 webhook、LINE smoke test、backup/restore drill、go-live approval 都完成後，production readiness 才能變成 `PASS`。
