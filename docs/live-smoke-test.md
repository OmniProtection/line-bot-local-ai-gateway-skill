# Live Smoke Test Guide

This guide describes a real LINE smoke test flow. It does not include real evidence and must not be committed with private data.

## Prerequisites

- A copied local bot project.
- Local `.env` with your own LINE Channel Secret and Channel Access Token.
- LM Studio running locally if model replies are tested.
- A manually created HTTPS endpoint that points only to the webhook server.
- LINE Official Account and Messaging API configured manually.

## Manual LINE Setup

Follow [`line-official-setup-guide.md`](line-official-setup-guide.md):

1. Create or select LINE Official Account.
2. Enable Messaging API.
3. Get Channel Secret and Channel Access Token.
4. Store credentials only in local `.env`.
5. Set webhook URL to the HTTPS endpoint ending in `/webhook`.
6. Enable webhook.

## LINE Console Verify

Expected PASS:

- LINE Console can reach the webhook URL.
- Invalid or unsigned webhook requests are rejected.

Expected BLOCKED:

- Local server not running.
- HTTPS endpoint not reachable.
- Wrong webhook URL.
- Missing local credentials.

## Smoke Test Matrix

| Test | Input | Expected |
|---|---|---|
| Private message | A simple private text message | Bot replies or sends pending reply then final answer. |
| Group no-mention | Message in group without bot mention | No reply, no search, no model call, no background memory organization. |
| Group mention | Mention bot with a question | Bot handles the message after mention text is removed. |
| Memory command | `記住: 測試偏好` | Bot confirms memory saved. |
| List memory | `列出記憶` | Bot lists bounded manual memory for current scope. |
| Explicit web-search | `查: example query` | If search is enabled, bot uses evidence-first search flow; otherwise clear disabled fallback. |

## Redacted Evidence Checklist

Record only sanitized evidence:

- Timestamp.
- Test name.
- PASS/BLOCKED status.
- Redacted command output.
- Redacted LINE message description.
- No raw payload.
- No real IDs unless masked.

## Do Not Commit

- Channel Secret.
- Channel Access Token.
- reply token.
- Search API key.
- Real webhook payloads.
- SQLite DB.
- logs.
- backup files.
- LINE Developers Console screenshots with secrets.
- Private tunnel URL.

