# Memory Reference

## Goals

Memory should help the bot answer with relevant local context without leaking secrets or storing unnecessary raw payloads.

## Recommended SQLite Areas

- `long_term_memories`: manual user memories from commands such as `記住:` and `忘記:`.
- `short_term_messages`: recent user/assistant exchanges for local context.
- `line_event_log`: normalized LINE events with redacted raw metadata and dedupe keys.
- `conversation_summaries`: rolling summaries for long conversations.
- `organized_group_memories`: group/room summaries created from batches of relevant messages.
- `memory_organization_state`: processing cursor/state for background memory organization.

## Routing Rules

- `記住:` saves a sanitized manual memory.
- `忘記:` deletes matching manual memories only.
- `列出記憶` replies with bounded memory text.
- Memory commands must not trigger web search or model calls.
- Group/room messages without bot mention may be logged, but must not reply, search, call the model, or summarize in the background.
- Unsend events should mark affected raw messages and dependent summaries dirty or invalid.

## Retrieval Rules

Load a compact memory context before model calls. Prefer manual memories, rolling summaries, recent interactions, recent raw text, and organized group summaries that pass relevance scoring. Keep character budgets explicit and log retrieval stats for auditability.
