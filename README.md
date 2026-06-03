# Local Free LINE Bot Creator

Codex skill for creating and reviewing local-first LINE Bot projects that use:

- LINE Messaging API webhooks with signature verification
- LM Studio local LLM through an OpenAI-compatible API
- SQLite conversation memory
- Explicit, grounded web search commands
- Local production readiness gates

The bundled template is under `assets/template`. It is intentionally free of runtime secrets and local artifacts.

## Repository Layout

```text
SKILL.md
agents/openai.yaml
references/
assets/template/
scripts/verify_linebot_project.js
```

## Safety Rules

Do not commit:

- `.env`
- LINE channel secrets or access tokens
- SQLite runtime databases
- logs, backups, or local production evidence
- personal tunnel URLs or machine-specific paths

## Validate

```bash
node scripts/verify_linebot_project.js assets/template
npm run check --prefix assets/template
```

Optional template readiness check:

```bash
npm run prod:readiness --prefix assets/template
```

In a fresh checkout without real runtime, LINE credentials, and approvals, readiness can return `BLOCKED`. It should not fail because of missing template docs or personal local paths.

## License

Apache License 2.0. See `LICENSE`.
