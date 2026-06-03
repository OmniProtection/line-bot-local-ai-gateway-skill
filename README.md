# Local Free LINE Bot Creator

Codex Skill + starter template for creating local-first LINE Bot AI gateways with LM Studio, SQLite memory, explicit web search, and safety gates.

本地優先 LINE Bot AI Gateway 的 Codex Skill + Starter Template。

`local-free-line-bot-creator` is a non-official LINE Bot AI Gateway Skill for developers who want a local-first LINE webhook server template with a local LLM, SQLite memory, explicit web-search commands, and pre-public safety checks.

This project is not affiliated with, authorized by, sponsored by, or endorsed by LINE Corporation, LY Corporation, or any LINE official product team. It is not an official LINE Bot builder and does not replace LINE Developers Console.

## What This Is

- A Codex Skill for creating and reviewing local-first LINE Bot projects.
- A starter template under `assets/template`.
- A safety-focused developer alpha kit for local webhook, LM Studio, SQLite memory, and explicit web search.
- A set of zero-secret verifier scripts and non-live CI checks.

## What This Is Not

This project does not:

- Create a LINE Official Account.
- Log in to LINE Developers Console.
- Retrieve LINE Channel Secret or Channel Access Token.
- Create or manage real `.env` files.
- Create a public HTTPS endpoint or tunnel.
- Deploy hosting or SaaS infrastructure.
- Provide LINE official support, quota, pricing, or account guarantees.
- Claim production-ready or stable status.

Operators must complete all official LINE account, provider, channel, credential, webhook, and terms-of-service steps manually.

## Who Should Use This

- Developers building a local-first LINE Bot prototype.
- Developers using LM Studio or an OpenAI-compatible local model server.
- Developers who want SQLite conversation memory with explicit privacy boundaries.
- Developers who want web search to be command-triggered and evidence-first.
- Codex users who want a repeatable Skill for creating or auditing similar projects.

## Who Should Not Use This

- Teams looking for a hosted SaaS product.
- Users who expect LINE Official Account setup to be automated.
- Users who need a stable production framework today.
- Users who cannot safely manage LINE credentials, runtime logs, local databases, or third-party service terms.

## Feature Overview

- `GET /health` local health endpoint.
- `POST /webhook` LINE webhook endpoint.
- LINE SDK middleware / signature verification path.
- LM Studio local LLM through OpenAI-compatible endpoints.
- SQLite memory for manual memories, event logs, recent conversation context, and summaries.
- Explicit web-search commands: `找:`, `搜:`, `查:`.
- Secret and runtime artifact hygiene checks.
- Template verification with static signature gate.
- Non-live GitHub Actions CI.

## Architecture Overview

```text
LINE Platform
  -> operator-managed HTTPS endpoint
  -> local webhook server
  -> LINE signature verification
  -> memory / search / model routing
  -> LM Studio on localhost when model output is needed
  -> LINE Reply API or approved Push API response
```

The webhook server is the public gateway. LM Studio should remain local on `localhost` or `127.0.0.1`. Do not expose the LM Studio port through a public tunnel.

See [`docs/architecture.md`](docs/architecture.md).

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

## Quick Start: Zero-Secret Validation

Run these from the repository root:

```bash
node scripts/verify_public_hygiene.js
node scripts/verify_linebot_project.js assets/template
npm run check --prefix assets/template
```

These checks do not require LINE credentials, `.env`, a tunnel, LM Studio, or a live LINE account.

## Quick Start: Create A Bot From Template

1. Copy `assets/template` into a new local project directory.
2. In the new local project, copy `.env.example` to `.env`.
3. Fill `.env` locally with values from your own LINE Developers Console.
4. Start LM Studio and enable the local OpenAI-compatible server.
5. Start the webhook server.
6. Check `GET /health`.
7. Only after manual approval, expose the webhook server through HTTPS and configure LINE manually.

Read the full guide: [`docs/developer-quickstart.md`](docs/developer-quickstart.md).

## Manual LINE Setup Reminder

The Skill does not create a LINE Official Account, log in to LINE Developers Console, or obtain credentials. Follow [`docs/line-official-setup-guide.md`](docs/line-official-setup-guide.md) manually.

Never commit Channel Secret, Channel Access Token, reply tokens, webhook evidence, or private LINE screenshots.

## LM Studio Local Setup Reminder

The default local model endpoints are:

