# Architecture

This Skill builds and reviews a local-first LINE Bot AI gateway. It is not an official LINE or LY Corporation product.

## Default Flow

```text
LINE Platform
  -> operator webhook server
  -> LINE signature verification
  -> memory/search/model routing
  -> local LM Studio endpoint when needed
  -> LINE Reply API or approved Push API
```

The webhook server is the only component intended to receive public LINE webhook traffic. LM Studio must remain bound to `localhost` or `127.0.0.1` by default.

## Runtime Boundaries

- The LINE webhook endpoint receives events at `POST /webhook`.
- Health is exposed at `GET /health`.
- LINE credentials are read from local environment variables.
- SQLite memory is stored in local runtime data and must not be committed.
- Web search is disabled by default and only runs for explicit commands.

## Manual External Steps

The Skill does not create LINE Official Accounts, log in to LINE Developers Console, fetch Channel Secret or Access Token, create tunnels, or deploy hosting. Operators must complete those steps manually and keep evidence sanitized.

