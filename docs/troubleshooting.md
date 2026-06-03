# Troubleshooting

## LINE Bot Does Not Reply

- Confirm the webhook server is running.
- Check `GET /health`.
- Confirm the public HTTPS endpoint points to the webhook server, not LM Studio.
- Confirm the LINE webhook URL ends in `/webhook`.
- Confirm the Channel Secret and Channel Access Token are present only in local `.env`.

## LINE Console Verify Fails

- Confirm the endpoint is publicly reachable over HTTPS.
- Confirm the tunnel targets the webhook server port.
- Confirm unsigned or invalid requests return `invalid_signature`.
- Check that credentials are local and not committed.

## LM Studio Does Not Respond

- Confirm LM Studio is running.
- Confirm the model is loaded.
- Confirm the OpenAI-compatible server is enabled.
- Confirm the configured endpoint uses `localhost` or `127.0.0.1`.
- Confirm the configured model name matches LM Studio.
- Expect timeout or fallback replies when the model is unavailable.

## Group Messages Reply Unexpectedly

- Group and room messages should require a bot mention.
- Messages without a bot mention should not reply, search, call the model, or organize background memory.
- Check mention metadata from LINE events if behavior differs.

## Web Search Finds Nothing

- Confirm `WEB_SEARCH_ENABLED=true`.
- Confirm `WEB_SEARCH_BACKGROUND_PUSH_ENABLED=true` if using Push API final results.
- Use explicit prefixes: `找:`, `搜:`, or `查:`.
- General chat should not search automatically.
- Search failures should produce a clear fallback, not fabricated sources.

## Readiness Is BLOCKED

Fresh templates can reasonably show `BLOCKED` until real runtime checks, public webhook checks, LINE smoke tests, backup/restore drill, monitoring, and final approval evidence are complete.

`BLOCKED` is not acceptable if caused by missing template files, committed secrets, personal paths, tunnel URLs, runtime artifacts, or missing public safety documents.

