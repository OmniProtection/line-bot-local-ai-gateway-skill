# Security Policy

## Supported Versions

This repository is in the pre-release stage for `v0.1.0-alpha`. Security fixes are accepted for the current default branch and for any published alpha tags after they exist.

Do not treat this project as production-ready until the release checklist and production readiness gates pass for your own deployment.

## Reporting a Vulnerability

Report security issues privately to the project maintainer. Do not open a public issue or discussion that contains credentials, tokens, webhook payloads, private LINE evidence, database files, logs, or conversation transcripts.

If a public report is necessary, describe the issue class and affected files without including secrets or private user data. Use redacted examples such as `LINE_CHANNEL_SECRET=<redacted>`.

## What Counts as a Security Issue

Please report issues such as:

- LINE webhook signature bypass or missing invalid-signature handling.
- Any path where invalid webhook requests can reach the LLM, memory store, or web-search flow.
- LINE Channel Secret, Channel Access Token, reply token, search API key, or local model token exposure.
- Memory leaks, unsafe memory export, unsafe logs, or accidental commit of SQLite runtime databases.
- Search SSRF, including access to localhost, loopback, private network ranges, metadata endpoints, `file://`, or `ftp://`.
- Prompt injection handling failures where webpage text is treated as system, developer, or tool instruction.
- Remote LLM leaks where LINE message content is sent away from the operator machine without clear manual approval.
- Public tunnel, webhook, or evidence records that disclose private runtime state.

## Secret Exposure Response

If a secret is exposed, assume it is compromised.

- Rotate or revoke LINE Channel Secret and Channel Access Token in LINE Developers Console.
- Invalidate any leaked reply token by treating it as unusable and removing it from logs or evidence.
- Rotate search API keys, local model API tokens, and tunnel credentials if used.
- Remove leaked `.env`, logs, databases, screenshots, and evidence from the public repository history as an incident response task.
- Re-run public hygiene verification before publishing again.

## Data We Do Not Accept in Public Reports

Do not submit:

- Real LINE Channel Secret, Channel Access Token, reply token, or search API key.
- Real LINE webhook evidence or LINE Developers Console private screenshots.
- Real user, group, room, or message IDs unless they are redacted.
- Real conversation logs or SQLite memory databases.
- Personal tunnel URLs or local absolute machine paths.

