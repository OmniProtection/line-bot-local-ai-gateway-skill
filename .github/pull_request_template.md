# LINE Bot Local AI Gateway Skill Pull Request

## Summary

Describe the change.

## Scope

- [ ] Docs only
- [ ] Verifier / CI
- [ ] Template source
- [ ] Skill metadata
- [ ] Other:

## Changed Files

List notable files.

## Tests Run

```bash
node scripts/verify_public_hygiene.js
node scripts/verify_linebot_project.js assets/template
npm run check --prefix assets/template
```

## Validation Commands

- [ ] Public hygiene passed.
- [ ] Template verifier passed.
- [ ] Syntax check passed.
- [ ] `prod:readiness` was not required as a blocking CI check.

## Security Impact

Describe any impact on signature verification, secrets, SSRF, prompt injection, remote LLM, or CI.

## Privacy Impact

Describe any impact on LINE identifiers, messages, memory, logs, search queries, or evidence.

## Docs Updated

- [ ] README/docs updated where needed.
- [ ] Security/privacy docs updated if needed.
- [ ] Release notes updated if needed.

## Safety Checklist

- [ ] No secrets.
- [ ] No `.env`.
- [ ] No LINE Channel Secret, Access Token, replyToken, or search API key.
- [ ] No runtime DB, logs, backups, `node_modules`, `dist`, or `build` artifacts.
- [ ] No live LINE evidence.
- [ ] No private tunnel URL.
- [ ] No deployment, tag, push, or release automation.
- [ ] No stable, production-ready, or official LINE claim.
