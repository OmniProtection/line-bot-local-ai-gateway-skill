# LINE Bot Local AI Gateway Skill

> Local-first starter template for building LINE AI bots with LM Studio, SQLite memory, local KB/RAG, explicit WebSearch, handoff tickets, and safety gates.

用 **LM Studio + SQLite + LINE Webhook** 快速建立本地優先的 LINE AI Bot 範本。重點不是取代 LINE 官方工具，而是提供一個可檢查、可修改、重視 secret 與本地模型安全邊界的 developer alpha 起點。

**10 秒看懂，3 分鐘開始，30 分鐘改成自己的 LINE AI Bot。**

---

## Why this exists

Most LINE AI bot examples assume cloud LLM APIs, skip local memory design, or leave secret / tunnel / model endpoint risks unclear.

This project gives developers a safer starting point for local-first LINE AI chatbot prototypes:

| What you get | Why it matters |
| --- | --- |
| Local-first LINE Bot template | Build a LINE AI bot without sending every model request to a cloud LLM by default. |
| LM Studio / OpenAI-compatible local model support | Use a local model server through an OpenAI-compatible API path. |
| SQLite memory | Keep local conversation memory and event logs inspectable. |
| Explicit WebSearch commands | Search only when the user or policy explicitly allows it. |
| Local KB / RAG MVP | Answer from local Markdown/text files without a vector DB. |
| Safety gates | Reduce risk from leaked secrets, remote LLM endpoints, unsafe WebSearch, and direct tool execution. |
| Codex Skill workflow support | Use this repo as a repeatable template generation / review / verification skill. |

---

## 3-minute demo

### 1. Clone and verify the public template

```bash
git clone https://github.com/OmniProtection/line-bot-local-ai-gateway-skill.git
cd line-bot-local-ai-gateway-skill
node scripts/verify_public_hygiene.js
node scripts/verify_linebot_project.js assets/template
npm run check --prefix assets/template
```

These checks do **not** require:

- LINE credentials
- `.env`
- public tunnel
- LM Studio
- live LINE account
- deployment

### 2. Create a local demo bot from the template

```bash
cp -R assets/template ../line-bot-local-demo
cd ../line-bot-local-demo
cp .env.example .env
npm install
npm start
```

Windows PowerShell:

```powershell
Copy-Item -Recurse .\assets\template ..\line-bot-local-demo
Set-Location ..\line-bot-local-demo
Copy-Item .env.example .env
npm install
npm start
```

Expected result:

- The webhook server starts locally.
- `GET /health` returns `{"ok":true,...}`.
- `記住: 內容`, `忘記: 關鍵字`, and `列出記憶` work as local memory commands.
- `找:`, `搜:`, and `查:` trigger the WebSearch path only when enabled by config.
- Remote LLM endpoints require manual approval instead of being silently accepted.

Full guide: [`docs/developer-quickstart.md`](docs/developer-quickstart.md)

---

## Architecture

![LINE Bot local AI gateway demo flow](docs/images/demo-flow.png)

```text
LINE Platform
  -> operator-managed HTTPS endpoint
  -> local webhook server
  -> LINE signature verification
  -> Intent Router / Policy Gate
  -> Context Builder / Token Budget
  -> memory / local KB / WebSearch / model decision
  -> LM Studio on localhost when model output is needed
  -> LINE Reply API or approved response path
```

**Important:** a public tunnel should point only to the webhook server. Do not expose the LM Studio port to the public internet.

More architecture notes: [`docs/architecture.md`](docs/architecture.md)

---

## Current template capabilities

Implemented or included in the current developer alpha template:

- `GET /health` health endpoint.
- `POST /webhook` LINE webhook endpoint.
- LINE SDK middleware / equivalent signature verification path.
- Invalid signature does not enter LLM / memory / WebSearch paths.
- LM Studio local model server integration.
- Local LLM default config through `.env.example`:
  - `LOCAL_MODEL_PROVIDER=lmstudio`
  - `LOCAL_MODEL_BASE_URL=http://localhost:1234/v1`
  - `LOCAL_MODEL_REST_BASE_URL=http://127.0.0.1:1234/api/v1`
- Remote LLM endpoint is treated as unsafe unless manually approved.
- SQLite event log / memory store.
- Manual memory commands.
- Duplicate webhook event handling.
- Group mention / no-mention routing strategy.
- Sprint 3 Gateway layer: Intent Router, Policy Gate, Context Builder, Token Budget.
- Gateway metadata: `input_style`, `risk_level`, `allowed_tools`, `route_reason`, `policy_reason`.
- Sprint 4 local Knowledge Base / RAG MVP: Markdown/text KB import, SQLite FTS5 retrieval, Output Validator, unanswered questions log.
- Sprint 5 Handoff / Ticket / Admin API foundation: policy high-risk, KB insufficient, WebSearch failure, and model fallback paths can create local tickets.
- Admin API default disabled, localhost-only, token-gated when enabled.
- Sprint 6 Tool Confirmation Gate: LINE-side explicit tool requests create a confirmation code before local ticket creation.
- Permission Gate: LINE actor cannot use admin tools; Admin API currently allows read-only ticket list/get only.
- Explicit WebSearch commands: `找:`, `搜:`, `查:`.
- Auto WebSearch Router / SearchPlan v2 config-gated support.
- WebSearch Reply API only; no automatic Push fallback for search results.
- Durable queue / retry / dead-letter supporting code.
- Public hygiene verifier.
- Template verifier.
- GitHub Actions non-live CI.