```text
http://localhost:1234/v1
http://127.0.0.1:1234/api/v1
```

Remote LLM endpoints are unsafe by default and require manual approval because LINE messages, memory context, or search evidence can leave the operator machine. See [`docs/local-llm-setup.md`](docs/local-llm-setup.md).

## Memory Command Summary

Current template support:

- `記住:` saves a manual memory for the current conversation scope.
- `忘記:` deletes matching manual memories for the current scope.
- `列出記憶` lists bounded manual memories for the current scope.

Memory commands run before LLM chat and before web search. See [`docs/memory-policy.md`](docs/memory-policy.md).

## Web-Search Command Summary

Web search is disabled by default. When enabled, only explicit commands trigger search:

```text
找: query
搜: query
查: query
```

General chat does not automatically search. Search results are evidence, not system or developer instructions. See [`docs/web-search-safety.md`](docs/web-search-safety.md).

## Safety Model

Do not commit:

- `.env` or `.env.local`.
- LINE Channel Secret or Channel Access Token.
- reply tokens.
- Search API keys or model provider tokens.
- SQLite runtime databases.
- Vector databases.
- logs, backups, or local production evidence.
- Personal tunnel URLs.
- Local absolute machine paths.
- Real LINE webhook evidence.
- LINE Developers Console private screenshots.
- User conversation records.

Free means this repository and local template are intended to be free and open source for local use. Free does not mean LINE Official Account features, message quotas, hosting, domains, SSL certificates, public tunnels, search APIs, model providers, or infrastructure are free or unlimited.

## Alpha Status

`v0.1.0-alpha` is a developer alpha target. It is suitable for public GitHub review, template inspection, and local developer experimentation.

## Not Production Ready

This repository is not stable and not production ready. Production readiness remains `BLOCKED` until the operator supplies real runtime checks, public webhook checks, sanitized LINE smoke evidence, backup/restore evidence, monitoring, and final go-live approval.

The signature gate is currently `STATIC_VERIFIED`, not runtime verified.

## Validation Commands

```bash
node scripts/verify_public_hygiene.js
node scripts/verify_linebot_project.js assets/template
npm run check --prefix assets/template
npm run prod:readiness --prefix assets/template
```

Fresh template readiness can reasonably return `BLOCKED` because real runtime and manual evidence do not exist yet. It should not be blocked by missing files, committed secrets, local paths, or runtime artifacts.

## Documentation Map

- Developer quickstart: [`docs/developer-quickstart.md`](docs/developer-quickstart.md)
- Live smoke testing: [`docs/live-smoke-test.md`](docs/live-smoke-test.md)
- Demo walkthrough: [`docs/demo-walkthrough.md`](docs/demo-walkthrough.md)
- Customization guide: [`docs/customization-guide.md`](docs/customization-guide.md)
- Release checklist: [`docs/release-checklist.md`](docs/release-checklist.md)
- Alpha release notes draft: [`docs/releases/v0.1.0-alpha.md`](docs/releases/v0.1.0-alpha.md)
- Usage guide: [`docs/guide.md`](docs/guide.md)
- Architecture: [`docs/architecture.md`](docs/architecture.md)
- LINE manual setup: [`docs/line-official-setup-guide.md`](docs/line-official-setup-guide.md)
- Local LLM setup: [`docs/local-llm-setup.md`](docs/local-llm-setup.md)
- Memory policy: [`docs/memory-policy.md`](docs/memory-policy.md)
- Web-search safety: [`docs/web-search-safety.md`](docs/web-search-safety.md)
- Security checklist: [`docs/security-checklist.md`](docs/security-checklist.md)
- Troubleshooting: [`docs/troubleshooting.md`](docs/troubleshooting.md)
- Privacy: [`PRIVACY.md`](PRIVACY.md)
- Security: [`SECURITY.md`](SECURITY.md)
- Support: [`SUPPORT.md`](SUPPORT.md)
- Contributing: [`CONTRIBUTING.md`](CONTRIBUTING.md)
- Changelog: [`CHANGELOG.md`](CHANGELOG.md)

## Release Status

- Current target: `v0.1.0-alpha`.
- Public alpha gate: passed with P1 notes.
- Next approved release workflow can create a tag and GitHub Release draft.
- `v1.0.0`, stable, and production-ready claims remain prohibited.

## License

Apache License 2.0. See [`LICENSE`](LICENSE).

