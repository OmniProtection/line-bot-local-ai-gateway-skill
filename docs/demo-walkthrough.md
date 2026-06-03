# Demo Walkthrough

This is a three-minute developer demo script for the alpha kit.

## Demo Goal

Show that the repository provides a local-first LINE Bot Skill and template with safety gates, memory boundaries, explicit search, and alpha release docs.

## Demo Environment

- Local clone of this repository.
- No real `.env`.
- No LINE token.
- No tunnel.
- Optional copied template project if you want to show local-only runtime separately.

## Demo Script

1. Open `README.md` and state the non-official alpha positioning.
2. Show `assets/template`.
3. Run zero-secret checks:

   ```bash
   node scripts/verify_public_hygiene.js
   node scripts/verify_linebot_project.js assets/template
   npm run check --prefix assets/template
   ```

4. Show `docs/memory-policy.md`.
5. Show `docs/web-search-safety.md`.
6. Show `docs/releases/v0.1.0-alpha.md`.

## Expected LINE Messages For A Live Demo

Use only a separate local bot project with your own credentials:

- `記住: 我偏好繁體中文`
- `列出記憶`
- `查: OpenAI 官方文件`
- Group message without mention.
- Group message with mention.

## Expected Bot Behaviors

- Memory command is handled before LLM and search.
- Web search only runs for explicit prefixes.
- Group no-mention does not trigger outbound work.
- Search results are treated as evidence, not instructions.

## Show Local-First Property

- LM Studio endpoint is `localhost` or `127.0.0.1`.
- SQLite memory path is local runtime data.
- Public tunnel, if used, points only to webhook server.

## Show Safety Gates

- `verify_public_hygiene.js` catches public hygiene gaps.
- `verify_linebot_project.js` checks template structure and reports static signature gate.
- CI runs non-live checks only.

## What Not To Show

- Tokens.
- Screenshots with secrets.
- Real user conversations.
- SQLite DB.
- live webhook evidence.
- private tunnel URL.
- local absolute paths.

