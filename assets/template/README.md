# LINE Bot Local AI Gateway Template

This is a non-official local-first LINE Bot template. It is not affiliated with, authorized by, sponsored by, or endorsed by LINE Corporation, LY Corporation, or any LINE official product team.

Free means the local template is intended to be free and open source for local use. It does not mean LINE Official Account features, message quotas, hosting, domains, SSL, tunnels, search APIs, or third-party infrastructure are free or unlimited.

Local-first LINE Bot MVP using Node.js, Express, LINE Messaging API Reply API, LINE Push API for approved background general replies, and LM Studio through its OpenAI-compatible local API.

## Architecture

```text
LINE -> webhook server -> signature verification -> Intent Router / Policy Gate -> Context Builder / Token Budget -> LM Studio local API when needed -> LINE Reply API or approved Push API
```

The webhook server is the public gateway. Keep LM Studio private on your machine; do not expose `http://localhost:1234` directly to the internet.

The webhook endpoint returns HTTP 2xx immediately after LINE signature verification, then processes each event. Short general chats can attempt a direct Reply when they fit the configured length gate and finish within the direct model timeout. Other normal model conversations first send `GENERAL_PENDING_REPLY_TEXT`, then send the final LM Studio answer through LINE Push API to the same user, group, or room.

Optional web search is disabled by default. When enabled, messages that begin with `找:`, `搜:`, or `查:` use the forced web-search path. Auto WebSearch can also be enabled through the config-gated SearchPlan router. LINE web search uses deterministic web evidence first, then LM Studio summarizes that evidence. Search answers stay on the LINE Reply API path; the runtime does not use Push API to supplement search answers.

Sprint 3 adds a gateway layer:

- `intentRouter.js`: memory command, forced WebSearch, auto WebSearch, general chat, ignored route, and unsend routing.
- `policyGate.js`: tool permission and risk-level metadata.
- `contextBuilder.js`: memory/context assembly and search-status guard.
- `tokenBudget.js`: char-based context budgeting without a tokenizer dependency.

Sprint 4 adds a local Knowledge Base / RAG MVP:

- Markdown/text KB files live under `kb/`.
- `npm run kb:import` imports KB chunks into local SQLite FTS5.
- KB evidence is separate from LINE chat memory.
- Output Validator prevents unsupported project/technical answers when KB evidence is missing.
- `npm run kb:unanswered` lists unresolved project/technical questions for future KB updates.
- No embeddings, vector DB, deployment, or external KB service is used.

Remote LLM endpoints are unsafe by default. Changing `LOCAL_MODEL_BASE_URL` away from `localhost` or `127.0.0.1` can send LINE message content, memory context, or search evidence away from the operator machine and requires explicit manual approval.

## Defaults

- LINE mode: Reply API for pending/command responses; Push API for background final replies
- Model provider: LM Studio
- LM Studio base URL: `http://localhost:1234/v1`
- LM Studio REST base URL: `http://127.0.0.1:1234/api/v1`
- Model name: `google/gemma-4-e4b`
- Model timeout: `60000` ms
- Chat temperature: `0.4`
- Chat top-p: `0.9`
- Chat max tokens: `256`
- Recommended LM Studio context length: `8192` tokens
- Configured max reply length: `800` characters
- Configured web-search max reply length: `1600` characters
- LINE reply hard safety limit: `4500` characters
- General direct reply gate: enabled for inputs up to `20` characters
- General direct model timeout: `1300` ms
- General pending reply text: `思考中`
- Web search: disabled by default
- Web-search Reply API result delivery: enabled only when WebSearch is enabled
- Web-search Push API result delivery: not used by the LINE runtime path
- Knowledge Base: enabled by default
- Knowledge Base source directory: `kb`
- Knowledge Base max results: `4`
- Knowledge Base chunk chars: `900`
- LM Studio `npacker/web-tools` search path: disabled by default
- DuckDuckGo fallback: disabled by default
- Server port: `3000`

## Setup

