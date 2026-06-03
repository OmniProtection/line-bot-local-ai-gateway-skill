# Contributing

This repository is in developer alpha. Contributions are welcome when they preserve the local-first, zero-secret, non-official LINE tooling boundary.

## Alpha Contribution Policy

- Keep changes small and reviewable.
- Prefer docs, verifier, tests, and template-safe improvements.
- Open an issue before large feature work or behavior changes.
- Do not claim stable, production-ready, official LINE, or SaaS status.
- Do not add deployment automation without prior approval.
- Do not add package dependencies without prior approval.

## Before Opening A Pull Request

Run:

```bash
node scripts/verify_public_hygiene.js
node scripts/verify_linebot_project.js assets/template
npm run check --prefix assets/template
```

`npm run prod:readiness --prefix assets/template` may remain `BLOCKED` for a fresh template because real runtime and manual evidence are intentionally absent.

## Do Not Include

- Real `.env` files.
- LINE Channel Secret, Channel Access Token, reply token, or search API key.
- SQLite memory databases, vector databases, logs, backups, or runtime evidence.
- Personal tunnel URLs or local absolute machine paths.
- LINE Developers Console screenshots with secrets.
- Real user conversation records.
- Live LINE webhook payloads unless fully redacted and explicitly requested.

## Coding And Docs Expectations

- Keep runtime behavior unchanged unless the issue or PR explicitly targets a behavior fix.
- Add or update non-live tests/verifier checks for safety-sensitive changes.
- Update docs when behavior, configuration, safety boundaries, or developer workflows change.
- Keep README and release notes free of stable or production-ready claims.

## Extra Review Required

Security review is required for changes touching:

- Webhook signature verification.
- Secret handling.
- Public hygiene scans.
- Web-search fetch behavior or SSRF controls.
- Prompt injection handling.
- Remote LLM configuration.

Privacy review is required for changes touching:

- SQLite memory storage.
- LINE identifiers.
- Logs and evidence records.
- Memory export, deletion, backup, or restore behavior.
- Search query routing to third-party providers.

Security issues should follow [`SECURITY.md`](SECURITY.md), not public issues with sensitive payloads.

