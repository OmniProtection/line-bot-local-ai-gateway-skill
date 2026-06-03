# Customization Guide

This guide explains where developers can customize the template and which changes require extra review.

## Bot Persona And Response Style

Review `assets/template/src/lmStudioClient.js` for chat message construction and response formatting. Keep prompts bounded and avoid exposing hidden reasoning or system instructions.

Changing persona or response style should include syntax checks and a manual review for privacy and safety language.

## Memory Behavior

Review:

- `assets/template/src/memoryStore.js`
- `assets/template/src/server.js`
- `docs/memory-policy.md`

Adding a memory command must preserve command priority before LLM chat and web search. New commands should define scope, retention, deletion behavior, and tests.

High-risk memory changes include:

- New storage locations.
- Memory export.
- Delete-all behavior.
- Storing additional LINE identifiers.
- Logging raw message text.

These require privacy review.

## Search Provider

Review:

- `assets/template/src/webSearchCommand.js`
- `assets/template/src/webSearchService.js`
- `assets/template/src/webSearchSecurity.js`
- `assets/template/src/webSearchPolicy.js`

Search must remain explicit and evidence-first. Adding a search command or provider must preserve SSRF blocking, prompt injection handling, timeouts, content limits, and honest fallback.

Changing web-search fetch behavior is high risk and requires security review.

## Local LLM Endpoint

Review `assets/template/src/config.js` and `.env.example`.

Keep localhost-only defaults:

```text
http://localhost:1234/v1
http://127.0.0.1:1234/api/v1
```

Changing to a remote LLM endpoint is high risk because LINE messages and memory context can leave the operator machine. Treat remote endpoints as unsafe by default and manual approval required.

## Webhook Signature Path

Review:

- `assets/template/src/server.js`
- `assets/template/src/lineClient.js`
- `scripts/verify_linebot_project.js`

Do not bypass LINE middleware or equivalent signature verification. Any signature-path change requires security review and new tests.

## Adding New Commands

For a new command:

- Define exact trigger syntax.
- Decide whether it runs before memory, search, or model routing.
- Add non-live tests or static verifier coverage.
- Document privacy and security impact.
- Update README or relevant docs.

## Avoid Breaking Security Gates

Before opening a PR:

```bash
node scripts/verify_public_hygiene.js
node scripts/verify_linebot_project.js assets/template
npm run check --prefix assets/template
```

Do not add CI jobs that require `.env`, live LINE credentials, public tunnels, deployment, tags, releases, or runtime evidence.

## Changes That Require New Tests

- Webhook signature verification.
- Memory command routing.
- Search command parsing.
- Search fetch or URL security.
- LLM timeout/fallback behavior.
- Logging and redaction.

## Changes That Require Privacy Or Security Review

- Remote LLM endpoint behavior.
- Memory storage or export.
- Web-search fetch behavior.
- Webhook signature path.
- Runtime evidence handling.
- Any new log containing user, group, room, message, or credential data.

