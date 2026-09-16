---
"@tailor-platform/sdk": patch
---

Fix a bug where the CLI could unnecessarily require a full `tailor login` sooner than expected. When a token refresh succeeded but the server did not issue a new refresh token, the CLI was overwriting the still-valid saved refresh token with nothing, so the very next time the access token expired there was no refresh token left to try and the CLI forced a fresh login instead of attempting one more refresh.
