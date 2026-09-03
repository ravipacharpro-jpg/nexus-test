---
name: deploy
description: End-to-end deploy orchestration for any web project — build, choose hosting (Render/Vercel/Netlify/Firebase/GitHub Pages), show preflight diff, get explicit confirmation for production, deploy, and verify the live result.
---

# Deploy

Drives a full build → host → verify cycle with a hard confirmation gate before
anything reaches production.

## Steps

1. **Build**
   ```bash
   npm ci && npm run build
   ```
   Fail fast and self-heal (see incident response) before continuing.

2. **Choose target** (from user preference / memory, or ask once):
   - Render / Vercel / Netlify — via their CLI or the `playwright` browser UI
   - Firebase Hosting — `firebase deploy` (see firebase skill)
   - GitHub Pages — push to `gh-pages` / Actions

3. **Preflight diff** — show exactly what will change (files, env, routes).

4. **Confirm gate** — for production, pause and wait for explicit, current
   user confirmation. Include the preflight diff in the notify message if the
   user is away.

5. **Deploy** — run the deploy command / browser flow.

6. **Verify** — after deploy:
   - `curl -I <live-url>` for status
   - `playwright` open the live URL, screenshot, check for console errors
   - report result + live URL to the user (notify skill)

## Boundaries

- Never deploy to production without explicit confirmation.
- Never enable billing / paid plans without confirmation.
- Never write secrets into the deployed artifact or logs.
- Login / OTP / CAPTCHA on hosting dashboards stay at the human checkpoint.
