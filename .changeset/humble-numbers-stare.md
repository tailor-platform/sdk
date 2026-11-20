---
"@tailor-platform/sdk": patch
---

CLI plugins now receive the user's email in `TAILOR_PLATFORM_USER` when the profile or `TAILOR_PLATFORM_URL` selects a platform other than the default, as they already did on the default platform. They previously received the user ID.

When a profile's `platform_url` differs from `TAILOR_PLATFORM_URL` (or the default) and its user has no login saved for that platform, plugins now receive the user ID instead of the email from a login not tied to a platform. No token is injected in that case, as before.
