---
name: LINE Bot Local AI Gateway Skill
repository_slug: line-bot-local-ai-gateway-skill
compatibility_alias: local-free-line-bot-creator
description: Create, modify, verify, or productionize local-first LINE Bot AI gateway projects that use LINE Messaging API webhooks, Reply API pending responses, optional Push API final responses, LM Studio local LLMs, SQLite memory, explicit web search, and safety gates. Use when Codex is asked to build a local-first LINE Bot AI gateway, connect it to a local LLM, add conversation memory, add grounded web-search commands, or audit the project for secrets, routing, and release readiness.
---

# LINE Bot Local AI Gateway Skill

`line-bot-local-ai-gateway-skill` is the current repository slug. `local-free-line-bot-creator` is retained only as the previous repository slug and compatibility alias.

Use this non-official Skill to build and review local-first LINE Bot AI gateway projects that keep paid services optional and private model traffic on the operator machine.

## Core Rules

- Never create or commit a real `.env` file.
- Never hard-code `LINE_CHANNEL_SECRET`, `LINE_CHANNEL_ACCESS_TOKEN`, private API keys, or tunnel-specific URLs.
- Keep LM Studio private at `localhost`; expose only the webhook server when tunnel testing is requested.
- Prefer LINE Reply API for immediate/pending responses. Use Push API only when the user explicitly asks for background final replies or the existing project already uses that pattern.
- Do not create LINE Official Accounts, retrieve credentials, log into LINE Console, deploy, install packages, or mutate external systems without explicit approval.
- Do not copy runtime DBs, logs, backups, or production evidence into generated repos.
- Do not describe this project as an official LINE tool, SaaS, stable framework, production-ready system, or tooling that automates LINE Official Account creation.

## Workflow

1. **Create LINE Bot**: scaffold Node.js + Express + `@line/bot-sdk`, `GET /health`, `POST /webhook`, raw-body-safe signature verification, private/group/room routing, and safe fallback replies.
2. **Connect Local LLM**: add LM Studio OpenAI-compatible chat completions with timeout, bounded prompts, reply clamping, direct-reply gate for short messages, and pending Reply + optional background Push for longer work.
3. **Add Memory**: use SQLite for manual memories, recent conversation context, LINE event logs, rolling summaries, group summaries, and unsend-aware invalidation. Memory commands must take precedence over model and search flows.
4. **Add Web Search**: use explicit commands such as `找:`, `搜:`, and `查:` only. Build deterministic web evidence first, sanitize URLs/text, reject unsafe sources, and ask the local model to summarize only grounded evidence.
5. **Verify**: run syntax checks, route tests, memory tests, web-search tests, secret checks, and release gates appropriate to the project stage.

## References

Read only what the task needs:

- `references/architecture.md` for webhook, routing, Reply/Push, and LM Studio flow.
- `references/memory.md` for SQLite memory schema and retrieval behavior.
- `references/web-search.md` for grounded web-search and source security policy.
- `references/production-gates.md` for local release readiness, backup, health checks, and go-live gates.

## Template

Use `assets/template` as the starter project when the user asks for a new bot. The template is intentionally clean: it includes `.env.example`, source, scripts, and docs, but excludes `.env`, runtime databases, logs, backups, and local evidence artifacts.

## Validation

For generated or modified projects, prefer:

```bash
npm run check
npm run test:line-routing
npm run test:web-search
node scripts/test-memory-relevance-gate.js
node scripts/test-memory-webhook-flow-static.js
node scripts/test-memory-safety-static.js
node scripts/test-line-event-log.js
```

For the bundled template itself, run:

```bash
node scripts/verify_linebot_project.js assets/template
```

Report PASS only when the project has no real secrets, exposes the expected endpoints, verifies LINE signatures, keeps LM Studio local, and preserves the requested memory/search behavior.
