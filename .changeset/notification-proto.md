---
"@tailor-platform/sdk": patch
---

`tailor api inspect` and shell completion now know the platform notification inbox endpoints (`ListMyNotifications`, `GetMyNotification`, `CountMyUnreadNotifications`, `MarkMyNotificationsRead`, `DismissMyNotification`), and `--field` values for them are typed from their request schema.
