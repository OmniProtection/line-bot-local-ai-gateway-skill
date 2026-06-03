# Changelog

All notable changes to this project will be documented here.

## Unreleased

- Added public security, privacy, memory, local LLM, web-search, LINE setup, troubleshooting, and security checklist documentation.
- Added template hygiene rules for runtime artifacts and local secrets.
- Strengthened preflight verifier checks for public release readiness.

## v0.1.0-alpha Draft

This is an alpha pre-release draft for `LINE Bot Local AI Gateway Skill v0.1.0-alpha`.

`line-bot-local-ai-gateway-skill` is the current repository slug.

`local-free-line-bot-creator` was the previous repository slug and remains only a legacy identifier / compatibility alias.

Included:

- Local-first LINE Bot AI gateway template for a webhook server, LM Studio-compatible local LLM, SQLite memory, and explicit web-search commands.
- Public hygiene and template verification scripts.
- Safety documentation for secrets, privacy, memory, web search, and local model boundaries.

Not included:

- LINE Official Account registration.
- LINE Developers Console login or automation.
- Deployment, hosting, domains, SSL, or tunnel provisioning.
- Real LINE Channel Secret, Channel Access Token, reply token, search API key, webhook evidence, or user conversation data.

Fresh template production readiness may reasonably return `BLOCKED` until local runtime, public webhook, LINE smoke tests, backup/restore drill, monitoring, and final approval evidence are completed by the operator.
