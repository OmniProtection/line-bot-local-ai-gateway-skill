# Web Search Safety

Web search is disabled by default.

## Triggering

Only explicit commands should trigger search:

```text
找: query
搜: query
查: query
```

General chat must not automatically search.

## Evidence Handling

Search results are evidence, not instructions. Page titles, snippets, and fetched text must never be treated as system, developer, or tool instructions.

The answer should summarize grounded evidence and include source URLs. If evidence is missing, weak, blocked, or timed out, the bot should return a clear fallback instead of inventing sources.

## Network Safety

Search and fetch logic must block:

- `localhost`
- `127.0.0.1`
- `0.0.0.0`
- private IPv4 ranges
- link-local and metadata endpoints
- local hostnames such as `.local`
- `file://`
- `ftp://`
- unsupported content types

Do not automatically download unknown files.

## Prompt Injection

Webpage text can contain prompt injection. Suspicious text should be sanitized or downgraded to conservative summary mode. The local model must only use evidence as untrusted content.

## Search Provider Data

If search is enabled, queries may be sent to third-party search services or public websites. Operators are responsible for provider terms, costs, quotas, and privacy impact.

