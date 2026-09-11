---
"@tailor-platform/sdk": minor
---

Add `logger.registerSecret(value)` to the CLI logger (`@tailor-platform/sdk/cli`). Values registered this way are automatically replaced with `<redacted>` in diagnostic log output (`info`/`success`/`warn`/`error`/`log`/`debug`), as a technical safety net on top of the existing convention of not passing secret values to the logger. `logger.out()` is unaffected, so commands that intentionally print a secret as their primary result (machine user tokens, OAuth2 client secrets) are unchanged. The CLI itself now registers access tokens, refresh tokens, OAuth2/IdP client secrets, and Secret Manager values as soon as they enter the process.

Fix: `tailor user pat create` / `tailor user pat update` now print their human-readable "token created/updated" message (including the new token value) to stdout instead of stderr. The new token is this command's primary output — the thing a script actually wants to capture — so printing it to stderr instead of stdout was inconsistent with every other command that returns a value (`--json` mode was unaffected and already used stdout). If a script was working around this by reading the token from stderr, switch it to stdout.
