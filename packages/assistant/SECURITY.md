# NEXUS Security Policy

Non-negotiable rules baked into every plugin:

1. NO password storage — API tokens and SSH keys only. cPanel connect asks for an API token you generate in the cPanel UI, never your password.
2. NO OTP interception — NEXUS never reads SMS, email or authenticator codes.
3. NO CAPTCHA bypass — CAPTCHAs always pause for a human.
4. NO auto-login — login pages trigger a hard HITL pause. The co-pilot never types into password fields.
5. Session reuse is local-only — the co-pilot may reuse YOUR browser profile on YOUR machine after an explicit consent prompt. Sessions/cookies are never extracted or transmitted.
6. Explicit consent — destructive actions (delete db/file/account, payments, key rotation) require yes/no confirmation; `db:delete` additionally requires `--confirm`.
7. Audit logging records what was done, never credentials.
8. Tokens are written 0600 under ~/.nexus/. Snapshots exclude .env, keys and node_modules.

## What the tool CAN do

- Fill non-sensitive forms after you are logged in
- Manage hosting via official APIs (cPanel UAPI)
- Deploy via SSH/rsync/git with confirmation
- Run tests, scans, snapshots, translations locally

## What it will NEVER do

- Steal credentials, bypass auth, or solve challenges
- Send your session cookies or tokens anywhere
