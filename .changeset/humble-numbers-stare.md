---
"@tailor-platform/sdk": patch
---

CLI plugins now receive the user's email in `TAILOR_PLATFORM_USER` when the profile or `TAILOR_PLATFORM_URL` selects a platform other than the default, as they already did on the default platform. They previously received the user ID.
