# Developer Quickstart

This guide helps developers validate the repository, inspect the template, and create a local LINE Bot project without committing secrets.

## Prerequisites

- Git.
- Node.js 20 or newer.
- A shell that can run `node` and `npm`.
- LM Studio for local model testing.
- LINE credentials only when you intentionally move to live LINE testing.

Do not run `npm install` in this repository unless you explicitly intend to work on a copied local bot project and understand the local artifact rules.

## Clone Repository

```bash
git clone <repo-url>
cd local-free-line-bot-creator
```

## Run Zero-Secret Verifier

```bash
node scripts/verify_public_hygiene.js
node scripts/verify_linebot_project.js assets/template
npm run check --prefix assets/template
```

Expected output:

- Public hygiene status is `PASS`.
- Template verifier status is `PASS`.
- Template verifier reports `signature_gate: STATIC_VERIFIED`.
- Syntax checks complete without requiring `.env`.

## Inspect Template

Review:

- `assets/template/src/server.js`
- `assets/template/src/config.js`
- `assets/template/src/lmStudioClient.js`
- `assets/template/src/memoryStore.js`
- `assets/template/src/webSearchCommand.js`
- `assets/template/.env.example`
- `assets/template/.gitignore`

## Create A Local Bot Project

Copy `assets/template` into a separate local project folder.

Inside the copied project:

```bash
cp .env.example .env
```

Fill `.env` locally with your own LINE credentials only when you are ready for live testing. Never commit `.env`.

## Start LM Studio Local Server

1. Open LM Studio.
2. Load your local model.
3. Enable the OpenAI-compatible local server.
4. Keep it on `localhost` or `127.0.0.1`.

Do not expose the LM Studio port through a public tunnel.

## Start Webhook Server

In the copied local project, install and run only when you are ready to create runtime artifacts in that local project:

```bash
npm install
npm start
```

This repository does not include installed dependencies or runtime artifacts.

## Check `/health`

Open or request:

```text
http://localhost:3000/health
```

Expected result is a JSON health response from the local webhook server.

## What Can Be Tested Without LINE

- Repository hygiene.
- Template file presence.
- Node syntax checks.
- Static signature gate.
- Web-search URL/prompt-injection policy tests after dependencies are available in a copied project.

## What Requires Real LINE Credentials

- LINE Console verify.
- Private message smoke test.
- Group no-mention and group mention tests.
- Real reply or push behavior.
- Live webhook evidence.

## Never Commit

- `.env`.
- LINE Channel Secret or Channel Access Token.
- reply tokens.
- Search API keys.
- SQLite DBs.
- logs, backups, runtime evidence.
- public tunnel URLs.
- local absolute paths.

## Common `BLOCKED` Reasons

- Missing real LINE credentials.
- No local runtime server.
- LM Studio model not loaded.
- Public webhook URL not configured.
- No sanitized LINE smoke evidence.
- No backup/restore drill.
- No final go-live approval.

These are expected for a fresh template.

## Next Docs

- [`docs/line-official-setup-guide.md`](line-official-setup-guide.md)
- [`docs/local-llm-setup.md`](local-llm-setup.md)
- [`docs/memory-policy.md`](memory-policy.md)
- [`docs/web-search-safety.md`](web-search-safety.md)
- [`docs/live-smoke-test.md`](live-smoke-test.md)