---

## What this is not

This project is **not**:

- An official LINE product.
- A hosted SaaS bot builder.
- A LINE Developers Console replacement.
- A tool that creates a LINE Official Account for you.
- A tool that obtains your LINE Channel Secret or Channel Access Token.
- A tool that creates your public HTTPS endpoint, tunnel, hosting, domain, SSL, or monitoring.
- Stable or production-ready.

You must still manage your own LINE Official Account, Messaging API setup, credentials, webhook URL, third-party service terms, runtime server, tunnel, backup, and production approval.

This project is not affiliated with, authorized by, sponsored by, or endorsed by LINE Corporation, LY Corporation, or any LINE official product team.

---

## Who should use this

Good fit:

- Developers building a local-first LINE Bot prototype.
- Developers testing LM Studio or another OpenAI-compatible local model server.
- Teams that need local memory with clear privacy boundaries.
- Developers who want WebSearch to run only through explicit commands or policy gates.
- Developers who want a Codex Skill to generate, review, and verify LINE Bot templates.

Not a good fit:

- Users looking for a no-code hosted bot builder.
- Users who want to skip LINE Developers Console manual setup.
- Teams that need a stable production framework today.
- Users who cannot manage secrets, runtime databases, logs, backup, LINE evidence, or search API keys.

---

## Manual LINE setup required

This Skill does not create or configure LINE accounts for you.

You need to manually:

- Create a LINE Official Account.
- Enable Messaging API.
- Get your Channel Secret and Channel Access Token.
- Configure a webhook URL.
- Enable webhook.
- Run LINE Console verify.

Guide: [`docs/line-official-setup-guide.md`](docs/line-official-setup-guide.md)

Do **not** commit Channel Secret, Channel Access Token, replyToken, webhook evidence, LINE Developers Console screenshots, or real user conversation records.

---

## LM Studio / Local LLM

The default `.env.example` uses LM Studio-style local model settings:

```text
LOCAL_MODEL_PROVIDER=lmstudio
LOCAL_MODEL_BASE_URL=http://localhost:1234/v1
LOCAL_MODEL_REST_BASE_URL=http://127.0.0.1:1234/api/v1
```

If you change the model endpoint to a remote provider, LINE messages, memory context, and WebSearch evidence may leave your local machine. Treat this as a high-risk change that requires explicit operator approval.

Guide: [`docs/local-llm-setup.md`](docs/local-llm-setup.md)

---

## Memory commands

The current template implements these chat commands:

| Command | Status | Behavior |
| --- | --- | --- |
| `記住: 內容` / `記住：內容` | Implemented | Stores cleaned content as manual memory in the current conversation scope. |
| `忘記: 關鍵字` / `忘記：關鍵字` | Implemented | Deletes manual memory entries in the current scope that match the keyword. |
| `列出記憶` | Implemented | Lists length-limited manual memories in the current scope. |

Not implemented as user-facing chat commands yet:

- `查詢記憶`: planned.
- `匯出記憶`: not implemented; operator can manually inspect / back up local SQLite.
- `刪除全部記憶`: planned.
- Delete all local memory DB: manual-only operator action.

Memory command priority is higher than LLM chat and WebSearch. For example, `記住: 查: 測試` is treated as a memory command and does not trigger search.

Policy: [`docs/memory-policy.md`](docs/memory-policy.md)

---

## WebSearch commands

WebSearch is config-gated. In `.env.example`:

```text
WEB_SEARCH_ENABLED=false
WEB_SEARCH_AUTO_DECISION_ENABLED=true
WEB_SEARCH_DUCKDUCKGO_FALLBACK_ENABLED=false
```

When enabled, explicit commands include:

| Command | Status | Behavior |
| --- | --- | --- |
| `找: query` / `找：query` | Implemented | Runs WebSearch for the query. |
| `搜: query` / `搜：query` | Implemented | Runs WebSearch for the query. |
| `查: query` / `查：query` | Implemented | Runs WebSearch for the query. |

Safety principles:

- WebSearch results are evidence, not instructions.
- LLM should summarize from evidence, not fabricate sources.
- Empty query asks the user to provide search content.
- Disabled WebSearch returns a disabled-feature message and does not search silently.
- Search must not fetch localhost, loopback, private IP, metadata endpoints, `file://`, or `ftp://`.
- Unknown files must not be automatically downloaded.
- Search failure must fall back clearly.