1. Install dependencies only when you are ready to run the app:

   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env` locally and fill in values from LINE Developers Console:

   ```bash
   cp .env.example .env
   ```

3. Start LM Studio, load `google/gemma-4-e4b`, set the model context length to `8192` tokens (`16384` only if you need longer context and your machine can handle it), disable thinking if the model UI exposes that option, and enable the local server at:

   ```text
   http://localhost:1234/v1
   ```

4. Start the webhook server:

   ```bash
   npm start
   ```

5. For local LINE webhook testing, expose only this webhook server with an HTTPS tunnel such as ngrok or Cloudflare Tunnel. Do not tunnel LM Studio directly.

6. Configure the LINE webhook URL manually:

   ```text
   https://YOUR-TUNNEL-DOMAIN/webhook
   ```

This template does not create a LINE Official Account, log in to LINE Developers Console, retrieve Channel Secret or Access Token, create a public HTTPS endpoint, or deploy hosting. Complete those official and infrastructure steps manually.

## Environment

Use `.env.example` as the template:

```env
LINE_CHANNEL_SECRET=
LINE_CHANNEL_ACCESS_TOKEN=
LOCAL_MODEL_PROVIDER=lmstudio
LOCAL_MODEL_BASE_URL=http://localhost:1234/v1
LOCAL_MODEL_REST_BASE_URL=http://127.0.0.1:1234/api/v1
LOCAL_MODEL_API_TOKEN=
LOCAL_MODEL_NAME=google/gemma-4-e4b
LOCAL_MODEL_TIMEOUT_MS=60000
CHAT_TEMPERATURE=0.4
CHAT_TOP_P=0.9
CHAT_MAX_TOKENS=256
CHAT_CONTEXT_LENGTH=8192
MAX_REPLY_CHARS=800
WEB_SEARCH_MAX_REPLY_CHARS=1600
GENERAL_DIRECT_REPLY_ENABLED=true
GENERAL_DIRECT_REPLY_MAX_INPUT_CHARS=20
GENERAL_DIRECT_MODEL_TIMEOUT_MS=1300
GENERAL_PENDING_REPLY_TEXT=思考中
WEB_SEARCH_ENABLED=false
WEB_SEARCH_BACKGROUND_PUSH_ENABLED=false
WEB_SEARCH_MAX_RESULTS=3
WEB_SEARCH_TOTAL_TIMEOUT_MS=12000
WEB_SEARCH_JOB_TIMEOUT_MS=120000
WEB_SEARCH_PAGE_TIMEOUT_MS=5000
WEB_SEARCH_PENDING_REPLY_TEXT=資料搜尋中，完成後會補上結果。
WEB_SEARCH_LMSTUDIO_TOOLS_ENABLED=false
WEB_SEARCH_LMSTUDIO_PLUGIN_ID=npacker/web-tools
WEB_SEARCH_DUCKDUCKGO_FALLBACK_ENABLED=false
KNOWLEDGE_BASE_ENABLED=true
KNOWLEDGE_BASE_SOURCE_DIR=kb
KNOWLEDGE_BASE_MAX_RESULTS=4
KNOWLEDGE_BASE_CHUNK_CHARS=900
KNOWLEDGE_BASE_INSUFFICIENT_REPLY=目前知識庫資料不足，我還不能確定答案。
PORT=3000
```

Do not commit `.env` or real LINE credentials.

`MAX_REPLY_CHARS` controls normal reply length. The app also keeps a final `4500`
character hard limit before sending text to LINE, even if `MAX_REPLY_CHARS` is set
higher.

`WEB_SEARCH_MAX_REPLY_CHARS` controls web-search Reply result length separately, so sourced search answers can be longer than normal chat while still staying below LINE's hard safety limit.

## Endpoints

- `GET /health`: local health check.
- `POST /webhook`: LINE webhook endpoint with SDK middleware signature verification.

## Verification

Run static syntax checks after dependencies are installed:

```bash
npm run check
```

Manual checks:

- `.env.example` exists and contains no real secrets.
- No real `.env` is committed.
- LINE webhook is `POST /webhook`.
- LINE signature verification uses `@line/bot-sdk` middleware.
- The webhook responds HTTP 2xx immediately, then processes LINE events in the background.
- Short normal model conversations may use direct Reply when `GENERAL_DIRECT_REPLY_ENABLED=true`, input length is within `GENERAL_DIRECT_REPLY_MAX_INPUT_CHARS`, and LM Studio finishes within `GENERAL_DIRECT_MODEL_TIMEOUT_MS`.
- Other normal model conversations use Reply API for `GENERAL_PENDING_REPLY_TEXT`, then Push API for the final LM Studio answer.
- Memory commands still use Reply API and keep priority over model/search flows.
- Web search uses Reply API only in the LINE runtime path. `WEB_SEARCH_BACKGROUND_PUSH_ENABLED` must not be used to supplement search answers.
- Broadcast, Multicast, and Narrowcast are not used.
- LM Studio chat completions are called through `LOCAL_MODEL_BASE_URL`; optional `npacker/web-tools` search is called through `LOCAL_MODEL_REST_BASE_URL`.
- Model timeout returns a safe fallback reply.
- LM Studio is not exposed directly to the public internet.

Web-search manual checks:

- `你好` should direct Reply when the direct gate is enabled and LM Studio answers within the direct timeout; otherwise it should reply `思考中`, then Push the final model answer.
- `今天新聞是什麼` should remain a normal conversation and should not trigger web search.
- `查: 台積電今天股價` should trigger the Reply API web-search flow when WebSearch is enabled.
- With `WEB_SEARCH_LMSTUDIO_TOOLS_ENABLED=true`, LM Studio must allow API clients to use `npacker/web-tools`; otherwise the bot returns `搜尋服務目前不可用，請稍後再試。` unless `WEB_SEARCH_DUCKDUCKGO_FALLBACK_ENABLED=true`.
- `記住: 查: 測試` should use the memory command and should not search.
- Group messages without a bot mention should not search or reply.

Search answers should keep source links clickable, using Markdown link format such as `[OpenAI](https://openai.com/news/)`. If LM Studio returns a bare URL, the bot normalizes it to a short clickable source label before sending the message to LINE.

Knowledge Base manual checks:

- `npm run kb:import` should import Markdown/text files from `kb/`.
- Project/technical questions with matching KB chunks may use `KNOWLEDGE_BASE_CONTEXT`.
- Project/technical questions without KB evidence should fall back to `KNOWLEDGE_BASE_INSUFFICIENT_REPLY`.
- `npm run kb:unanswered` should list unresolved fallback questions.
- KB evidence must stay separate from manual memories and LINE chat history.

## Limits

This MVP does not create a LINE Official Account, retrieve credentials, configure LINE Developers Console, install tunnel tools, deploy hosting, add embeddings, create a vector DB, or guarantee model quality.

## Related Safety Docs

- Root README: `../../README.md`
- Privacy policy: `../../PRIVACY.md`
- Security policy: `../../SECURITY.md`
- Memory policy: `../../docs/memory-policy.md`
- Web-search safety: `../../docs/web-search-safety.md`
- LINE manual setup: `../../docs/line-official-setup-guide.md`
- Local LLM setup: `../../docs/local-llm-setup.md`
