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
  -> memory/search/model routing
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

## Sprint 3 Gateway Layer

Sprint 3 adds a maintainable gateway layer between LINE events, memory, WebSearch, and LM Studio:

- `intentRouter.js`: classifies memory commands, forced WebSearch, auto WebSearch, general chat, ignored routes, and unsend events.
- `policyGate.js`: assigns allowed tools and risk level. It does not execute deployment, package installation, broadcast, multicast, narrowcast, or external-state mutations.
- `contextBuilder.js`: centralizes memory/context loading and adds search-status guards when WebSearch was not performed.
- `tokenBudget.js`: applies a char-based context budget without installing a tokenizer.

## Manual External Steps

The Skill does not create LINE Official Accounts, log in to LINE Developers Console, fetch Channel Secret or Access Token, create tunnels, or deploy hosting. Operators must complete those steps manually and keep evidence sanitized.
