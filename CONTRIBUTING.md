# Contributing

Thanks for helping improve this Skill.

## Safety Rules

Do not submit:

- Real `.env` files.
- LINE Channel Secret, Channel Access Token, reply token, or search API key.
- SQLite memory databases, logs, backups, or runtime evidence.
- Personal tunnel URLs or local absolute machine paths.
- Real LINE Developers Console screenshots.
- Real user conversation records.

Security issues should follow `SECURITY.md` and must not be reported with public secrets or private payloads.

## Development Scope

Keep changes local-first and template-safe. Do not add deployment automation, LINE account automation, or package installation requirements without explicit maintainer approval.

Before opening a pull request, run:

```bash
node scripts/verify_public_hygiene.js
node scripts/verify_linebot_project.js assets/template
npm run check --prefix assets/template
```

Fresh template production readiness may remain `BLOCKED` until runtime and manual LINE evidence exist.

