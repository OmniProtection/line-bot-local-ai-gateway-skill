# LINE Official Setup Guide

This guide describes manual setup only. The Skill does not automate LINE account creation, LINE Developers Console login, credential retrieval, tunnel creation, or deployment.

## Manual Steps

1. Create or select a LINE Official Account in the official LINE interface.
2. Enable Messaging API for the account.
3. Create or select a LINE Developers provider and Messaging API channel.
4. Copy the Channel Secret and Channel Access Token into your local `.env` file only.
5. Start the local webhook server.
6. Create your own HTTPS endpoint or tunnel that points only to the webhook server.
7. Set the LINE webhook URL to your HTTPS endpoint ending in `/webhook`.
8. Enable webhook usage in LINE Developers Console.
9. Use LINE Console verify to confirm the webhook can be reached.
10. Run private, group mention, group no-mention, memory, and search smoke tests with sanitized evidence.

## Do Not Commit

- Channel Secret.
- Channel Access Token.
- reply token.
- `.env`.
- LINE webhook evidence containing private payloads.
- LINE Developers Console private screenshots.
- Personal tunnel URLs.

If a credential is exposed, rotate or revoke it before continuing.

