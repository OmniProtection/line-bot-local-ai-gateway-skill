# Support for LINE Bot Local AI Gateway Skill

This project is a developer alpha kit. Support is best effort and focused on local-first template usage, zero-secret validation, and documentation clarity.

## Supported Questions

- Understanding the Skill and template layout.
- Running zero-secret verifier commands.
- Understanding LM Studio local setup.
- Understanding memory and web-search safety boundaries.
- Understanding expected `prod:readiness` `BLOCKED` states.
- Preparing sanitized bug reports or pull requests.

## Out Of Scope

- LINE Official Account creation.
- LINE Developers Console account support.
- Credential retrieval or handling real tokens.
- Deployment, hosting, domains, SSL, or tunnel provisioning.
- Debugging private production environments without sanitized evidence.
- SaaS operation or managed hosting.
- Stable or production readiness guarantees.

## How To Ask For Help

Include:

- Operating system.
- Node.js version.
- Command run.
- Redacted command output.
- Whether the issue happened in zero-secret validation or live LINE setup.
- LM Studio status if model behavior is involved.
- Which documentation page you followed.

Do not include:

- LINE Channel Secret, Channel Access Token, reply token, or search API key.
- Real webhook payloads unless fully redacted.
- SQLite databases, logs, backups, or runtime evidence files.
- Private tunnel URLs.
- LINE Developers Console screenshots with secrets.

Report security issues using [`SECURITY.md`](SECURITY.md).
