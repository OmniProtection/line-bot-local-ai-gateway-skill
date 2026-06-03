# Release Checklist

This checklist is for public alpha release preparation. It does not authorize deployment, tag creation, push, or GitHub Release publication by itself.

## GitHub Public Checklist

- README states non-official LINE status.
- README states free-scope limits.
- README states alpha and not production ready.
- Repo description does not imply official LINE tooling.
- GitHub secret scanning is enabled.
- GitHub push protection is enabled.
- Dependabot alerts are enabled.

## Zero-Secret Validation

```bash
node scripts/verify_public_hygiene.js
```

Expected: `PASS`.

## Template Validation

```bash
node scripts/verify_linebot_project.js assets/template
npm run check --prefix assets/template
```

Expected: `PASS`.

## README / Docs Checklist

- Developer quickstart exists.
- Live smoke test guide exists.
- Demo walkthrough exists.
- Customization guide exists.
- Security, privacy, memory, web-search, and local LLM docs exist.

## SECURITY / PRIVACY Checklist

- SECURITY explains private reporting.
- SECURITY explains credential rotation/revocation.
- PRIVACY explains local-first flow.
- PRIVACY explains memory and web-search data movement.
- Remote LLM warning exists.

## Release Notes Checklist

- `docs/releases/v0.1.0-alpha.md` exists.
- Not Included section is complete.
- Known limitations include static signature gate and no live smoke evidence.

## Tag Checklist

- Tag only after explicit approval.
- Use `v0.1.0-alpha`.
- Do not create stable or production-ready tags.

## GitHub UI Settings Checklist

- Secret scanning enabled.
- Push protection enabled.
- Dependabot alerts enabled.
- Issues policy decided.
- Discussions policy decided.
- Topics reviewed.

## No Stable / Production Claim Checklist

- No `v1.0.0` release claim.
- No stable claim.
- No production-ready claim.
- Production readiness remains blocked until operator evidence exists.

## No Real Token Checklist

- No LINE Channel Secret.
- No Channel Access Token.
- No reply token.
- No search API key.
- No model provider token.

## No Runtime Artifact Checklist

- No `.env`.
- No SQLite DB.
- No vector DB.
- No logs.
- No backups.
- No `node_modules`.
- No `dist` or `build`.

## No Live LINE Evidence Checklist

- No real webhook payload.
- No real user conversation.
- No private LINE Developers Console screenshot.
- No private tunnel URL.

`v0.1.0-alpha` can be public after gates pass. `v1.0.0` or stable must wait for runtime invalid signature tests, sanitized LINE smoke evidence, backup/restore evidence, monitoring, and go-live approval.

