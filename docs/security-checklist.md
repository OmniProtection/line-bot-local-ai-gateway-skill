# GitHub Public Security Checklist

Before publishing this repository, verify:

- No `.env` or local secret file is present.
- No LINE Channel Secret, Channel Access Token, reply token, search API key, or model API token is present.
- No SQLite DB, vector DB, memory DB, backup, or restore artifact is present.
- No logs or runtime evidence are present.
- No `node_modules`, `dist`, `build`, or coverage artifacts are present.
- No personal tunnel URL is present.
- No local absolute machine path is present.
- `SECURITY.md` exists.
- `PRIVACY.md` exists.
- `assets/template/.gitignore` exists and blocks runtime artifacts.
- Root `README.md` states this is not official LINE tooling.
- Root `README.md` explains that free means the local open-source tool, not all LINE services or third-party infrastructure.
- Verifier scripts pass.

Recommended commands:

```bash
node scripts/verify_public_hygiene.js
node scripts/verify_linebot_project.js assets/template
npm run check --prefix assets/template
npm run prod:readiness --prefix assets/template
```

Fresh template readiness may be `BLOCKED` when the missing items are real runtime, LINE smoke, manual evidence, backup, monitoring, or final approval gates.

