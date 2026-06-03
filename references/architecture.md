# Architecture Reference

## Default Flow

```text
LINE user
  -> LINE Platform webhook
  -> local Express webhook server
  -> LINE signature verification
  -> memory/search/model routing
  -> LM Studio local API when needed
  -> LINE Reply API or approved Push API
```

The webhook server is the only public gateway. LM Studio must remain private on `localhost` or `127.0.0.1`.

## Required Surfaces

- `GET /health` returns `ok`, model provider, and model name.
- `POST /webhook` is protected by LINE SDK middleware or equivalent raw-body-safe signature verification.
- Private messages can be handled directly.
- Group and room messages must be ignored unless the bot is mentioned.
- Memory commands must run before search/model routing.
- Search commands must run before general model routing.

## Reply Strategy

Use Reply API for quick command responses and pending responses. For slow local model or web-search work, send an immediate pending Reply, then use Push API for the final answer only when this behavior is approved and configured.

## Local LLM

Use LM Studio through its OpenAI-compatible `/v1/chat/completions` endpoint. Configure model name, timeout, temperature, top-p, max tokens, and context length through environment variables. Always return a safe fallback on timeout, empty output, malformed JSON, non-2xx responses, or connection failure.
