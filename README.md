# Local Free LINE Bot Creator

`local-free-line-bot-creator` is a non-official LINE Bot AI Gateway Skill for creating and reviewing local-first LINE Bot project templates.

This project is not affiliated with, authorized by, sponsored by, or endorsed by LINE Corporation, LY Corporation, or any LINE official product team. It is not an official LINE Bot builder and does not replace LINE Developers Console.

## What This Skill Does

This Skill helps Codex create or review local-first projects that use:

- LINE Messaging API webhooks with signature verification.
- A local webhook server.
- LM Studio or another local LLM through an OpenAI-compatible local endpoint.
- SQLite memory for local conversation context.
- Explicit web-search commands with evidence-first safety rules.
- Static checks and local production readiness gates.

The bundled template is under `assets/template`. It is intentionally free of runtime secrets and local artifacts.

## What This Skill Does Not Do

This Skill does not:

- Create a LINE Official Account.
- Log in to LINE Developers Console.
- Retrieve LINE Channel Secret or Channel Access Token.
- Create or manage real `.env` files.
- Create a public HTTPS endpoint or tunnel.
- Deploy hosting.
- Provide LINE official support, quota, pricing, or account guarantees.

Operators must complete all official LINE account, provider, channel, credential, webhook, and terms-of-service steps manually.

## Free Scope

Free means this repository and local template are intended to be free and open source for local use.

Free does not mean that all related services are free or unlimited. LINE Official Account features, message quotas, hosting, domains, SSL certificates, public tunnels, search APIs, model providers, and infrastructure may have their own costs, limits, and terms.

Do not describe this project as an official LINE tool or as a completely free unlimited LINE service.

## Local-First Safety Defaults

- LINE credentials are read from local environment variables.
- The template includes `.env.example`, not a real `.env`.
- LM Studio defaults to `localhost` or `127.0.0.1`.
- LM Studio ports should not be exposed through public tunnels.
- Public tunnels, when used, should point only to the webhook server.
- Web search is disabled by default.
- Web search requires explicit prefixes such as `找:`, `搜:`, or `查:`.
- Memory data is local SQLite runtime data and must not be committed.

Remote LLM endpoints are unsafe by default. Using a remote LLM can send LINE message content, memory context, or search evidence away from the operator machine. Treat remote LLM use as manual approval required.

## Documentation

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
- Changelog: [`CHANGELOG.md`](CHANGELOG.md)

## Repository Layout

```text
SKILL.md
agents/openai.yaml
references/
docs/
assets/template/
scripts/verify_linebot_project.js
scripts/verify_public_hygiene.js
```

## Safety Rules

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

## Validate

```bash
node scripts/verify_public_hygiene.js
node scripts/verify_linebot_project.js assets/template
npm run check --prefix assets/template
```

Optional template readiness check:

```bash
npm run prod:readiness --prefix assets/template
```

In a fresh checkout without real runtime, LINE credentials, public webhook, LINE smoke evidence, backups, monitoring, and final approval, readiness can return `BLOCKED`. That is acceptable when the blocker is missing runtime evidence. It is not acceptable when caused by missing template files, committed secrets, personal paths, or runtime artifacts.

## License

Apache License 2.0. See `LICENSE`.
