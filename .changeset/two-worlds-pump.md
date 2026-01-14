---
"@tailor-platform/sdk": patch
---

Made it possible to change the OAuth2 Client ID

By setting PLATFORM_OAUTH2_CLIENT_ID, you can now change the OAuth2 Client ID used for logging into Tailor Platform. Using it in combination with PLATFORM_URL makes it easier to log into non-production Tailor Platform environments for testing. This is for internal debugging purposes and is not intended to be set by regular users.
