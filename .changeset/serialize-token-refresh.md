---
"@tailor-platform/sdk": patch
---

Fix `tailor` commands that run at the same time breaking each other's login. When several commands found the stored token expired, each refreshed it, and all but one failed with `AUTH_TOKEN_REFRESH_FAILED`; sometimes the stored refresh token was left unusable, and every later command failed until you ran `tailor login` again. Commands now refresh one at a time and use the token another command already stored. `tailor logout` also waits for a refresh in progress, so the refresh no longer restores the user it removed.

The CLI now refreshes a token that expires within five minutes, so a command such as `tailor deploy` no longer starts with a token that expires partway through. If that early refresh fails, the CLI uses the current token until it expires. `loadAccessToken` from `@tailor-platform/sdk/cli` follows the same rules. The config file is now replaced in one step, so a command reading it while another writes it no longer fails to parse it.
