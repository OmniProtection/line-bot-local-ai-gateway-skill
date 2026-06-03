# Production Gates Reference

## Local-First Release Gates

Use gates to prevent ad-hoc production changes:

1. Runtime supervision exists or an approved lower-privilege startup fallback exists.
2. Public `/health` returns `ok:true` and unsigned `/webhook` rejects with `invalid_signature`.
3. LINE Console webhook URL is confirmed by user-provided evidence.
4. Real LINE smoke tests pass: private, search, group no-mention, group mention, memory, list memory.
5. SQLite backup and copied restore drill pass without mutating the live DB.
6. Health monitoring exists and writes bounded logs.
7. Allowed production changes, incident severity, alert path, and retention policy are approved.
8. Final readiness and go-live commands return PASS.

## Windows Startup Fallback

If Task Scheduler is blocked by permissions, an approved Startup folder `.cmd` can start the bot after user login. This is lower privilege and does not guarantee startup before login.

## Evidence Rules

Evidence records must be secret-free, timestamped, status-labeled, and tied to explicit acceptance criteria. Do not publish local DBs, logs, backups, real tokens, or user-private production evidence in a public Skill repo.
