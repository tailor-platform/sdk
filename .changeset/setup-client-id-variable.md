---
"@tailor-platform/sdk-plugin-setup": minor
---

`tailor setup ci` now treats `TAILOR_PLATFORM_MACHINE_USER_CLIENT_ID` as a GitHub variable instead of a secret, because a client ID cannot authenticate without the client secret. The generated workflows read `vars.TAILOR_PLATFORM_MACHINE_USER_CLIENT_ID || secrets.TAILOR_PLATFORM_MACHINE_USER_CLIENT_ID`, so a repository that already stores the client ID as a secret keeps working without changes, and `tailor setup ci env` now prints `gh variable set` for it. `TAILOR_PLATFORM_MACHINE_USER_CLIENT_SECRET` stays a secret.
