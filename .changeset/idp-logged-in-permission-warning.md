---
"@tailor-platform/sdk": patch
---

`tailor deploy` now warns when an IdP `permission` rule allows every authenticated user (`[{ user: "_loggedIn" }, "=", true]` as its only condition). Such a rule lets any signed-in user read and change other users' login information, such as email addresses, and send password reset emails to anyone. The deploy still succeeds; restrict the rule to an administrator role unless every user who can sign in is trusted.