Policy: [`docs/web-search-safety.md`](docs/web-search-safety.md)

---

## Local Knowledge Base / RAG MVP

Sprint 4 added a local KB / RAG MVP:

- Source files: Markdown / text files under `assets/template/kb/`.
- Import command: `npm run kb:import --prefix assets/template`.
- Retrieval: SQLite FTS5.
- No embeddings.
- No vector DB.
- No new package required for vector search.
- KB evidence is separated from chat memory.
- Output Validator blocks answers that claim to be based on KB evidence when no KB evidence exists.
- When KB evidence is insufficient, the conservative response is: `目前知識庫資料不足，我還不能確定答案。`
- Unanswered project / technical questions are logged locally for operator review.

This is still not production-ready RAG. KB quality depends on the operator maintaining the local files.

---

## Safety model

Do not commit:

- `.env` or `.env.local`
- LINE Channel Secret
- LINE Channel Access Token
- replyToken
- Search API key
- model provider token
- SQLite runtime database
- vector database
- logs
- backups
- local production evidence
- personal tunnel URL
- local absolute machine path
- real LINE webhook evidence
- LINE Developers Console private screenshot
- user conversation records

Security policy: [`SECURITY.md`](SECURITY.md)  
Privacy policy: [`PRIVACY.md`](PRIVACY.md)

---

## Validation commands

```bash
node scripts/verify_public_hygiene.js
node scripts/verify_linebot_project.js assets/template
npm run check --prefix assets/template
npm run prod:readiness --prefix assets/template
```

A fresh template may reasonably return `BLOCKED` for `prod:readiness` when the only blockers are missing runtime / live evidence gates. It should not fail because of committed secrets, local paths, missing files, runtime artifacts, or template hygiene problems.

---

## Repository layout

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

---

## Docs map

- Developer quickstart: [`docs/developer-quickstart.md`](docs/developer-quickstart.md)
- Demo walkthrough: [`docs/demo-walkthrough.md`](docs/demo-walkthrough.md)
- LINE manual setup: [`docs/line-official-setup-guide.md`](docs/line-official-setup-guide.md)
- Local LLM setup: [`docs/local-llm-setup.md`](docs/local-llm-setup.md)
- Architecture: [`docs/architecture.md`](docs/architecture.md)
- Memory policy: [`docs/memory-policy.md`](docs/memory-policy.md)
- WebSearch safety: [`docs/web-search-safety.md`](docs/web-search-safety.md)
- Live smoke testing: [`docs/live-smoke-test.md`](docs/live-smoke-test.md)
- Customization guide: [`docs/customization-guide.md`](docs/customization-guide.md)
- Release checklist: [`docs/release-checklist.md`](docs/release-checklist.md)
- Alpha release notes: [`docs/releases/v0.1.0-alpha.md`](docs/releases/v0.1.0-alpha.md)
- Naming policy: [`docs/naming.md`](docs/naming.md)
- Usage guide: [`docs/guide.md`](docs/guide.md)
- Security checklist: [`docs/security-checklist.md`](docs/security-checklist.md)
- Troubleshooting: [`docs/troubleshooting.md`](docs/troubleshooting.md)
- Privacy: [`PRIVACY.md`](PRIVACY.md)
- Security: [`SECURITY.md`](SECURITY.md)
- Support: [`SUPPORT.md`](SUPPORT.md)
- Contributing: [`CONTRIBUTING.md`](CONTRIBUTING.md)
- Changelog: [`CHANGELOG.md`](CHANGELOG.md)
- GitHub star launch plan: [`docs/github-star-launch-plan.md`](docs/github-star-launch-plan.md)

---

## Release status

- Current public release: `v0.1.0-alpha`.
- GitHub repo: public.
- Release type: published prerelease.
- Release assets: none.
- Stable / production-ready status: not allowed yet.
- Production readiness remains blocked until real runtime evidence, public webhook evidence, sanitized LINE smoke evidence, backup / restore evidence, monitoring evidence, and final go-live approval exist.
- Signature gate is currently `STATIC_VERIFIED`, not runtime verified.

---

## Free scope

Free means this repository and local template are free/open-source for local developer use.

Free does **not** mean LINE Official Account features, LINE message quotas, hosting, domains, SSL certificates, public tunnels, search APIs, model providers, infrastructure, or third-party services are free or unlimited.

---

## Naming

`LINE Bot Local AI Gateway Skill` is the public display name.

中文正式名稱：`LINE Bot 本地 AI Gateway Skill`。

Current repository: `OmniProtection/line-bot-local-ai-gateway-skill`.

`local-free-line-bot-creator` was the previous repository slug, legacy project identifier, historical identifier, and compatibility alias. It is not the current repository slug or public display name.

---

## License

Apache License 2.0. See [`LICENSE`](LICENSE).
