# LINE Bot Local AI Gateway Skill Memory / WebSearch Update 2026-06-06

## Final Status

PASS_READY_TO_PUSH_BRANCH

## Executive Summary

- Synced the latest Memory and WebSearch runtime/template updates from the local development repo into `assets/template`.
- Source summary: `GO-LINEBOT-CONVERSATION-DEVELOPMENT-SUMMARY-20260606-001`.
- Source runtime repo state referenced: local development workspace, latest update commit `282c2cb Stabilize LINE Bot web search planning`.
- No real `.env`, LINE token, replyToken, search API key, SQLite DB, logs, backups, node_modules, or live webhook evidence were copied.
- Public hygiene and template verifier passed after removing a personal default public endpoint from copied production check scripts.
- Runtime dependency-backed tests that require `node_modules` were not installed or executed to completion.

## Update Scope

| Area | Summary |
| --- | --- |
| Memory | Synced memory safety, webhook flow, relevance gate, group/no-mention, duplicate handling, unsend handling, and event-log related template updates. |
| WebSearch | Synced explicit WebSearch command/policy/runtime planning updates, including SearchPlan v2 stabilization and Auto Decision Router support. |
| Gateway | Added durable gateway store and pipeline contract template files and related static tests. |
| LM Studio | Synced local model timeout, JSON parsing, reasoning trace guard, fallback, and persona-related updates. |
| Production checks | Synced dry-run/readiness scripts, then sanitized copied defaults for public template safety. |

## Modified Template Files

- `assets/template/.env.example`
- `assets/template/package.json`
- `assets/template/src/config.js`
- `assets/template/src/gatewayStore.js`
- `assets/template/src/lmStudioClient.js`
- `assets/template/src/memoryStore.js`
- `assets/template/src/pipelineContract.js`
- `assets/template/src/server.js`
- `assets/template/src/webSearchCommand.js`
- `assets/template/src/webSearchPolicy.js`
- `assets/template/src/webSearchService.js`
- `assets/template/scripts/*`
- `assets/template/searxng/README.md`

## Safety Handling

| Check | Result |
| --- | --- |
| Real `.env` copied | NO |
| Real LINE secrets copied | NO |
| replyToken copied | NO |
| Search API key copied | NO |
| SQLite DB / vector DB copied | NO |
| logs / backups copied | NO |
| node_modules copied | NO |
| live webhook evidence copied | NO |
| personal public endpoint retained | NO |

## Validation Results

| Command | Result | Notes |
| --- | --- | --- |
| `node scripts/verify_public_hygiene.js` | PASS | No findings. |
| `node scripts/verify_linebot_project.js assets/template` | PASS | `signature_gate: STATIC_VERIFIED`. |
| `npm run check --prefix assets/template` | PASS | Syntax checks passed for updated template files and scripts. |
| `npm run prod:readiness --prefix assets/template` | EXPECTED BLOCKED | Fresh template lacks real runtime, public webhook, LINE smoke, backup/restore, monitoring, and go-live evidence. |
| `node assets/template/scripts/test-memory-safety-static.js` | PASS | Static memory safety check passed. |
| `node assets/template/scripts/test-memory-webhook-flow-static.js` | PASS | Static memory webhook flow check passed. |
| `node assets/template/scripts/test-web-search-security.js` | PASS | No output; exit code 0. |
| `node assets/template/scripts/test-web-search-policy.js` | PASS | No output; exit code 0. |
| `node assets/template/scripts/test-web-search-command.js` | PASS | No output; exit code 0. |
| `node assets/template/scripts/test-web-search-flow-static.js` | PASS | No output; exit code 0. |
| `npm run test:web-search --prefix assets/template` | BLOCKED_PACKAGE_INSTALL_REQUIRED | Stopped at runtime test because template dependencies such as `express` are not installed. No package install was performed. |
| `node assets/template/scripts/test-memory-relevance-gate.js` | BLOCKED_PACKAGE_INSTALL_REQUIRED | Requires `better-sqlite3`; no package install was performed. |

## PR Review Fixes

Codex PR review on PR #2 reported three P2 findings. They were addressed in a follow-up commit:

| Finding | Resolution |
| --- | --- |
| Avoid persisting raw webhook events in durable payloads. | `webhook_event` durable jobs now persist only identifiers such as `webhookEventId` and `lineEventLogId`. Raw LINE events are not written into `jobs.payload_json`; reply tokens are kept only in process-local volatile memory. |
| Preserve webhook replies when retrying after side effects. | Durable webhook retry now reloads the existing sanitized `line_event_log` record and passes the existing `lineEventLogId` back into `handleEvent`, so retry does not stop at the duplicate insert guard before reply side effects. |
| Point evidence gates at the template docs directory. | Production evidence/readiness scripts now resolve productionization docs from `assets/template/docs/maintenance/...` through `PROJECT_ROOT/docs`, not the parent `assets/docs` path. |
| Ensure duplicate logs still enqueue durable jobs. | Duplicate `line_event_log` rows with an existing log id now continue through idempotent durable job enqueue, so LINE redelivery can recover a crash between log insert and job insert. |

Additional validation after review fixes:

| Command | Result | Notes |
| --- | --- | --- |
| `node assets/template/scripts/test-memory-webhook-flow-static.js` | PASS | Covers sanitized webhook durable payload and retry reuse path. |
| `node assets/template/scripts/production-evidence-secret-audit.js` | PASS | Scanned 8 template evidence records, no findings. |

## Release / GitHub Notes

- This update is prepared on branch `codex/memory-websearch-update-20260606`.
- It should be pushed as an update branch, not directly to `master`.
- `v0.1.0-alpha` remains a developer alpha.
- Stable / production-ready claims remain prohibited.
- Runtime invalid-signature tests, live LINE smoke, sanitized evidence, backup/restore, monitoring, and go-live approval remain future work.

## Recommended Next Step

Push branch:

```bash
git push -u origin codex/memory-websearch-update-20260606
```

Then open a GitHub PR to review Memory and WebSearch updates before merging into `master`.
