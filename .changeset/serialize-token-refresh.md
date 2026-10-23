---
"@tailor-platform/sdk": patch
---

Fix `tailor` commands that run at the same time breaking each other's login. When several commands found the stored token expired, each refreshed it, and all but one failed with `AUTH_TOKEN_REFRESH_FAILED`; sometimes the stored refresh token was left unusable, and every later command failed until you ran `tailor login` again. Commands now refresh one at a time and use the token another command already stored. `tailor logout` also waits for a refresh in progress, so the refresh no longer restores the user it removed. A command that waits too long for another one fails with `CONFIG_LOCK_TIMEOUT`.

The CLI now refreshes a token that expires within five minutes, so a command no longer starts with a token that is about to expire. Until the current token expires, the CLI keeps using it if that early refresh fails or another command is already refreshing. `loadAccessToken` from `@tailor-platform/sdk/cli` follows the same rules. The config file is now replaced in one step, so a command reading it while another writes it no longer fails to parse it.
