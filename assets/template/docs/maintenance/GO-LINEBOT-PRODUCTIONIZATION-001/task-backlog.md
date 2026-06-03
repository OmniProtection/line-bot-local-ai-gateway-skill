# LINE Bot Productionization Task Backlog

## Status Rules

Only these task statuses are used:

- PASS
- FAIL
- BLOCKED
- CEO_DECISION_REQUIRED

| Task ID | Task | Status | Acceptance Criteria | Evidence Required |
| --- | --- | --- | --- | --- |
| LINEBOT-P0-T01 | Initialize productionization docs. | PASS | Template docs exist and contain no secrets. | `docs/maintenance/GO-LINEBOT-PRODUCTIONIZATION-001/` |
| LINEBOT-P1-T01 | Verify local runtime. | BLOCKED | `GET /health` returns `ok:true` from the intended bot. | `npm run prod:health:local` |
| LINEBOT-P2-T01 | Verify public webhook endpoint. | BLOCKED | Public `/health` works and unsigned `/webhook` returns `invalid_signature`. | `PUBLIC_WEBHOOK_BASE_URL`; `npm run prod:public:execute` |
| LINEBOT-P3-T01 | Verify LM Studio readiness. | BLOCKED | LM Studio `/v1/models` is reachable and configured model is loaded. | `npm run prod:health:local` |
| LINEBOT-P4-T01 | Run real LINE smoke tests. | BLOCKED | Private, group mention/no-mention, memory, and search scenarios are manually verified. | sanitized manual evidence |
| LINEBOT-P5-T01 | Verify backup and restore drill. | BLOCKED | Backup dry run and copied restore drill pass without mutating live DB. | `npm run prod:backup:dry-run`; `npm run prod:restore-drill:dry-run` |
| LINEBOT-P6-T01 | Approve final go-live. | CEO_DECISION_REQUIRED | User explicitly approves production status after all gates pass. | `evidence-records/gate-h-go-live-approval.json` |
