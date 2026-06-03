# Memory Policy

This document describes the memory behavior expected from the bundled template. It does not grant permission to publish runtime memory data.

## Default Strategy

The template includes SQLite memory support. When the bot runtime starts, it can create a local SQLite database under:

```text
assets/template/data/linebot-memory.sqlite
```

This file is local runtime data. It must not be committed to GitHub.

## Group Memory Strategy

Group and room events may be logged locally for routing, deduplication, unsend handling, and later memory organization. Group and room messages without a bot mention should not reply, search, call the model, or start background memory organization.

Organized group summaries are local runtime data. They must not be committed.

## Memory Types

- Manual memory: user-controlled memory saved with `記住:`.
- Conversation memory: recent user and assistant turns saved after successful model replies.
- Event log: normalized LINE events used for deduplication, routing, unsend handling, and retrieval.
- Rolling summary: compact older conversation context generated locally.
- Group summary: organized group or room context generated from eligible local events.

## Command Priority

Memory commands must run before LLM chat and before web search. A message such as `記住: 查: test` is a memory command, not a search command.

## Command Support Status

| Command or capability | Status | Notes |
|---|---|---|
| `記住:` | Implemented | Saves sanitized manual memory for the current scope. |
| `忘記:` | Implemented | Deletes matching manual memories for the current scope. |
| `列出記憶` | Implemented | Lists bounded manual memories for the current scope. |
| Query memory command | Not implemented | Planned as a dedicated command. |
| Export memory command | Not implemented | Manual-only by inspecting or copying the local SQLite database. |
| Delete all memory for current scope | Not implemented | Planned. |
| Delete all local memory | Manual-only | Stop the bot and delete the local SQLite database and approved backups. |

Do not document planned commands as available until they are implemented and tested.

## Identifier Storage

The template may store LINE user IDs, group IDs, room IDs, message IDs, text hashes, and normalized event metadata in SQLite. Text content may be stored for memory and event-log behavior. Public logs and reports should not expose raw IDs or message content.

## Unsend and Delete Events

Unsend events should mark matching message records as unsent and invalidate dependent summaries when possible. This is not the same as a complete user data deletion request. Full deletion remains manual or planned unless implemented as a command.

## Backup and Restore

Backups and restore drills are operator responsibilities. Backup files can contain private LINE identifiers and message content. Store them locally, protect them, and do not commit them.

## GitHub Rule

Never upload SQLite memory databases, backups, logs, runtime evidence, or private screenshots to GitHub.

