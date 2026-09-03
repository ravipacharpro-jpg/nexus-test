---
name: notify
description: Ping the user on Telegram or Discord when an autonomous run hits a human checkpoint, needs confirmation, finishes, or gets blocked. Keeps the user informed during long unattended sessions.
---

# Notify

Used so the agent can run autonomously and only surface what needs the user.
Sends a message via Telegram Bot API or a Discord webhook using `curl` (allowed
via `bash`).

## Secrets (never in config)

Store these in the NEXUS vault or shell environment, not in `opencode.jsonc`:

- `TELEGRAM_BOT_TOKEN` — from @BotFather
- `TELEGRAM_CHAT_ID` — your chat id
- `DISCORD_WEBHOOK` — channel webhook URL

## Send helpers

Telegram:
```bash
curl -s -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendMessage" \
  -d "chat_id=$TELEGRAM_CHAT_ID" \
  --data-urlencode "text=✅ Deploy done: $SITE_URL"
```

Discord:
```bash
curl -s -X POST "$DISCORD_WEBHOOK" \
  -H "Content-Type: application/json" \
  -d "{\"content\":\"⚠️ Checkpoint: need login at $URL\"}"
```

## When to notify

- Task finished (with result / live URL)
- Reached a human checkpoint (login, OTP, CAPTCHA, payment)
- Needs explicit confirmation for a consequential/prod action (include the
  preflight diff in the message)
- Blocked / error that needs the user

Never send secrets, cookies, tokens, or OTPs in the notification body.
