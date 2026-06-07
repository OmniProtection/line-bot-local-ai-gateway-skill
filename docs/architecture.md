# Architecture

This Skill builds and reviews a local-first LINE Bot AI gateway. It is not an official LINE or LY Corporation product.

## Default Flow

```text
LINE Platform
  -> operator webhook server
  -> LINE signature verification
  -> Intent Router
  -> Policy Gate
  -> Context Builder / Token Budget
  -> memory / local KB / search / model routing
  -> local LM Studio endpoint when needed
  -> LINE Reply API or approved Push API
```

The webhook server is the only component intended to receive public LINE webhook traffic. LM Studio must remain bound to `localhost` or `127.0.0.1` by default.

## Runtime Boundaries

- The LINE webhook endpoint receives events at `POST /webhook`.
- Health is exposed at `GET /health`.
- LINE credentials are read from local environment variables.
- SQLite memory is stored in local runtime data and must not be committed.
- Web search is disabled by default. Explicit `找:` / `搜:` / `查:` commands are supported when enabled.
- Auto WebSearch routing is config-gated and must pass SearchPlan / confidence / safety rules.
- WebSearch answers use LINE Reply API only in the runtime path; Push must not be used to supplement search answers.
- Gateway metadata records routing and policy decisions without storing raw user text.
- Local Knowledge Base uses Markdown/text files imported into SQLite FTS5. It does not use embeddings or a vector DB.
- KB evidence is separate from LINE chat memory and should be treated as project-local technical knowledge.
- Handoff tickets are local SQLite operational records for policy, validator, search, model, or admin-created follow-up cases.
- Admin API is disabled by default, localhost-only by default, token-gated when enabled, and has no LINE send endpoint.
- Tool confirmation records are local SQLite pending approvals for explicit tool requests.

## Sprint 3 Gateway Layer

Sprint 3 adds a maintainable gateway layer between LINE events, memory, WebSearch, and LM Studio:

- `intentRouter.js`: classifies memory commands, forced WebSearch, auto WebSearch, general chat, ignored routes, and unsend events.
- `policyGate.js`: assigns allowed tools and risk level. It does not execute deployment, package installation, broadcast, multicast, narrowcast, or external-state mutations.
- `contextBuilder.js`: centralizes memory/context loading and adds search-status guards when WebSearch was not performed.
- `tokenBudget.js`: applies a char-based context budget without installing a tokenizer.

## Sprint 4 Knowledge Base / RAG MVP

Sprint 4 adds a local KB/RAG layer for project and technical answers:

- `knowledgeBaseStore.js`: stores KB documents/chunks and `unanswered_questions` in local SQLite.
- `import-knowledge-base.js`: imports Markdown/text files from `kb/`.
- `outputValidator.js`: blocks unsupported KB claims and returns a conservative fallback when required evidence is missing.
- `list-unanswered-questions.js`: lists unresolved questions for future KB improvements.

The KB layer is local-first. It does not deploy, call external services, use embeddings, or introduce a vector database.

## Sprint 5 Handoff / Ticket / Admin API

Sprint 5 adds a local human handoff foundation without changing outbound LINE delivery rules:

- `handoffStore.js`: stores local handoff tickets, ticket events, ticket drafts, and admin audit logs in SQLite.
- `adminApi.js`: exposes disabled-by-default localhost-only admin routes behind `x-admin-api-token`.
- Policy high-risk requests create `policy_high_risk` tickets and receive the configured conservative handoff reply.
- KB-insufficient validator fallbacks create `kb_insufficient` tickets while preserving unanswered-question logging.
- WebSearch final failures preserve the Reply API `搜尋失敗` response and create `web_search_failure` tickets.
- Model hard fallbacks create `model_failure` tickets.
- Admin summary and draft generation are on-demand admin operations only; they do not run inside the webhook path.

The Admin API intentionally has no route that sends, pushes, broadcasts, multicasts, or narrowcasts LINE messages.

## Sprint 6 Tool Confirmation Gate

Sprint 6 adds a conservative local tool gate before any user-triggered local-write tool executes:

- `toolRegistry.js`: defines known tools, actor scope, access level, risk level, executor, and confirmation requirement.
- `permissionGate.js`: rejects actor-scope mismatches, admin-tool access from LINE actors, external mutations, and secret-operation payloads.
- `confirmationStore.js`: stores pending confirmations in local SQLite with sanitized payloads and TTL.
- `agentLite.js`: parses only explicit tool requests, such as `建立工單:` / `開工單:`.
- `server.js`: returns a confirmation code first; only `確認 CODE` executes the confirmed local handoff-ticket creation.
- `adminApi.js`: applies permission checks to read-only ticket list/get routes.

This layer does not add provider adapters, deployment, external tool execution, LINE Push/Broadcast/Multicast/Narrowcast tools, or a multi-step autonomous agent loop.

## Manual External Steps

The Skill does not create LINE Official Accounts, log in to LINE Developers Console, fetch Channel Secret or Access Token, create tunnels, or deploy hosting. Operators must complete those steps manually and keep evidence sanitized.
