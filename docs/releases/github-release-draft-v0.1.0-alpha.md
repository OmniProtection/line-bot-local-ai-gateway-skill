# LINE Bot Local AI Gateway Skill v0.1.0-alpha

## Status

Developer alpha. Not stable. Not production ready.

Repository: `OmniProtection/line-bot-local-ai-gateway-skill`

## What this is

A Codex Skill + starter template for creating local-first LINE Bot AI gateways with LM Studio, SQLite memory, explicit web search, and safety gates.

## What this is not

- Not an official LINE or LY Corporation product.
- Not affiliated with, authorized by, sponsored by, or endorsed by LINE / LY Corporation.
- Not a LINE Official Account registration tool.
- Not a LINE Developers Console automation tool.
- Not a hosted SaaS.
- Not production-ready.

## Included

- Codex Skill for creating / reviewing local-first LINE Bot AI gateway projects.
- Starter template under `assets/template`.
- LINE webhook server template.
- LINE signature verification path.
- LM Studio / OpenAI-compatible local LLM integration.
- SQLite memory support.
- Explicit web-search commands: `找:` / `搜:` / `查:`
- Public hygiene verifier.
- Template verifier.
- Static signature verification gate: `STATIC_VERIFIED`
- Developer quickstart.
- Live smoke test guide.
- Demo walkthrough.
- Customization guide.
- Security / privacy / memory / web-search safety docs.
- Non-live GitHub Actions CI.

## Not included

- LINE Official Account registration.
- LINE Developers Console login or automation.
- Channel Secret or Channel Access Token generation.
- Deployment, hosting, domain, SSL, or tunnel provisioning.
- Real `.env`.
- Real LINE Channel Secret.
- Real Channel Access Token.
- Real replyToken.
- Search API key.
- Real webhook evidence.
- Real user conversation data.
- Runtime SQLite DB.
- Logs or backup artifacts.

## Validation

The release candidate must have passed:

```bash
node scripts/verify_public_hygiene.js
node scripts/verify_linebot_project.js assets/template
npm run check --prefix assets/template
npm run prod:readiness --prefix assets/template
```

Expected result:

- `verify_public_hygiene`: PASS
- `verify_linebot_project`: PASS, `signature_gate: STATIC_VERIFIED`
- `npm run check`: PASS
- `prod:readiness`: expected BLOCKED only because real runtime, public webhook, LINE smoke, backup/restore, monitoring, and final go-live approval evidence are intentionally absent.

## Known limitations

- Signature gate is `STATIC_VERIFIED`, not runtime verified.
- No live LINE smoke evidence is included.
- No real runtime evidence is included.
- No backup / restore drill evidence is included.
- Not suitable for production use without operator validation.
- Not a GUI product.
- Not a SaaS.
- Developer alpha only.

## Security notes

Do not commit:

- `.env`
- LINE Channel Secret
- Channel Access Token
- replyToken
- search API key
- SQLite runtime database
- logs
- backups
- live webhook evidence
- private tunnel URLs
- local absolute paths
- LINE Developers Console screenshots with secrets

Security issues should follow `SECURITY.md`.

## Privacy notes

This project is local-first by default. If memory is enabled, local runtime data may be stored in SQLite. If web search is enabled, queries may be sent to third-party search services. If a remote LLM endpoint is configured, LINE messages and memory context may leave the operator machine.

See `PRIVACY.md` and `docs/memory-policy.md`.

## Recommended next steps

- Run live LINE smoke tests only in a private operator environment.
- Add runtime invalid-signature tests when dependency/runtime approval is available.
- Add sanitized evidence only when explicitly approved.
- Keep `v1.0.0` / stable prohibited until production readiness gates pass.
