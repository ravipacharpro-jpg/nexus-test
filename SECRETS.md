# Secrets Vault Map

The agent pulls credentials from these locations. **Never** store secrets in
config files or commit them. Credentials are only entered by the user at
human checkpoints.

| Service        | How the agent authenticates                          | Notes |
|----------------|------------------------------------------------------|-------|
| GitHub         | `gh auth login` (token in gh credential store)       | Use `gh` CLI; never paste tokens into chat or config. |
| Firebase       | `firebase login` / service account in `./` + env     | Keep service-account JSON out of git. |
| Supabase       | `supabase login` (OAuth) + project keys from dashboard | Keys via `supabase status`; never hardcode in source. |
| cPanel/Hostinger | SSH key auth; host & user in skill config          | Passwords are NOT stored — user provides at checkpoint if needed. |
| Telegram notify| bot token + chat id via `nexus_notify` env / skill config | Set once; used only to ping the user. |
| App API keys   | project `.env` (gitignored)                           | Injected at runtime, never committed. |

## Rules
- The agent never asks for a password/OTP in chat — it pauses and waits for the
  user to complete the step in the browser/CLI.
- On `nexus` update, this vault map is safe because it lives outside the repo
  (user-level `~/.config/nexus/`) and in your head, not in bundled config.
