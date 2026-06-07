# LINE Bot Project Operations Knowledge

This local knowledge base stores project and technical documentation for the LINE Bot.

Current platform constraints:
- LINE Bot should use Reply API first.
- WebSearch replies should stay reply-only and should not use Push for delayed search results.
- Group and room chats should not trigger a bot reply unless the bot is mentioned.
- Private chat, group chat, and room chat context must stay isolated by conversation scope.
- Local AI generation uses LM Studio through an OpenAI-compatible local API.

Sprint 4 knowledge behavior:
- Project-local Markdown and text files under `kb/` are imported into SQLite FTS5.
- Knowledge Base evidence is separate from chat memory.
- If a project or technical question needs Knowledge Base facts but no matching evidence exists, the bot should answer that the knowledge base data is insufficient instead of guessing.
- Unanswered project or technical questions are written to the local `unanswered_questions` table for later KB improvement.
