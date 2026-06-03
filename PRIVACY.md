# Privacy Policy

This project is a local-first LINE Bot AI Gateway Skill and template. It is not an official LINE or LY Corporation product.

## Local-First Data Flow

LINE messages are delivered by LINE Platform to the webhook server that the operator runs. The template is designed so the webhook server, SQLite memory database, and LM Studio local model run on the operator-controlled machine by default.

The template does not create a LINE Official Account, retrieve credentials, log in to LINE Developers Console, create a tunnel, or deploy hosting.

## Data That May Be Processed

Depending on configuration and usage, the local bot may process or store:

- LINE user IDs, group IDs, and room IDs.
- Text message content.
- Message hashes and normalized event metadata.
- Webhook event IDs and delivery/redelivery metadata.
- Manual memories saved by commands.
- Short-term conversation turns.
- Rolling summaries or group summaries.
- Local runtime logs that contain event classes and counts.

Do not commit runtime databases, logs, backups, evidence records, or `.env` files to GitHub.

## SQLite Memory

If memory is enabled by running the template as provided, runtime data is stored in the local SQLite database at:

```text
assets/template/data/linebot-memory.sqlite
```

This path is a runtime artifact and must remain untracked. The template `.gitignore` blocks SQLite files, data directories, logs, backups, and local evidence.

## Memory Controls

Current template support:

- `記住:` saves a manual memory for the current LINE conversation scope.
- `忘記:` deletes matching manual memories for the current scope.
- `列出記憶` lists bounded manual memories for the current scope.

Planned or manual-only controls:

- Query memory as a dedicated command: planned.
- Export memory: manual-only by inspecting or copying the local SQLite database.
- Delete all memory for a scope: planned.
- Delete all local memory: manual-only by stopping the bot and deleting the local SQLite database or approved backup copies.

Do not claim these planned controls are automated until the template implements them.

## Group Memory

Group and room messages can be logged locally for routing and deduplication. The template is designed to avoid replying, searching, calling the model, or organizing group memory when the bot is not mentioned.

Group memory summaries are local runtime data and must not be committed.

## Web Search

Web search is disabled by default. If enabled, only explicit commands such as `找:`, `搜:`, or `查:` trigger search.

Search queries and fetched public web evidence may be sent to third-party search services or public websites. The operator is responsible for the privacy terms and costs of any search provider they enable.

## Local and Remote LLMs

The default model endpoint is local:

```text
http://localhost:1234/v1
http://127.0.0.1:1234/api/v1
```

If the operator changes the configuration to a remote LLM endpoint, LINE message content and memory context may leave the local machine. Remote LLM endpoints are unsafe by default and require explicit manual approval, documentation, and user awareness.

## Operator Responsibility

The operator is responsible for LINE Official Account setup, LINE credentials, third-party service terms, search providers, hosting, domains, SSL, tunnels, backups, and data retention.

