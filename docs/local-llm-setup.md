# Local LLM Setup

The template is designed for LM Studio through an OpenAI-compatible local server.

## LM Studio Local Server

1. Start LM Studio.
2. Load the model configured in `.env`.
3. Enable the OpenAI-compatible local server.
4. Keep the endpoint local:

```text
http://localhost:1234/v1
http://127.0.0.1:1234/api/v1
```

## Network Boundary

Do not expose the LM Studio port through a public tunnel. A public tunnel, when used for LINE testing, should point only to the webhook server.

The webhook server is the public gateway. LM Studio is private infrastructure.

## Remote Endpoint Warning

Remote LLM endpoints are unsafe by default for this template because LINE messages, memory context, and search evidence may leave the operator machine.

Use a remote LLM endpoint only after explicit manual approval and clear documentation of:

- What data leaves the machine.
- Which provider receives the data.
- Retention and logging terms.
- Cost and quota impact.
- How users are informed.

## Timeout and Fallback

Configure model timeouts so the bot can return a safe fallback when LM Studio is stopped, the model name is wrong, the endpoint is unreachable, JSON is malformed, or the model returns an empty response.

